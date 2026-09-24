import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import type { FileChange, FileChangedEvent } from '@/shared/types';

import { isUnversionedEntry } from '../utils/gitStatusGroups';

/**
 * G1 契约判定：目录条目显式 `is_dir` 字段优先；`?? dir/` 旧 payload
 * （无 is_dir 且 path 带尾斜杠）走斜杠兜底（过渡期兼容）。
 */
function isCollapsedDirEntry(file: FileChange): boolean {
  return file.is_dir ?? file.path.endsWith('/');
}

/**
 * 目录包含关系：`path` 是否位于折叠目录 `dir` 之下（含目录自身）。
 *
 * 这是**包含**判定而非「同一文件」判定，不构成红线 12 的身份判定：不做形态归一、
 * 不拼项目根、不比较 `FileRef` 身份。两个入参都是同形态的项目相对路径
 * （G1 契约：快照条目 path 无尾斜杠；watcher 事件路径同样无尾斜杠），因此按完整
 * 路径段比较即可 —— `dir-ab/x` 不会被 `dir-a` 误命中（兄弟目录前缀）。
 * 旧 payload 的目录条目可能带尾斜杠（G1 之前），此处只补足分隔符。
 */
export function isPathUnderDir(path: string, dir: string): boolean {
  if (dir === '') return false;
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const bare = prefix.slice(0, -1);
  return path === bare || path.startsWith(prefix);
}

/**
 * 把折叠的 untracked 目录条目替换为其下的文件条目，
 * 使 Unversioned 组内所有行同构展示（【文件名】【目录名】）。
 * 子文件列表尚未拉取完成时保留目录条目占位。
 */
export function expandUntrackedEntries(
  files: FileChange[],
  dirFilesMap: Record<string, string[]>,
): FileChange[] {
  const out: FileChange[] = [];
  for (const file of files) {
    if (!isCollapsedDirEntry(file)) {
      out.push(file);
      continue;
    }
    const children = dirFilesMap[file.path];
    if (children) {
      for (const child of children) {
        out.push({ path: child, status: 'Untracked', additions: 0, deletions: 0, is_dir: false });
      }
    } else {
      out.push(file);
    }
  }
  return out;
}

/**
 * 折叠 untracked 目录条目的按需展开状态机：
 * 后端 `git status` 折叠语义输出目录条目（G1 起 path 无尾斜杠 + is_dir=true）；
 * 此处按需拉取目录下的文件并与普通文件行同构展示（【文件名】【目录名】），
 * 未加载完成前保留目录条目占位。
 *
 * 失效契约（三条信号，全部走 SWR：标记 stale 时**保留旧值**，新值落地才替换 ——
 * 否则每次失效都会让已展开的目录闪一下目录条目）：
 * - **S1 文件事件**：`file-changed` 批次里任一路径落在某折叠目录下 → 该目录需重拉。
 *   local 主路径上这是「目录内新增/删除文件」的即时通道。
 * - **S2 快照替换**：`files`（= store 的 `changed_files`）引用被整体替换 → 全部需重拉。
 *   判定落在**引用**而非快照 `version`：local 的两条刷新都不推进 version（面板刷新按钮走
 *   `get_git_info` 不经 version gate；窗口聚焦走 `versionGateAccepts(..., allowEqual=true)`
 *   同版本放行），而它们是「手动刷新必须看到最新内容」的唯一通道。
 * - **S3 失败抑制**：拉取失败不写缓存键（目录条目继续占位），并进入失败抑制直至下一次
 *   失效信号 —— 避免「失败 → 不写键 → effect 重跑 → 立即重试」自激。
 *
 * 去重：同一目录 in-flight 期间的多次失效只重新标记 stale，落地后合并为一次 trailing 重拉。
 * 缓存作用域：hook 状态随组件生命周期存活，跨项目切换由渲染侧的 `key={project.id}` 重置
 * （见 `GitCommitPanel` 中 `ChangesList` 的 key），故此处无需感知 projectId。
 */
