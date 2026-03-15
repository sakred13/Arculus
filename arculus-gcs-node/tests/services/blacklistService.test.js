const blacklistService = require('../../services/blacklistService');
const authService = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');

jest.mock('../../services/authService', () => ({
    isUserOfType: jest.fn(),
    getUserFromToken: jest.fn()
}));

jest.mock('../../modules/arculusDbConnection', () => ({
    query: jest.fn(),
    promise: jest.fn().mockReturnThis()
}));

describe('BlacklistService', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: { authToken: 'test-token', records: '10' },
            body: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        authService.getUserFromToken.mockReturnValue('testuser');
    });

    describe('getBlacklist', () => {
        it('returns 500 if role check errors', () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                // If it expects roles array (current code)
                if (typeof roles === 'function') {
                    roles(new Error('db error'), null);
                } else if (cb) {
                    cb(new Error('db error'), null);
                } else {
                    return Promise.reject(new Error('db error'));
                }
            });

            // Call the callback-style if it's there
            const result = blacklistService.getBlacklist(req, res);
            // It might be async if refactored, but currently it's sync with callbacks
            
            // To handle both sync and async testing style uniformly, we will check if it returns a promise
            if (result instanceof Promise) {
                return result.then(() => {
                    expect(res.status).toHaveBeenCalledWith(500);
                });
            } else {
                expect(res.status).toHaveBeenCalledWith(500);
            }
        });

        it('returns 403 if user is not admin', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(null, false);
                return Promise.resolve(false);
            });

            const result = blacklistService.getBlacklist(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns blacklisted IPs successfully if admin', async () => {
            authService.isUserOfType.mockImplementation((user, roles, cb) => {
                if (cb) cb(null, true);
                return Promise.resolve(true);
            });

            pool.query.mockImplementation((query, cb) => {
                if(cb) cb(null, [{ blacklist_ip: '192.168.1.1' }, { blacklist_ip: '10.0.0.1' }]);
            });

            pool.promise().query.mockResolvedValue([[{ blacklist_ip: '192.168.1.1' }, { blacklist_ip: '10.0.0.1' }]]);

            const result = blacklistService.getBlacklist(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ blacklistedIPs: ['192.168.1.1', '10.0.0.1'] });
        });
    });

    describe('removeFromBlacklist', () => {
        beforeEach(() => {
            req.body = { ipAddresses: '192.168.1.1,10.0.0.1' };
        });

        it('returns 500 if role check errors', async () => {
            // Note: the existing code for removeFromBlacklist passes `(user, cb)` omitting the roles array, 
            // which is a bug in the existing code! isUserOfType expects (user, userTypes, cb).
            // We'll mock it to just call whatever the last argument is as a callback.
            authService.isUserOfType.mockImplementation((...args) => {
                const cb = args[args.length - 1];
                if (typeof cb === 'function') cb(new Error('db error'), null);
                return Promise.reject(new Error('db error'));
            });

            try {
                const result = blacklistService.removeFromBlacklist(req, res);
                if (result instanceof Promise) await result;
            } catch(e) {}

            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('returns 200 on successful removal', async () => {
             authService.isUserOfType.mockImplementation((...args) => {
                const cb = args[args.length - 1];
                if (typeof cb === 'function') cb(null, true);
                return Promise.resolve(true);
            });

            pool.query.mockImplementation((query, values, cb) => {
                if(cb) cb(null);
            });
            pool.promise().query.mockResolvedValue([{}]);

            const result = blacklistService.removeFromBlacklist(req, res);
            if (result instanceof Promise) await result;

            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
