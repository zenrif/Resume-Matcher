'use client';

import React from 'react';
import Sun from 'lucide-react/dist/esm/icons/sun';
import Moon from 'lucide-react/dist/esm/icons/moon';
import Monitor from 'lucide-react/dist/esm/icons/monitor';
import { useTheme, type Theme } from '@/lib/context/theme-context';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
  variant?: 'segmented' | 'compact';
}

export function ThemeToggle({ className, variant = 'segmented' }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
    { value: 'system', label: 'System', icon: <Monitor className="w-3.5 h-3.5" /> },
  ];

  if (variant === 'compact') {
    const nextTheme: Theme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    return (
      <button
        onClick={() => setTheme(nextTheme)}
        className={cn(
          'inline-flex items-center justify-center p-2 rounded-lg border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sw-xs',
          className
        )}
        title={`Theme: ${theme}. Click to change.`}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? (
          <Moon className="w-4 h-4 text-blue-400" />
        ) : theme === 'light' ? (
          <Sun className="w-4 h-4 text-amber-500" />
        ) : (
          <Monitor className="w-4 h-4 text-slate-400" />
        )}
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme selection"
      className={cn(
        'inline-flex items-center p-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400',
        className
      )}
    >
      {options.map((opt) => {
        const isActive = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={isActive}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all',
              isActive
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sw-xs font-semibold'
                : 'hover:text-slate-900 dark:hover:text-slate-100'
            )}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
