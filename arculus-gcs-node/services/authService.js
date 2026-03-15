const pool = require('../modules/arculusDbConnection');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const util = require('util');
const sgMail = require('@sendgrid/mail');
const fs = require('fs');

const execAsync = util.promisify(exec);

// Variables that should probably be in a DB/Cache (Redis) in production
var ztMode = 'no_zt';
var pids = {};
var otps = {};

// In a real application, these should be env variables, not read synchronously at startup
// However, to maintain existing behavior but prevent blocking during requests, we read them once at startup
let apiKey = '';
let cryptSecret = '';

try {
    apiKey = fs.readFileSync('configs/EMAIL_API_KEY.txt', 'utf8').trim();
    cryptSecret = fs.readFileSync('configs/ENCRYPTION_SECRET.txt', 'utf8').trim();
    sgMail.setApiKey(apiKey);
} catch (error) {
    console.error('Failed to load configuration files:', error);
}

const getUserFromToken = (token) => {
    if (typeof token !== 'string') {
        return 'Unauthorized';
    }

    try {
        const decoded = jwt.verify(token, cryptSecret);

        if (!decoded.username) {
            return 'Unauthorized';
        }

        return decoded.username;
    } catch (err) {
        console.error('Token verification error:', err);
        return 'Unauthorized';
    }
};

const isUserOfType = async (username, userTypes, callback) => {
    try {
        const [results] = await pool.promise().query(
            "SELECT r.role_name FROM user u JOIN role r ON u.role_id = r.role_id WHERE u.username = ?", 
            [username]
        );
        
        const isOfRightType = results.some((row) => userTypes.includes(row.role_name));
        
        if (callback) {
            callback(null, isOfRightType);
        }
        return isOfRightType;
    } catch (err) {
        console.error(err);
        if (callback) {
            callback(err, null);
        }
        throw err;
    }
};

const getUserRole = async (username, callback) => {
    try {
        const [results] = await pool.promise().query(
            "SELECT r.role_name FROM user u JOIN role r ON u.role_id = r.role_id WHERE u.username = ?", 
            [username]
        );

        const roleName = results.length > 0 ? results[0].role_name : null;
        
        if (callback) {
            callback(null, roleName);
        }
        return roleName;
    } catch (err) {
        console.error(err);
        if (callback) {
            callback(err, null);
        }
        throw err;
    }
};

const getUserIdFromName = async (username) => {
    const [results] = await pool.promise().query("SELECT user_id FROM user WHERE username = ?", [username]);

    if (results.length === 0) {
        throw new Error('User not found');
    }

    return results[0].user_id;
};

