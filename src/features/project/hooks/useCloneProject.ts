import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useState } from 'react';

import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { PROJECT_CLONE_PROGRESS_EVENT } from '@/shared/utils/projectEvents';

import { cancelProjectClone, cloneGitProject } from '../api/projectApi';
import type { CloneProgress } from '../types/clone';
import { deriveProjectName, isValidCloneUrl } from '../utils/cloneFormUtils';

/** localStorage key remembering the last clone destination parent dir. */
const LAST_DEST_DIR_KEY = 'neeko.clone.lastDestDir';

export type CloneStatus = 'idle' | 'cloning';

export interface UseCloneProjectOptions {
  /** Invoked with the cloned path after a successful clone (before close). */
  onSuccess: (path: string) => void;
}

/**
 * State machine for the Clone-from-Git dialog: form fields with auto-derived
 * project name, directory picker, streaming progress, cancel, and inline
 * error handling. UI rendering lives in CloneProjectDialog; all backend
 * interaction is encapsulated here.
 */
export function useCloneProject({ onSuccess }: UseCloneProjectOptions) {
  const [url, setUrl] = useState('');
  const [destParent, setDestParent] = useState(() => localStorage.getItem(LAST_DEST_DIR_KEY) ?? '');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [status, setStatus] = useState<CloneStatus>('idle');
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUrlChange = useCallback(
    (next: string) => {
      setUrl(next);
      if (!nameTouched) setName(deriveProjectName(next));
    },
    [nameTouched],
  );

  const handleNameChange = useCallback((next: string) => {
    setNameTouched(true);
    setName(next);
  }, []);

  const pickDirectory = useCallback(async () => {
    const selected = await open({ multiple: false, directory: true });
    if (selected) {
      setDestParent(selected);
      localStorage.setItem(LAST_DEST_DIR_KEY, selected);
    }
  }, []);

  // 无 clone_id 过滤：后端单克隆槽位保证同一时刻只有一个克隆在跑，
  // 事件里的 clone_id 仅供未来多克隆扩展使用。
  const handleProgress = useCallback((p: CloneProgress) => {
    setProgress(p);
  }, []);
  useTauriEvent<CloneProgress>(PROJECT_CLONE_PROGRESS_EVENT, handleProgress);

  const startClone = useCallback(async () => {
    if (status === 'cloning') return;
    const trimmedUrl = url.trim();
    const trimmedDest = destParent.trim();
    const finalName = (name.trim() || deriveProjectName(trimmedUrl)).trim();

    if (!isValidCloneUrl(trimmedUrl)) {
      setError('Invalid git URL — expected http://, https://, or git@');
      return;
    }
    if (!trimmedDest) {
      setError('Choose a destination directory');
      return;
    }
    if (!finalName) {
      setError('Project name is required');
      return;
    }

    setStatus('cloning');
    setProgress(null);
    setError(null);

    try {
      const result = await cloneGitProject({
        url: trimmedUrl,
        destParent: trimmedDest,
        name: finalName,
      });
      setStatus('idle');
      onSuccess(result.path);
    } catch (e) {
      setStatus('idle');
      const message = e instanceof Error ? e.message : String(e);
      // User-initiated cancel is a neutral outcome (backend rejects the clone
      // command with "Clone cancelled"): fields stay for retry, no banner.
      if (!message.includes('Clone cancelled')) {
        setError(message);
      }
    }
  }, [status, url, destParent, name, onSuccess]);

  const cancel = useCallback(async () => {
    if (status !== 'cloning') return;
    try {
      await cancelProjectClone();
    } catch (e) {
      console.error('[Clone] Failed to request cancellation:', e);
    }
  }, [status]);

  return {
    url,
    setUrl: handleUrlChange,
    destParent,
    setDestParent,
    name,
    setName: handleNameChange,
    status,
    progress,
    error,
    locked: status === 'cloning',
    pickDirectory,
    startClone,
    cancel,
  };
}

export type UseCloneProjectReturn = ReturnType<typeof useCloneProject>;
