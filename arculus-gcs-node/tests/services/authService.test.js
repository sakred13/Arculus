const authService = require('../../services/authService');
const pool = require('../../modules/arculusDbConnection');
const jwt = require('jsonwebtoken');

jest.mock('../../modules/arculusDbConnection', () => {
    const mPool = {
        promise: jest.fn().mockReturnThis(),
        query: jest.fn()
    };
    return mPool;
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn()
}));

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserFromToken', () => {
    it('returns Unauthorized for invalid token type', () => {
      expect(authService.getUserFromToken(123)).toBe('Unauthorized');
    });

    it('returns username for valid token', () => {
      jwt.verify.mockReturnValue({ username: 'testuser' });
      expect(authService.getUserFromToken('validtoken')).toBe('testuser');
    });

    it('returns Unauthorized on verification error', () => {
      jwt.verify.mockImplementation(() => { throw new Error('invalid'); });
      expect(authService.getUserFromToken('badtoken')).toBe('Unauthorized');
    });
  });

  describe('getUserRole', () => {
    it('returns role if found', async () => {
      pool.query.mockResolvedValue([[{ role_name: 'Mission Creator' }]]);

      const role = await authService.getUserRole('testuser');
      expect(role).toBe('Mission Creator');
    });

    it('returns null if no role found', async () => {
      pool.query.mockResolvedValue([[]]);

      const role = await authService.getUserRole('testuser');
      expect(role).toBeNull();
    });
  });

  describe('isUserOfType', () => {
    it('returns true if user matches type', async () => {
        pool.query.mockResolvedValue([[{ role_name: 'Mission Creator' }]]);

        const isMatch = await authService.isUserOfType('adminUser', ['Mission Creator', 'Mission Viewer']);
        expect(isMatch).toBe(true);
    });

    it('returns false if user does not match type', async () => {
        pool.query.mockResolvedValue([[{ role_name: 'Operator' }]]);

        const isMatch = await authService.isUserOfType('operatorUser', ['Mission Creator', 'Mission Viewer']);
        expect(isMatch).toBe(false);
    });
  });
});
