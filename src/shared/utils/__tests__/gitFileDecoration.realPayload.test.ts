import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';

import {
  buildFileSummaryMap,
  buildFolderSummaryMap,
  resolveDecoration,
} from '../gitFileDecoration';

/**
 * 真实载荷形状回归：用 Rust 后端对真实仓库 `git status`（git2 路径）的实测输出
 * 驱动装饰管线（2026-08-28 捕获）。覆盖三类关键形状：
 * 1. 折叠 untracked 目录条目（尾斜杠，如 `.trellis/tasks/.../`）；
 * 2. 混合目录中的独立 untracked 文件（目录内同时含已跟踪文件）；
 * 3. 同目录 Modified 与 Untracked 并存 → 目录聚合按优先级 M > U 取蓝色。
 */
const REAL_CHANGED: FileChange[] = [
  {
    path: '.trellis/tasks/08-27-file-tree-git-decoration/',
    status: 'Untracked',
    additions: 0,
    deletions: 0,
  },
  { path: 'src-tauri/tests/diag_real_repo.rs', status: 'Untracked', additions: 0, deletions: 0 },
  {
    path: 'src/features/file/components/__tests__/FileTreeNodeRenderCount.test.tsx',
    status: 'Untracked',
    additions: 0,
    deletions: 0,
  },
  {
    path: 'src/features/file/components/__tests__/FilesPanel.test.tsx',
    status: 'Modified',
    additions: 10,
    deletions: 2,
  },
  {
    path: 'src/features/file/components/FilesPanel.tsx',
    status: 'Modified',
    additions: 30,
    deletions: 5,
  },
  {
    path: 'src/features/file/components/FileTreeNode.tsx',
    status: 'Modified',
    additions: 20,
    deletions: 40,
  },
  { path: 'src/shared/store/gitStore.ts', status: 'Modified', additions: 15, deletions: 3 },
  {
    path: 'src/shared/store/__tests__/gitStore.test.ts',
    status: 'Untracked',
    additions: 0,
    deletions: 0,
  },
  {
    path: 'src/shared/utils/gitFileDecoration.ts',
    status: 'Untracked',
    additions: 0,
    deletions: 0,
  },
  { path: 'src/styles/tokens/theme.css', status: 'Modified', additions: 6, deletions: 0 },
];

const TARGET = 'src/features/file/components/__tests__/FileTreeNodeRenderCount.test.tsx';

describe('gitFileDecoration real payload', () => {
  it('untracked file resolves to text-accent-brick with real backend payload', () => {
    const fileSummaries = buildFileSummaryMap(REAL_CHANGED);
    const folderSummaries = buildFolderSummaryMap(fileSummaries);

    // 混合目录中的独立 untracked 文件 → 砖红
    const fileDeco = resolveDecoration(
      TARGET,
      false,
      fileSummaries,
      folderSummaries,
      undefined,
      false,
    );
    expect(fileDeco?.color).toBe('text-accent-brick');
    expect(fileDeco?.badge).toBe('U');

    // 祖先目录链：链上存在 Modified 文件 → 聚合主导状态为 Modified（优先级 M > U）→ 蓝
    for (const dir of [
      'src',
      'src/features',
      'src/features/file',
      'src/features/file/components',
      'src/features/file/components/__tests__',
    ]) {
      const dirDeco = resolveDecoration(
        dir,
        true,
        fileSummaries,
        folderSummaries,
        undefined,
        false,
      );
      expect(dirDeco?.color).toBe('text-accent-blue');
    }

    // 纯 untracked 目录 → 砖红
    const pureDir = resolveDecoration(
      'src/shared/store/__tests__',
      true,
      fileSummaries,
      folderSummaries,
      undefined,
      false,
    );
    expect(pureDir?.color).toBe('text-accent-brick');

    // Modified 文件 → 蓝
    const modDeco = resolveDecoration(
      'src/features/file/components/FileTreeNode.tsx',
      false,
      fileSummaries,
      folderSummaries,
      undefined,
      false,
    );
    expect(modDeco?.color).toBe('text-accent-blue');
  });
});
