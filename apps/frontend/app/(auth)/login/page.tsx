'use client';

import React, { useState, Suspense } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import LogIn from 'lucide-react/dist/esm/icons/log-in';

import { login } from '@/lib/api/auth';
import { sanitizeNextUrl } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';

function LoginForm() {
  const { t } = useTranslations();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login({ email, password });
      const nextParam = searchParams.get('next');
      const target = sanitizeNextUrl(nextParam);
      window.location.href = target;
    } catch (err: unknown) {
      setLoading(false);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('auth.invalidCredentials'));
      }
    }
  };

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
          {t('auth.loginTitle')}
        </h1>
        <p className="mt-2 font-mono text-xs text-blue-700 uppercase tracking-wider font-semibold">
          {'// '}
          {t('auth.loginSubtitle')}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="border border-red-500 bg-red-50 p-3.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-red-700 leading-relaxed break-words">{error}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="font-mono text-xs uppercase font-bold text-black">
            {t('auth.email')}
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholder')}
            required
            autoComplete="email"
            className="font-mono text-sm bg-white"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="font-mono text-xs uppercase font-bold text-black">
            {t('auth.password')}
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.passwordPlaceholder')}
            required
            autoComplete="current-password"
            className="font-mono text-sm bg-white"
            disabled={loading}
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-700 text-white hover:bg-blue-800 font-mono text-xs uppercase font-bold tracking-wider py-3 shadow-sw-default active:shadow-none"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('auth.signingIn')}
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4 mr-2" />
              {t('auth.signInButton')}
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 flex items-center justify-center font-mono text-xs text-steel-grey uppercase">
          Loading...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
