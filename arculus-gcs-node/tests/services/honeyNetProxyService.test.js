const honeyNetProxyService = require('../../services/honeyNetProxyService');
const authService = require('../../services/authService');
const axios = require('axios');
const fs = require('fs-extra');

jest.mock('../../services/authService', () => ({
    isUserOfType: jest.fn(),
    getUserFromToken: jest.fn()
}));

jest.mock('axios');

jest.mock('fs-extra', () => ({
    readFileSync: jest.fn().mockReturnValue(JSON.stringify({ honeyNetDomain: 'test-domain', apikey: 'test-key' }))
}));

describe('HoneyNetProxyService', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: { authToken: 'test-token', otherParam: '123' },
            params: ['test-path'],
            method: 'GET',
            body: { data: 'test-data' }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        authService.getUserFromToken.mockReturnValue('testuser');
    });

    describe('honeyPotApi', () => {
        it('returns 500 if role check errors', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(new Error('db error'), null);
                return Promise.reject(new Error('db error'));
            });

            const result = honeyNetProxyService.honeyPotApi(req, res);
            if (result instanceof Promise) {
                try { await result; } catch(e) {}
            }

            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('returns 403 if user is not admin', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(null, false);
                return Promise.resolve(false);
            });

            const result = honeyNetProxyService.honeyPotApi(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized: Only users with admin role can access the honeypot API' });
        });

        it('forwards request to honeypot API and returns successful response', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(null, true);
                return Promise.resolve(true);
            });

            axios.mockResolvedValue({ status: 200, data: { success: true } });

            const result = honeyNetProxyService.honeyPotApi(req, res);
            if (result instanceof Promise) await result;

            expect(axios).toHaveBeenCalledWith({
                method: 'GET',
                url: 'http://test-domain/test-path',
                params: { otherParam: '123' },
                headers: { apikey: 'test-key' },
                data: { data: 'test-data' }
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true });
        });

        it('handles errors from honeypot API with response', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(null, true);
                return Promise.resolve(true);
            });

            axios.mockRejectedValue({ response: { status: 404 } });

            const result = honeyNetProxyService.honeyPotApi(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Proxy error' });
        });

        it('handles errors from honeypot API without response', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(null, true);
                return Promise.resolve(true);
            });

            axios.mockRejectedValue(new Error('Network error'));

            const result = honeyNetProxyService.honeyPotApi(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Proxy error' });
        });
    });
});
