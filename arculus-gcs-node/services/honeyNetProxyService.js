const fs = require('fs-extra');
const axios = require('axios');

const { isUserOfType, getUserFromToken } = require('./authService');

let proxyConfig = {};
try {
    proxyConfig = Object.freeze(JSON.parse(fs.readFileSync('configs/honeypot_config.json', 'utf8')));
} catch (error) {
    console.error('Failed to load proxy config:', error.message);
}

exports.honeyPotApi = async (req, res) => {
    try {
        const { authToken, ...queryParams } = req.query;
        
        const username = getUserFromToken(authToken);
        
        if (!username || username === 'Unauthorized') {
             return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
             return res.status(403).json({ message: 'Unauthorized: Only users with admin role can access the honeypot API' });
        }

        const apiPath = req.params[0];
        const honeypotApiUrl = `http://${proxyConfig.honeyNetDomain}/${apiPath}`;
        console.log("honey: ", honeypotApiUrl);

        const response = await axios({
            method: req.method,
            url: honeypotApiUrl,
            params: queryParams,
            headers: {
                apikey: proxyConfig.apikey
            },
            data: req.body,
        });

        return res.status(response.status).json(response.data);
    } catch (error) {
        console.error('Error calling honeypot API:', error);
        return res.status(error.response ? error.response.status : 500).json({ error: 'Proxy error' });
    }
};
