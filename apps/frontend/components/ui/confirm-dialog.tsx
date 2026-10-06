'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';
import { useTranslations } from '@/lib/i18n';

/**
 * Swiss International Style Confirm Dialog Component
 *
 * A modal dialog for confirming user actions with semantic variants:
 * - danger: Destructive actions (delete, remove)
 * - warning: Caution actions (reset, overwrite)
 * - success: Positive confirmations
 * - default: Neutral confirmations
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  errorMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  variant?: 'danger' | 'warning' | 'success' | 'default';
  closeOnConfirm?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  showCancelButton?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  errorMessage,
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
  cancelDisabled = false,
  variant = 'default',
  closeOnConfirm = true,
  onConfirm,
  onCancel,
  showCancelButton = true,
}) => {
  const { t } = useTranslations();
  const finalConfirmLabel = confirmLabel ?? t('common.confirm');
  const finalCancelLabel = cancelLabel ?? t('common.cancel');

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm();
    if (closeOnConfirm) {
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    if (cancelDisabled) return;
    onCancel?.();
    onOpenChange(false);
  };

  const variantStyles = {
    danger: {
      icon: (
        <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
          <span className="text-xl font-bold">!</span>
        </div>
      ),
      buttonVariant: 'destructive' as const,
    },
    warning: {
      icon: (
        <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <span className="text-xl font-bold">!</span>
        </div>
      ),
      buttonVariant: 'warning' as const,
    },
    success: {
      icon: (
        <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <span className="text-xl font-bold">&#10003;</span>
        </div>
      ),
      buttonVariant: 'success' as const,
    },
    default: {
      icon: (
        <div className="w-11 h-11 rounded-xl bg-blue-50 text-primary flex items-center justify-center shrink-0">
          <span className="text-xl font-bold">?</span>
        </div>
      ),
      buttonVariant: 'default' as const,
    },
  };

  const { icon, buttonVariant } = variantStyles[variant];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && cancelDisabled) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[425px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <div className="flex items-start gap-3.5">
            {icon}
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-sans text-lg font-semibold tracking-tight text-slate-900">
                {title}
              </DialogTitle>
              <DialogDescription className="font-sans text-sm text-slate-500 mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {errorMessage && (
          <div className="px-6 pb-4">
            <div className="rounded-lg border border-red-200 bg-red-50/80 p-3 font-sans text-xs text-red-600 max-h-60 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
              {errorMessage}
            </div>
          </div>
        )}
        <DialogFooter className="p-4 bg-slate-50/80 border-t border-slate-100 flex-row justify-end gap-2.5">
          {showCancelButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={cancelDisabled}
            >
              {finalCancelLabel}
            </Button>
          )}
          <Button
            variant={buttonVariant}
            size="sm"
            onClick={handleConfirm}
            disabled={confirmDisabled}
          >
            {finalConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
