import React from 'react';
import { MarkdownPreview } from '@/ui/MarkdownPreview';
import type { AppTheme } from '@/shared/types';

interface PRDescriptionProps {
  body: string | null;
  theme: AppTheme;
}

const PRDescription: React.FC<PRDescriptionProps> = ({ body, theme }) => {
  if (!body) {
    return (
      <div className="p-4 text-[var(--font-size)] text-text-muted italic">
        No description provided.
      </div>
    );
  }

  return (
    <div className="p-4">
      <MarkdownPreview content={body} theme={theme} />
    </div>
  );
};

export default React.memo(PRDescription);
