import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import InvitePage from '@/app/(auth)/invite/[token]/page';
import * as authApi from '@/lib/api/auth';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'mock-token-123' }),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/api/auth', () => ({
  validateInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

describe('InvitePage Password Visibility Toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders password inputs as password type by default and toggles visibility on button click', async () => {
    vi.mocked(authApi.validateInvite).mockResolvedValue({
      email: 'alex@example.com',
      display_name: 'Alex',
      purpose: 'invite',
    });

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByText('alex@example.com')).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText('auth.newPassword') as HTMLInputElement;
    const confirmInput = screen.getByLabelText('auth.confirmPassword') as HTMLInputElement;

    // Both should be 'password' by default (hidden)
    expect(passwordInput.type).toBe('password');
    expect(confirmInput.type).toBe('password');

    // Find toggle buttons via aria-label
    const toggleButtons = screen.getAllByRole('button', { name: 'auth.showPassword' });
    expect(toggleButtons).toHaveLength(2);

    // Toggle main password visibility
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(passwordInput.type).toBe('text');
    });
    expect(confirmInput.type).toBe('password');

    // Toggle again to hide
    fireEvent.click(screen.getByRole('button', { name: 'auth.hidePassword' }));
    await waitFor(() => {
      expect(passwordInput.type).toBe('password');
    });

    // Toggle confirm password visibility
    const confirmToggle = screen.getAllByRole('button', { name: 'auth.showPassword' })[1];
    fireEvent.click(confirmToggle);
    await waitFor(() => {
      expect(confirmInput.type).toBe('text');
    });
    expect(passwordInput.type).toBe('password');

    // Toggle confirm password back to hidden
    fireEvent.click(screen.getByRole('button', { name: 'auth.hidePassword' }));
    await waitFor(() => {
      expect(confirmInput.type).toBe('password');
    });
  });
});
