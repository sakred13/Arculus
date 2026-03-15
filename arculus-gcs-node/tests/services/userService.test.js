const userService = require('../../services/userService');
const { isUserOfType, getUserFromToken } = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');

jest.mock('../../services/authService');
jest.mock('../../modules/arculusDbConnection');

describe('userService', () => {
    let mockReq;
    let mockRes;
    let mockQuery;
    let mockConnection;

    beforeEach(() => {
        jest.clearAllMocks();

        mockReq = {
            body: {
                authToken: 'mockToken',
                user: 'targetUser',
                updated_username: 'newUser',
                email_id: 'new@email.com',
                role: 'Mission Viewer',
                domains: 'domain1,domain2'
            },
            query: {
                authToken: 'mockToken',
                username: 'targetUser'
            }
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            send: jest.fn()
        };

        mockQuery = jest.fn();
        
        mockConnection = {
            beginTransaction: jest.fn(),
            query: jest.fn(),
            commit: jest.fn(),
            rollback: jest.fn(),
            release: jest.fn()
        };

        pool.promise = jest.fn().mockReturnValue({
            query: mockQuery,
            getConnection: jest.fn().mockResolvedValue(mockConnection)
        });
        
        getUserFromToken.mockReturnValue('adminUser');
    });

    describe('updateUser', () => {
        it('should return 403 if not admin', async () => {
            isUserOfType.mockResolvedValue(false);
            
            await userService.updateUser(mockReq, mockRes);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Unauthorized: Only admin users can edit user details' });
        });

        it('should return 404 if role not found', async () => {
            isUserOfType.mockResolvedValue(true);
            mockQuery.mockResolvedValueOnce([[]]); // Empty results for role

            await userService.updateUser(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Role not found' });
        });

        it('should return 404 if user not found', async () => {
            isUserOfType.mockResolvedValue(true);
            mockQuery.mockResolvedValueOnce([[{ role_id: 1 }]]); // Found role
            mockQuery.mockResolvedValueOnce([[]]); // Empty results for user

            await userService.updateUser(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'User not found' });
        });

        it('should update user successfully', async () => {
            isUserOfType.mockResolvedValue(true);
            mockQuery.mockResolvedValueOnce([[{ role_id: 1 }]]); // Found role
            mockQuery.mockResolvedValueOnce([[{ user_id: 2, username: 'targetUser' }]]); // Found user
            mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]); // Update success

            await userService.updateUser(mockReq, mockRes);

            expect(mockQuery).toHaveBeenNthCalledWith(3, 'UPDATE user SET username = ?, email = ?, role_id = ?, domains = ? WHERE username = ?', ['newUser', 'new@email.com', 1, 'domain1,domain2', 'targetUser']);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'User updated successfully' });
        });
    });

    describe('deleteUser', () => {
        it('should return 403 if not admin', async () => {
            isUserOfType.mockResolvedValue(false);
            
            await userService.deleteUser(mockReq, mockRes);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
        });

        it('should commit transaction and return 200 on success', async () => {
            isUserOfType.mockResolvedValue(true);
            mockConnection.query.mockResolvedValue([{}]); // Simulated successful queries

            await userService.deleteUser(mockReq, mockRes);

            expect(mockConnection.beginTransaction).toHaveBeenCalled();
            expect(mockConnection.query).toHaveBeenCalledTimes(3); 
            expect(mockConnection.commit).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'User deleted successfully' });
        });

        it('should rollback transaction on query failure', async () => {
             isUserOfType.mockResolvedValue(true);
             mockConnection.query.mockRejectedValueOnce(new Error('DB Error'));

             await userService.deleteUser(mockReq, mockRes);

             expect(mockConnection.rollback).toHaveBeenCalled();
             expect(mockRes.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getUsers', () => {
        it('should return 400 if user not found', async () => {
            mockConnection.query.mockResolvedValueOnce([[]]); // Empty users
            
            await userService.getUsers(mockReq, mockRes);
            
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.send).toHaveBeenCalledWith('User not found');
            expect(mockConnection.rollback).toHaveBeenCalled();
        });

        it('should return users array on success', async () => {
            mockConnection.query.mockResolvedValueOnce([[{ user_id: 1 }]]); 
            mockConnection.query.mockResolvedValueOnce([[{ username: 'test', email: 'test@t.com' }]]);
            
            await userService.getUsers(mockReq, mockRes);
            
            expect(mockRes.json).toHaveBeenCalledWith([{ username: 'test', email: 'test@t.com' }]);
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });

    describe('getCurrentUser', () => {
        it('should return 400 if user not found', async () => {
            mockConnection.query.mockResolvedValueOnce([[]]); // Empty
            
            await userService.getCurrentUser(mockReq, mockRes);
            
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.send).toHaveBeenCalledWith('User not found');
            expect(mockConnection.rollback).toHaveBeenCalled();
        });

        it('should return user object on success', async () => {
            mockConnection.query.mockResolvedValueOnce([[{ user_id: 1, username: 'test' }]]);
            
            await userService.getCurrentUser(mockReq, mockRes);
            
            expect(mockRes.json).toHaveBeenCalledWith({ user_id: 1, username: 'test' });
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });
});
