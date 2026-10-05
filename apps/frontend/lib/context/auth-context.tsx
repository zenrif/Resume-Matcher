'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { me, logout as apiLogout, type UserMe } from '@/lib/api/auth';
import { sanitizeNextUrl } from '@/lib/api/client';

export interface AuthContextType {
  user: UserMe | null;
  isAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<UserMe | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<UserMe | null> => {
    try {
      const u = await me();
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
  }, []);

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useOptionalAuth(): AuthContextType | undefined {
  return useContext(AuthContext);
}

/**
 * Gate component that prevents children from rendering until auth state is known.
 * If unauthenticated, redirects to `/login?next=<path>` with open-redirect guards.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      if (typeof window !== 'undefined') {
        const currentPath = window.location.pathname + window.location.search;
        const safeNext = sanitizeNextUrl(currentPath);
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = `/login?next=${encodeURIComponent(safeNext)}`;
        }
      }
    }
  }, [loading, user]);

  if (loading || !user) {
    return null;
  }

  return <>{children}</>;
}
