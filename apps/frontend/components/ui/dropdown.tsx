'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';

export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Dropdown({
  options,
  value,
  onChange,
  label,
  description,
  disabled = false,
  className = '',
}: DropdownProps) {
  const { t } = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Stable id wiring the trigger's aria-controls to the popup's id, and
  // the popup's role="menu" to its role="menuitem" children.
  const menuId = React.useId();

  const selectedOption = options.find((opt) => opt.id === value);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = (optionId: string) => {
    onChange(optionId);
    setIsOpen(false);
  };

  return (
    <div className={`space-y-1.5 ${className}`} ref={containerRef}>
      {label && (
        <label className="font-sans text-xs font-semibold uppercase tracking-wider text-slate-600 block">
          {label}
        </label>
      )}

      {description && <p className="text-xs text-slate-500 font-sans">{description}</p>}

      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          aria-label={label}
          className="w-full flex items-center justify-between rounded-lg border border-slate-200/90 bg-white px-3.5 py-2.5 font-sans text-sm text-slate-900 transition-all duration-150 shadow-sw-xs hover:border-slate-300 hover:shadow-sw-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex-1 text-left min-w-0">
            {selectedOption ? (
              <div>
                <div className="font-medium text-slate-900 truncate">{selectedOption.label}</div>
                {selectedOption.description && (
                  <div className="text-xs text-slate-500 mt-0.5 font-normal truncate">
                    {selectedOption.description}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-400">{t('common.selectOption')}</span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ml-2 shrink-0 ${
              isOpen ? 'rotate-180 text-primary' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div
            id={menuId}
            role="menu"
            aria-label={label}
            className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl border border-slate-200/90 bg-white shadow-sw-lg overflow-hidden p-1.5 animate-in fade-in-0 zoom-in-95 duration-150"
          >
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {options.map((option) => (
                <button
                  key={option.id}
                  role="menuitemradio"
                  aria-checked={option.id === value}
                  onClick={() => handleSelect(option.id)}
                  className={`w-full px-3 py-2 text-left font-sans text-sm rounded-lg transition-colors duration-150 ${
                    option.id === value
                      ? 'bg-blue-50 text-primary font-medium'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{option.label}</div>
                      {option.description && (
                        <div className="text-xs text-slate-500 mt-0.5 truncate">{option.description}</div>
                      )}
                    </div>
                    {option.id === value && (
                      <span className="text-primary font-bold text-sm shrink-0">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
