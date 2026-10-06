'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import { useTranslations } from '@/lib/i18n';
import { useOptionalAuth } from '@/lib/context/auth-context';

import { ThemeToggle } from '@/components/common/theme-toggle';

export const SwissGrid = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslations();
  const auth = useOptionalAuth();
  const user = auth?.user ?? null;
  const logout = auth?.logout ?? (() => Promise.resolve());

  return (
    // 1. Outer Wrapper: Full viewport height with clean modern grid background
    <div className="h-[100dvh] w-full flex justify-center items-start py-4 sm:py-6 md:py-8 px-3 sm:px-4 md:px-8 overflow-hidden bg-background modern-grid-pattern transition-colors duration-200">
      {/* 2. The Main Container: Clean rounded-2xl border, creating the modern Canvas */}
      <div className="w-full max-w-[86rem] max-h-full rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900 shadow-sw-card flex flex-col overflow-hidden transition-colors duration-200">
        {/* Header Section - stays above hovered cards */}
        <div className="border-b border-slate-100 dark:border-slate-800/80 py-4.5 px-6 md:py-5 md:px-10 shrink-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm relative z-30 transition-colors duration-200">
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-4">
            <h1 className="font-sans text-2xl md:text-3xl lg:text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-none">
              {t('nav.dashboard')}
            </h1>
            <p className="text-xs md:text-sm font-sans text-primary font-medium tracking-normal shrink-0">
              {t('dashboard.selectModule')}
            </p>
          </div>
        </div>

        {/* Content Area - Scrollable area with generous padding and clean modern responsive grid */}
        <div className="@container flex-1 overflow-y-auto overflow-x-hidden relative z-10 p-5 sm:p-6 md:p-8 bg-slate-50/40 dark:bg-slate-950/40 transition-colors duration-200">
          <div className="grid grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4 gap-5 md:gap-6">
            {children}
          </div>
        </div>

        {/* Footer - stays above hovered cards */}
        <div className="p-3.5 sm:p-4 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm flex justify-between items-center font-sans text-xs text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 shrink-0 relative z-30 transition-colors duration-200">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.svg"
              alt="Resume Matcher"
              width={20}
              height={20}
              className="w-5 h-5"
            />
            <span className="font-semibold text-slate-900 dark:text-slate-100">Resume Matcher</span>
            {user?.email && (
              <span className="hidden md:inline font-sans text-xs text-slate-500 dark:text-slate-400 border-l border-slate-200 dark:border-slate-700 pl-3">
                {user.email}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5">
            <ThemeToggle variant="compact" />
            <Link
              href="/tracker"
              className="inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium tracking-normal shadow-sw-xs hover:bg-slate-50 dark:hover:bg-slate-700 hover:shadow-sw-sm hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all text-center"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              {t('nav.applicationTracker')}
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center justify-center gap-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium tracking-normal shadow-sw-xs hover:bg-slate-50 dark:hover:bg-slate-700 hover:shadow-sw-sm hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all text-center"
            >
              {t('nav.settings')}
            </Link>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center justify-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg font-medium tracking-normal shadow-sw-xs hover:bg-slate-200/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all text-center cursor-pointer"
              title={t('auth.logout')}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
