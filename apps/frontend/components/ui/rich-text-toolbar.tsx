'use client';

import React from 'react';
import { Editor } from '@tiptap/react';
import { Bold, Italic, Underline, Link } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface RichTextToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
}

/**
 * Rich Text Toolbar Component
 *
 * Swiss International Style formatting toolbar with B/I/U/Link buttons.
 * Active states shown with Hyper Blue background.
 */
export const RichTextToolbar: React.FC<RichTextToolbarProps> = ({ editor, onLinkClick }) => {
  const tools = [
    {
      icon: Bold,
      label: 'Bold',
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: editor.isActive('bold'),
      shortcut: 'Ctrl+B',
    },
    {
      icon: Italic,
      label: 'Italic',
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: editor.isActive('italic'),
      shortcut: 'Ctrl+I',
    },
    {
      icon: Underline,
      label: 'Underline',
      action: () => editor.chain().focus().toggleUnderline().run(),
      isActive: editor.isActive('underline'),
      shortcut: 'Ctrl+U',
    },
    {
      icon: Link,
      label: 'Link',
      action: onLinkClick,
      isActive: editor.isActive('link'),
      shortcut: 'Ctrl+K',
    },
  ];

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 shadow-sw-xs">
      {tools.map((tool) => (
        <Button
          key={tool.label}
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.preventDefault();
            tool.action();
          }}
          aria-label={tool.label}
          aria-pressed={tool.isActive}
          title={`${tool.label} (${tool.shortcut})`}
          className={cn(
            'h-7 w-7 rounded-md transition-colors',
            tool.isActive
              ? 'bg-primary text-white hover:bg-blue-600 hover:text-white dark:bg-primary dark:text-white dark:hover:bg-blue-600 shadow-sw-xs'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800'
          )}
        >
          <tool.icon className="w-3.5 h-3.5" />
        </Button>
      ))}
    </div>
  );
};
