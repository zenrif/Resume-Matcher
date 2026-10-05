'use client';

import React, { useEffect, useState } from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Key from 'lucide-react/dist/esm/icons/key';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import UserIcon from 'lucide-react/dist/esm/icons/user';

import { useAuth } from '@/lib/context/auth-context';
import { changePassword, updateProfile } from '@/lib/api/auth';
import { apiPost } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';

export function AccountSection() {
  const { t } = useTranslations();
  const { user, refresh } = useAuth();

  // Profile State
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [isDisplayNameDirty, setIsDisplayNameDirty] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);

  useEffect(() => {
    if (user?.display_name && !isDisplayNameDirty) {
      setDisplayName(user.display_name);
    }
  }, [user?.display_name, isDisplayNameDirty]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);

    const trimmed = displayName.trim();
    if (!trimmed) {
      setProfileError(t('settings.account.displayNameRequired'));
      return;
    }

    setProfileLoading(true);
    try {
      await updateProfile({ display_name: trimmed });
      await refresh();
      setProfileSuccess(true);
      setIsDisplayNameDirty(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setProfileError(err.message);
      } else {
        setProfileError('Failed to update profile');
      }
    } finally {
      setProfileLoading(false);
    }
  };

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Delete Data State
  const [showDeleteDataDialog, setShowDeleteDataDialog] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError(t('auth.passwordMinLength'));
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError(t('auth.passwordsDoNotMatch'));
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setPasswordError(err.message);
      } else {
        setPasswordError('Failed to change password');
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteData = async () => {
    if (deleteConfirmationText !== 'RESET_ALL_DATA') {
      setDeleteError('Please type RESET_ALL_DATA exactly to confirm');
      return;
    }

    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await apiPost('/config/reset', { confirm: 'RESET_ALL_DATA' });
      if (!res.ok) {
        throw new Error('Failed to reset user data');
      }
      setShowDeleteDataDialog(false);
      setDeleteConfirmationText('');
      setDeleteSuccess(true);
      await refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setDeleteError(err.message);
      } else {
        setDeleteError('Failed to delete data');
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const used = user?.ai_used_today ?? 0;
  const limit = user?.daily_ai_limit;
  const isUnlimited = limit === null || limit === undefined;
  const percentUsed = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-black/10 pb-2">
        <Key className="w-4 h-4" />
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider">
          {t('settings.account.title')}
        </h2>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Card */}
        <div className="border border-black bg-white p-6 shadow-sw-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-blue-700" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black">
                {t('settings.account.profileTitle')}
              </h3>
            </div>
            <span className="font-mono text-xs text-steel-grey uppercase">
              {user?.role === 'admin'
                ? t('settings.users.roleAdmin')
                : t('settings.users.roleUser')}
            </span>
          </div>

          {profileSuccess && (
            <div className="border border-green-500 bg-green-50 p-3 flex items-center gap-2 text-xs font-mono text-green-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t('settings.account.profileUpdated')}</span>
            </div>
          )}

          {profileError && (
            <div className="border border-red-500 bg-red-50 p-3 flex items-center gap-2 text-xs font-mono text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{profileError}</span>
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="accountEmail" className="text-xs font-mono uppercase text-steel-grey">
                {t('auth.email')}
              </Label>
              <Input
                id="accountEmail"
                type="email"
                value={user?.email ?? ''}
                readOnly
                disabled
                className="font-mono text-xs h-9 bg-paper-tint text-steel-grey cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="displayName" className="text-xs font-mono uppercase">
                {t('settings.account.displayName')}
              </Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setIsDisplayNameDirty(true);
                  if (profileSuccess) setProfileSuccess(false);
                  if (profileError) setProfileError(null);
                }}
                required
                maxLength={100}
                placeholder={t('settings.account.displayNamePlaceholder')}
                className="font-mono text-xs h-9"
                disabled={profileLoading}
              />
            </div>

            <Button
              type="submit"
              disabled={
                profileLoading ||
                !displayName.trim() ||
                displayName.trim() === (user?.display_name ?? '')
              }
              size="sm"
              className="w-full font-mono text-xs uppercase font-bold"
            >
              {profileLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  {t('settings.account.savingProfile')}
                </>
              ) : (
                t('settings.account.saveProfile')
              )}
            </Button>
          </form>
        </div>

        {/* Change Password Form */}
        <div className="border border-black bg-white p-6 shadow-sw-sm space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-steel-grey" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black">
              {t('settings.account.changePassword')}
            </h3>
          </div>

          {passwordSuccess && (
            <div className="border border-green-500 bg-green-50 p-3 flex items-center gap-2 text-xs font-mono text-green-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t('settings.account.passwordUpdated')}</span>
            </div>
          )}

          {passwordError && (
            <div className="border border-red-500 bg-red-50 p-3 flex items-center gap-2 text-xs font-mono text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{passwordError}</span>
            </div>
          )}

          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="currentPassword" className="text-xs font-mono uppercase">
                {t('settings.account.currentPassword')}
              </Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="font-mono text-xs h-9"
                disabled={passwordLoading}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="newPassword" className="text-xs font-mono uppercase">
                {t('settings.account.newPassword')}
              </Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="font-mono text-xs h-9"
                disabled={passwordLoading}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="confirmNewPassword" className="text-xs font-mono uppercase">
                {t('settings.account.confirmNewPassword')}
              </Label>
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                className="font-mono text-xs h-9"
                disabled={passwordLoading}
              />
            </div>

            <Button
              type="submit"
              disabled={passwordLoading}
              size="sm"
              className="w-full font-mono text-xs uppercase font-bold"
            >
              {passwordLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                t('settings.account.updatePassword')
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Daily Quota Card */}
      <div className="border border-black bg-white p-6 shadow-sw-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-700" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black">
              {t('settings.account.quotaTitle')}
            </h3>
          </div>
          <span className="font-mono text-xs text-steel-grey uppercase">
            {user?.role === 'admin'
              ? t('settings.users.roleAdmin')
              : t('settings.users.roleUser')}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <span className="font-mono text-2xl font-bold">
              {used}
              {!isUnlimited && (
                <span className="text-sm font-normal text-steel-grey"> / {limit}</span>
              )}
            </span>
            <span className="font-mono text-xs font-semibold text-blue-700 uppercase">
              {isUnlimited ? t('settings.users.quotaUnlimitedLabel') : `${percentUsed}% USED`}
            </span>
          </div>

          {/* Swiss Progress Bar */}
          {!isUnlimited ? (
            <div className="w-full h-3 border border-black bg-paper-tint relative overflow-hidden">
              <div
                className="h-full bg-blue-700 transition-all duration-300"
                style={{ width: `${percentUsed}%` }}
              />
            </div>
          ) : (
            <p className="font-mono text-xs text-steel-grey">
              {t('settings.account.quotaUnlimited', { used })}
            </p>
          )}

          <div className="flex items-center gap-1.5 pt-2 text-[11px] font-mono text-steel-grey">
            <Clock className="w-3.5 h-3.5" />
            <span>{t('settings.account.quotaResetsMidnight')}</span>
          </div>
        </div>
      </div>

      {/* Delete All My Data (Per-User) */}
      <div className="border border-red-200 bg-red-50/40 p-6 space-y-4">
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-red-900 mb-1">
            {t('settings.account.deleteDataTitle')}
          </h3>
          <p className="font-mono text-xs text-red-700">
            {t('settings.account.deleteDataDescription')}
          </p>
        </div>

        {deleteSuccess && (
          <div className="border border-green-500 bg-green-50 p-3 flex items-center gap-2 text-xs font-mono text-green-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{t('settings.account.deleteDataSuccess')}</span>
          </div>
        )}

        <Button
          variant="outline"
          className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-900 font-mono text-xs uppercase font-bold"
          onClick={() => {
            setDeleteError(null);
            setDeleteConfirmationText('');
            setShowDeleteDataDialog(true);
          }}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {t('settings.account.deleteDataButton')}
        </Button>
      </div>

      {/* Delete User Data Confirmation Dialog */}
      {showDeleteDataDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-black bg-background p-6 shadow-sw-lg space-y-4">
            <div className="flex items-center gap-2 text-red-700 font-mono text-sm font-bold uppercase">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{t('settings.account.deleteDataConfirmTitle')}</span>
            </div>

            <p className="font-mono text-xs text-ink-soft leading-relaxed">
              {t('settings.account.deleteDataConfirmDescription')}
            </p>

            {deleteError && (
              <p className="font-mono text-xs text-red-600 bg-red-50 p-2 border border-red-200">
                {deleteError}
              </p>
            )}

            <div className="space-y-1">
              <Label className="font-mono text-xs uppercase text-steel-grey">
                Type RESET_ALL_DATA to confirm:
              </Label>
              <Input
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="RESET_ALL_DATA"
                className="font-mono text-xs"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteDataDialog(false)}
                disabled={deleteLoading}
                className="font-mono text-xs uppercase"
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteData}
                disabled={deleteConfirmationText !== 'RESET_ALL_DATA' || deleteLoading}
                className="font-mono text-xs uppercase font-bold"
              >
                {deleteLoading ? (
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
