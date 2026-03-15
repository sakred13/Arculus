const { isUserOfType, getUserFromToken } = require('./authService');
const pool = require('../modules/arculusDbConnection');

exports.updateUser = async (req, res) => {
    const { authToken, user, updated_username, email_id, role, domains } = req.body;

    try {
        const username = getUserFromToken(authToken);

        // Check if the user has an admin role
        const isAdmin = await isUserOfType(username, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can edit user details' });
        }

        // Fetch the corresponding role_id based on the provided role name
        const [roleResults] = await pool.promise().query('SELECT role_id FROM role WHERE role_name = ?', [role]);
        
        if (roleResults.length === 0) {
            return res.status(404).json({ message: 'Role not found' });
        }

        const role_id = roleResults[0].role_id;

        // Fetch the user record from the database using the provided username
        const [results] = await pool.promise().query('SELECT * FROM user WHERE username = ?', [user]);

        if (results.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update the user record with the new information, including the role_id and domains
        await pool.promise().query(
            'UPDATE user SET username = ?, email = ?, role_id = ?, domains = ? WHERE username = ?',
            [updated_username, email_id, role_id, domains, user]
        );

        return res.status(200).json({ message: 'User updated successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.deleteUser = async (req, res) => {
    const { username, authToken } = req.query;
    
    try {
        const user = getUserFromToken(authToken);

        // Check if the user has an admin role
        const isAdmin = await isUserOfType(user, ['Mission Creator']);

        if (!isAdmin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can delete users' });
        }

        // Start a transaction to handle deletion from multiple tables
        const connection = await pool.promise().getConnection();
        
        try {
            await connection.beginTransaction();

            await connection.query('DELETE FROM supervisor WHERE user_id = (SELECT user_id FROM user WHERE username = ?)', [username]);
            await connection.query('DELETE FROM viewer WHERE user_id = (SELECT user_id FROM user WHERE username = ?)', [username]);
            await connection.query('DELETE FROM user WHERE username = ?', [username]);

            await connection.commit();
            
            return res.status(200).json({ message: 'User deleted successfully' });
        } catch (transactionErr) {
            await connection.rollback();
            console.error('Error during transaction:', transactionErr);
            return res.status(500).json({ message: 'Internal Server Error' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getUsers = async (req, res) => {
    const { authToken } = req.query;
    
    try {
        const username = getUserFromToken(authToken);
        
        const connection = await pool.promise().getConnection();
        
        try {
            await connection.beginTransaction();

            const [userRows] = await connection.query('SELECT user_id FROM user WHERE username = ? LIMIT 1', [username]);

            if (userRows.length === 0 || !userRows[0].user_id) {
                await connection.rollback();
                connection.release();
                return res.status(400).send('User not found');
            }
            
            const [rows] = await connection.query(`
                SELECT u.username, u.email, u.user_id, r.role_name, u.domains
                FROM user u
                JOIN role r ON u.role_id = r.role_id
            `);

            await connection.commit();
            return res.json(rows);
            
        } catch (transactionErr) {
            await connection.rollback();
            throw transactionErr;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getCurrentUser = async (req, res) => {
    const { authToken } = req.query;
    
    try {
        const username = getUserFromToken(authToken);

        const connection = await pool.promise().getConnection();
        
        try {
            await connection.beginTransaction();

            const [userRows] = await connection.query('SELECT u.user_id, u.username, u.email, u.domains, r.role_name FROM user u join role r on u.role_id=r.role_id WHERE username = ? LIMIT 1', [username]);

            if (userRows.length === 0 || !userRows[0].user_id) {
                await connection.rollback();
                connection.release();
                return res.status(400).send('User not found');
            }
            
            await connection.commit();
            return res.json(userRows[0]);
            
        } catch (transactionErr) {
            await connection.rollback();
            throw transactionErr;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};