const { isUserOfType, getUserFromToken } = require('./authService');
const pool = require('../modules/arculusDbConnection');

// GET API to retrieve blacklisted IP addresses
exports.getBlacklist = async (req, res) => {
    const { authToken } = req.query;

    try {
        const username = getUserFromToken(authToken);
        
        if (username === 'Unauthorized') {
            return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        // Check if the user has an admin role
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
        }

        // Query to get blacklisted IP addresses
        const [results] = await pool.promise().query('SELECT blacklist_ip FROM blacklist');

        const blacklistedIPs = results.map(result => result.blacklist_ip);
        return res.status(200).json({ blacklistedIPs });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// DELETE API to remove IP addresses from the blacklist
exports.removeFromBlacklist = async (req, res) => {
    const { authToken } = req.query;
    const { ipAddresses } = req.body;

    try {
        const username = getUserFromToken(authToken);
        
        if (username === 'Unauthorized') {
            return res.status(403).json({ message: 'Unauthorized: Invalid or missing token' });
        }

        // Check if the user has an admin role (Note: was missing the roles array in the original code, causing bugs)
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
        }

        // Split the comma-separated IP addresses
        const ipArray = ipAddresses.split(',');

        // Query to remove IP addresses from the blacklist
        await pool.promise().query('DELETE FROM blacklist WHERE blacklist_ip IN (?)', [ipArray]);

        return res.status(200).json({ message: 'Successfully removed from blacklist' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