export function useUntrackedDirExpansion(
  files: FileChange[],
  onExpandUntrackedDir?: (dirPath: string) => Promise<string[]>,
) {
  const [dirFilesMap, setDirFilesMap] = useState<Record<string, string[]>>({});
  /** 需后台重拉但**保留旧值**的目录（SWR）；用 state 而非 ref，好让拉取 effect 随其重跑 */
  const [staleDirs, setStaleDirs] = useState<ReadonlySet<string>>(() => new Set());
  const inflightDirsRef = useRef<Set<string>>(new Set());
  /** 失败抑制集：失败目录在下一次失效信号前不再自动重试（S3 防自激） */
  const failedDirsRef = useRef<Set<string>>(new Set());
  /** 上一次的折叠目录条目集合：引用变化 = `changed_files` 被替换（S2） */
  const prevCollapsedRef = useRef<FileChange[] | undefined>(undefined);
  /** 当前折叠目录路径集合：给引用稳定的订阅回调经 ref 读取最新值 */
  const entryPathsRef = useRef<string[]>([]);

  // G6：unversioned 判定优先走 porcelain XY（X=Y='?'），缺 XY 回退单 status
  const untrackedFiles = useMemo(() => files.filter(isUnversionedEntry), [files]);

  const collapsedDirEntries = useMemo(
    () => untrackedFiles.filter(isCollapsedDirEntry),
    [untrackedFiles],
  );

  useEffect(() => {
    entryPathsRef.current = collapsedDirEntries.map((entry) => entry.path);
  }, [collapsedDirEntries]);

  // S1：file-changed 批次命中折叠目录前缀 → 标记需重拉（并复位失败抑制，允许重试）
  const handleFileChanged = useCallback((event: FileChangedEvent) => {
    const dirsToCheck = entryPathsRef.current;
    if (dirsToCheck.length === 0 || event.paths.length === 0) return;
    const matched = new Set<string>();
    for (const path of event.paths) {
      for (const dir of dirsToCheck) {
        if (isPathUnderDir(path, dir)) matched.add(dir);
      }
    }
    if (matched.size === 0) return;
    for (const dir of matched) failedDirsRef.current.delete(dir);
    setStaleDirs((prev) => new Set([...prev, ...matched]));
  }, []);
  useFileChangedEvent(handleFileChanged);

  // S2：`changed_files` 被替换 → 全部需重拉；已不在列表中的目录键丢弃（目录被 stage /
  // 删除后缓存不得残留）。首次挂载只登记基线，不触发重拉。
  useEffect(() => {
    const prev = prevCollapsedRef.current;
    prevCollapsedRef.current = collapsedDirEntries;
    if (prev === undefined || prev === collapsedDirEntries) return;

    const entryPaths = collapsedDirEntries.map((entry) => entry.path);
    const keep = new Set(entryPaths);
    setDirFilesMap((cache) => {
      const keys = Object.keys(cache);
      if (keys.length === 0) return cache;
      const next: Record<string, string[]> = {};
      let dropped = false;
      for (const key of keys) {
        if (!keep.has(key)) {
          dropped = true;
          continue;
        }
        next[key] = cache[key]!;
      }
      // 无键被丢弃时回原引用：避免无谓重渲染（stale 的更新走下面的 state）
      return dropped ? next : cache;
    });
    // 刷新信号 = 允许重试（S3），并把当前目录全部标记为需重拉（未缓存目录本就 pending）
    failedDirsRef.current.clear();
    setStaleDirs((prevStale) => {
      const next = new Set([...prevStale, ...entryPaths]);
      // 内容未变则不换引用（next ⊇ prevStale，故等长即等价）
      return next.size === prevStale.size ? prevStale : next;
    });
  }, [collapsedDirEntries]);

  useEffect(() => {
    if (!onExpandUntrackedDir) return;
    const pending = collapsedDirEntries.filter(
      (entry) =>
        (dirFilesMap[entry.path] === undefined || staleDirs.has(entry.path)) &&
        !inflightDirsRef.current.has(entry.path) &&
        !failedDirsRef.current.has(entry.path),
    );
    if (pending.length === 0) return;
    for (const entry of pending) inflightDirsRef.current.add(entry.path);
    // 本轮已受理这些目录；若在飞行期间再次失效，S1/S2 会重新标记 → 落地后合并为一次重拉
    const accepted = new Set(pending.map((entry) => entry.path));
    setStaleDirs((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const dirPath of accepted) {
        if (next.delete(dirPath)) changed = true;
      }
      return changed ? next : prev;
    });
    Promise.all(
      pending.map(async (entry) => {
        try {
          // 兼容旧 payload 的尾斜杠路径；G1 起后端已归一化为无斜杠 path
          const children = await onExpandUntrackedDir(entry.path.replace(/\/+$/, ''));
          return [entry.path, children] as const;
        } catch {
          // S3：失败不写缓存键（目录条目继续占位）+ 进入失败抑制（下一次失效信号复位）
          failedDirsRef.current.add(entry.path);
          return null;
        } finally {
          inflightDirsRef.current.delete(entry.path);
        }
      }),
    ).then((results) => {
      const succeeded = results.filter((result) => result !== null);
      if (succeeded.length === 0) return;
      setDirFilesMap((prev) => {
        const next = { ...prev };
        for (const [dirPath, children] of succeeded) next[dirPath] = children;
        return next;
      });
    });
  }, [collapsedDirEntries, dirFilesMap, staleDirs, onExpandUntrackedDir]);

  /** 平铺后的 Unversioned 列表：折叠目录条目替换为其下文件（同构 Untracked 行） */
  const flattenedUntracked = useMemo(
    () => expandUntrackedEntries(untrackedFiles, dirFilesMap),
    [untrackedFiles, dirFilesMap],
  );

  return { flattenedUntracked };
}
