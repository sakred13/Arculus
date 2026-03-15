const authService = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');
const { exec, execSync } = require('child_process');
const policyService = require('../../services/policyService');
const fs = require('fs');

jest.mock('../../services/authService', () => ({
    isUserOfType: jest.fn(),
    getUserFromToken: jest.fn(),
    getUserIdFromName: jest.fn(),
}));

jest.mock('../../modules/arculusDbConnection', () => ({
    query: jest.fn(),
    promise: jest.fn().mockReturnValue({
        query: jest.fn(),
        getConnection: jest.fn().mockResolvedValue({
            beginTransaction: jest.fn().mockResolvedValue(undefined),
            query: jest.fn().mockResolvedValue([{ insertId: 42, affectedRows: 1 }]),
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined),
            release: jest.fn(),
        }),
    }),
}));

jest.mock('child_process', () => ({
    exec: jest.fn(),
    execSync: jest.fn(),
}));

jest.mock('../../services/policyService', () => ({
    addNetworkPolicyDuringMission: jest.fn().mockResolvedValue({}),
    deleteNetworkPolicyDuringMission: jest.fn(),
}));

// Mock fs at module level so the readFileSync for ENCRYPTION_SECRET doesn't fail
jest.mock('fs', () => ({
    readFileSync: jest.fn().mockReturnValue('12345678901234567890123456789012'),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    promises: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        writeFile: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
    },
}));

// Require service AFTER all mocks are set up
const missionService = require('../../services/missionService');

describe('MissionService', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: { authToken: 'test-token' },
            body: { authToken: 'test-token' },
            files: null,
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            send: jest.fn(),
            download: jest.fn(),
        };
        authService.getUserFromToken.mockReturnValue('testuser');
        authService.getUserIdFromName.mockImplementation((name, cb) => {
            if (typeof cb === 'function') cb(null, 1);
            return Promise.resolve(1);
        });
    });

    // -------------------------------------------------------------------------
    // startMission
    // -------------------------------------------------------------------------
    describe('startMission', () => {
        it('returns 500 if role check errors', async () => {
            authService.isUserOfType.mockRejectedValue(new Error('db error'));
            const result = missionService.startMission(req, res);
            if (result instanceof Promise) await result;
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('returns 403 if user is not admin', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            const result = missionService.startMission(req, res);
            if (result instanceof Promise) await result;
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 200 and starts mission on admin', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            req.body = { ...req.body, gcX: 10, gcY: 20, destX: 100, destY: 200 };
            const result = missionService.startMission(req, res);
            if (result instanceof Promise) await result;
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ message: 'Mission data updated successfully' });
        });
    });

    // -------------------------------------------------------------------------
    // getMissionState (now auth-gated and async in the refactored service)
    // -------------------------------------------------------------------------
    describe('getMissionState', () => {
        it('returns 403 if not admin', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            const result = missionService.getMissionState(req, res);
            if (result instanceof Promise) await result;
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 200 with mission state if admin', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            const result = missionService.getMissionState(req, res);
            if (result instanceof Promise) await result;
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ missionRunning: expect.anything() }));
        });
    });

    // -------------------------------------------------------------------------
    // createMission
    // -------------------------------------------------------------------------
    describe('createMission', () => {
        it('returns 401 if user is not a mission creator', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            await missionService.createMission(req, res);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('returns 200 and inserts mission on success', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            req.body = { ...req.body, mission_config: '{}', supervisors: [], viewers: [] };
            await missionService.createMission(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ missionId: 42 });
        });
    });

    // -------------------------------------------------------------------------
    // deleteMission
    // -------------------------------------------------------------------------
    describe('deleteMission', () => {
        it('returns 403 if user is not a mission creator', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            await missionService.deleteMission(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 200 when mission is deleted successfully', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            req.body = { ...req.body, missionId: 1 };
            await missionService.deleteMission(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    // -------------------------------------------------------------------------
    // simulateBadNetwork
    // -------------------------------------------------------------------------
    describe('simulateBadNetwork', () => {
        it('fires kubectl command and returns 200', async () => {
            req.body = { controller: 'ctrl-pod', type: 'surv' };
            const result = missionService.simulateBadNetwork(req, res);
            if (result instanceof Promise) await result;
            expect(exec).toHaveBeenCalledWith(
                expect.stringContaining('echo "disconnected" > survState.txt')
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    // -------------------------------------------------------------------------
    // simulateGpsSpoofing
    // -------------------------------------------------------------------------
    describe('simulateGpsSpoofing', () => {
        it('fires GPS spoof command and returns 200', async () => {
            req.body = { controller: 'ctrl-pod', device: 'surv', slope: '0.5', distance: '100' };
            const result = missionService.simulateGpsSpoofing(req, res);
            if (result instanceof Promise) await result;
            expect(exec).toHaveBeenCalledWith(
                expect.stringContaining('spoofGpsSurv.txt')
            );
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    // -------------------------------------------------------------------------
    // simulatePhysicalCapture
    // -------------------------------------------------------------------------
    describe('simulatePhysicalCapture', () => {
        it('deletes policy and returns 200', async () => {
            req.body = { device: 'drone-1' };
            const result = missionService.simulatePhysicalCapture(req, res);
            if (result instanceof Promise) await result;
            expect(policyService.deleteNetworkPolicyDuringMission).toHaveBeenCalledWith('policy-drone-1');
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    // -------------------------------------------------------------------------
    // uploadMissionManifest
    // -------------------------------------------------------------------------
    describe('uploadMissionManifest', () => {
        it('returns 403 if not mission creator', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            await missionService.uploadMissionManifest(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 400 if no files uploaded', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            req.files = null;
            await missionService.uploadMissionManifest(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    // -------------------------------------------------------------------------
    // downloadMissionManifest
    // -------------------------------------------------------------------------
    describe('downloadMissionManifest', () => {
        it('returns 403 if not mission creator', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            await missionService.downloadMissionManifest(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });
});
