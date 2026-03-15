const taskService = require('../../services/taskService');
const { isUserOfType, getUserFromToken } = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');

// Mock dependencies
jest.mock('../../services/authService');
jest.mock('../../modules/arculusDbConnection');

describe('taskService', () => {
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

    describe('getTasks', () => {
        it('should return 403 if token is invalid or unauthorized', async () => {
            getUserFromToken.mockReturnValue('Unauthorized');

            await taskService.getTasks(mockReq, mockRes);

            expect(getUserFromToken).toHaveBeenCalledWith('mockToken');
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Unauthorized: Invalid token' });
        });

        it('should return 500 if auth validation fails', async () => {
            getUserFromToken.mockReturnValue('mockUser');
            isUserOfType.mockRejectedValue(new Error('Auth validation error'));

            await taskService.getTasks(mockReq, mockRes);

            expect(isUserOfType).toHaveBeenCalledWith('mockUser', ['Mission Creator']);
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Internal Server Error' });
        });

        it('should return 403 if user is not admin', async () => {
             getUserFromToken.mockReturnValue('mockUser');
             isUserOfType.mockResolvedValue(false);

             await taskService.getTasks(mockReq, mockRes);

             expect(mockRes.status).toHaveBeenCalledWith(403);
             expect(mockRes.json).toHaveBeenCalledWith({ message: 'Unauthorized: Only users with admin role can perform this action' });
        });

        it('should return 500 if database query fails', async () => {
            getUserFromToken.mockReturnValue('mockUser');
            isUserOfType.mockResolvedValue(true); // User is admin
            mockQuery.mockRejectedValue(new Error('DB error'));

            await taskService.getTasks(mockReq, mockRes);

            expect(mockQuery).toHaveBeenCalledWith('SELECT task_name FROM task');
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ message: 'Internal Server Error' });
        });

        it('should return 200 and list of task names on success', async () => {
            getUserFromToken.mockReturnValue('mockUser');
            isUserOfType.mockResolvedValue(true); // User is admin
            const mockDbResults = [
                { task_name: 'Task 1' },
                { task_name: 'Task 2' },
                { task_name: 'Task 3' }
            ];
            mockQuery.mockResolvedValue([mockDbResults]);

            await taskService.getTasks(mockReq, mockRes);

            expect(mockQuery).toHaveBeenCalledWith('SELECT task_name FROM task');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ taskNames: ['Task 1', 'Task 2', 'Task 3'] });
        });
    });
});
