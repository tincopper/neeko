import { useEffect, useState } from 'react';

import { viewPr, listPrFiles, listPrCommits, listPrComments } from '../../api/gitApi';
import type { PRInfo, PRFileChange, PRCommit } from '../../types';
import type { PRComment } from '../../types/comment';

export interface PRResource {
  info: PRInfo;
  files: PRFileChange[];
  commits: PRCommit[];
  comments: PRComment[];
}

const cache = new Map<string, PRResource>();

export function isPRCached(projectId: string, prNumber: number): boolean {
  return cache.has(`${projectId}:${prNumber}`);
}

export function usePRResource(projectId: string, prNumber: number, enabled: boolean) {
  const key = `${projectId}:${prNumber}`;
  const cached = cache.get(key);
  const [resource, setResource] = useState<PRResource | null>(cached ?? null);

  // Sync resource state when enabled/cached changes
  useEffect(() => {
    if (!enabled && !cached) {
      setResource(null);
    } else if (enabled && cached) {
      setResource(cached);
    }
  }, [enabled, cached]);

  // Sync when a cached value becomes available for an already-enabled key
  useEffect(() => {
    if (enabled && cached && resource !== cached) {
      setResource(cached);
    }
  }, [enabled, cached, resource]);

  useEffect(() => {
    if (!enabled) return;
    if (cached) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    timer = setTimeout(() => {
      if (cancelled) return;
      Promise.all([
        viewPr(projectId, prNumber).catch((err: unknown) => {
          console.error('[usePRResource] viewPr failed:', err);
          throw err; // re-throw so Promise.all still rejects
        }),
        listPrFiles(projectId, prNumber).catch((): PRFileChange[] => []),
        listPrCommits(projectId, prNumber).catch((): PRCommit[] => []),
        listPrComments(projectId, prNumber).catch((): PRComment[] => []),
      ])
        .then(([info, files, commits, comments]) => {
          if (!cancelled) {
            const data = { info, files, commits, comments };
            cache.set(key, data);
            setResource(data);
          }
        })
        .catch((err: unknown) => {
          console.error('[usePRResource] failed to load PR resource:', err);
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, enabled, cached, projectId, prNumber]);

  return resource;
}
