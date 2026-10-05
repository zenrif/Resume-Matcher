import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { AuthProvider, AuthGate, useAuth } from '@/lib/context/auth-context';
import * as authApi from '@/lib/api/auth';

function TestConsumer() {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <div>LOADING_AUTH</div>;
  if (!user) return <div>NO_USER</div>;
  return (
    <div>
      <span>EMAIL: {user.email}</span>
      <span>ROLE: {user.role}</span>
      <span>IS_ADMIN: {isAdmin ? 'YES' : 'NO'}</span>
      <span>LIMIT: {user.daily_ai_limit ?? 'UNLIMITED'}</span>
      <span>USED: {user.ai_used_today}</span>
    </div>
  );
}

describe('AuthProvider & AuthGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children with authenticated user data when me() succeeds', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValueOnce({
      id: 'u-1',
      email: 'admin@example.com',
      display_name: 'Admin User',
      role: 'admin',
      content_language: 'en',
      daily_ai_limit: null,
      ai_used_today: 3,
    });

    render(
      <AuthProvider>
        <AuthGate>
          <TestConsumer />
        </AuthGate>
      </AuthProvider>
    );

    // Initial state shows nothing or loading
    await waitFor(() => {
      expect(screen.getByText('EMAIL: admin@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('ROLE: admin')).toBeInTheDocument();
    expect(screen.getByText('IS_ADMIN: YES')).toBeInTheDocument();
    expect(screen.getByText('LIMIT: UNLIMITED')).toBeInTheDocument();
    expect(screen.getByText('USED: 3')).toBeInTheDocument();
  });

  it('redirects to /login?next=... when user is unauthenticated', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValueOnce(null);

    const originalLocation = window.location;
    delete (window as unknown as { location?: unknown }).location;
    (
      window as unknown as { location: { href: string; pathname: string; search: string } }
    ).location = {
      href: 'http://localhost:3000/settings',
      pathname: '/settings',
      search: '',
    };

    try {
      render(
        <AuthProvider>
          <AuthGate>
            <div data-testid="protected-content">SECRET</div>
          </AuthGate>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(window.location.href).toBe('/login?next=%2Fsettings');
      });

      // Protected content should never render
      expect(screen.queryByTestId('protected-content')).toBeNull();
    } finally {
      (window as unknown as { location: unknown }).location = originalLocation;
    }
  });

  it('redirects root / to /login?next=%2Fdashboard when unauthenticated', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValueOnce(null);

    const originalLocation = window.location;
    delete (window as unknown as { location?: unknown }).location;
    (
      window as unknown as { location: { href: string; pathname: string; search: string } }
    ).location = {
      href: 'http://localhost:3000/',
      pathname: '/',
      search: '',
    };

    try {
      render(
        <AuthProvider>
          <AuthGate>
            <div data-testid="protected-content">SECRET</div>
          </AuthGate>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(window.location.href).toBe('/login?next=%2Fdashboard');
      });

      expect(screen.queryByTestId('protected-content')).toBeNull();
    } finally {
      (window as unknown as { location: unknown }).location = originalLocation;
    }
  });

  it('recognizes regular user role and sets isAdmin to false', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValueOnce({
      id: 'u-2',
      email: 'user@example.com',
      display_name: 'Regular User',
      role: 'user',
      content_language: 'id',
      daily_ai_limit: 10,
      ai_used_today: 2,
    });

    render(
      <AuthProvider>
        <AuthGate>
          <TestConsumer />
        </AuthGate>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('EMAIL: user@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('ROLE: user')).toBeInTheDocument();
    expect(screen.getByText('IS_ADMIN: NO')).toBeInTheDocument();
    expect(screen.getByText('LIMIT: 10')).toBeInTheDocument();
    expect(screen.getByText('USED: 2')).toBeInTheDocument();
  });
});
