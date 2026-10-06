import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Swiss International Style Button Component
 *
 * Design Principles:
 * - Hard shadows (no blur) that create depth
 * - Square corners (rounded-none) - Brutalist aesthetic
 * - High contrast black borders
 * - Hover: translate + shadow removal creates "press" effect
 * - Clear semantic variants for different actions
 */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual variant determining color and purpose:
   * - `default`: Hyper Blue (#1D4ED8) - Primary actions (save, submit, create)
   * - `destructive`: Alert Red (#DC2626) - Destructive actions (delete, remove)
   * - `success`: Signal Green (#15803D) - Positive actions (download, confirm, complete)
   * - `warning`: Alert Orange (#F97316) - Caution actions (reset, clear, undo)
   * - `outline`: Transparent + black border - Secondary actions (cancel, back)
   * - `secondary`: Panel Grey (#E5E5E0) - Tertiary actions
   * - `ghost`: No background - Subtle actions (icon buttons, navigation)
   * - `link`: Text only with underline - Inline links
   */
  variant?:
    'default' | 'destructive' | 'success' | 'warning' | 'outline' | 'secondary' | 'ghost' | 'link';
  /**
   * Button size:
   * - `default`: Standard button (h-10)
   * - `sm`: Small button (h-8)
   * - `lg`: Large button (h-12)
   * - `icon`: Square icon button (h-9 w-9)
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    // Base styles applied to ALL buttons
    // Modern-Minimalist: clean, tactile, refined typography
    const baseStyles = cn(
      // Layout & Typography
      'relative inline-flex items-center justify-center gap-2',
      'whitespace-nowrap text-sm font-medium font-sans tracking-normal select-none',
      // Fluid micro-motion with spring feel
      'transition-all duration-150 cubic-bezier(0.16, 1, 0.3, 1)',
      // Focus state - modern soft ring with offset
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
      // Disabled state
      'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
      // SVG icon sizing
      "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
      // Modern-Minimalist: rounded-lg corner
      'rounded-lg'
    );

    // Hit-area expansion for icon-only buttons
    const iconHitArea = "before:absolute before:-inset-1.5 before:content-['']";

    // Variant styles - refined modern palettes and tactile feedback
    const variants = {
      // PRIMARY - Modern Vibrant Blue
      // Use for: Save, Submit, Create, Primary CTA
      default: cn(
        'bg-primary text-white',
        'border border-blue-600/30',
        'shadow-sw-xs',
        'hover:bg-blue-600 hover:shadow-sw-sm hover:-translate-y-0.5',
        'active:translate-y-0 active:scale-[0.98]'
      ),

      // DESTRUCTIVE - Clean Alert Red
      // Use for: Delete, Remove, Destroy, Dangerous actions
      destructive: cn(
        'bg-destructive text-white',
        'border border-red-500/30',
        'shadow-sw-xs',
        'hover:bg-red-600 hover:shadow-sw-sm hover:-translate-y-0.5',
        'active:translate-y-0 active:scale-[0.98]'
      ),

      // SUCCESS - Signal Emerald Green
      // Use for: Download, Confirm, Complete, Positive actions
      success: cn(
        'bg-success text-white',
        'border border-emerald-600/30',
        'shadow-sw-xs',
        'hover:bg-emerald-600 hover:shadow-sw-sm hover:-translate-y-0.5',
        'active:translate-y-0 active:scale-[0.98]'
      ),

      // WARNING - Clean Amber / Alert Orange
      // Use for: Reset, Clear, Undo, Caution actions
      warning: cn(
        'bg-warning text-white',
        'border border-amber-500/30',
        'shadow-sw-xs',
        'hover:bg-amber-600 hover:shadow-sw-sm hover:-translate-y-0.5',
        'active:translate-y-0 active:scale-[0.98]'
      ),

      // OUTLINE - Clean white with subtle slate border
      // Use for: Cancel, Back, Secondary actions, Navigation
      outline: cn(
        'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200',
        'border border-slate-200/90 dark:border-slate-800',
        'shadow-sw-xs',
        'hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700 hover:-translate-y-0.5 hover:shadow-sw-sm',
        'active:translate-y-0 active:scale-[0.98]'
      ),

      // SECONDARY - Subtle Slate-100 Pill
      // Use for: Less prominent actions, Toolbar buttons
      secondary: cn(
        'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200',
        'border border-transparent',
        'shadow-sw-xs',
        'hover:bg-slate-200/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:-translate-y-0.5',
        'active:translate-y-0 active:scale-[0.98]'
      ),

      // GHOST - Minimal hover highlight
      // Use for: Icon buttons, Subtle navigation, Toolbars
      ghost: cn(
        'bg-transparent text-slate-700 dark:text-slate-300',
        'border-none shadow-none',
        'hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white',
        'active:scale-[0.98]'
      ),

      // LINK - Text only with underline
      // Use for: Inline links, Text navigation
      link: cn(
        'bg-transparent text-primary',
        'border-none shadow-none',
        'underline-offset-4 hover:underline',
        'p-0 h-auto'
      ),
    };

    const sizes = {
      default: 'h-9.5 px-5 py-2',
      sm: 'h-8 px-3.5 py-1 text-xs rounded-md',
      lg: 'h-11 px-7 py-2.5 text-base rounded-xl',
      icon: cn('h-9.5 w-9.5 p-0 rounded-lg', iconHitArea),
    };

    const variantClass = variants[variant];
    const sizeClass = sizes[size];

    return (
      <button ref={ref} className={cn(baseStyles, variantClass, sizeClass, className)} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button };
