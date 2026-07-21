import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, GitBranch } from 'lucide-react';
import { Button, Input } from '@/ui';
import { ResizablePanel } from '@/ui/ResizablePanel';
import { cn } from '@/lib/utils';
import {
  previewGitInstall,
  confirmGitInstall,
  cancelGitPreview,
} from '@/features/skill/api/skillApi';

export interface GitSkillOption {
  name: string;
  path: string;
  description?: string;
}

interface GitInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => Promise<void> | void;
}

type Phase = 'input' | 'preview' | 'installing';

const GitInstallDialog: React.FC<GitInstallDialogProps> = React.memo(
  ({ open, onOpenChange, onInstalled }) => {
    const [url, setUrl] = useState('');
    const [branch, setBranch] = useState('');
    const [subpath, setSubpath] = useState('');
    const [phase, setPhase] = useState<Phase>('input');
    const [error, setError] = useState<string | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [skills, setSkills] = useState<GitSkillOption[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [installing, setInstalling] = useState(false);

    const reset = useCallback(() => {
      setUrl('');
      setBranch('');
      setSubpath('');
      setPhase('input');
      setError(null);
      setPreviewId(null);
      setSkills([]);
      setSelected(new Set());
      setInstalling(false);
    }, []);

    const cleanupPreview = useCallback(async (id: string | null) => {
      if (!id) return;
      try {
        await cancelGitPreview(id);
      } catch {
        /* ignore */
      }
    }, []);

    const handleClose = useCallback(async () => {
      await cleanupPreview(previewId);
      reset();
      onOpenChange(false);
    }, [cleanupPreview, previewId, reset, onOpenChange]);

    // Reset when closed externally
    useEffect(() => {
      if (!open) {
        void cleanupPreview(previewId);
        reset();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open flip
    }, [open]);

    const handlePreview = useCallback(async () => {
      const trimmed = url.trim();
      if (!trimmed) {
        setError('Repository URL or owner/repo is required');
        return;
      }
      setError(null);
      setPhase('preview');
      setInstalling(true);
      // Drop previous preview if re-fetching
      await cleanupPreview(previewId);
      setPreviewId(null);
      setSkills([]);
      setSelected(new Set());
      try {
        const result = await previewGitInstall(
          trimmed,
          branch.trim() || null,
          subpath.trim() || null,
        );
        setPreviewId(result.id);
        const list = result.available_skills.map(s => ({
          name: s.name,
          path: s.path,
          description: s.description,
        }));
        setSkills(list);
        // Pre-select all when few skills
        if (list.length > 0 && list.length <= 5) {
          setSelected(new Set(list.map(s => s.path)));
        }
        if (list.length === 0) {
          setError('No skills (SKILL.md directories) found in this repository');
        }
      } catch (e) {
        setError(String(e));
        setPhase('input');
      } finally {
        setInstalling(false);
      }
    }, [url, branch, subpath, previewId, cleanupPreview]);

    const togglePath = useCallback((path: string) => {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }, []);

    const handleInstall = useCallback(async () => {
      if (!previewId || selected.size === 0) return;
      setError(null);
      setPhase('installing');
      setInstalling(true);
      try {
        for (const path of selected) {
          await confirmGitInstall(previewId, path);
        }
        await cleanupPreview(previewId);
        setPreviewId(null);
        await onInstalled();
        reset();
        onOpenChange(false);
      } catch (e) {
        setError(String(e));
        setPhase('preview');
      } finally {
        setInstalling(false);
      }
    }, [previewId, selected, cleanupPreview, onInstalled, reset, onOpenChange]);

    if (!open) return null;

    return (
      <ResizablePanel open={open} onClose={() => void handleClose()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-text-secondary" />
            <span className="text-sm font-semibold text-text-primary">Install from Git</span>
          </div>
          <button
            onClick={() => void handleClose()}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">
              Repository
            </label>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo.git"
              disabled={installing}
              className="text-sm"
            />
            <p className="text-[11px] text-text-muted mt-1">
              GitHub shorthand (owner/repo) or full git URL
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1.5">
                Branch (optional)
              </label>
              <Input
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
                disabled={installing}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1.5">
                Subpath (optional)
              </label>
              <Input
                value={subpath}
                onChange={e => setSubpath(e.target.value)}
                placeholder="skills/"
                disabled={installing}
                className="text-sm"
              />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {(phase === 'preview' || phase === 'installing') && skills.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  Skills found ({skills.length})
                </label>
                <button
                  type="button"
                  className="text-[11px] text-text-secondary hover:text-text-primary hover:underline"
                  disabled={installing}
                  onClick={() => {
                    if (selected.size === skills.length) setSelected(new Set());
                    else setSelected(new Set(skills.map(s => s.path)));
                  }}
                >
                  {selected.size === skills.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <ul className="space-y-1 max-h-64 overflow-y-auto border border-border rounded-md">
                {skills.map(s => {
                  const checked = selected.has(s.path);
                  return (
                    <li key={s.path}>
                      <label
                        className={cn(
                          'flex items-start gap-2 px-3 py-2 cursor-pointer text-xs hover:bg-bg-hover',
                          checked && 'bg-bg-selected',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          disabled={installing}
                          onChange={() => togglePath(s.path)}
                        />
                        <span className="min-w-0">
                          <span className="font-medium text-text-primary block truncate">
                            {s.name}
                          </span>
                          {s.description && (
                            <span className="text-text-muted line-clamp-2">{s.description}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {installing && phase === 'preview' && skills.length === 0 && !error && (
            <div className="flex items-center gap-2 text-text-muted text-xs py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cloning and scanning repository…
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={() => void handleClose()} disabled={installing}>
            Cancel
          </Button>
          {phase === 'input' || (phase === 'preview' && skills.length === 0 && !installing) ? (
            <Button
              size="sm"
              onClick={() => void handlePreview()}
              disabled={installing || !url.trim()}
              className="gap-1"
            >
              {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Preview
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handlePreview()}
                disabled={installing}
              >
                Re-scan
              </Button>
              <Button
                size="sm"
                onClick={() => void handleInstall()}
                disabled={installing || selected.size === 0}
                className="gap-1"
              >
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Install ({selected.size})
              </Button>
            </>
          )}
        </div>
      </ResizablePanel>
    );
  },
);

GitInstallDialog.displayName = 'GitInstallDialog';
export default GitInstallDialog;
