import React, { useState } from 'react';

import { cn } from '@/lib/utils';

interface PRCommentInputProps {
  onSubmit: (body: string) => void;
  placeholder?: string;
  isSubmitting?: boolean;
}

const PRCommentInput: React.FC<PRCommentInputProps> = ({
  onSubmit,
  placeholder = 'Write a comment...',
  isSubmitting = false,
}) => {
  const [body, setBody] = useState('');
  const [isPreview, setIsPreview] = useState(false);

  const handleSubmit = () => {
    if (body.trim() && !isSubmitting) {
      onSubmit(body);
      setBody('');
      setIsPreview(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const charCount = body.length;
  const maxChars = 65536;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-primary">
      {/* Tabs */}
      <div className="flex items-center border-b border-border bg-bg-secondary">
        <button
          className={cn(
            'px-4 py-2 text-[calc(var(--font-size)-1px)] font-medium transition-colors',
            !isPreview
              ? 'text-text-primary border-b-2 border-accent-blue'
              : 'text-text-muted hover:text-text-primary',
          )}
          onClick={() => setIsPreview(false)}
        >
          Write
        </button>
        <button
          className={cn(
            'px-4 py-2 text-[calc(var(--font-size)-1px)] font-medium transition-colors',
            isPreview
              ? 'text-text-primary border-b-2 border-accent-blue'
              : 'text-text-muted hover:text-text-primary',
          )}
          onClick={() => setIsPreview(true)}
        >
          Preview
        </button>
        <div className="flex-1" />
        <div className="px-3 text-[calc(var(--font-size)-2px)] text-text-muted">
          {charCount > 0 && (
            <span className={cn(charCount > maxChars && 'text-accent-red')}>
              {charCount.toLocaleString()} / {maxChars.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-[120px]">
        {isPreview ? (
          <div className="p-3 text-[var(--font-size)] text-text-primary whitespace-pre-wrap">
            {body || <span className="text-text-muted italic">Nothing to preview</span>}
          </div>
        ) : (
          <textarea
            className="w-full min-h-[120px] p-3 bg-transparent text-[var(--font-size)] text-text-primary placeholder-text-muted outline-none resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isSubmitting}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-bg-secondary">
        <div className="text-[calc(var(--font-size)-2px)] text-text-muted">
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-[calc(var(--font-size)-2px)]">
            ⌘
          </kbd>
          {' + '}
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-[calc(var(--font-size)-2px)]">
            Enter
          </kbd>
          {' to submit'}
        </div>
        <button
          className={cn(
            'px-4 py-1.5 text-[calc(var(--font-size)-1px)] font-medium rounded transition-all',
            body.trim() && !isSubmitting
              ? 'bg-accent-blue text-white hover:opacity-90'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
          )}
          onClick={handleSubmit}
          disabled={!body.trim() || isSubmitting}
        >
          {isSubmitting ? 'Commenting...' : 'Comment'}
        </button>
      </div>
    </div>
  );
};

export default React.memo(PRCommentInput);
