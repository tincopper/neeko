import { useEffect, useMemo, useRef, useState } from 'react';

import type { FileChange } from '@/shared/types';

/**
 * 把折叠的 untracked 目录条目（path 带尾斜杠）替换为其下的文件条目，
 * 使 Unversioned 组内所有行同构展示（【文件名】【目录名】）。
 * 子文件列表尚未拉取完成时保留目录条目占位（行显示剥离尾斜杠后的名字）。
 */
export function expandUntrackedEntries(
  files: FileChange[],
  dirFilesMap: Record<string, string[]>,
): FileChange[] {
  const out: FileChange[] = [];
  for (const file of files) {
    if (!file.path.endsWith('/')) {
      out.push(file);
      continue;
    }
    const children = dirFilesMap[file.path];
    if (children) {
      for (const child of children) {
        out.push({ path: child, status: 'Untracked', additions: 0, deletions: 0 });
      }
    } else {
      out.push(file);
    }
  }
  return out;
}

/**
 * 折叠 untracked 目录条目的按需展开状态机：
 * 后端 `git status` 折叠语义输出 `dir/` 单条目；此处按需拉取目录下的文件并
 * 与普通文件行同构展示（【文件名】【目录名】），未加载完成前保留目录条目占位。
 */
export function useUntrackedDirExpansion(
  files: FileChange[],
  onExpandUntrackedDir?: (dirPath: string) => Promise<string[]>,
) {
  const [dirFilesMap, setDirFilesMap] = useState<Record<string, string[]>>({});
  const inflightDirsRef = useRef<Set<string>>(new Set());

  const untrackedFiles = useMemo(() => files.filter((f) => f.status === 'Untracked'), [files]);

  const collapsedDirEntries = useMemo(
    () => untrackedFiles.filter((f) => f.path.endsWith('/')),
    [untrackedFiles],
  );

  useEffect(() => {
    if (!onExpandUntrackedDir) return;
    const pending = collapsedDirEntries.filter(
      (f) => dirFilesMap[f.path] === undefined && !inflightDirsRef.current.has(f.path),
    );
    if (pending.length === 0) return;
    for (const entry of pending) inflightDirsRef.current.add(entry.path);
    Promise.all(
      pending.map(async (entry) => {
        try {
          const children = await onExpandUntrackedDir(entry.path.replace(/\/+$/, ''));
          return [entry.path, children] as const;
        } catch {
          // 拉取失败：记为空列表，避免该目录永久重试刷屏（下次挂载可再试）
          return [entry.path, [] as string[]] as const;
        } finally {
          inflightDirsRef.current.delete(entry.path);
        }
      }),
    ).then((results) => {
      setDirFilesMap((prev) => {
        const next = { ...prev };
        for (const [dirPath, children] of results) next[dirPath] = children;
        return next;
      });
    });
  }, [collapsedDirEntries, dirFilesMap, onExpandUntrackedDir]);

  /** 平铺后的 Unversioned 列表：折叠目录条目替换为其下文件（同构 Untracked 行） */
  const flattenedUntracked = useMemo(
    () => expandUntrackedEntries(untrackedFiles, dirFilesMap),
    [untrackedFiles, dirFilesMap],
  );

  return { flattenedUntracked };
}
