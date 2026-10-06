'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Swiss International Style Tabs Component
 *
 * Design Principles:
 * - Square corners (rounded-none) - Brutalist aesthetic
 * - Hard shadows on active tab
 * - Black borders for high contrast
 * - Monospace uppercase text
 */

export interface Tab {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface RetroTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export const RetroTabs: React.FC<RetroTabsProps> = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}) => {
  return (
    <div className={cn('inline-flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-slate-800/80 rounded-lg border border-slate-200/80 dark:border-slate-700/80', className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.id}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
            className={cn(
              'px-3.5 py-1.5 font-sans text-xs font-medium rounded-md transition-all duration-150 select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
              isActive && [
                'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold shadow-sw-xs dark:shadow-none',
              ],
              !isActive &&
                !isDisabled && ['text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/60 dark:hover:bg-slate-700/50'],
              isDisabled && ['text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50']
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
