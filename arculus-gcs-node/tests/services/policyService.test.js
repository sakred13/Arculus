const authService = require('../../services/authService');
const { exec } = require('child_process');
const util = require('util');

jest.mock('../../services/authService', () => ({
    isUserOfType: jest.fn(),
    getUserFromToken: jest.fn(),
}));

jest.mock('child_process', () => ({
    exec: jest.fn(),
}));

// Require service AFTER mocks are registered
const policyService = require('../../services/policyService');

describe('PolicyService', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: { authToken: 'test-token' },
            body: { authToken: 'test-token' },
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            send: jest.fn(),
        };
        authService.getUserFromToken.mockReturnValue('testuser');
    });

    // -----------------------------------------------------------------------
    // addNetworkPolicy
    // -----------------------------------------------------------------------
    describe('addNetworkPolicy', () => {
        // NOTE: the original code has a bug — isAdmin() is called without await,
        // so `admin` is always a truthy Promise and the 403 branch is dead code.
        // This test documents the EXPECTED behaviour after refactoring.
        it('returns 403 when user is not admin', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            req.body = { authToken: 'test-token', device: 'drone-1', ingress: [], egress: [] };
            await policyService.addNetworkPolicy(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('applies kubectl and returns 200 when user is admin', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            exec.mockImplementation((cmd, cb) => cb(null, 'applied', ''));
            req.body = { authToken: 'test-token', device: 'drone-1', ingress: [], egress: [] };
            await policyService.addNetworkPolicy(req, res);
            expect(exec).toHaveBeenCalledWith(
                expect.stringContaining('kubectl apply'),
                expect.any(Function)
            );
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ networkPolicyId: 'policy-drone-1' });
        });

        it('returns 500 when kubectl fails', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            exec.mockImplementation((cmd, cb) => cb(new Error('kubectl error'), '', 'err'));
            req.body = { authToken: 'test-token', device: 'drone-1', ingress: [], egress: [] };
            await policyService.addNetworkPolicy(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // -----------------------------------------------------------------------
    // getNetworkPolicies
    // -----------------------------------------------------------------------
    describe('getNetworkPolicies', () => {
        // NOTE: same missing-await bug as addNetworkPolicy — 403 branch is dead in original.
        it('returns 403 when user is not admin', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            await policyService.getNetworkPolicies(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 200 with parsed policies when user is admin', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            const mockOutput = JSON.stringify({
                items: [
                    {
                        metadata: { name: 'policy-drone-1' },
                        spec: {
                            podSelector: {},
                            policyTypes: ['Ingress'],
                            ingress: [],
                            egress: [],
                        },
                    },
                ],
            });
            exec.mockImplementation((cmd, cb) => cb(null, mockOutput, ''));
            await policyService.getNetworkPolicies(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.arrayContaining([expect.objectContaining({ name: 'policy-drone-1' })])
            );
        });

        it('returns 500 when kubectl fails', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            exec.mockImplementation((cmd, cb) => cb(new Error('kubectl error'), '', 'err'));
            await policyService.getNetworkPolicies(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // -----------------------------------------------------------------------
    // deleteNetworkPolicy
    // -----------------------------------------------------------------------
    describe('deleteNetworkPolicy', () => {
        // NOTE: same missing-await bug — 403 branch is dead in original.
        it('returns 403 when user is not admin', async () => {
            authService.isUserOfType.mockResolvedValue(false);
            req.body = { authToken: 'test-token', policyName: 'policy-drone-1' };
            await policyService.deleteNetworkPolicy(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 200 when policy deleted successfully', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            exec.mockImplementation((cmd, cb) => cb(null, 'deleted', ''));
            req.body = { authToken: 'test-token', policyName: 'policy-drone-1' };
            await policyService.deleteNetworkPolicy(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('returns 500 when kubectl fails', async () => {
            authService.isUserOfType.mockResolvedValue(true);
            exec.mockImplementation((cmd, cb) => cb(new Error('kubectl error'), '', 'err'));
            req.body = { authToken: 'test-token', policyName: 'policy-drone-1' };
            await policyService.deleteNetworkPolicy(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    // -----------------------------------------------------------------------
    // addNetworkPolicyDuringMission
    // -----------------------------------------------------------------------
    describe('addNetworkPolicyDuringMission', () => {
        it('runs kubectl and resolves with the policy ID', async () => {
            // execAsync (promisified) used internally — mock exec to call back immediately
            exec.mockImplementation((cmd, cb) => cb(null, 'applied', ''));
            const id = await policyService.addNetworkPolicyDuringMission('drone-1', [], []);
            expect(id).toBe('policy-drone-1');
        });

        it('throws when kubectl fails', async () => {
            exec.mockImplementation((cmd, cb) => cb(new Error('kubectl error'), '', 'err'));
            await expect(
                policyService.addNetworkPolicyDuringMission('drone-1', [], [])
            ).rejects.toThrow('Failed to create NetworkPolicy');
        });
    });

    // -----------------------------------------------------------------------
    // deleteNetworkPolicyDuringMission
    // -----------------------------------------------------------------------
    describe('deleteNetworkPolicyDuringMission', () => {
        it('fires kubectl delete command', () => {
            exec.mockImplementation(() => {}); // fire-and-forget
            policyService.deleteNetworkPolicyDuringMission('policy-drone-1');
            expect(exec).toHaveBeenCalledWith(
                expect.stringContaining('kubectl delete networkpolicy policy-drone-1'),
                expect.any(Function)
            );
        });
    });
});
