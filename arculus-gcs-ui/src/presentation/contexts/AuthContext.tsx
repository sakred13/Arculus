import React, { createContext, useContext, useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import { API_URL } from '../../config';

interface AuthContextType {
    userType: string | null;
    isLegitimateUser: boolean;
    loading: boolean;
    ztMode: string | null;
}

const AuthContext = createContext<AuthContextType>({
    userType: null,
    isLegitimateUser: false,
    loading: true,
    ztMode: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [userType, setUserType] = useState<string | null>(null);
    const [isLegitimateUser, setIsLegitimateUser] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);
    const [ztMode, setZtMode] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const checkAuth = async () => {
            const token = Cookies.get('jwtToken');
            if (!token) {
                if (isMounted) {
                    setIsLegitimateUser(false);
                    setLoading(false);
                }
                return;
            }

            try {
                const response = await fetch(`${API_URL}/auth/authorize?authToken=${encodeURIComponent(token)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (isMounted) {
                        setUserType(data.userType);
                        setZtMode(data.mode);
                        setIsLegitimateUser(true);
                    }
                } else {
                    if (isMounted) {
                        setIsLegitimateUser(false);
                    }
                }
            } catch (error) {
                console.error("Auth check failed:", error);
                if (isMounted) {
                    setIsLegitimateUser(false);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        checkAuth();
        return () => { isMounted = false; };
    }, []);

    return (
        <AuthContext.Provider value={{ userType, isLegitimateUser, loading, ztMode }}>
            {children}
        </AuthContext.Provider>
    );
};
