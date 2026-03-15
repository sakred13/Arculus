const { isUserOfType, getUserFromToken } = require('./authService');
const pool = require('../modules/arculusDbConnection');
const { exec } = require('child_process');
const util = require('util');
const ip = require('ip');
const fs = require('fs');
const temp = require('temp').track();

const execAsync = util.promisify(exec);

var requestList = {};
var acceptedList = {};
var blockList = {};

// In production this should be async or in memory cache, keeping it as is 
// strictly for startup since it mimics the original layout
let imageMap = {};
try {
    imageMap = JSON.parse(fs.readFileSync('configs/dockerImageConfig.json', 'utf8'));
} catch (error) {
    console.error('Failed to load imageMap:', error.message);
}

// WebSocket server setup
exports.joinReqsWebSocket = (ws, req) => {
    console.log('WebSocket client connected');
    ws.send(JSON.stringify(requestList));

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });

    const updateInterval = setInterval(() => {
        ws.send(JSON.stringify(requestList));
    }, 5000);

    ws.on('close', () => {
        clearInterval(updateInterval);
    });
};

exports.joinStatusWebSocket = (ws, req) => {
    console.log('WebSocket client connected');
    const nodeName = new URLSearchParams(req.url.split('?')[1]).get('nodeName');
    ws.send("Request submitted. Please hang on until an administrator approves your request.");

    ws.on('close', () => console.log('WebSocket client disconnected'));

    const checkNodeInterval = setInterval(() => {
        if (Object.values(acceptedList).includes(nodeName)) {
            ws.send("Join Successful");
            clearInterval(checkNodeInterval);
            ws.close();
        } else if (Object.values(blockList).includes(nodeName)) {
            ws.send("Request Declined");
            clearInterval(checkNodeInterval);
            ws.close();
        }
    }, 5000);
};

// Database helper functions using promise queries
const getTaskIdsByName = async (taskNames) => {
    const [results] = await pool.promise().query('SELECT task_id FROM task WHERE task_name IN (?)', [taskNames]);
    return results.map(result => result.task_id);
};

const insertDeviceTasks = async (deviceId, taskIds) => {
    if(!taskIds || taskIds.length === 0) return;
    const values = taskIds.map(taskId => [deviceId, taskId]);
    await pool.promise().query('INSERT INTO device_task (device_id, task_id) VALUES ?', [values]);
};

const getDeviceTasks = async (deviceId) => {
    const [results] = await pool.promise().query('SELECT task_id FROM device_task WHERE device_id = ?', [deviceId]);
    return results.map(result => result.task_id);
};

const deleteDeviceTasks = async (deviceId, taskIdsToDelete) => {
    if(!taskIdsToDelete || taskIdsToDelete.length === 0) return;
    await pool.promise().query('DELETE FROM device_task WHERE device_id = ? AND task_id IN (?)', [deviceId, taskIdsToDelete]);
};

const insertTrustedDevice = async (deviceName, ipAddress, deviceType) => {
    const [result] = await pool.promise().query('INSERT INTO trusted_device (device_name, ip_address, device_type) VALUES (?, ?, ?)', [deviceName, ipAddress, deviceType]);
    return result;
};

const getDeviceIdByName = async (deviceName) => {
    const [results] = await pool.promise().query('SELECT device_id FROM trusted_device WHERE device_name = ?', [deviceName]);
    if (results.length === 0) throw new Error('Device not found');
    return results[0].device_id;
};

const findTrustedDeviceByName = async (deviceName) => {
    const [results] = await pool.promise().query('SELECT * FROM trusted_device WHERE device_name = ?', [deviceName]);
    return results[0];
};

const updateDevice = async (deviceId, newDeviceName, newIpAddress) => {
    await pool.promise().query('UPDATE trusted_device SET device_name = ?, ip_address = ? WHERE device_id = ?', [newDeviceName, newIpAddress, deviceId]);
};

function calculateSubnetRange(ipAddress, subnetMask) {
    return ip.subnet(ipAddress, subnetMask);
}