const isNewSetup = async (req, res) => {
    try {
        const [results] = await pool.promise().query('SELECT COUNT(*) AS userCount FROM user');
        
        if (results[0].userCount === 0) {
            return res.status(200).json({ newSetup: true });
        } else {
            return res.status(200).json({ newSetup: false });
        }
    } catch (queryErr) {
        console.error(queryErr);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

const signup = async (req, res) => {
    const { jwtToken, username, email, password, role, domains } = req.body;

    const createUser = async (role_id) => {
        try {
            const hash = await bcrypt.hash(password, 10);
            
            await pool.promise().query(
                'INSERT INTO user (username, email, role_id, password_hash, domains) VALUES (?, ?, ?, ?, ?)',
                [username, email, role_id, hash, domains]
            );
            
            return res.status(200).json({ message: 'User account created successfully' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'An Account is already present with the given email or username. Please try to login or create a new account using a different email.' });
        }
    };

    const fetchRoleIdAndCreateUser = async (roleName) => {
        try {
            const [results] = await pool.promise().query('SELECT role_id FROM role WHERE role_name = ?', [roleName]);
            
            if (results.length === 0) {
                return res.status(500).json({ message: 'Internal Server Error or Invalid role specified' });
            }
            
            const role_id = results[0].role_id;
            await createUser(role_id);
        } catch (selectErr) {
            console.error(selectErr);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    };

    const checkForEmptyDatabaseAndCreateUser = async () => {
        try {
            const [results] = await pool.promise().query('SELECT COUNT(*) AS count FROM user');
            
            if (results[0].count > 0) {
                return res.status(403).json({ message: 'Unauthorized: No valid JWT provided and users exist in the database' });
            }
            
            await fetchRoleIdAndCreateUser(role);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    };

    if (jwtToken) {
        try {
            const decoded = jwt.verify(jwtToken, cryptSecret);
            const isAdmin = await isUserOfType(decoded.userId || decoded.username, ['Mission Creator']);
            
            if (!isAdmin) {
                return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
            }
            
            await fetchRoleIdAndCreateUser(role);
        } catch (err) {
            console.error('Token verification failed:', err);
            await checkForEmptyDatabaseAndCreateUser();
        }
    } else {
        await checkForEmptyDatabaseAndCreateUser();
    }
};

const sendEmailForAuth = async (req, res) => {
    const { authToken } = req.body;
    const username = getUserFromToken(authToken);

    try {
        const isAuthorized = await isUserOfType(username, ['Mission Creator', 'Mission Supervisor', 'Mission Viewer']);
        
        if (!isAuthorized) {
            return res.status(403).json({ message: 'Unauthorized to perform this action' });
        }

        const [results] = await pool.promise().query('SELECT email FROM user WHERE username = ?', [username]);

        if (results.length === 0) {
            return res.status(400).json({ message: 'Error fetching email ID' });
        }

        const email = results[0].email;
        const otp = Math.floor(100000 + Math.random() * 900000);
        otps[username] = otp.toString();
        
        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
    .email-container { background-color: #ffffff; max-width: 600px; margin: 0 auto; padding: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); border-radius: 10px; }
    .email-header { background: #007bff; color: #ffffff; padding: 10px; border-radius: 10px 10px 0 0; text-align: center; }
    .email-body { padding: 20px; text-align: center; }
    .otp-code { font-size: 24px; color: #333333; margin: 20px 0; padding: 10px; border: 1px dashed #007bff; display: inline-block; }
    .footer { font-size: 12px; text-align: center; margin-top: 20px; color: #666; }
</style>
</head>
<body>
    <div class="email-container">
        <div class="email-header">
            <h1>Verify Your Identity</h1>
        </div>
        <div class="email-body">
            <p>Hello ${username},</p>
            <p>Your One-Time Password (OTP) for your password change request is:</p>
            <div class="otp-code">${otp}</div>
            <p>Please enter this code on the provided screen to proceed.</p>
        </div>
        <div class="footer">
            <p>If you did not request this, please ignore this email or contact support if you have any concerns.</p>
        </div>
    </div>
</body>
</html>
`;
        const msg = {
            to: email,
            from: 'saketh.reddy1102@gmail.com', // Replace with configured sender in production
            subject: 'Arculus: Authentication for Password Change Request',
            text: `Hello ${username}, your OTP is: ${otp}`,
            html: htmlContent
        };

        await sgMail.send(msg);
        console.log('Email sent');
        return res.status(200).json({ message: 'Email successfully sent' });
        
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error or Failed to send email' });
    }
};

const verifyOtp = async (req, res) => {
    const { authToken, otp } = req.body;
    const username = getUserFromToken(authToken);

    try {
        const isAuthorized = await isUserOfType(username, ['Mission Creator', 'Mission Supervisor', 'Mission Viewer']);
        
        if (!isAuthorized) {
            return res.status(403).json({ message: 'Unauthorized to perform this action' });
        }

        if(otps[username] === otp) {
            // Consider deleting the OTP after verification for security
            delete otps[username];
            return res.status(200).json({message: "Identity Verified"});
        }

        return res.status(403).json({message: "Incorrect OTP"});
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

const login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const [results] = await pool.promise().query('SELECT * FROM user WHERE username = ?', [username]);

        if (results.length === 0) {
            return res.status(401).json({ status: 401, message: 'Invalid credentials' });
        }

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ status: 401, message: 'Invalid credentials' });
        }

        const jwtToken = jwt.sign({ username, password }, cryptSecret, { expiresIn: '1h' });

        return res.json({ status: 200, message: 'Logged in successfully', jwtToken, user: username });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 500, message: 'Internal Server Error' });
    }
};

const authorize = async (req, res) => {
    const { authToken } = req.query;
    const username = getUserFromToken(authToken);

    if (!username || username === 'Unauthorized') {
        return res.status(403).json({ message: 'Unauthorized: User not found' });
    }

    try {
        const userType = await getUserRole(username);
        return res.status(200).json({ message: 'User is authorized', userType });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

const setZtMode = async (req, res) => {
    const { mode } = req.query;
    const { authToken } = req.body;

    const username = getUserFromToken(authToken);

    try {
        const isAdmin = await isUserOfType(username, ['Mission Creator']);
        
        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can change Zero Trust Settings' });
        }

        ztMode = mode;
        return res.status(200).json({ message: 'Zero Trust mode changed successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

const runExperimentInPod = async (req, res) => {
    try {
        const { authToken } = req.query;
        const username = getUserFromToken(authToken);
        const podNames = ["node1", "node2", "node3", "node4", "node5", "node6", "node7", "node8", "node9", "node10"]; 

        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        // Execute the kubectl command to kill processes inside the pods concurrently using Promise.all
        const killPromises = Object.entries(pids).map(async ([device, pid]) => {
            try {
                await execAsync(`kubectl exec ${device} --namespace=default -- sh -c 'kill ${pid}'`);
                console.log(`Process with PID ${pid} killed successfully in pod ${device}`);
            } catch (error) {
                console.error(`Error killing process in pod ${device}: ${error}`);
            }
        });

        await Promise.all(killPromises);

        // Check ztMode and set parameters accordingly
        let m = 4;
        let n = 5;
        if (ztMode === 'full_zt') {
            m = 12;
            n = 3;
        }

        const scriptPromises = podNames.map(async (podName) => {
            try {
                await execAsync(`kubectl exec ${podName} --namespace=default -- sh -c ' /home/run_experiment.sh ${m} ${n}'`);
                console.log(`Script executed successfully in pod ${podName}`);
            } catch (error) {
                console.error(`Error executing script in pod ${podName}: ${error}`);
                throw error; // Let Promise.all catch it if any fail
            }
        });

        await Promise.all(scriptPromises);

        return res.status(200).send('Scripts executed successfully in all pods');
    } catch (error) {
        console.error(`An error occurred: ${error}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

const authenticate = (req, res) => {
    const { processInfo } = req.query;
    
    const parseProcessInfo = (processInfoData) => {
        if (processInfoData) {
            console.log('Process Info:', processInfoData);
            const [key, value] = processInfoData.split('@');
            if (key && value) {
                pids[key] = value;
            }
        }
    };

    parseProcessInfo(processInfo);

    return res.status(200).json({ message: 'Process information received and stored successfully' });
};

// Exports
module.exports = {
    getUserFromToken,
    isUserOfType,
    getUserRole,
    getUserIdFromName,
    isNewSetup,
    signup,
    sendEmailForAuth,
    verifyOtp,
    login,
    authorize,
    setZtMode,
    runExperimentInPod,
    authenticate
};