import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { loadFileLineChanges } from '@/features/git/api/fileLineChange';
import { GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT } from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import type { FileChangedEvent, FileLineChange, GitStatusSnapshot } from '@/shared/types';
import { fileRefFromTabPath, pathsContainFile, relativeToRootOrNull } from '@/shared/utils/fileRef';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { createGitChangeExtensions, setFileLineChangesEffect } from '../git-change';

/** VCS 事件去抖窗口（ms）：git-changed 在 build 期间高频爆发，合并为静默窗口末一次拉取。 */
const REFRESH_DEBOUNCE_MS = 300;

interface UseGitChangeEditorParams {
  enabled: boolean;
  projectId: string | null;
  /** tab.filePath（canonical 绝对或虚拟身份）；fetch 前剥根为仓库相对路径。 */
  filePath: string;
  /** 项目根：剥根基准（worktree 未激活时）+ file-changed 相对路径身份基准。 */
  projectRoot?: string | null;
  /** worktree 路径：激活时优先作剥根基准，且原样透传 get_file_diff。 */
  worktreePath?: string | null;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  /** EditorView 挂载 epoch：首拉时 view 尚未创建，epoch 变更后补派发。 */
  editorViewEpoch: number;
}

/**
 * tab 身份 → `get_file_diff` 仓库相对路径；不可下发（虚拟身份 / 无根绝对路径 /
 * 不在根下）返回 null（调用方跳过 fetch）。
 *
 * 身份解析走 `fileRefFromTabPath`（禁止自造字符串归一）；剥根走 `relativeToRootOrNull`
 * （SSOT：是否「在根下」的判定集中在 fileRef，杜绝消费侧另立绝对路径正则）。
 */
function resolveRepoRelativePath(
  projectRoot: string | null | undefined,
  worktreePath: string | null | undefined,
  filePath: string,
): string | null {
  if (!filePath) return null;
  const identityRoot = worktreePath ?? projectRoot ?? '';
  const ref = fileRefFromTabPath(identityRoot, filePath);
  if (ref.kind !== 'fs') return null;
  return relativeToRootOrNull(identityRoot, ref.path);
}

/** 主/事件两条路径共用的拉取：失败返回 `[]`（静默），stale 时返回 `null` 表示丢弃。 */
async function loadChanges(
  projectId: string,
  filePath: string,
  worktreePath: string | null | undefined,
  isStale: () => boolean,
): Promise<readonly FileLineChange[] | null> {
  try {
    const changes = await loadFileLineChanges(projectId, filePath, worktreePath);
    if (isStale()) return null;
    return changes;
  } catch {
    if (isStale()) return null;
    return [];
  }
}

function buildKey(
  projectId: string,
  filePath: string,
  worktreePath: string | null | undefined,
  eventTick: number,
): string {
  return `${projectId}|${filePath}|${worktreePath ?? ''}|${eventTick}`;
}

/**
 * Git 行级变更高亮装配：拉取 `get_file_diff`（collapse=false）→ 纯函数推导
 * `FileLineChange[]` → 经 `setFileLineChangesEffect` 写入常驻 StateField。
 *
 * 扩展数组 memo 仅依赖 `enabled`（引用终身稳定）；数据更新一律走 effect，
 * 禁止把行映射数据本身接进 extensions memo（防 reconfigure）。
 *
 * 事件刷新：`git-status-snapshot` / `git-changed` 直接 listen + 去抖重拉；
 * `file-changed` 走共享 `useFileChangedEvent`（单 IPC 订阅 + refcount），
 * `pathsContainFile` 身份命中后汇入同一去抖窗口；卸载解除监听并取消 pending 调度。
 */
