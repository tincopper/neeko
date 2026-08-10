import React from 'react';

import { FileCode } from '@/shared/components/icons';

import EditorHeader from './EditorHeader';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UneditableFileViewProps {
  pathSegments: string[];
  size: number;
  message: string;
}

/**
 * 不可编辑文件（binary / 超大文件）只读占位视图。
 */
function UneditableFileView({ pathSegments, size, message }: UneditableFileViewProps) {
  return (
    <div className="flex-1 flex flex-col">
      <EditorHeader
        pathSegments={pathSegments}
        isDirty={false}
        canEdit={false}
        isMd={false}
        isHtml={false}
        previewMode="preview"
        isSaving={false}
        onSave={() => {}}
        onTogglePreview={() => {}}
      />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <FileCode size={48} className="mx-auto mb-3 opacity-30" />
          <p>{message}</p>
          <p className="text-xs mt-1 opacity-60">{formatFileSize(size)}</p>
        </div>
      </div>
    </div>
  );
}

export default React.memo(UneditableFileView);
