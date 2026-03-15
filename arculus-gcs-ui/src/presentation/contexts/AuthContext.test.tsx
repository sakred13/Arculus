import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import Cookies from 'js-cookie';

// Mock the config module
jest.mock('../../config', () => ({
  API_URL: 'http://localhost:3001'
}));

// Mock js-cookie
jest.mock('js-cookie');

const mockCookiesGet = Cookies.get as jest.Mock;

describe('AuthContext', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, 'fetch');
        jest.clearAllMocks();
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    const TestComponent = () => {
        const { userType, isLegitimateUser, loading, ztMode } = useAuth();

        if (loading) return <div>Loading...</div>;
        if (!isLegitimateUser) return <div>Not Authorized</div>;

        return (
            <div>
                <span data-testid="userType">{userType}</span>
                <span data-testid="ztMode">{ztMode}</span>
            </div>
        );
    };

    it('should successfully authenticate user with a valid token', async () => {
        // Arrange
        mockCookiesGet.mockReturnValue('valid-token');
        
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ userType: 'Mission Creator', mode: 'strict_zt' }),
            status: 200,
        });

        // Act
        render(
            <AuthProvider>
                <TestComponent />
            </AuthProvider>
        );

        // Assert initial loading state
        expect(screen.getByText('Loading...')).toBeInTheDocument();

        // Assert resolved state
        await waitFor(() => {
            expect(screen.getByTestId('userType')).toHaveTextContent('Mission Creator');
            expect(screen.getByTestId('ztMode')).toHaveTextContent('strict_zt');
        });

        // Verify API was called EXACTLY once
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3001/auth/authorize?authToken=valid-token');
    });

    it('should show unauthorized if no token is present', async () => {
        mockCookiesGet.mockReturnValue(undefined);

        render(
            <AuthProvider>
                <TestComponent />
            </AuthProvider>
        );

        await waitFor(() => {
            expect(screen.getByText('Not Authorized')).toBeInTheDocument();
        });

        // fetch shouldn't even be called without a token
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should show unauthorized if API returns 403', async () => {
        mockCookiesGet.mockReturnValue('invalid-token');
        
        fetchSpy.mockResolvedValueOnce({
            ok: false,
            status: 403,
        });

        render(
            <AuthProvider>
                <TestComponent />
            </AuthProvider>
        );

        await waitFor(() => {
            expect(screen.getByText('Not Authorized')).toBeInTheDocument();
        });
    });
});
