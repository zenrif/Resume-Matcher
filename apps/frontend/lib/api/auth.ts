import { apiDelete, apiFetch, apiPatch, apiPost, parseErrorDetail } from './client';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  daily_ai_limit: number | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface UserMe {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  content_language: string;
  daily_ai_limit: number | null;
  ai_used_today: number;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  user: User;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export interface InviteValidateResult {
  email: string;
  display_name: string;
  purpose: 'invite' | 'reset';
}

export interface AcceptInvitePayload {
  password: string;
}

export interface CreateUserPayload {
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  daily_ai_limit?: number | null;
}

export interface CreateUserResult {
  user: User;
  invite_path: string;
}

export interface ResetLinkResult {
  invite_path: string;
}

export interface PatchUserPayload {
  display_name?: string;
  is_active?: boolean;
  daily_ai_limit?: number | null;
}

export async function login(payload: LoginPayload): Promise<LoginResult> {
  const res = await apiPost<LoginPayload>('/auth/login', payload);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Login failed');
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await apiPost('/auth/logout', {});
}

export async function me(): Promise<UserMe | null> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to fetch user');
  }
  return res.json();
}

export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  const res = await apiPost<ChangePasswordPayload>('/auth/password', payload);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to change password');
  }
}

export async function validateInvite(token: string): Promise<InviteValidateResult> {
  const res = await apiFetch(`/auth/invite/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Invite link is invalid or has expired');
  }
  return res.json();
}

export async function acceptInvite(
  token: string,
  payload: AcceptInvitePayload
): Promise<LoginResult> {
  const res = await apiPost<AcceptInvitePayload>(
    `/auth/invite/${encodeURIComponent(token)}`,
    payload
  );
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to set password');
  }
  return res.json();
}

// Admin user management calls
export async function listUsers(): Promise<User[]> {
  const res = await apiFetch('/admin/users');
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to list users');
  }
  return res.json();
}

export async function createUser(payload: CreateUserPayload): Promise<CreateUserResult> {
  const res = await apiPost<CreateUserPayload>('/admin/users', payload);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to create user');
  }
  return res.json();
}

export async function createResetLink(userId: string): Promise<ResetLinkResult> {
  const res = await apiPost(`/admin/users/${encodeURIComponent(userId)}/reset-link`, {});
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to generate reset link');
  }
  return res.json();
}

export async function patchUser(userId: string, payload: PatchUserPayload): Promise<User> {
  const res = await apiPatch<PatchUserPayload>(
    `/admin/users/${encodeURIComponent(userId)}`,
    payload
  );
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to update user');
  }
  return res.json();
}

export async function deleteUser(userId: string): Promise<void> {
  const res = await apiDelete(`/admin/users/${encodeURIComponent(userId)}`);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(parseErrorDetail(errorBody) || 'Failed to delete user');
  }
}
