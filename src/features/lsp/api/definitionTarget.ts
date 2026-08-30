import { readFileContent } from '@/features/file/api/fileApi';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { FileContent } from '@/shared/types';

import { fromFileUri } from '../languageMap';

import { lspReadPreauthorizedFile } from './lspApi';

/**
 * Definition 目标文件内容加载策略。
 *
 * 项目内文件走常规读取；项目外文件（monorepo 依赖、系统源码等）被后端路径
 * 安全校验拒绝，改走「预授权只读」通道——uri 必须出现在该会话最近的
 * definition 响应中（后端 preauth 表），前端无法伪造任意路径。
 * 两条路径都失败时返回结构化原因，由调用方决定用户反馈文案。
 */

export type DefinitionTargetContent =
  | { kind: 'project-file'; content: FileContent }
  | { kind: 'external-readonly'; content: FileContent }
  | { kind: 'unavailable'; reason: 'outside-root' | 'read-failed' };

/** 后端路径安全校验拒绝项目外路径时的错误标记（read/write 两个分支的公共子串）。 */
const OUTSIDE_ROOT_MARKER = 'outside root directory';

function isOutsideRootError(err: unknown): boolean {
  return String(err).toLowerCase().includes(OUTSIDE_ROOT_MARKER);
}

/**
 * 跳转失败的用户可见反馈（此前为静默 console.error——用户看到「跳不过去且无
 * 任何反应」）。按 loadDefinitionTargetContent 的失败原因区分文案。
 * 与加载策略同文件：失败分类新增时反馈文案同步维护。
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

  try {
    const content = await readFileContent(projectId, targetPath);
    return { kind: 'project-file', content };
  } catch (err) {
    if (!isOutsideRootError(err)) {
      return { kind: 'unavailable', reason: 'read-failed' };
    }
  }

  // 项目外：尝试预授权只读读取
  try {
    const content = await lspReadPreauthorizedFile(projectId, languageId, uri);
    return { kind: 'external-readonly', content };
  } catch {
    return { kind: 'unavailable', reason: 'outside-root' };
  }
}
