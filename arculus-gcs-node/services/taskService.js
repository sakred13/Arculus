const { isUserOfType, getUserFromToken } = require('./authService');
const pool = require('../modules/arculusDbConnection');

exports.getTasks = async (req, res) => {
    const { authToken } = req.query;

    try {
        const username = getUserFromToken(authToken);
        if (username === 'Unauthorized') {
            return res.status(403).json({ message: 'Unauthorized: Invalid token' });
        }

        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only users with admin role can perform this action' });
        }

        const [results] = await pool.promise().query('SELECT task_name FROM task');
        const taskNames = results.map(result => result.task_name);
        
        return res.status(200).json({ taskNames });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
