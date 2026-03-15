const deviceService = require('../../services/deviceService');
const authService = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');
const { exec } = require('child_process');
const fs = require('fs');
const temp = require('temp');

jest.mock('../../services/authService', () => ({
    isUserOfType: jest.fn(),
    getUserFromToken: jest.fn()
}));

jest.mock('../../modules/arculusDbConnection', () => ({
    query: jest.fn(),
    getConnection: jest.fn(),
    promise: jest.fn().mockReturnValue({
        query: jest.fn()
    })
}));

jest.mock('child_process', () => ({
    exec: jest.fn()
}));

jest.mock('fs', () => ({
    readFileSync: jest.fn().mockReturnValue(JSON.stringify({ "Test Type": "test-image" })),
    writeSync: jest.fn(),
    closeSync: jest.fn(),
    unlinkSync: jest.fn()
}));

jest.mock('temp', () => ({
    track: jest.fn().mockReturnThis(),
    openSync: jest.fn().mockReturnValue({ fd: 1, path: '/tmp/test.yaml' })
}));

describe('DeviceService', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: { authToken: 'test-token' },
            body: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            send: jest.fn()
        };
        authService.getUserFromToken.mockReturnValue('testuser');
    });

    describe('addToCluster', () => {
        beforeEach(() => {
            req.body = { ipAddress: 'let.it.be', nodeName: 'TestNode', authToken: 'test-token' };
        });

        it('returns 403 if user is not admin', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, false);
                return false; // handle both callback and promise mocks
            });

            const result = deviceService.addToCluster(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 200 on successful add', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            const result = deviceService.addToCluster(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ message: 'Added to cluster successfully.' });
        });
    });

    describe('removeFromCluster', () => {
        beforeEach(() => {
            req.body = { nodeName: 'TestNode', authToken: 'test-token' };
        });

        it('returns 200 on successful remove', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            exec.mockImplementation((cmd, cb) => {
                cb(null, 'deleted'); // Simulate successful kubectl exec
            });

            const result = deviceService.removeFromCluster(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('returns 500 on kubectl error', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            exec.mockImplementation((cmd, cb) => {
                cb(new Error('kubectl failed'), null, null);
            });

            const result = deviceService.removeFromCluster(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
