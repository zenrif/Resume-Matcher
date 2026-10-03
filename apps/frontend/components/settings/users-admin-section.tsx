'use client';

import React, { useEffect, useState, useCallback } from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Check from 'lucide-react/dist/esm/icons/check';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Edit2 from 'lucide-react/dist/esm/icons/edit-2';
import Key from 'lucide-react/dist/esm/icons/key';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import UserCheck from 'lucide-react/dist/esm/icons/user-check';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus';
import UserX from 'lucide-react/dist/esm/icons/user-x';
import Users from 'lucide-react/dist/esm/icons/users';

import {
  createUser,
  createResetLink,
  deleteUser,
  listUsers,
  patchUser,
  type User,
} from '@/lib/api/auth';
import { useAuth } from '@/lib/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';

export function UsersAdminSection() {
  const { t } = useTranslations();
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite user form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviteRole, setInviteRole] = useState<'user' | 'admin'>('user');
  const [inviteLimit, setInviteLimit] = useState<string>('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Invite Link Modal state
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit Quota modal/state
  const [editingQuotaUser, setEditingQuotaUser] = useState<User | null>(null);
  const [newQuotaValue, setNewQuotaValue] = useState<string>('');
  const [quotaSaving, setQuotaSaving] = useState(false);

  // Delete User Confirmation state
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteSubmitting(true);

    try {
      const limitVal = inviteLimit.trim() === '' ? null : Number(inviteLimit);
      const res = await createUser({
        email: inviteEmail.trim(),
        display_name: inviteDisplayName.trim(),
        role: inviteRole,
        daily_ai_limit: limitVal,
      });

      const fullUrl = `${window.location.origin}${res.invite_path}`;
      setCreatedInviteUrl(fullUrl);
      setInviteEmail('');
      setInviteDisplayName('');
      setInviteLimit('');
      setShowInviteForm(false);
      await loadUsers();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setInviteError(err.message);
      } else {
        setInviteError('Failed to invite user');
      }
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleGenerateResetLink = async (targetUser: User) => {
    try {
      const res = await createResetLink(targetUser.id);
      const fullUrl = `${window.location.origin}${res.invite_path}`;
      setCreatedInviteUrl(fullUrl);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to generate reset link');
    }
  };

  const handleToggleActive = async (targetUser: User) => {
    try {
      await patchUser(targetUser.id, { is_active: !targetUser.is_active });
      await loadUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update user status');
    }
  };

  const handleSaveQuota = async () => {
    if (!editingQuotaUser) return;
    setQuotaSaving(true);
    try {
      const limitVal = newQuotaValue.trim() === '' ? null : Number(newQuotaValue);
      await patchUser(editingQuotaUser.id, { daily_ai_limit: limitVal });
      setEditingQuotaUser(null);
      await loadUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update quota');
    } finally {
      setQuotaSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await deleteUser(userToDelete.id);
      setUserToDelete(null);
      await loadUsers();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setDeleteError(err.message);
      } else {
        setDeleteError('Failed to delete user');
      }
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!createdInviteUrl) return;
    try {
      await navigator.clipboard.writeText(createdInviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/10 pb-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <h2 className="font-mono text-sm font-bold uppercase tracking-wider">
            {t('settings.users.title')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadUsers}
            disabled={loading}
            className="gap-1 text-xs font-mono uppercase"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {t('common.retry')}
          </Button>
          <Button
            size="sm"
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="font-mono text-xs uppercase font-bold"
          >
            <UserPlus className="w-3.5 h-3.5 mr-1.5" />
            {t('settings.users.inviteUser')}
          </Button>
        </div>
      </div>

      {/* Invite User Panel */}
      {showInviteForm && (
        <div className="border border-black bg-white p-6 shadow-sw-default space-y-4">
          <div className="flex items-center justify-between border-b border-black/10 pb-2">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black">
              {t('settings.users.inviteUser')}
            </h3>
            <button
              onClick={() => setShowInviteForm(false)}
              className="font-mono text-xs text-steel-grey uppercase hover:text-black"
            >
              ✕ {t('common.close')}
            </button>
          </div>

          {inviteError && (
            <div className="border border-red-500 bg-red-50 p-3 text-xs font-mono text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{inviteError}</span>
            </div>
          )}

          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="inviteEmail" className="font-mono text-xs uppercase">
                {t('settings.users.inviteEmail')}
              </Label>
              <Input
                id="inviteEmail"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="inviteDisplayName" className="font-mono text-xs uppercase">
                {t('settings.users.inviteDisplayName')}
              </Label>
              <Input
                id="inviteDisplayName"
                value={inviteDisplayName}
                onChange={(e) => setInviteDisplayName(e.target.value)}
                placeholder="Jane Doe"
                required
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="font-mono text-xs uppercase">
                {t('settings.users.inviteRole')}
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInviteRole('user')}
                  className={`flex-1 py-2 font-mono text-xs uppercase border border-black font-bold transition-all ${
                    inviteRole === 'user' ? 'bg-black text-white' : 'bg-white text-black'
                  }`}
                >
                  {t('settings.users.roleUser')}
                </button>
                <button
                  type="button"
                  onClick={() => setInviteRole('admin')}
                  className={`flex-1 py-2 font-mono text-xs uppercase border border-black font-bold transition-all ${
                    inviteRole === 'admin' ? 'bg-black text-white' : 'bg-white text-black'
                  }`}
                >
                  {t('settings.users.roleAdmin')}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="inviteLimit" className="font-mono text-xs uppercase">
                {t('settings.users.dailyQuota')}
              </Label>
              <Input
                id="inviteLimit"
                type="number"
                min="1"
                value={inviteLimit}
                onChange={(e) => setInviteLimit(e.target.value)}
                placeholder={t('settings.users.dailyQuotaPlaceholder')}
                className="font-mono text-xs"
              />
            </div>

            <div className="md:col-span-2 pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowInviteForm(false)}
                className="font-mono text-xs uppercase"
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={inviteSubmitting}
                size="sm"
                className="font-mono text-xs uppercase font-bold"
              >
                {inviteSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    {t('common.saving')}
                  </>
                ) : (
                  t('settings.users.sendInvite')
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="border border-black bg-white shadow-sw-sm overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center font-mono text-xs text-steel-grey uppercase">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            {t('common.loading')}
          </div>
        ) : error ? (
          <div className="p-6 text-center space-y-3">
            <p className="font-mono text-xs text-red-600 uppercase">{error}</p>
            <Button variant="outline" size="sm" onClick={loadUsers} className="font-mono text-xs">
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-black bg-paper-tint text-black uppercase">
                  <th className="p-3 font-bold">{t('settings.users.tableEmail')}</th>
                  <th className="p-3 font-bold">{t('settings.users.tableName')}</th>
                  <th className="p-3 font-bold">{t('settings.users.tableRole')}</th>
                  <th className="p-3 font-bold">{t('settings.users.tableQuota')}</th>
                  <th className="p-3 font-bold">{t('settings.users.tableStatus')}</th>
                  <th className="p-3 font-bold text-right">{t('settings.users.tableActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-medium text-black">
                        {u.email}
                        {isSelf && (
                          <span className="ml-2 px-1.5 py-0.5 border border-black bg-yellow-100 text-[10px] font-bold">
                            YOU
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-steel-grey">{u.display_name}</td>
                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 border border-black text-[10px] font-bold uppercase ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-900'
                              : 'bg-paper-tint text-ink-soft'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span>
                            {u.daily_ai_limit !== null
                              ? u.daily_ai_limit
                              : t('settings.users.quotaUnlimitedLabel')}
                          </span>
                          <button
                            onClick={() => {
                              setEditingQuotaUser(u);
                              setNewQuotaValue(
                                u.daily_ai_limit !== null ? String(u.daily_ai_limit) : ''
                              );
                            }}
                            className="text-steel-grey hover:text-black"
                            title={t('settings.users.editQuota')}
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1 font-bold text-[10px] uppercase ${
                            u.is_active ? 'text-green-700' : 'text-red-600'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-none ${
                              u.is_active ? 'bg-green-600' : 'bg-red-500'
                            }`}
                          />
                          {u.is_active ? t('settings.users.active') : t('settings.users.inactive')}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Reset Link */}
                          <button
                            onClick={() => handleGenerateResetLink(u)}
                            className="px-2 py-1 border border-black bg-white hover:bg-black hover:text-white transition-all text-[10px] uppercase font-bold"
                            title={t('settings.users.resetLink')}
                          >
                            <Key className="w-3 h-3 inline mr-1" />
                            {t('settings.users.resetLink')}
                          </button>

                          {/* Toggle Active / Deactivate */}
                          {!isSelf && (
                            <button
                              onClick={() => handleToggleActive(u)}
                              className="px-2 py-1 border border-black bg-white hover:bg-black hover:text-white transition-all text-[10px] uppercase font-bold"
                              title={
                                u.is_active
                                  ? t('settings.users.deactivate')
                                  : t('settings.users.activate')
                              }
                            >
                              {u.is_active ? (
                                <UserX className="w-3 h-3 text-red-600 inline" />
                              ) : (
                                <UserCheck className="w-3 h-3 text-green-600 inline" />
                              )}
                            </button>
                          )}

                          {/* Delete User */}
                          {!isSelf && (
                            <button
                              onClick={() => {
                                setUserToDelete(u);
                                setDeleteError(null);
                              }}
                              className="px-2 py-1 border border-red-500 text-red-600 hover:bg-red-600 hover:text-white transition-all text-[10px] uppercase font-bold"
                              title={t('settings.users.delete')}
                            >
                              <Trash2 className="w-3 h-3 inline" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Created Invite Link Modal */}
      {createdInviteUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg border border-black bg-background p-6 shadow-sw-lg space-y-4">
            <div className="flex items-center gap-2 text-black font-mono text-sm font-bold uppercase">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <span>{t('settings.users.inviteLinkTitle')}</span>
            </div>

            <div className="border border-black bg-paper-tint p-3 break-all font-mono text-xs text-black">
              {createdInviteUrl}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreatedInviteUrl(null)}
                className="font-mono text-xs uppercase"
              >
                {t('common.close')}
              </Button>
              <Button
                size="sm"
                onClick={handleCopyLink}
                className="font-mono text-xs uppercase font-bold"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1 text-green-400" />
                    {t('settings.users.linkCopied')}
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    {t('settings.users.copyLink')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Quota Modal */}
      {editingQuotaUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-black bg-background p-6 shadow-sw-lg space-y-4">
            <h3 className="font-mono text-sm font-bold uppercase text-black">
              {t('settings.users.editQuota')} - {editingQuotaUser.email}
            </h3>

            <div className="space-y-1">
              <Label className="font-mono text-xs uppercase text-steel-grey">
                {t('settings.users.dailyQuota')}
              </Label>
              <Input
                type="number"
                min="1"
                value={newQuotaValue}
                onChange={(e) => setNewQuotaValue(e.target.value)}
                placeholder={t('settings.users.dailyQuotaPlaceholder')}
                className="font-mono text-xs"
                autoFocus
              />
              <p className="text-[10px] font-mono text-steel-grey uppercase">
                Leave empty for unlimited
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingQuotaUser(null)}
                disabled={quotaSaving}
                className="font-mono text-xs uppercase"
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleSaveQuota}
                disabled={quotaSaving}
                className="font-mono text-xs uppercase font-bold"
              >
                {quotaSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    {t('common.saving')}
                  </>
                ) : (
                  t('settings.users.saveQuota')
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-black bg-background p-6 shadow-sw-lg space-y-4">
            <div className="flex items-center gap-2 text-red-700 font-mono text-sm font-bold uppercase">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{t('settings.users.deleteUserConfirmTitle')}</span>
            </div>

            <p className="font-mono text-xs text-ink-soft leading-relaxed">
              {t('settings.users.deleteUserConfirmDescription', { email: userToDelete.email })}
            </p>

            {deleteError && (
              <p className="font-mono text-xs text-red-600 bg-red-50 p-2 border border-red-200">
                {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUserToDelete(null)}
                disabled={deleteSubmitting}
                className="font-mono text-xs uppercase"
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteUser}
                disabled={deleteSubmitting}
                className="font-mono text-xs uppercase font-bold"
              >
                {deleteSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    {t('common.processing')}
                  </>
                ) : (
                  t('common.delete')
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
