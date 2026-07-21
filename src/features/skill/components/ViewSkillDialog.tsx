import {
  X,
  ExternalLink,
  FolderOpen,
  GitBranch,
  HardDrive,
  Link2,
  Store,
  ChevronDown,
} from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { revealInFileManager } from '@/features/file/api/fileApi';
import { useAppConfig } from '@/features/settings/hooks/useAppConfig';
import { getSkillDocumentAtPath } from '@/features/skill/api/skillApi';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import type { AgentDiskSkill, ManagedSkillDto } from '@/shared/types';
import { Button, Badge } from '@/ui';
import { MarkdownPreview } from '@/ui/MarkdownPreview';
import { ResizablePanel } from '@/ui/ResizablePanel';

interface ViewSkillDialogProps {
  open: boolean;
  /** Library / managed skill */
  skill: ManagedSkillDto | null;
  /** Agent disk skill (local or synced) — used when viewing by path */
  diskSkill?: AgentDiskSkill | null;
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
  if (type === 'agent-local') return <HardDrive className="h-3.5 w-3.5" />;
  if (type === 'synced') return <Link2 className="h-3.5 w-3.5" />;
  return <HardDrive className="h-3.5 w-3.5" />;
}

function sourceTypeLabel(type: string) {
  if (type === 'skillssh') return 'skills.sh';
  if (type === 'git') return 'Git';
  if (type === 'agent-local') return 'Agent local';
  if (type === 'synced') return 'Synced';
  return 'Local';
}

const ViewSkillDialog: React.FC<ViewSkillDialogProps> = React.memo(
  ({ open, skill, diskSkill = null, onClose }) => {
    const { config } = useAppConfig();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sourceCollapsed, setSourceCollapsed] = useState(true);
    const [panelExpanded, setPanelExpanded] = useState(false);

    const isDiskMode = Boolean(open && diskSkill && !skill);
    const active = skill ?? null;
    const disk = diskSkill ?? null;

    useEffect(() => {
      if (!open) return;

      if (skill) {
        setLoading(true);
        setError(null);
        useSkillStore
          .getState()
          .getSkillDocument(skill.id)
          .then((doc) => setContent(doc))
          .catch((e) => setError(String(e)))
          .finally(() => setLoading(false));
        return;
      }

      if (diskSkill) {
        setLoading(true);
        setError(null);
        getSkillDocumentAtPath(diskSkill.path)
          .then((doc) => setContent(doc.content))
          .catch((e) => setError(String(e)))
          .finally(() => setLoading(false));
      }
    }, [open, skill, diskSkill]);

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

    if (!open || (!skill && !diskSkill)) return null;

    const title = active?.name ?? disk?.name ?? '';
    const description = active?.description ?? disk?.description ?? null;
    const tags = active?.tags ?? [];
    const badgeLabel = active
      ? active.source_type === 'local'
        ? 'local'
        : active.source_type
      : disk?.managed
        ? 'synced'
        : 'local';
    const basePath = active?.central_path ?? disk?.path ?? undefined;
    const isGitLike =
      active != null && (active.source_type === 'git' || active.source_type === 'skillssh');
    const sourceUrl = active?.source_ref_resolved || active?.source_ref;
    const diskSourceType = disk?.managed ? 'synced' : 'agent-local';
    const sourceKind = active?.source_type ?? diskSourceType;

    return (
      <ResizablePanel
        open={open}
        onClose={handleClose}
        expanded={panelExpanded}
        onToggleExpand={() => setPanelExpanded((v) => !v)}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-text-primary truncate">{title}</span>
            <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">
              {badgeLabel}
            </Badge>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Description and tags */}
        {(description || tags.length > 0) && (
          <div className="px-4 py-3 border-b border-border">
            {description ? <p className="text-sm text-text-secondary mb-2">{description}</p> : null}
            {tags.length > 0 ? (
              <div className="flex gap-1 flex-wrap">
                {tags.map((tag) => (
                  <Badge key={tag} variant="default" className="text-[10px] px-1.5 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Source info */}
        <div className="px-4 py-3 border-b border-border">
          <button
            type="button"
            onClick={() => setSourceCollapsed(!sourceCollapsed)}
            className="flex items-center gap-1.5 w-full text-[11px] font-medium text-text-muted uppercase tracking-wider text-left"
          >
            {sourceTypeIcon(sourceKind)}
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
                  {sourceTypeLabel(sourceKind)}
                </Badge>
              </div>

              {active && active.source_type === 'local' && active.source_ref ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-muted w-16 shrink-0">Source</span>
                  <span
                    className="truncate text-text-secondary font-mono text-[11px]"
                    title={active.source_ref}
                  >
                    {active.source_ref}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleReveal(active.source_ref!)}
                    className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    title="Reveal in Finder"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              {active && active.source_type === 'local' && !active.source_ref ? (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-16 shrink-0">Source</span>
                  <span className="text-text-muted italic">Created in Neeko</span>
                </div>
              ) : null}

              {isGitLike && sourceUrl ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-muted w-16 shrink-0">
                    {active?.source_type === 'skillssh' ? 'Repo' : 'Remote'}
                  </span>
                  <span
                    className="truncate text-text-secondary font-mono text-[11px]"
                    title={sourceUrl}
                  >
                    {sourceUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenUrl(sourceUrl)}
                    className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    title="Open in browser"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}

              {isGitLike && active?.source_branch ? (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-16 shrink-0">Branch</span>
                  <span className="text-text-secondary font-mono text-[11px]">
                    {active.source_branch}
                  </span>
                </div>
              ) : null}

              {isGitLike && active?.source_subpath ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-muted w-16 shrink-0">Subpath</span>
                  <span className="truncate text-text-secondary font-mono text-[11px]">
                    {active.source_subpath}
                  </span>
                </div>
              ) : null}

              {/* Path: library central or agent disk path */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-text-muted w-16 shrink-0">
                  {isDiskMode ? 'Path' : 'Central'}
                </span>
                <span
                  className="truncate text-text-secondary font-mono text-[11px]"
                  title={basePath}
                >
                  {basePath}
                </span>
                {basePath ? (
                  <button
                    type="button"
                    onClick={() => handleReveal(basePath)}
                    className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    title="Reveal in Finder"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {isGitLike && active ? (
                <div className="flex items-center gap-2">
                  <span className="text-text-muted w-16 shrink-0">Checked</span>
                  <span className="text-text-secondary text-[11px]">
                    {formatTimestamp(active.last_checked_at)}
                  </span>
                </div>
              ) : null}
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
            <div className="h-full flex items-center justify-center text-accent-red text-sm p-4">
              {error}
            </div>
          ) : (
            <div className="p-4">
              <MarkdownPreview content={content} theme={config.theme} basePath={basePath} />
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
  },
);

ViewSkillDialog.displayName = 'ViewSkillDialog';

export default ViewSkillDialog;