export function useGitChangeEditor({
  enabled,
  projectId,
  filePath,
  projectRoot,
  worktreePath,
  editorViewRef,
  editorViewEpoch,
}: UseGitChangeEditorParams): Extension[] {
  // 配置级依赖：enabled 翻转才换扩展集（false → [] 完全卸载）
  const extensions = useMemo(() => createGitChangeExtensions(enabled), [enabled]);

  // 最近一次成功拉取：view 晚挂载时按 epoch 补派发，避免首拉丢数据
  const lastChangesRef = useRef<readonly FileLineChange[]>([]);
  const lastKeyRef = useRef<string | null>(null);
  /** 事件去抖后的强制重拉信号（进 main effect key，不进 extensions memo）。 */
  const eventTickRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 仅归主拉取 effect：参数/epoch 变更后，in-flight fetch 不得再写缓存。
   * 事件订阅 effect 不得 bump（否则会误杀主路径 in-flight，导致同 key 重拉）。
   */
  const generationRef = useRef(0);
  /** git-events effect 注册的去抖入口；file-changed 共享订阅经此汇入同一窗口。 */
  const scheduleRefreshRef = useRef<() => void>(() => {});

  // 剥根结果进 deps（原始 filePath/worktreePath/projectRoot 的派生），避免两侧各算一套
  const repoRelPath = useMemo(
    () => resolveRepoRelativePath(projectRoot, worktreePath, filePath),
    [projectRoot, worktreePath, filePath],
  );

  // 主拉取/补派发路径
  useEffect(() => {
    if (!enabled || !projectId || !repoRelPath) {
      lastChangesRef.current = [];
      lastKeyRef.current = null;
      return;
    }

    const gen = ++generationRef.current;
    const isStale = () => generationRef.current !== gen;
    const key = buildKey(projectId, repoRelPath, worktreePath, eventTickRef.current);

    const dispatch = (changes: readonly FileLineChange[]) => {
      if (isStale()) return;
      editorViewRef.current?.dispatch({
        effects: setFileLineChangesEffect.of(changes),
      });
    };

    void (async () => {
      // 同 key 且 view 刚 epoch 变更 → 只补派发缓存，不重复 fetch
      if (lastKeyRef.current === key) {
        if (editorViewRef.current) dispatch(lastChangesRef.current);
        return;
      }
      const changes = await loadChanges(projectId, repoRelPath, worktreePath, isStale);
      if (changes === null || isStale()) return;
      lastChangesRef.current = changes;
      lastKeyRef.current = key;
      dispatch(changes);
    })();
  }, [enabled, projectId, repoRelPath, worktreePath, editorViewEpoch, editorViewRef]);

  // git 事件订阅：去抖后重拉并写 field（独立 active 生命周期，不碰 generationRef）
  useEffect(() => {
    if (!enabled || !projectId || !repoRelPath) {
      scheduleRefreshRef.current = () => {};
      return;
    }

    let active = true;
    const unlisteners: Array<() => void> = [];

    const forceRefresh = () => {
      if (!active) return;
      void (async () => {
        const changes = await loadChanges(projectId, repoRelPath, worktreePath, () => !active);
        if (changes === null || !active) return;
        lastChangesRef.current = changes;
        // 写入主 effect 同构 key：后续 epoch 补派发命中缓存，不二次 fetch
        lastKeyRef.current = buildKey(projectId, repoRelPath, worktreePath, eventTickRef.current);
        editorViewRef.current?.dispatch({
          effects: setFileLineChangesEffect.of(changes),
        });
      })();
    };

    const scheduleRefresh = () => {
      if (!active) return;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (!active) return;
        eventTickRef.current += 1;
        forceRefresh();
      }, REFRESH_DEBOUNCE_MS);
    };
    scheduleRefreshRef.current = scheduleRefresh;

    const onSnapshot = (event: { payload: GitStatusSnapshot }) => {
      if (event.payload.project_id !== projectId) return;
      scheduleRefresh();
    };
    const onGitChanged = (event: { payload: string }) => {
      if (event.payload !== projectId) return;
      scheduleRefresh();
    };

    const track = (p: Promise<UnlistenFn>) => {
      void p.then((un) => {
        if (!active) {
          safeUnlisten(un)();
          return;
        }
        unlisteners.push(safeUnlisten(un));
      });
    };

    track(listen<GitStatusSnapshot>(GIT_STATUS_SNAPSHOT_EVENT, onSnapshot));
    track(listen<string>(GIT_CHANGED_EVENT, onGitChanged));

    return () => {
      active = false;
      scheduleRefreshRef.current = () => {};
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      for (const un of unlisteners) un();
      unlisteners.length = 0;
    };
  }, [enabled, projectId, worktreePath, repoRelPath, editorViewRef]);

  // file-changed：共享单 IPC 订阅；身份命中后汇入 git-events 同一去抖窗口
  const onFileChanged = useCallback(
    (payload: FileChangedEvent) => {
      if (!enabled || !projectId || !repoRelPath) return;
      if (payload.project_id !== projectId) return;
      // 相对/绝对混合形态由身份所有者归一（watcher 正常发项目相对，strip_prefix 失败回退绝对）
      if (!pathsContainFile(projectRoot ?? worktreePath ?? '', payload.paths, filePath)) return;
      scheduleRefreshRef.current();
    },
    [enabled, projectId, repoRelPath, projectRoot, worktreePath, filePath],
  );
  useFileChangedEvent(onFileChanged);

  return extensions;
}
