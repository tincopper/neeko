import React from 'react';

import { Button } from '@/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/Dialog';
import { Input } from '@/ui/Input';

import { useCloneProject } from '../hooks/useCloneProject';
import { deriveProjectName, isValidCloneUrl } from '../utils/cloneFormUtils';

interface CloneProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Invoked with the cloned path — the app layer runs the add-project chain. */
  onSuccess: (path: string) => void;
}

const CLONE_PHASE_LABELS: Record<string, string> = {
  counting: 'Counting objects',
  compressing: 'Compressing objects',
  receiving: 'Receiving objects',
  resolving: 'Resolving deltas',
  updating: 'Updating files',
};

/**
 * Clone-from-Git dialog: URL + destination parent dir + auto-derived project
 * name. Locked while cloning (cancel is the only exit); failures stay inline
 * with fields preserved for retry; success hands the path to `onSuccess`.
 */
const CloneProjectDialog: React.FC<CloneProjectDialogProps> = ({ isOpen, onClose, onSuccess }) => {
  const clone = useCloneProject({
    onSuccess: React.useCallback((path: string) => onSuccess(path), [onSuccess]),
  });

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open && !clone.locked) onClose();
    },
    [clone.locked, onClose],
  );

  // While cloning, Esc / overlay clicks must not close the dialog.
  const guardClose = React.useCallback(
    (e: { preventDefault: () => void }) => {
      if (clone.locked) e.preventDefault();
    },
    [clone.locked],
  );

  const handleCancel = React.useCallback(() => {
    if (clone.locked) {
      void clone.cancel();
    } else {
      onClose();
    }
  }, [clone, onClose]);

  const canSubmit =
    !clone.locked &&
    isValidCloneUrl(clone.url.trim()) &&
    clone.destParent.trim().length > 0 &&
    (clone.name.trim().length > 0 || deriveProjectName(clone.url).length > 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        onEscapeKeyDown={guardClose}
        onInteractOutside={guardClose}
        data-testid="clone-project-dialog"
      >
        <DialogHeader>
          <DialogTitle>Clone from Git</DialogTitle>
          <DialogDescription>
            Clone a repository into a local folder and add it as a project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="clone-url" className="text-sm text-text-secondary">
              Git URL
            </label>
            <Input
              id="clone-url"
              value={clone.url}
              onChange={(e) => clone.setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
              disabled={clone.locked}
              autoComplete="off"
              spellCheck={false}
            />
            {clone.url.trim().length > 0 && !isValidCloneUrl(clone.url.trim()) && (
              <p className="text-xs text-red-500">Expected http://, https://, or git@ URL.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="clone-dest" className="text-sm text-text-secondary">
              Destination directory
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="clone-dest"
                value={clone.destParent}
                onChange={(e) => clone.setDestParent(e.target.value)}
                placeholder="/path/to/parent"
                disabled={clone.locked}
                className="flex-1"
                spellCheck={false}
              />
              <Button
                variant="outline"
                onClick={() => void clone.pickDirectory()}
                disabled={clone.locked}
              >
                Choose…
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="clone-name" className="text-sm text-text-secondary">
              Project name
            </label>
            <Input
              id="clone-name"
              value={clone.name}
              onChange={(e) => clone.setName(e.target.value)}
              placeholder="repo"
              disabled={clone.locked}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {clone.locked && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-tertiary p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">
                  {clone.progress
                    ? (CLONE_PHASE_LABELS[clone.progress.phase] ?? 'Cloning') + '…'
                    : 'Cloning…'}
                </span>
                {clone.progress && (
                  <span className="text-text-primary">{clone.progress.percent}%</span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-hover">
                {clone.progress ? (
                  <div
                    className="h-full rounded-full bg-accent-blue transition-[width] duration-200"
                    style={{ width: `${clone.progress.percent}%` }}
                    data-testid="clone-progress-bar"
                  />
                ) : (
                  <div
                    className="h-full w-1/3 animate-pulse rounded-full bg-accent-blue"
                    data-testid="clone-progress-indeterminate"
                  />
                )}
              </div>
            </div>
          )}

          {clone.error && (
            <div
              className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-sm text-red-500"
              role="alert"
            >
              {clone.error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {clone.locked ? 'Cancel clone' : 'Cancel'}
          </Button>
          <Button onClick={() => void clone.startClone()} disabled={!canSubmit}>
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(CloneProjectDialog);
