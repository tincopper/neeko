import { readFileContent } from '@/features/file/api/fileApi';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { FileContent } from '@/shared/types';

import { fromFileUri } from '../languageMap';

import { lspReadPreauthorizedFile } from './lspApi';

/**
 * Definition 目标文件内容加载策略。
 *
 * 项目内文件走常规读取；读取失败时统一尝试「预授权只读」通道——uri 必须出现
 * 在该会话最近的 definition 响应中（后端 preauth 表，权威判定），前端无法伪造
 * 任意路径。授权表命中与否即为项目内/外的最终裁决，不依赖错误消息匹配
 * （错误标记仅用于失败 toast 的文案推断，非判定依据）。
 */

export type DefinitionTargetContent =
  | { kind: 'project-file'; content: FileContent }
  | { kind: 'external-readonly'; content: FileContent }
  | { kind: 'unavailable'; reason: 'outside-root' | 'read-failed' };

/** 展示文案推断用：后端路径安全校验拒绝项目外路径时的错误标记（本地分支）。 */
const OUTSIDE_ROOT_MARKER = 'outside root directory';

function isLikelyOutsideRootError(err: unknown): boolean {
  return String(err).toLowerCase().includes(OUTSIDE_ROOT_MARKER);
}

/**
 * 跳转失败的用户可见反馈（此前为静默 console.error——用户看到「跳不过去且无
 * 任何反应」）。按失败原因区分文案。与加载策略同文件：失败分类新增时反馈
 * 文案同步维护。
 */
export function showNavigationFailure(reason: 'outside-root' | 'read-failed'): void {
  useNotificationStore.getState().addNotification(
    reason === 'outside-root'
      ? {
          type: 'info',
          title: 'Definition Outside Project',
          message:
            'The target file is outside the project root and has not been pre-authorized (only in-project files can be opened).',
        }
      : {
          type: 'error',
          title: 'Navigation Failed',
          message: 'Failed to read the definition target file. See logs for details.',
        },
  );
}

export async function loadDefinitionTargetContent(
  projectId: string,
  languageId: string,
  uri: string,
): Promise<DefinitionTargetContent> {
  const targetPath = fromFileUri(uri);

  let primaryError: unknown;
  try {
    const content = await readFileContent(projectId, targetPath);
    return { kind: 'project-file', content };
  } catch (err) {
    primaryError = err;
  }

  // 常规读取失败（项目外拒绝 / 远程路径问题 / 其他 IO 错误）——统一尝试
  // 预授权只读读取；后端授权表未命中（旧响应/会话重启）则归为不可用
  try {
    const content = await lspReadPreauthorizedFile(projectId, languageId, uri);
    return { kind: 'external-readonly', content };
  } catch {
    return {
      kind: 'unavailable',
      reason: isLikelyOutsideRootError(primaryError) ? 'outside-root' : 'read-failed',
    };
  }
}
