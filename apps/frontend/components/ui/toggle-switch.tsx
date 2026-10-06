'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Swiss International Style Toggle Switch Component
 *
 * Design Principles:
 * - Square corners (rounded-none on container, pill shape for toggle)
 * - High contrast states
 * - Clear label and description
 */

export interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  className,
}) => {
  const labelId = React.useId();

  const handleToggle = () => {
    if (!disabled) {
      onCheckedChange(!checked);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between p-4.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900',
        'shadow-sw-xs',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <div className="flex-1 mr-4">
        <div id={labelId} className="font-sans text-sm font-semibold text-slate-900 dark:text-slate-100">
          {label}
        </div>
        {description && <div className="font-sans text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
          'transition-colors duration-200 ease-in-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed',
          checked ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700'
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sw-xs',
            'transition-transform duration-200 ease-in-out',
            checked ? 'translate-x-5.5' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  );
};
