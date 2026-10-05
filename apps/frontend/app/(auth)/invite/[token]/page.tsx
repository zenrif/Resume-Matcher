'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

import { acceptInvite, validateInvite, type InviteValidateResult } from '@/lib/api/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';

export default function InvitePage() {
  const { t } = useTranslations();
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [validating, setValidating] = useState(true);
  const [inviteData, setInviteData] = useState<InviteValidateResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setValidating(false);
      setValidationError(t('auth.inviteInvalidOrExpired'));
      return;
    }

    validateInvite(token)
      .then((data) => {
        setInviteData(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error) {
          setValidationError(err.message);
        } else {
          setValidationError(t('auth.inviteInvalidOrExpired'));
        }
      })
      .finally(() => {
        setValidating(false);
      });
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 8) {
      setSubmitError(t('auth.passwordMinLength'));
      return;
    }

    if (password !== confirmPassword) {
      setSubmitError(t('auth.passwordsDoNotMatch'));
      return;
    }

    setSubmitting(true);
    try {
      await acceptInvite(token, { password });
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      setSubmitting(false);
      if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to set password');
      }
    }
  };

  if (validating) {
    return (
      <div className="p-12 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
        <p className="font-mono text-xs text-steel-grey uppercase tracking-wider">
          {t('common.checking')}
        </p>
      </div>
    );
  }

  if (validationError || !inviteData) {
    return (
      <div className="p-8 md:p-10 space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Image src="/logo.svg" alt="Resume Matcher" width={24} height={24} className="w-6 h-6" />
          <span className="font-mono text-xs uppercase font-bold tracking-wider text-black">
            Resume Matcher
          </span>
        </div>

        <div className="border border-red-500 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-700 font-mono text-sm font-bold uppercase">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{t('common.error')}</span>
          </div>
          <p className="font-mono text-xs text-red-700 leading-relaxed">
            {validationError || t('auth.inviteInvalidOrExpired')}
          </p>
        </div>

        <div className="pt-2">
          <Link href="/login">
            <Button variant="outline" className="w-full font-mono text-xs uppercase font-bold">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('auth.backToLogin')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isReset = inviteData.purpose === 'reset';

  return (
    <div className="p-8 md:p-10 space-y-8">
      {/* Brand & Header */}
      <div>
        <div className="flex items-center gap-2 mb-6">
          <Image src="/logo.svg" alt="Resume Matcher" width={24} height={24} className="w-6 h-6" />
          <span className="font-mono text-xs uppercase font-bold tracking-wider text-black">
            Resume Matcher
          </span>
        </div>
        <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-black uppercase leading-tight">
          {isReset ? t('auth.resetTitle') : t('auth.welcomeTitle')}
        </h1>
        <p className="mt-2 font-mono text-xs text-blue-700 uppercase tracking-wider font-semibold">
          {'// '}
          {isReset ? t('auth.resetSubtitle') : t('auth.welcomeSubtitle')}
        </p>
      </div>

      {/* Target User Info */}
      <div className="border border-black bg-paper-tint p-3 flex justify-between items-center text-xs font-mono">
        <span className="text-steel-grey uppercase">{t('auth.email')}:</span>
        <span className="font-bold text-black">{inviteData.email}</span>
      </div>

      {/* Error Message */}
      {submitError && (
        <div className="border border-red-500 bg-red-50 p-3.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-red-700 leading-relaxed break-words">
            {submitError}
          </p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="password" className="font-mono text-xs uppercase font-bold text-black">
            {t('auth.newPassword')}
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              required
              autoComplete="new-password"
              className="font-mono text-sm bg-white pr-10"
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-0 top-0 h-full px-3 flex items-center text-steel-grey hover:text-black focus:outline-none transition-colors"
              aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              disabled={submitting}
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-[10px] font-mono text-steel-grey uppercase">
            {t('auth.passwordMinLength')}
          </p>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="confirmPassword"
            className="font-mono text-xs uppercase font-bold text-black"
          >
            {t('auth.confirmPassword')}
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              required
              autoComplete="new-password"
              className="font-mono text-sm bg-white pr-10"
              disabled={submitting}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              className="absolute right-0 top-0 h-full px-3 flex items-center text-steel-grey hover:text-black focus:outline-none transition-colors"
              aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              title={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              disabled={submitting}
            >
              {showConfirmPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-700 text-white hover:bg-blue-800 font-mono text-xs uppercase font-bold tracking-wider py-3 shadow-sw-default active:shadow-none"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('auth.settingPassword')}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {t('auth.setPasswordButton')}
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
