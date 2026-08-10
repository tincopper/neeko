import React from 'react';

import { Eye, Save, FileCode, Globe, ExternalLink } from '@/shared/components/icons';

import type { PreviewMode } from '../types';

interface EditorHeaderProps {
  pathSegments: string[];
  isDirty: boolean;
  canEdit: boolean;
  isMd: boolean;
  isHtml: boolean;
  previewMode: PreviewMode;
  isSaving: boolean;
  onSave: () => void;
  onTogglePreview: () => void;
  onOpenInBrowser?: () => void;
  onOpenInSystemBrowser?: () => void;
  canOpenInBrowser?: boolean;
}

/**
 * 编辑器头部：面包屑路径 + 预览/保存/浏览器操作按钮。
 */
function EditorHeader({
  pathSegments,
  isDirty,
  canEdit,
  isMd,
  isHtml,
  previewMode,
  isSaving,
  onSave,
  onTogglePreview,
  onOpenInBrowser,
  onOpenInSystemBrowser,
  canOpenInBrowser,
}: EditorHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/50">
      {/* Breadcrumb */}
      <div className="flex-1 flex items-center gap-1 text-xs text-text-secondary min-w-0 overflow-hidden">
        {pathSegments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="opacity-40">/</span>}
            <span
              className={
                i === pathSegments.length - 1
                  ? 'text-text-primary font-medium truncate'
                  : 'truncate'
              }
            >
              {seg}
            </span>
          </React.Fragment>
        ))}
        {isDirty && <span className="ml-1 text-accent">●</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Markdown / HTML preview toggle */}
        {(isMd || isHtml) && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            onClick={onTogglePreview}
            title={previewMode === 'preview' ? 'Switch to source' : 'Switch to preview'}
          >
            {previewMode === 'preview' ? (
              <span className="flex items-center gap-1">
                <FileCode size={12} /> Source
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Eye size={12} /> Preview
              </span>
            )}
          </button>
        )}

        {/* HTML: Open in Browser Panel */}
        {isHtml && canOpenInBrowser && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
            onClick={onOpenInBrowser}
            title="Open in Browser Panel"
          >
            <Globe size={12} /> Browser
          </button>
        )}

        {/* HTML: Open in System Browser */}
        {isHtml && canOpenInBrowser && onOpenInSystemBrowser && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
            onClick={onOpenInSystemBrowser}
            title="Open in System Browser"
          >
            <ExternalLink size={12} /> System
          </button>
        )}

        {canEdit && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1 disabled:opacity-50"
            onClick={onSave}
            disabled={!isDirty || isSaving}
            title="Save (Ctrl+S)"
          >
            <Save size={12} /> {isSaving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}

export default React.memo(EditorHeader);
