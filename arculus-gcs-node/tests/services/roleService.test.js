const roleService = require('../../services/roleService');
const { isUserOfType, getUserFromToken } = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');

// Mock dependencies
jest.mock('../../services/authService');
jest.mock('../../modules/arculusDbConnection');

describe('roleService', () => {
    let mockReq;
    let mockRes;
    let mockQuery;

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Setup common mock request and response
        mockReq = {
            query: { authToken: 'mockToken' }
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        mockQuery = jest.fn();
        pool.promise = jest.fn().mockReturnValue({ query: mockQuery });
    });

    describe('getRoles', () => {
        it('should return 500 if auth validation fails', async () => {
            getUserFromToken.mockReturnValue('mockUser');
            isUserOfType.mockRejectedValue(new Error('Auth validation error'));

            await roleService.getRoles(mockReq, mockRes);

            expect(getUserFromToken).toHaveBeenCalledWith('mockToken');
            expect(isUserOfType).toHaveBeenCalledWith('mockUser', ['Mission Creator']);
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Internal Server Error' });
        });

        it('should return 403 if user is not admin', async () => {
             getUserFromToken.mockReturnValue('mockUser');
             isUserOfType.mockResolvedValue(false);

             await roleService.getRoles(mockReq, mockRes);

             expect(mockRes.status).toHaveBeenCalledWith(403);
             expect(mockRes.json).toHaveBeenCalledWith({ message: 'Unauthorized: Only users with admin role can perform this action' });
        });

        it('should return 500 if database query fails', async () => {
            getUserFromToken.mockReturnValue('mockUser');
            isUserOfType.mockResolvedValue(true); // User is admin
            mockQuery.mockRejectedValue(new Error('DB error'));

            await roleService.getRoles(mockReq, mockRes);

            expect(mockQuery).toHaveBeenCalledWith('SELECT role_name FROM role');
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Internal Server Error' });
        });

        it('should return 200 and list of role names on success', async () => {
            getUserFromToken.mockReturnValue('mockUser');
            isUserOfType.mockResolvedValue(true); // User is admin
            const mockDbResults = [
                { role_name: 'Mission Creator' },
                { role_name: 'Mission Supervisor' },
                { role_name: 'Mission Viewer' }
            ];
            mockQuery.mockResolvedValue([mockDbResults]);

            await roleService.getRoles(mockReq, mockRes);

            expect(mockQuery).toHaveBeenCalledWith('SELECT role_name FROM role');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ roleNames: ['Mission Creator', 'Mission Supervisor', 'Mission Viewer'] });
        });
    });
});
