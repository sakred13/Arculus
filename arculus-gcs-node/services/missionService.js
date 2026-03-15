const { isUserOfType, getUserFromToken, getUserIdFromName } = require('./authService');
const pool = require('../modules/arculusDbConnection');
const fs = require('fs');
const util = require('util');
const { execSync, exec } = require('child_process');
const { addNetworkPolicyDuringMission, deleteNetworkPolicyDuringMission } = require('./policyService');
const path = require('path');
const crypto = require('crypto');

const execAsync = util.promisify(exec);

// Read secret once at startup — synchronous read is acceptable at module load time
let cryptSecret = '';
try {
    cryptSecret = fs.readFileSync('configs/ENCRYPTION_SECRET.txt', 'utf8').trim();
} catch (err) {
    console.error('Failed to load ENCRYPTION_SECRET.txt:', err.message);
}

// Mission-scoped global state
let gcX = null;
let gcY = null;
let destX = null;
let destY = null;
let survDroneName = null;
let survDroneIp = null;
let supplyDroneName = null;
let supplyDroneIp = null;
let survX = null;
let survY = null;
let supplyX = null;
let supplyY = null;
let missionRunning = false;
const ipCache = {};

// ---------------------------------------------------------------------------
// startMission
// ---------------------------------------------------------------------------
exports.startMission = async (req, res) => {
    const {
        authToken, gcX: newGcX, gcY: newGcY, destX: newDestX, destY: newDestY,
        survDroneName: newSurvDroneName, survDroneIp: newSurvDroneIp,
        supplyDroneName: newSupplyDroneName, supplyDroneIp: newSupplyDroneIp
    } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
        }

        gcX = newGcX; gcY = newGcY; destX = newDestX; destY = newDestY;
        survDroneName = newSurvDroneName; survDroneIp = newSurvDroneIp;
        supplyDroneName = newSupplyDroneName; supplyDroneIp = newSupplyDroneIp;
        missionRunning = true;
        survX = gcX; survY = gcY; supplyX = gcX; supplyY = gcY;

        res.status(200).json({ message: 'Mission data updated successfully' });

        const incrementCoordinates = () => {
            if (missionRunning) {
                survX += 1;
                survY += 1;
                setTimeout(incrementCoordinates, 3000);
            }
        };
        incrementCoordinates();

    } catch (error) {
        console.error('Error in startMission:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// getMissionState — returns global mission variables (auth-gated)
// ---------------------------------------------------------------------------
exports.getMissionState = async (req, res) => {
    const { authToken } = req.query;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
        }

        return res.status(200).json({
            gcX, gcY, destX, destY, survDroneName, survDroneIp,
            supplyDroneName, supplyDroneIp, survX, survY, supplyX, supplyY, missionRunning
        });
    } catch (error) {
        console.error('Error in getMissionState:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// createMission
// ---------------------------------------------------------------------------
exports.createMission = async (req, res) => {
    const { authToken, mission_config, supervisors, viewers } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isMissionCreator = await isUserOfType(username, ['Mission Creator']);

        if (!isMissionCreator) {
            console.error('Unauthorized: Only mission creators can create missions');
            return res.status(401).json({ message: 'Unauthorized: Only mission creators can create missions' });
        }

        const creatorId = await getUserIdFromName(username);

        const connection = await pool.promise().getConnection();
        try {
            await connection.beginTransaction();

            const [missionResult] = await connection.query(
                `INSERT INTO mission (creator_id, mission_config, state) VALUES (?, ?, 'CREATED')`,
                [creatorId, mission_config]
            );
            const missionId = missionResult.insertId;

            if (supervisors && supervisors.length > 0) {
                const supervisorValues = supervisors.map(supervisorId => [supervisorId, missionId]);
                await connection.query('INSERT INTO supervisor (user_id, mission_id) VALUES ?', [supervisorValues]);
            }

            if (viewers && viewers.length > 0) {
                const viewerValues = viewers.map(viewerId => [viewerId, missionId]);
                await connection.query('INSERT INTO viewer (user_id, mission_id) VALUES ?', [viewerValues]);
            }

            await connection.commit();
            connection.release();

            return res.status(200).json({ missionId });

        } catch (dbErr) {
            await connection.rollback();
            connection.release();
            throw dbErr;
        }
    } catch (error) {
        console.error('Error in createMission:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// getMissionById — returns a Promise (callers updated accordingly)
// ---------------------------------------------------------------------------
exports.getMissionById = async (authToken, missionId) => {
    const userName = getUserFromToken(authToken);
    await getUserIdFromName(userName); // validate user exists

    const [missionResults] = await pool.promise().query(
        'SELECT * FROM mission WHERE mission_id = ?', [missionId]
    );
    if (missionResults.length === 0) throw new Error('Mission not found');

    const [supervisorResults, viewerResults] = await Promise.all([
        pool.promise().query('SELECT * FROM supervisor WHERE mission_id = ?', [missionId]),
        pool.promise().query('SELECT * FROM viewer WHERE mission_id = ?', [missionId]),
    ]);

    return {
        mission: missionResults[0],
        supervisors: supervisorResults[0],
        viewers: viewerResults[0],
    };
};

// ---------------------------------------------------------------------------
// Shared row-mapper for mission list queries
// ---------------------------------------------------------------------------
const mapMissionRows = (rows) =>
    rows.map(row => ({
        config: row.config,
        state: row.state,
        mission_id: row.mission_id,
        supervisors: row.supervisors ? row.supervisors.split(',') : [],
        viewers: row.viewers ? row.viewers.split(',') : [],
    }));

const MISSION_SELECT_FIELDS = `
    SELECT
        m.mission_config AS config,
        m.state,
        m.mission_id,
        GROUP_CONCAT(DISTINCT u1.username) AS supervisors,
        GROUP_CONCAT(DISTINCT u2.username) AS viewers
    FROM mission AS m
    LEFT JOIN supervisor AS s ON m.mission_id = s.mission_id
    LEFT JOIN viewer AS v ON m.mission_id = v.mission_id
    LEFT JOIN user AS u1 ON s.user_id = u1.user_id
    LEFT JOIN user AS u2 ON v.user_id = u2.user_id`;

// ---------------------------------------------------------------------------
// getMissionsByCreatorId
// ---------------------------------------------------------------------------
exports.getMissionsByCreatorId = async (req, res) => {
    try {
        const username = getUserFromToken(req.query.authToken);
        const creatorId = await getUserIdFromName(username);

        const [missionsResult] = await pool.promise().query(
            `${MISSION_SELECT_FIELDS} WHERE m.creator_id = ? GROUP BY m.mission_config, m.state, m.mission_id;`,
            [creatorId]
        );

        if (missionsResult && missionsResult.length > 0) {
            return res.status(200).json({ missions: mapMissionRows(missionsResult) });
        }
        return res.status(404).json({ message: 'No missions found for the given creator' });
    } catch (error) {
        console.error('Error in getMissionsByCreatorId:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// getMissionsBySupervisorId
// ---------------------------------------------------------------------------
exports.getMissionsBySupervisorId = async (req, res) => {
    try {
        const username = getUserFromToken(req.query.authToken);
        const supervisorId = await getUserIdFromName(username);

        const [missionsResult] = await pool.promise().query(
            `${MISSION_SELECT_FIELDS} WHERE s.user_id = ? GROUP BY m.mission_config, m.state, m.mission_id;`,
            [supervisorId]
        );

        if (missionsResult && missionsResult.length > 0) {
            return res.status(200).json({ missions: mapMissionRows(missionsResult) });
        }
        return res.status(404).json({ message: 'No missions found for the given supervisor' });
    } catch (error) {
        console.error('Error in getMissionsBySupervisorId:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// getMissionsByViewerId
// ---------------------------------------------------------------------------
exports.getMissionsByViewerId = async (req, res) => {
    try {
        const username = getUserFromToken(req.query.authToken);
        const viewerId = await getUserIdFromName(username);

        const [missionsResult] = await pool.promise().query(
            `${MISSION_SELECT_FIELDS} WHERE u2.user_id = ? GROUP BY m.mission_config, m.state, m.mission_id;`,
            [viewerId]
        );

        if (missionsResult && missionsResult.length > 0) {
            return res.status(200).json({ missions: mapMissionRows(missionsResult) });
        }
        return res.status(404).json({ message: 'No missions found for the given viewer' });
    } catch (error) {
        console.error('Error in getMissionsByViewerId:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// updateMission — Promise-based (callers updated accordingly)
// ---------------------------------------------------------------------------
exports.updateMission = async (authToken, missionId, newData) => {
    const username = getUserFromToken(authToken);
    const isMissionCreator = await isUserOfType(username, ['Mission Creator']);

    if (!isMissionCreator) {
        throw new Error('Unauthorized: Only mission creators can update missions');
    }

    const connection = await pool.promise().getConnection();
    try {
        await connection.beginTransaction();

        const [updateResult] = await connection.query(
            'UPDATE mission SET ? WHERE mission_id = ?', [newData, missionId]
        );
        if (updateResult.affectedRows === 0) throw new Error('Mission not found');

        // Run supervisor and viewer updates concurrently (replaces async.parallel)
        await Promise.all([
            connection.query('UPDATE supervisor SET ? WHERE mission_id = ?', [newData, missionId]),
            connection.query('UPDATE viewer SET ? WHERE mission_id = ?', [newData, missionId]),
        ]);

        await connection.commit();
        connection.release();
    } catch (dbErr) {
        await connection.rollback();
        connection.release();
        throw dbErr;
    }
};

// ---------------------------------------------------------------------------
// deleteMission
// ---------------------------------------------------------------------------
exports.deleteMission = async (req, res) => {
    const { authToken, missionId } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isMissionCreator = await isUserOfType(username, ['Mission Creator']);

        if (!isMissionCreator) {
            return res.status(403).send({ message: 'Unauthorized: Only mission creators can delete missions' });
        }

        const connection = await pool.promise().getConnection();
        try {
            await connection.beginTransaction();

            // Sequential deletes replace async.waterfall, ensuring referential integrity
            await connection.query('DELETE FROM supervisor WHERE mission_id = ?', [missionId]);
            await connection.query('DELETE FROM viewer WHERE mission_id = ?', [missionId]);

            const [result] = await connection.query(
                'DELETE FROM mission WHERE mission_id = ?', [missionId]
            );
            if (result.affectedRows === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).send({ message: 'Mission not found' });
            }

            await connection.commit();
            connection.release();

            return res.status(200).send({ message: 'Mission successfully deleted' });
        } catch (dbErr) {
            await connection.rollback();
            connection.release();
            throw dbErr;
        }
    } catch (error) {
        console.error('Error in deleteMission:', error);
        return res.status(500).send({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// getMissionState (device/kubectl variant)
// ---------------------------------------------------------------------------
exports.getDeviceMissionState = (req, res) => {
    const { deviceName } = req.query;
    try {
        const command = `kubectl exec ${deviceName} -n default -- cat mission_state.json`;
        const missionStateJson = execSync(command, { encoding: 'utf-8' });
        try {
            return res.status(200).json(JSON.parse(missionStateJson));
        } catch {
            return res.status(200).send(missionStateJson);
        }
    } catch (error) {
        console.error('Error fetching device mission state:', error.stderr || error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// Helper: fetch pod IP via kubectl
// ---------------------------------------------------------------------------
const getPodIp = async (podName) => {
    const { stdout } = await execAsync(`kubectl get pod ${podName} -n default -o json`);
    return JSON.parse(stdout).status.podIP;
};

// ---------------------------------------------------------------------------
// Helper: clean up network policies after mission ends
// ---------------------------------------------------------------------------
const cleanupPolicies = (controller, relayDrone, surveillanceDrone, supplyDrone) => {
    deleteNetworkPolicyDuringMission(`policy-${controller}`);
    deleteNetworkPolicyDuringMission(`policy-${relayDrone}`);
    deleteNetworkPolicyDuringMission(`policy-${surveillanceDrone}`);
    deleteNetworkPolicyDuringMission(`policy-${supplyDrone}`);
};

// ---------------------------------------------------------------------------
// executeStealthyReconAndResupply
// ---------------------------------------------------------------------------
exports.executeStealthyReconAndResupply = async (req, res) => {
    const { gcX, gcY, destX, destY, controller, supplyDrone, surveillanceDrone, relayDrone, missionId } = req.body;

    // Respond immediately; the long-running execution happens in the background
    res.status(200).json({ message: 'IP retrieval initiated' });

    try {
        const [supplyDroneIP, surveillanceDroneIP, relayDroneIP] = await Promise.all([
            getPodIp(supplyDrone),
            getPodIp(surveillanceDrone),
            getPodIp(relayDrone),
        ]);

        await pool.promise().query(
            'UPDATE mission SET state = ? WHERE mission_id = ?', ['IN EXECUTION', missionId]
        );
        console.log('Mission status updated to IN EXECUTION.');

        await Promise.all([
            addNetworkPolicyDuringMission(surveillanceDrone, [{ device: controller, port: '3050', protocol: 'TCP' }, { device: relayDrone, port: '3050', protocol: 'TCP' }], [{ device: controller, port: '6001', protocol: 'UDP' }]),
            addNetworkPolicyDuringMission(supplyDrone, [{ device: controller, port: '4050', protocol: 'TCP' }, { device: relayDrone, port: '4050', protocol: 'TCP' }], [{ device: controller, port: '6002', protocol: 'UDP' }]),
            addNetworkPolicyDuringMission(relayDrone, [{ device: controller, port: '5050', protocol: 'TCP' }], [{ device: controller, port: '6003', protocol: 'UDP' }]),
            addNetworkPolicyDuringMission(controller, [{ device: supplyDrone, port: '6002', protocol: 'UDP' }, { device: surveillanceDrone, port: '6001', protocol: 'UDP' }, { device: relayDrone, port: '6003', protocol: 'UDP' }], [{ device: relayDrone, port: '5050', protocol: 'TCP' }, { device: surveillanceDrone, port: '3050', protocol: 'TCP' }, { device: supplyDrone, port: '4050', protocol: 'TCP' }]),
        ]);

        ipCache[relayDrone] = relayDroneIP;
        ipCache[surveillanceDrone] = surveillanceDroneIP;
        ipCache[supplyDrone] = supplyDroneIP;

        const command = `kubectl exec ${controller} -n default -- python3 controller.py ${gcX} ${gcY} ${destX} ${destY} ${surveillanceDroneIP} ${supplyDroneIP} ${relayDroneIP}`;
        console.log('Executing command:', command);

        try {
            const { stdout } = await execAsync(command);
            console.log('Script executed successfully:', stdout);

            await pool.promise().query('UPDATE mission SET state = ? WHERE mission_id = ?', ['SUCCESSFUL', missionId]);
            cleanupPolicies(controller, relayDrone, surveillanceDrone, supplyDrone);
            console.log('Mission status updated to SUCCESSFUL.');

        } catch (execErr) {
            console.error('Error executing controller command:', execErr);

            await pool.promise().query('UPDATE mission SET state = ? WHERE mission_id = ?', ['ABORTED', missionId]);
            cleanupPolicies(controller, relayDrone, surveillanceDrone, supplyDrone);

            await execAsync(`kubectl exec ${controller} -n default -- sh -c 'echo "" > mission_state.json'`);
            await execAsync(`kubectl exec ${controller} -n default -- sh -c 'echo "connected" > survState.txt'`);
            await execAsync(`kubectl exec ${controller} -n default -- sh -c 'echo "connected" > supState.txt'`);

            console.log('Mission status updated to ABORTED.');
        }
    } catch (criticalError) {
        console.error('Critical failure during recon and resupply:', criticalError);
    }
};

// ---------------------------------------------------------------------------
// simulateBadNetwork
// ---------------------------------------------------------------------------
exports.simulateBadNetwork = (req, res) => {
    const { controller, type } = req.body;
    const drone = `${type}State.txt`;
    const command = `kubectl exec ${controller} -n default -- sh -c 'echo "disconnected" > ${drone}'`;
    console.log(command);
    exec(command);
    return res.status(200).json({ message: 'Network simulation initiated' });
};

// ---------------------------------------------------------------------------
// simulateGpsSpoofing
// ---------------------------------------------------------------------------
exports.simulateGpsSpoofing = (req, res) => {
    const { controller, device, slope, distance } = req.body;
    const drone = device === 'surv' ? 'spoofGpsSurv.txt' : 'spoofGpsSup.txt';
    const command = `kubectl exec ${controller} -n default -- sh -c 'echo "${slope},${distance}" > ${drone}'`;
    console.log(command);
    exec(command);
    return res.status(200).json({ message: 'GPS Spoofing simulation initiated' });
};

// ---------------------------------------------------------------------------
// simulatePhysicalCapture
// ---------------------------------------------------------------------------
exports.simulatePhysicalCapture = (req, res) => {
    const { device } = req.body;
    deleteNetworkPolicyDuringMission(`policy-${device}`);
    return res.status(200).json({ message: 'Physical Capture simulation successful' });
};

// ---------------------------------------------------------------------------
// downloadMissionManifest
// ---------------------------------------------------------------------------
exports.downloadMissionManifest = async (req, res) => {
    const { authToken } = req.query;

    try {
        const username = getUserFromToken(authToken);
        const isMissionCreator = await isUserOfType(username, ['Mission Creator']);

        if (!isMissionCreator) {
            return res.status(403).send({ message: 'Unauthorized: Only mission creators can download manifests' });
        }

        const algorithm = 'aes-256-ctr';
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, cryptSecret, iv);
        const encryptedData = Buffer.concat([cipher.update(JSON.stringify(req.body)), cipher.final()]);

        const timestamp = Date.now();
        const directoryPath = path.join(__dirname, 'tmp');
        const filePath = path.join(directoryPath, `manifest_${timestamp}.mconf`);

        await fs.promises.mkdir(directoryPath, { recursive: true });
        await fs.promises.writeFile(filePath, Buffer.concat([iv, encryptedData]));

        res.download(filePath, `manifest_${timestamp}.mconf`, async (downloadErr) => {
            if (downloadErr) {
                console.error('Error while downloading the file:', downloadErr);
            }
            try {
                await fs.promises.unlink(filePath);
            } catch (unlinkErr) {
                console.error('Error while deleting manifest file:', unlinkErr);
            }
        });

    } catch (error) {
        console.error('Error in downloadMissionManifest:', error);
        return res.status(500).send('Internal Server Error');
    }
};

// ---------------------------------------------------------------------------
// uploadMissionManifest
// ---------------------------------------------------------------------------
exports.uploadMissionManifest = async (req, res) => {
    const { authToken } = req.query;

    try {
        const username = getUserFromToken(authToken);
        const isMissionCreator = await isUserOfType(username, ['Mission Creator']);

        if (!isMissionCreator) {
            return res.status(403).send({ message: 'Unauthorized: Only mission creators can upload manifests' });
        }

        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).send('No files were uploaded.');
        }

        const fileBuffer = req.files.uploadedFile.data;
        const iv = fileBuffer.slice(0, 16);

        if (iv.length !== 16) {
            return res.status(400).send('Invalid IV length. Expected IV length: 16 bytes.');
        }

        const decipher = crypto.createDecipheriv('aes-256-ctr', cryptSecret, iv);
        const decryptedData = Buffer.concat([decipher.update(fileBuffer.slice(16)), decipher.final()]);

        try {
            return res.json(JSON.parse(decryptedData.toString()));
        } catch (parseErr) {
            console.error('Error parsing JSON:', parseErr);
            return res.status(500).send('Error parsing JSON');
        }

    } catch (error) {
        console.error('Error in uploadMissionManifest:', error);
        return res.status(500).send('Internal Server Error');
    }
};
