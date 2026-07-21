import { X, ExternalLink, FolderOpen, GitBranch, HardDrive, Store, ChevronDown } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { revealInFileManager } from '@/features/file/api/fileApi';
import { useAppConfig } from '@/features/settings/hooks/useAppConfig';
import { useSkillStore } from '@/features/skill/store';
import type { ManagedSkillDto } from '@/shared/types';
import { cn } from '@/lib/utils';
import { Button, Badge } from '@/ui';
import { MarkdownPreview } from '@/ui/MarkdownPreview';
import { ResizablePanel } from '@/ui/ResizablePanel';

interface ViewSkillDialogProps {
  open: boolean;
  skill: ManagedSkillDto | null;
  onClose: () => void;
}

function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function sourceTypeIcon(type: string) {
  if (type === 'skillssh') return <Store className="h-3.5 w-3.5" />;
  if (type === 'git') return <GitBranch className="h-3.5 w-3.5" />;
  return <HardDrive className="h-3.5 w-3.5" />;
}

function sourceTypeLabel(type: string) {
  if (type === 'skillssh') return 'skills.sh';
  if (type === 'git') return 'Git';
  return 'Local';
}

const ViewSkillDialog: React.FC<ViewSkillDialogProps> = React.memo(({ open, skill, onClose }) => {
  const { config } = useAppConfig();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceCollapsed, setSourceCollapsed] = useState(true);
  const [panelExpanded, setPanelExpanded] = useState(false);

  useEffect(() => {
    if (open && skill) {
      setLoading(true);
      setError(null);

      useSkillStore
        .getState()
        .getSkillDocument(skill.id)
        .then((content) => {
          setContent(content);
        })
        .catch((e) => {
          setError(String(e));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, skill]);

  const handleClose = useCallback(() => {
    setContent('');
    setError(null);
    onClose();
  }, [onClose]);

  const handleOpenUrl = useCallback((url: string) => {
    openInDefaultBrowser(url).catch(console.error);
  }, []);

  const handleReveal = useCallback((path: string) => {
    revealInFileManager(path).catch(console.error);
  }, []);

  if (!open || !skill) return null;

  const isGitLike = skill.source_type === 'git' || skill.source_type === 'skillssh';
  const sourceUrl = skill.source_ref_resolved || skill.source_ref;

  return (
    <ResizablePanel
        open={open}
        onClose={handleClose}
        expanded={panelExpanded}
        onToggleExpand={() => setPanelExpanded((v) => !v)}
      >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{skill.name}</span>
          <Badge variant="default" className="text-[10px] px-1.5 py-0">
            {skill.source_type === 'local' ? 'local' : skill.source_type}
          </Badge>
        </div>
        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Description and tags */}
      {(skill.description || skill.tags.length > 0) && (
        <div className="px-4 py-3 border-b border-border">
          {skill.description && (
            <p className="text-sm text-text-secondary mb-2">{skill.description}</p>
          )}
          {skill.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="default" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Source info */}
      <div className="px-4 py-3 border-b border-border">
        <button
          onClick={() => setSourceCollapsed(!sourceCollapsed)}
          className="flex items-center gap-1.5 w-full text-[11px] font-medium text-text-muted uppercase tracking-wider text-left"
        >
          {sourceTypeIcon(skill.source_type)}
          Source
          <ChevronDown
            className={cn(
              'h-3 w-3 ml-auto transition-transform',
              sourceCollapsed ? '-rotate-90' : '',
            )}
          />
        </button>
        {!sourceCollapsed && (
          <div className="space-y-1.5 text-[12px] mt-2">
          <div className="flex items-center gap-2">
            <span className="text-text-muted w-16 shrink-0">Type</span>
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              {sourceTypeLabel(skill.source_type)}
            </Badge>
          </div>

          {skill.source_type === 'local' && skill.source_ref && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-text-muted w-16 shrink-0">Source</span>
              <span
                className="truncate text-text-secondary font-mono text-[11px]"
                title={skill.source_ref}
              >
                {skill.source_ref}
              </span>
              <button
                onClick={() => handleReveal(skill.source_ref!)}
                className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                title="Reveal in Finder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {skill.source_type === 'local' && !skill.source_ref && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-16 shrink-0">Source</span>
              <span className="text-text-muted italic">Created in Neeko</span>
            </div>
          )}

          {isGitLike && sourceUrl && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-text-muted w-16 shrink-0">
                {skill.source_type === 'skillssh' ? 'Repo' : 'Remote'}
              </span>
              <span
                className="truncate text-text-secondary font-mono text-[11px]"
                title={sourceUrl}
              >
                {sourceUrl}
              </span>
              <button
                onClick={() => handleOpenUrl(sourceUrl!)}
                className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                title="Open in browser"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {isGitLike && skill.source_branch && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-16 shrink-0">Branch</span>
              <span className="text-text-secondary font-mono text-[11px]">
                {skill.source_branch}
              </span>
            </div>
          )}

          {isGitLike && skill.source_subpath && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-text-muted w-16 shrink-0">Subpath</span>
              <span className="truncate text-text-secondary font-mono text-[11px]">
                {skill.source_subpath}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-text-muted w-16 shrink-0">Central</span>
            <span
              className="truncate text-text-secondary font-mono text-[11px]"
              title={skill.central_path}
            >
              {skill.central_path}
            </span>
            <button
              onClick={() => handleReveal(skill.central_path)}
              className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
              title="Reveal in Finder"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>

          {isGitLike && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-16 shrink-0">Checked</span>
              <span className="text-text-secondary text-[11px]">
                {formatTimestamp(skill.last_checked_at)}
              </span>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-text-muted text-sm">
            Loading...
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-red-400 text-sm p-4">
            {error}
          </div>
        ) : (
          <div className="p-4">
            <MarkdownPreview
              content={content}
              theme={config.theme}
              basePath={skill?.central_path}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
        <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs">
          Close
        </Button>
      </div>
    </ResizablePanel>
  );
});

ViewSkillDialog.displayName = 'ViewSkillDialog';

export default ViewSkillDialog;
