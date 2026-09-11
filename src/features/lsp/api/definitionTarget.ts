import { readFileContent } from '@/features/file/api/fileApi';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { FileContent } from '@/shared/types';
import { isJdtUri } from '@/shared/utils/jdt';

import { readClassFileContents } from '../jdt/jdtUtils';

import { fromFileUri } from './languageMap';
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

// isJdtUri / jdtDisplayPath / tabLspDocumentUri 已迁 `@/shared/utils/jdt`（jdt 领域
// 行为单一所有权；本文件保留 definition 目标的内容加载策略、显示名解析与失败反馈）。

/**
 * `jdt://` 类文件 uri 的显示名：取 `?` 查询串之前路径的最后一段。
 * 例：`jdt://contents/java.base/java.lang/System.class?=p1/...` → `System.class`。
 * 解析不出段时回退为完整 uri（标题仍可辨识）。
 */
export function jdtClassFileDisplayName(uri: string): string {
  const path = uri.split('?')[0] ?? '';
  const lastSegment = path.split('/').filter(Boolean).pop();
  return lastSegment ?? uri;
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
  projectPath: string,
  languageId: string,
  uri: string,
): Promise<DefinitionTargetContent> {
  // 双键空间（键错位曾致外部/jdt 目标恒 read-failed）：
  // - 常规读取 `read_file_content` 按项目 id 解析（UUID）；
  // - 预授权门控（preauth 表）按文件系统 path 分桶（后端 record/check 一致）。
  // jdt:// 类文件目标：非文件路径，不能走常规读取（会把 uri 当路径读盘）；
  // 内容经 `java/classFileContents` 门控命令按需获取，与项目外目标同型——打开只读
  // buffer，uri 本身作为 buffer 的 path 标识。
  if (isJdtUri(uri)) {
    try {
      const content = await readClassFileContents(projectPath, languageId, uri);
      return {
        kind: 'external-readonly',
        content: {
          path: uri,
          content,
          size: new TextEncoder().encode(content).byteLength,
          is_binary: false,
        },
      };
    } catch {
      return { kind: 'unavailable', reason: 'read-failed' };
    }
  }

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
    const content = await lspReadPreauthorizedFile(projectPath, languageId, uri);
    return { kind: 'external-readonly', content };
  } catch {
    return {
      kind: 'unavailable',
      reason: isLikelyOutsideRootError(primaryError) ? 'outside-root' : 'read-failed',
    };
  }
}
