'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from '@/lib/i18n';

export default function Hero() {
  const { t } = useTranslations();

  // Hover translates DOWN-RIGHT (+1, +1) for the press-in effect — matches
  // every other button in the codebase. The previous version translated
  // UP-LEFT (-1, -1) which was the inverse and looked broken next to the
  // rest of the design system.
  const buttonClass =
    'group relative inline-flex items-center justify-center rounded-xl border border-slate-200/90 bg-white px-8 py-3.5 font-sans text-sm font-semibold text-slate-800 shadow-sw-xs transition-all duration-150 ease-out hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 hover:shadow-sw-sm hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] cursor-pointer';

  const primaryButtonClass =
    'group relative inline-flex items-center justify-center rounded-xl border border-blue-600/30 bg-primary px-8 py-3.5 font-sans text-sm font-semibold text-white shadow-sw-sm transition-all duration-150 ease-out hover:bg-blue-600 hover:shadow-sw-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] cursor-pointer';

  return (
    <section className="min-h-[100dvh] w-full p-4 md:p-12 lg:p-20 bg-background modern-grid-pattern flex items-center justify-center">
      <div className="flex w-full max-w-6xl flex-col items-center justify-center rounded-3xl border border-slate-200/90 bg-white shadow-sw-xl p-10 md:p-20">
        <h1 className="mb-12 text-center font-sans text-5xl font-extrabold tracking-tighter leading-tight md:text-7xl lg:text-8xl text-slate-900 selection:bg-primary selection:text-white">
          {t('home.brandLine1')}
          <br />
          {t('home.brandLine2')}
        </h1>

        <div className="flex flex-col gap-4 sm:flex-row sm:gap-6 md:gap-8">
          <a
            href="https://github.com/srbhr/Resume-Matcher"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass}
          >
            GitHub
          </a>
          <a
            href="https://resumematcher.fyi"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass}
          >
            {t('home.docs')}
          </a>
          <Link href="/dashboard" className={primaryButtonClass}>
            {t('home.launchApp')}
          </Link>
        </div>
      </div>
    </section>
  );
}
