import { useCallback, useMemo } from 'react';

import type { FileChange } from '@/shared/types';
import {
  buildFileSummaryMap,
  buildFolderSummaryMap,
  collectCollapsedDirs,
  resolveNodeStatus,
} from '@/shared/utils/gitFileDecoration';

/** 空变更列表常量：避免每次渲染新建空数组导致下游 useMemo 依赖抖动 */
const EMPTY_CHANGED_FILES: FileChange[] = [];

/**
 * S3 组装期 join：git 变更 → 视图节点的语义状态投影。
 *
 * 产出的 `decorate` 回调把「主导状态 + ignored 原始事实」直接盖章到视图节点，
 * 渲染期零匹配；输入不变则回调引用不变（`buildFileTreeView` memo 依赖稳定）。
 */
export function useGitDecorationProjection(changedFiles: FileChange[] | null | undefined) {
  // ── 装饰投影（S3：组装期 join）────────────────────────────
  // git 变更/忽略输入 → 路径摘要 map（输入不变则引用不变）
  const fileSummaries = useMemo(
    () => buildFileSummaryMap(changedFiles ?? EMPTY_CHANGED_FILES),
    [changedFiles],
  );
  // 折叠 untracked 目录条目：后代继承目录态色的投影输入（Rust 不递归 untracked）。
  // G1 起目录条目为无尾斜杠 path + is_dir；collectCollapsedDirs 产物同时喂给
  // folderSummaries（目录自身需显式携带状态色）与 resolveNodeStatus。
  const collapsedDirs = useMemo(
    () => collectCollapsedDirs(changedFiles ?? EMPTY_CHANGED_FILES),
    [changedFiles],
  );
  const folderSummaries = useMemo(
    () => buildFolderSummaryMap(fileSummaries, collapsedDirs),
    [fileSummaries, collapsedDirs],
  );
  // S5：ignored 灰显不再来自平行数组 —— 后端读层原生标注 node.ignored，
  // 组装期并入 is_ignored（见 fileTree.ts finalizeNode）。

  // 组装期 join：buildFileTreeView 的 decorate 回调把语义状态（主导状态 + ignored
  // 原始事实）直接盖章到视图节点——FileTreeRow 读字段呈现，无渲染期匹配回调。
  const decorate = useCallback(
    (path: string, isDir: boolean) =>
      resolveNodeStatus(path, isDir, { fileSummaries, folderSummaries, collapsedDirs }),
    [fileSummaries, folderSummaries, collapsedDirs],
  );

  return decorate;
}
