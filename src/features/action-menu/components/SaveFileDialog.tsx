import { open as openDirectoryDialog } from '@tauri-apps/plugin-dialog';
import React, { useState, useCallback, useRef, useEffect, startTransition } from 'react';

import DirectoryPickerDialog from '@/features/action-menu/components/DirectoryPickerDialog';
import { saveNewFile } from '@/features/file/api/fileApi';
import { useEditorStore } from '@/shared/store';
import { useProjectStore } from '@/shared/store/projectStore';
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
      const relPath = await saveNewFile(request.projectId, dir, fn, request.content);
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
      clearSaveAs();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to save file',
      );
    } finally {
      setSubmitting(false);
    }
  }, [request, activeProject, filename, directory, clearSaveAs]);

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
