import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (!enabled) {
      if (!cached) setResource(null);
      return;
    }

    if (cached) {
      setResource(cached);
      return;
    }

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
  }, [key, enabled, cached]);

  return resource;
}
