const { isUserOfType, getUserFromToken } = require('./authService');

const pool = require('../modules/arculusDbConnection');

exports.getRoles = async (req, res) => {
    const { authToken } = req.query;

    try {
        const isAdmin = await isUserOfType(getUserFromToken(authToken), ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
        }

        // Query to get task names
        const [results] = await pool.promise().query('SELECT role_name FROM role');
        const roleNames = results.map(result => result.role_name);
        
        return res.status(200).json({ roleNames });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};