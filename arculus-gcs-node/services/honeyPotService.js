const fs = require('fs-extra');
const axios = require('axios');

const { isUserOfType, getUserFromToken } = require('./authService');

let honeypotConfig = {};
try {
    honeypotConfig = Object.freeze(JSON.parse(fs.readFileSync('configs/honeypot_config.json', 'utf8')));
} catch (error) {
    console.error('Failed to load honeypot config:', error.message);
}

const deployedHoneypots = [];

exports.createHoneyPot = async (req, res) => {
    const { authToken, honeypotTarget, honeypotType } = req.query;

    try {
        const username = getUserFromToken(authToken);

        if (!username || username === 'Unauthorized') {
             return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only users with admin role can access the honeypot API' });
        }

        const isDuplicate = deployedHoneypots.some((honeypot) =>
            honeypot.honeypotTarget === honeypotTarget && honeypot.honeypotType === honeypotType
        );

        if (isDuplicate) {
            return res.status(400).json({ message: 'Duplicate request: Honeypot already deployed with the same target and type' });
        }

        const honeypotApiUrl = `http://${honeypotTarget}:5000/deployHoneyPot`;
        console.log("honey: ", honeypotApiUrl);

        try {
            const response = await axios({
                method: req.method,
                url: honeypotApiUrl,
                headers: {},
                data: {
                    url: honeypotConfig.url,
                    deployKey: honeypotConfig.deployKey,
                    potType: honeypotType
                },
            });

            if (response.status === 200) {
                deployedHoneypots.push({
                    honeypotTarget,
                    honeypotType
                });
                console.log("Deployed: ", deployedHoneypots);
            }

            return res.status(response.status).json(response.data);
            
        } catch (axiosError) {
            console.error('Error calling honeypot API:', axiosError);
            return res.status(axiosError.response ? axiosError.response.status : 500).json({ error: 'Internal Server Error' });
        }

    } catch (error) {
        console.error('Error in createHoneyPot:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.undeployHoneypot = async (req, res) => {
    const { authToken, honeypotTarget, honeypotType } = req.query;

    try {
        const username = getUserFromToken(authToken);

        if (!username || username === 'Unauthorized') {
             return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only users with admin role can undeploy honeypot' });
        }

        const deployedHoneypotIndex = deployedHoneypots.findIndex((honeypot) =>
            honeypot.honeypotTarget === honeypotTarget && honeypot.honeypotType === honeypotType
        );

        if (deployedHoneypotIndex === -1) {
            return res.status(404).json({ message: 'Honeypot not found' });
        }

        const honeypotApiUrl = `http://${honeypotTarget}:5000/undeployHoneypot`;

        try {
            const response = await axios({
                method: 'DELETE',
                url: honeypotApiUrl,
                headers: {},
                data: {
                    url: honeypotConfig.url,
                    potType: honeypotType
                },
            });

            if (response.status === 200) {
                deployedHoneypots.splice(deployedHoneypotIndex, 1);
                console.log("Undeployed: ", deployedHoneypots);
            }

            return res.status(response.status).json(response.data);

        } catch (axiosError) {
            console.error('Error calling honeypot API for undeploy:', axiosError);
            return res.status(axiosError.response ? axiosError.response.status : 500).json({ error: 'Internal Server Error' });
        }

    } catch (error) {
        console.error('Error in undeployHoneypot:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.getDeployedHoneypots = async (req, res) => {
    const { authToken } = req.query;

    try {
        const username = getUserFromToken(authToken);

        if (!username || username === 'Unauthorized') {
             return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only users with admin role can access the deployed honeypots' });
        }

        return res.status(200).json({ deployedHoneypots });

    } catch (error) {
        console.error('Error getting deployed honeypots:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
