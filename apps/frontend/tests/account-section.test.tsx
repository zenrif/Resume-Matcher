import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AccountSection } from '@/components/settings/account-section';
import * as authApi from '@/lib/api/auth';
import * as authContext from '@/lib/context/auth-context';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.used !== undefined) return `${params.used} operations used`;
      return key;
    },
  }),
}));

vi.mock('@/lib/api/auth', () => ({
  changePassword: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiPost: vi.fn(),
}));

describe('AccountSection Profile Editing', () => {
  const mockRefresh = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      user: {
        id: 'user-123',
        email: 'user@example.com',
        display_name: 'Original Name',
        role: 'user',
        content_language: 'en',
        daily_ai_limit: 50,
        ai_used_today: 5,
      },
      loading: false,
      isAdmin: false,
      logout: vi.fn(),
      refresh: mockRefresh,
    });
  });

  it('renders current user email and display name', () => {
    render(<AccountSection />);

    const emailInput = screen.getByLabelText('auth.email') as HTMLInputElement;
    expect(emailInput.value).toBe('user@example.com');
    expect(emailInput).toHaveAttribute('readOnly');

    const displayNameInput = screen.getByLabelText('settings.account.displayName') as HTMLInputElement;
    expect(displayNameInput.value).toBe('Original Name');

    const saveButton = screen.getByRole('button', { name: 'settings.account.saveProfile' });
    expect(saveButton).toBeDisabled();
  });

  it('enables save button when display name is edited and successfully updates profile', async () => {
    vi.mocked(authApi.updateProfile).mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      display_name: 'Updated Name',
      role: 'user',
      content_language: 'en',
      daily_ai_limit: 50,
      ai_used_today: 5,
    });

    render(<AccountSection />);

    const displayNameInput = screen.getByLabelText('settings.account.displayName') as HTMLInputElement;
    const saveButton = screen.getByRole('button', { name: 'settings.account.saveProfile' });

    // Change display name
    fireEvent.change(displayNameInput, { target: { value: 'Updated Name' } });
    expect(saveButton).not.toBeDisabled();

    // Click save
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(authApi.updateProfile).toHaveBeenCalledWith({ display_name: 'Updated Name' });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(screen.getByText('settings.account.profileUpdated')).toBeInTheDocument();
    });
  });

  it('shows error message if updating profile fails', async () => {
    vi.mocked(authApi.updateProfile).mockRejectedValue(new Error('Network error'));

    render(<AccountSection />);

    const displayNameInput = screen.getByLabelText('settings.account.displayName') as HTMLInputElement;
    fireEvent.change(displayNameInput, { target: { value: 'New Name' } });

    const saveButton = screen.getByRole('button', { name: 'settings.account.saveProfile' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
