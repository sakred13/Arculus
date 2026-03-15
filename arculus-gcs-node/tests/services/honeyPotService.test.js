const honeyPotService = require('../../services/honeyPotService');
const authService = require('../../services/authService');
const axios = require('axios');

jest.mock('../../services/authService', () => ({
    isUserOfType: jest.fn(),
    getUserFromToken: jest.fn()
}));

jest.mock('axios');

jest.mock('fs-extra', () => ({
    readFileSync: jest.fn().mockReturnValue(JSON.stringify({ url: 'test-url', deployKey: 'test-key' }))
}));

describe('HoneyPotService', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: { authToken: 'test-token', honeypotTarget: 'target', honeypotType: 'type' },
            method: 'POST'
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        authService.getUserFromToken.mockReturnValue('testuser');
    });

    describe('createHoneyPot', () => {
        it('returns 403 if user is not admin', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, false);
                return false;
            });

            const result = honeyPotService.createHoneyPot(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('deploys honeypot successfully', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            axios.mockResolvedValue({ status: 200, data: { success: true } });

            const result = honeyPotService.createHoneyPot(req, res);
            if (result instanceof Promise) await result;

            expect(axios).toHaveBeenCalledWith(expect.objectContaining({
                url: 'http://target:5000/deployHoneyPot',
                data: { url: 'test-url', deployKey: 'test-key', potType: 'type' }
            }));
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true });
        });

        it('returns 400 for duplicate request', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            // Already pushed successfully in previous test, so hitting again should trigger duplicate code
            const result = honeyPotService.createHoneyPot(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Duplicate') }));
        });
    });

    describe('getDeployedHoneypots', () => {
        it('returns list of deployed honeypots', async () => {
             authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            const result = honeyPotService.getDeployedHoneypots(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(200);
            // It should have the ["target", "type"] inserted by the `deploys honeypot successfully` test above
            expect(res.json).toHaveBeenCalledWith({ deployedHoneypots: [
                { honeypotTarget: 'target', honeypotType: 'type' }
            ] });
        });
    });

    describe('undeployHoneypot', () => {
        it('returns 404 if honeypot not found', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            req.query.honeypotTarget = 'nonexistent-target';

            const result = honeyPotService.undeployHoneypot(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ message: 'Honeypot not found' });
        });

        it('undeploys successfully', async () => {
            authService.isUserOfType.mockImplementation(async (user, roles, cb) => {
                if (cb) cb(null, true);
                return true;
            });

            axios.mockResolvedValue({ status: 200, data: { success: true } });

            // Using the duplicate previously deployed
            const result = honeyPotService.undeployHoneypot(req, res);
            if (result instanceof Promise) await result;

            expect(axios).toHaveBeenCalledWith(expect.objectContaining({
                method: 'DELETE',
                url: 'http://target:5000/undeployHoneypot'
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