function generateIPRange(startIP, endIP) {
    const start = startIP.split('.').map(Number);
    const end = endIP.split('.').map(Number);
    const result = [];

    for (let i = start[0]; i <= end[0]; i++) {
        for (let j = start[1]; j <= end[1]; j++) {
            for (let k = start[2]; k <= end[2]; k++) {
                for (let l = start[3]; l <= end[3]; l++) {
                    result.push(`http://${i}.${j}.${k}.${l}:*`);
                    result.push(`https://${i}.${j}.${k}.${l}:*`);
                }
            }
        }
    }
    return result;
}

try {
    const networkInterfaces = require('os').networkInterfaces();
    if(networkInterfaces['eth0']) {
        const subnetMask = networkInterfaces['eth0'][0].netmask;
        const hostIp = networkInterfaces['eth0'][0].address;
        const subnetRange = calculateSubnetRange(hostIp, subnetMask);
        exports.subnetIps = generateIPRange(subnetRange.firstAddress, subnetRange.lastAddress);
    }
} catch (error) {
    console.error('Error calculating subnet IPs:', error.message);
}

exports.getTrustedDevices = async (req, res) => {
    const { authToken } = req.query;
    
    try {
        const username = getUserFromToken(authToken);
        
        if (!username || username === 'Unauthorized') {
             return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        const { stdout } = await execAsync('kubectl get pods --namespace=default -o json');
        const podInfo = JSON.parse(stdout).items.map(pod => ({
            name: pod.metadata.name,
            ip: pod.status.podIP,
        }));

        const podNames = podInfo.map(pod => pod.name);
        const podIPs = podInfo.map(pod => pod.ip);

        // Transaction block using promises
        const connection = await pool.promise().getConnection();
        
        try {
            await connection.beginTransaction();

            const [userRows] = await connection.query('SELECT user_id FROM user WHERE username = ? LIMIT 1', [username]);

            if (userRows.length === 0 || !userRows[0].user_id) {
                await connection.rollback();
                connection.release();
                return res.status(400).send('User not found');
            }

            if (podNames.length === 0 || podIPs.length === 0) {
                await connection.rollback();
                connection.release();
                return res.json([]);
            } 

            const [deviceRows] = await connection.query(`
                SELECT device_id, device_name, ip_address, personnel_rank, device_type
                FROM trusted_device
                WHERE device_name IN (?) AND ip_address IN (?)
            `, [podNames, podIPs]);

            const deviceIds = deviceRows.map(device => device.device_id);

            if (deviceIds.length === 0) {
                await connection.commit();
                connection.release();
                return res.json([]);
            }

            const [taskRows] = await connection.query(`
                SELECT dt.device_id, t.task_name
                FROM device_task dt
                INNER JOIN task t ON dt.task_id = t.task_id
                WHERE dt.device_id IN (?)
            `, [deviceIds]);

            await connection.commit();
            connection.release();

            const tasksByDevice = {};
            taskRows.forEach(task => {
                if (!tasksByDevice[task.device_id]) {
                    tasksByDevice[task.device_id] = [];
                }
                tasksByDevice[task.device_id].push(task.task_name);
            });

            const devicesWithTasks = deviceRows.map(device => ({
                ...device,
                allowedTasks: tasksByDevice[device.device_id] || [],
            }));

            return res.json(devicesWithTasks);

        } catch (dbErr) {
            await connection.rollback();
            connection.release();
            throw dbErr;
        }

    } catch(err) {
        console.error('Error in getTrustedDevices:', err);
        return res.status(500).send('Failed to fetch pod information or DB Error');
    }
};

const getK3sNodes = async () => {
    const { stdout } = await execAsync('kubectl get nodes -o json');
    const nodeData = JSON.parse(stdout);

    return nodeData.items
        .filter((node) => node.status.conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True'))
        .map((node) => ({
            nodeName: node.metadata.name,
            nodeIP: node.status.addresses.find((addr) => addr.type === 'InternalIP').address,
        }));
};

exports.getMoreNodes = async (req, res) => {
    const { authToken } = req.query;
    
    try {
        const username = getUserFromToken(authToken);

        if (!username || username === 'Unauthorized') {
             return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        const connection = await pool.promise().getConnection();
        
        try {
            await connection.beginTransaction();

            const [userRows] = await connection.query('SELECT user_id FROM user WHERE username = ? LIMIT 1', [username]);

            if (userRows.length === 0 || !userRows[0].user_id) {
                await connection.rollback();
                connection.release();
                return res.status(400).send('User not found');
            }

            const nodeList = await getK3sNodes();
            await connection.commit();
            connection.release();
            return res.json(nodeList);

        } catch(dbErr) {
            await connection.rollback();
            connection.release();
            throw dbErr;
        }

    } catch (error) {
        console.error(error);
        return res.status(500).send('Internal Server Error');
    }
};

exports.addTrustedDevice = async (req, res) => {
    const { authToken, deviceName, tasks, deviceType } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        const commandMap = {
            "Video Capture Drone": ["python3", "surveillanceDrone.py"],
            "Video Analytic Controller": ["sleep", '"3600000"'],
            "Video Capture Rover": ["sleep", "3600000"],
            "Freight Drone": ["python3", "supplyDrone.py"],
            "Freight UGV": ["sleep", "3600000"],
            "Sensor-Integrated Drone": ["sleep", "3600000"],
            "Communication Relay Drone": ["python3", "relayDrone.py"],
            "Communication Relay Rover": ["sleep", "3600000"],
        };

        const portMap = {
            "Video Capture Drone": 3050,
            "Video Analytic Controller": 5050,
            "Video Capture Rover": 8080,
            "Freight Drone": 4050,
            "Freight UGV": 8080,
            "Sensor-Integrated Drone": 8080,
            "Communication Relay Drone": 5050,
            "Communication Relay Rover": 8080,
        };

        const selectedImage = imageMap[deviceType];
        const selectedCommand = commandMap[deviceType];

        if (!selectedImage) {
            return res.status(400).json({ message: 'Invalid deviceType' });
        }

        // Create a temporary YAML file
        const podYAML = `
apiVersion: v1
kind: Pod
metadata:
  name: ${deviceName}
  labels:
    app: ${deviceName}
spec:
  nodeName: ${deviceName}
  containers:
  - name: busybox
    image: ${selectedImage}
    imagePullPolicy: Always 
    ports:
      - containerPort: ${portMap[deviceType]}
    command:
      - ${selectedCommand.join("\n      - ")}`;

        const yamlFilePath = temp.openSync({ suffix: '.yaml' });
        fs.writeSync(yamlFilePath.fd, podYAML);
        fs.closeSync(yamlFilePath.fd);

        await execAsync(`kubectl apply -f ${yamlFilePath.path}`);

        // Set an interval loop check utilizing delay promises (sleep logic)
        const waitForIP = async () => {
             for(let i = 0; i < 20; i++) { // try for ~20 seconds maximum
                try {
                    const { stdout } = await execAsync(`kubectl get pod ${deviceName} -o=jsonpath='{.status.podIP}'`);
                    if (stdout && stdout.trim()) {
                        return stdout.trim();
                    }
                } catch(e) {} // ignore minor process fetch fails 
                await new Promise(resolve => setTimeout(resolve, 1000));
             }
             throw new Error('Timeout waiting for Pod IP');
        };

        const podIP = await waitForIP();

        await Promise.all([
            insertTrustedDevice(deviceName, podIP, deviceType),
            getTaskIdsByName(tasks).then(async taskIds => {
                 // Technically we want the device insert to finish first to get insertId
            })
        ]);

        // Fix dependency order for previous logic logic
        const insertDeviceResult = await insertTrustedDevice(deviceName, podIP, deviceType);
        const taskIds = await getTaskIdsByName(tasks);
        await insertDeviceTasks(insertDeviceResult.insertId, taskIds);

        // Delete the temporary YAML file
        fs.unlinkSync(yamlFilePath.path);
        
        return res.status(200).json({ message: 'Trusted device added successfully' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.updateTrustedDevice = async (req, res) => {
    const { authToken, currentName, deviceName, ipAddress, tasks } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        const existingDevice = await findTrustedDeviceByName(currentName);

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        await updateDevice(existingDevice.device_id, deviceName, ipAddress);

        const taskIds = await getTaskIdsByName(tasks);
        const existingDeviceTasks = await getDeviceTasks(existingDevice.device_id);

        const tasksToAdd = taskIds.filter(taskId => !existingDeviceTasks.includes(taskId));
        const tasksToDelete = existingDeviceTasks.filter(taskId => !taskIds.includes(taskId));

        if (tasksToAdd.length > 0) {
            await insertDeviceTasks(existingDevice.device_id, tasksToAdd);
        }

        if (tasksToDelete.length > 0) {
            await deleteDeviceTasks(existingDevice.device_id, tasksToDelete);
        }

        return res.status(200).json({ message: 'Trusted device updated successfully' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.removeTrustedDevice = async (req, res) => {
    const { authToken, deviceName } = req.query;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        const deviceId = await getDeviceIdByName(deviceName);

        await pool.promise().query('DELETE FROM device_task WHERE device_id = ?', [deviceId]);
        await pool.promise().query('DELETE FROM trusted_device WHERE device_id = ?', [deviceId]);

        await execAsync(`kubectl delete pod ${deviceName}`);

        return res.status(200).json({ message: 'Trusted device and associated pod removed successfully' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.clusterJoinRequest = async (req, res) => {
    const { nodeName } = req.query;
    const requestingIP = req.ip ? req.ip.replace('::ffff:', '') : '127.0.0.1';

    try {
        const { stdout } = await execAsync('kubectl get nodes -o custom-columns=NAME:.metadata.name,INTERNAL-IP:.status.addresses[0].address');
        
        const nodeData = stdout
            .split('\n')
            .slice(1)
            .filter((data) => data.length > 0)
            .map((data) => {
                const [nName, nIP] = data.split(/\s+/);
                return { nodeName: nName, nodeIP: nIP };
            });

        const existingNodeNames = nodeData.map((node) => node.nodeName);
        if (existingNodeNames.includes(nodeName)) {
            console.log(`Node name ${nodeName} is already taken. Sending 422 status.`);
            return res.status(422).json({ error: 'The node name is already taken. Please choose a different name.' });
        }

        const existingIPs = nodeData.map((node) => node.nodeIP);
        if (existingIPs.includes(requestingIP)) {
             console.log(`Requesting device with IP address ${requestingIP} is already part of the cluster. Sending 409 status.`);
             return res.status(409).json({ error: 'The device is already part of the cluster.' });
        }

        console.log(`Received cluster join request for node: ${nodeName}`);
        requestList[requestingIP] = nodeName;
        console.log("Request List: ", requestList);

        return res.status(200).json({ message: 'Cluster join request received successfully', nodeName });

    } catch (error) {
         console.error(`Error executing kubectl: ${error.message}`);
         return res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.getToken = async (req, res) => {
    const { nodeName } = req.query;

    if (!nodeName || !nodeName.trim()) {
        return res.status(400).json({ error: 'Node name is required and invalid.' });
    }

    try {
        const { stdout } = await execAsync('sudo cat /var/lib/rancher/k3s/server/node-token');
        const token = stdout.trim();

        if (!token) {
            console.error('Empty token received.');
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        if (Object.values(acceptedList).includes(nodeName)) {
            return res.status(200).json({ token });
        } else {
            return res.status(409).json({ error: 'Node name not found in acceptedList.' });
        }

    } catch (error) {
        console.error(`Error executing command: ${error.message}`);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.addToCluster = async (req, res) => {
    const { ipAddress, nodeName, authToken, decline } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        if (!ipAddress || !nodeName) {
            return res.status(400).json({ error: 'Both ipAddress and nodeName are required.' });
        }

        if (decline) {
            blockList[ipAddress] = nodeName;
            delete requestList[ipAddress];
            return res.status(403).json({ message: 'Device declined and removed from the request list.' });
        } else {
            acceptedList[ipAddress] = nodeName;
            delete requestList[ipAddress];
            return res.status(200).json({ message: 'Added to cluster successfully.' });
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.removeFromCluster = async (req, res) => {
    const { authToken, nodeName } = req.body;

    try {
        const username = getUserFromToken(authToken);
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        await execAsync(`kubectl delete node ${nodeName}`);
        return res.status(200).json({ message: 'Node removed from the cluster successfully' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
