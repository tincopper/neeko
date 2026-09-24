import type { FileLineChange } from '@/shared/types/git';

import { deriveFileLineChanges } from '../utils/lineChange';

import { getFileDiff } from './gitApi';

/**
 * 拉取 + 推导一体（git 域边界 / IPC seam）：editor 只消费 `FileLineChange[]`，
 * 不接触 `DiffResult`，也不直接调 `getFileDiff`。
 *
 * 失败与陈旧响应由调用方（`useGitChangeEditor`）处理。
 */
export async function loadFileLineChanges(
  projectId: string,
  filePath: string,
  worktreePath?: string | null,
): Promise<FileLineChange[]> {
  const diff = await getFileDiff(projectId, filePath, worktreePath, false);
  return deriveFileLineChanges(diff);
}
