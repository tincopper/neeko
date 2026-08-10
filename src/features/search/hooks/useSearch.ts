import { useEffect, useMemo, useRef, useState } from 'react';

import { useFileStore } from '@/features/file/store';
import { useSearchStore } from '@/features/search/store/searchStore';
import type { SearchFileGroup, SearchOptions } from '@/shared/types/search';

const DEBOUNCE_MS = 300;

export type ShowToastFn = (message: string, type?: 'info' | 'error') => void;

/** Serialize options for dependency identity (avoid object-identity churn). */
function optionsKey(options: SearchOptions): string {
  return JSON.stringify(options);
}

/** Collect all file paths from the flat directory cache. */
function collectAllFiles(dirs: Record<string, { path: string; is_dir: boolean }[]>): string[] {
  const files: string[] = [];
  for (const entries of Object.values(dirs)) {
    for (const entry of entries) {
      if (!entry.is_dir) {
        files.push(entry.path);
      }
    }
  }
  return files;
}

/** Filter files by name matching the query. */
function filterFilesByName(files: string[], query: string): SearchFileGroup[] {
  const q = query.toLowerCase();
  const groups: SearchFileGroup[] = [];
  for (const path of files) {
    const fileName = path.split('/').pop() || path;
    if (fileName.toLowerCase().includes(q)) {
      groups.push({
        path,
        matches: [], // No content matches for file name results
      });
    }
  }
  return groups;
}

/**
 * Debounced, life-cycle-safe search driver.
 *
 * Searches both file names (locally) and content (backend) simultaneously.
 * File name matches are displayed first, followed by content matches.
 */
export function useSearch(
  projectId: string | null,
  showToast: ShowToastFn,
  options: SearchOptions = {},
) {
  const [query, setQuery] = useState('');
  const [committed, setCommitted] = useState('');
  const [fileNameMatches, setFileNameMatches] = useState<SearchFileGroup[]>([]);

  const run = useSearchStore((s) => s.run);
  const stop = useSearchStore((s) => s.stop);
  const clear = useSearchStore((s) => s.clear);
  const fileGroups = useSearchStore((s) => s.fileGroups);
  const status = useSearchStore((s) => s.status);
  const truncated = useSearchStore((s) => s.truncated);
  const error = useSearchStore((s) => s.error);

  const fileDirs = useFileStore((s) => s.dirs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest-options ref: the debounced effect reads current options without
  // re-firing on object identity changes. Mirrored inside an effect (writing
  // refs during render is disallowed by react-hooks/refs).
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // All files from the file tree cache.
  const allFiles = useMemo(() => collectAllFiles(fileDirs), [fileDirs]);

  // Serialized options for dependency identity (avoid object-identity churn).
  const optionsSignature = useMemo(() => optionsKey(options), [options]);

  // Debounced trigger: restart search once the query settles. All state
  // updates happen inside the timeout callback (never synchronously in the
  // effect body) so the debounce window also covers query clearing.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!projectId || !query.trim()) {
        setFileNameMatches([]);
        return;
      }
      setCommitted(query);
      // Always search file names locally.
      setFileNameMatches(filterFilesByName(allFiles, query));
      // Always search content via backend.
      void run(projectId, query, optionsRef.current);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, projectId, optionsSignature, allFiles, run]);

  // Cancel the backend request when the panel unmounts.
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  // Show errors via the global toast notification.
  useEffect(() => {
    if (error) {
      showToast(error, 'error');
    }
  }, [error, showToast]);

  // Combined results: file name matches first, then content matches.
  const combinedGroups = useMemo(() => {
    return [...fileNameMatches, ...fileGroups];
  }, [fileNameMatches, fileGroups]);

  const totalMatches = useMemo(() => {
    const fileNameCount = fileNameMatches.length;
    const contentCount = fileGroups.reduce((sum, g) => sum + g.matches.length, 0);
    return fileNameCount + contentCount;
  }, [fileNameMatches, fileGroups]);

  const clearAll = () => {
    clear();
    setFileNameMatches([]);
    setQuery('');
  };

  return {
    query,
    setQuery,
    committed,
    fileGroups: combinedGroups,
    fileNameMatches,
    status,
    truncated,
    clear: clearAll,
    totalMatches,
  };
}
