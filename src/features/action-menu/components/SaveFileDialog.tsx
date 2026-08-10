import { open as openDirectoryDialog } from '@tauri-apps/plugin-dialog';
import React, { useState, useCallback, useRef, useEffect, startTransition } from 'react';

import DirectoryPickerDialog from '@/features/action-menu/components/DirectoryPickerDialog';
import { readDirTree, saveNewFile } from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { refreshGitFileStates } from '@/features/git';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileContent } from '@/shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/Dialog';

import { useSaveAsStore } from '../store/saveAsStore';

const SaveFileDialog: React.FC = () => {
  const request = useSaveAsStore((s) => s.request);
  const clearSaveAs = useSaveAsStore((s) => s.clearSaveAs);
  const activeProject = useProjectStore((s) => s.activeProject);
  // Worktree 激活时，保存目标根目录应为 worktree 路径
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);

  const [filename, setFilename] = useState('');
  const [directory, setDirectory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const filenameRef = useRef<HTMLInputElement>(null);
  const lastOpenRef = useRef(false);

  const env = activeProject?.environment;
  const open = request !== null;

  useEffect(() => {
    if (open && !lastOpenRef.current) {
      startTransition(() => {
        setFilename(request!.defaultFilename);
        setDirectory(request!.defaultDirectory);
        setError(null);
        setSubmitting(false);
      });
      requestAnimationFrame(() => filenameRef.current?.focus());
    }
    lastOpenRef.current = open;
  }, [open, request]);

  const handleBrowse = useCallback(async () => {
    if (!env) return;

    if (env.type === 'Local') {
      try {
        const selected = await openDirectoryDialog({
          directory: true,
          multiple: false,
          title: 'Select Directory',
        });
        if (selected) {
          setDirectory(selected);
        }
      } catch {
        /* user cancelled */
      }
    } else {
      setDirPickerOpen(true);
    }
  }, [env]);

  const handleDirPickerSelect = useCallback((path: string) => {
    setDirectory(path);
    setDirPickerOpen(false);
  }, []);

  // 保存成功后刷新文件树，让新文件在 worktree/项目视图中立即可见；
  // 同时显式刷新 git 状态（worktree 下 watcher 不监听，新文件需手动触发变色）
  // 通过 store.loadDir 静默重载根目录：只替换根缓存，已展开的子目录缓存不受影响
  const refreshFileTree = useCallback(async () => {
    if (!request || !activeProject) return;
    try {
      const rootPath = activeWorktreePath ?? activeProject.path;
      const owner = `${request.projectId}:${rootPath}`;
      const loader = () => readDirTree(request.projectId, null, activeWorktreePath ?? null);
      await useFileStore.getState().loadDir(owner, '', loader, {
        force: true,
        silent: true,
      });
      void refreshGitFileStates(request.projectId, activeWorktreePath ?? '');
    } catch {
      /* 树刷新失败不影响保存结果 */
    }
  }, [request, activeProject, activeWorktreePath]);

  const handleSubmit = useCallback(async () => {
    if (!request || !activeProject) return;

    const fn = filename.trim();
    const dir = directory.trim();
    if (!fn) {
      setError('Filename cannot be empty');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const relPath = await saveNewFile(
        request.projectId,
        dir,
        fn,
        request.content,
        activeWorktreePath ?? undefined,
      );
      const store = useEditorStore.getState();
      store.updateTab(request.tabKey, request.tabId, {
        filePath: relPath,
        title: fn,
        isDirty: false,
        isUntitled: false,
        initialPreviewMode: undefined,
        content: {
          path: relPath,
          content: request.content,
          size: request.content.length,
          is_binary: false,
        } satisfies FileContent,
      });
      store.activateTab(request.tabKey, request.tabId);
      void refreshFileTree();
      clearSaveAs();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to save file',
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    request,
    activeProject,
    filename,
    directory,
    clearSaveAs,
    activeWorktreePath,
    refreshFileTree,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !submitting) {
        handleSubmit();
      }
    },
    [handleSubmit, submitting],
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) clearSaveAs();
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Save As</DialogTitle>
            <DialogDescription>Choose a filename and directory to save the file.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label htmlFor="save-filename" className="block text-xs text-text-secondary mb-1">
                Filename
              </label>
              <input
                ref={filenameRef}
                id="save-filename"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Untitled-1"
                className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue text-sm"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div>
              <label htmlFor="save-directory" className="block text-xs text-text-secondary mb-1">
                Directory
              </label>
              <div className="flex gap-2">
                <input
                  id="save-directory"
                  value={directory}
                  onChange={(e) => {
                    setDirectory(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={activeProject?.path ?? '/'}
                  className="flex-1 px-3 py-2 rounded-md border border-border bg-bg-primary text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="shrink-0 px-3 py-2 rounded-md text-sm text-text-secondary bg-bg-primary border border-border hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={handleBrowse}
                >
                  Browse&hellip;
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <DialogFooter>
            <button
              type="button"
              className="px-4 py-1.5 rounded-md text-sm text-text-secondary bg-bg-primary border border-border hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => clearSaveAs()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-1.5 rounded-md text-sm text-white bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 transition-colors cursor-pointer"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Saving\u2026' : 'Save'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {env && env.type !== 'Local' && request && (
        <DirectoryPickerDialog
          open={dirPickerOpen}
          onOpenChange={setDirPickerOpen}
          target={
            env.type === 'Wsl'
              ? { type: 'wsl', distro: env.distro }
              : {
                  type: 'remote',
                  host: env.host,
                  port: env.port,
                  username: env.username,
                  auth: env.auth,
                }
          }
          onSelect={handleDirPickerSelect}
        />
      )}
    </>
  );
};

export default React.memo(SaveFileDialog);
