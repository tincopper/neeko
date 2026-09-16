/**
 * 源引用 → 打开请求（**纯函数层**，零 store 读取、零 tab 操作，可 100% 单测）。
 *
 * 把三种来源翻译成同一种「打开请求」：DAP 帧、源码路径（fs / jdt）、适配器虚拟引用。
 * 只回答「要打开什么、内容从哪来」，不回答「要不要跳转」——后者是 `navigate.ts` 的职责，
 * tab 生命周期是 `sourceTab.ts` 的职责。
 *
 * 身份与内容来源分离：
 * - `identity` 是**规范 tab 身份**（tab / 断点 key / 黄线共用同一套归一）；
 * - `load` 决定内容通道（项目内读 / 会话门控的外部只读 / 适配器 `source` 请求）。
 */
import { fileRefFromTabPath, sourceIdentityOf } from '@/shared/utils/fileRef';
import { getFileName } from '@/shared/utils/fileTree';

import {
  loadStopSourceContent,
  loadVirtualSourceContent,
  type StopSourceContent,
} from './sourceContent';
import { virtualSourceIdentity } from './stackFrames';
import type { StackFrameDto } from './types';

/** 打开请求：身份 + 标题 + 内容加载器。 */
export interface SourceOpenRequest {
  identity: string;
  tabTitle: string;
  load: () => Promise<StopSourceContent>;
}

/**
 * fs / jdt 源引用 → 打开请求。
 *
 * `loadPath` 是交给内容通道的**源引用**：jdt 身份由后端翻译成真实文件（缓存命中或从
 * `src.zip` / 依赖 `-sources.jar` 落盘），而 JDK 解压缓存路径本身就是磁盘上的真文件，
 * 故 fs 形态直接用 canonical 路径。
 */
export function fsSourceOpen(
  projectRoot: string,
  projectId: string,
  sourcePath: string,
  sessionId?: string,
): SourceOpenRequest {
  const ref = fileRefFromTabPath(projectRoot, sourcePath);
  const identity = sourceIdentityOf(projectRoot, sourcePath);
  const loadPath = ref.kind === 'fs' ? ref.path : identity;
  return {
    identity,
    tabTitle: getFileName(identity),
    load: () => loadStopSourceContent(projectId, loadPath, sessionId),
  };
}

/**
 * 适配器虚拟源码（DAP `sourceReference`）→ 打开请求；无会话或非正引用返回 null。
 *
 * 没有磁盘路径：tab 身份即合成身份 `dap-source:/<ref>/<name>`，内容经 DAP `source` 请求取。
 */
export function virtualSourceOpen(
  sourceName: string | null | undefined,
  reference: number,
  sessionId?: string,
): SourceOpenRequest | null {
  if (!sessionId || reference <= 0) return null;
  const identity = virtualSourceIdentity(reference, sourceName);
  return {
    identity,
    tabTitle: sourceName?.trim() || getFileName(identity),
    load: () => loadVirtualSourceContent(sessionId, identity, reference),
  };
}

/** 栈帧 → 打开请求（物理源码优先，其次适配器虚拟源码；两者皆无返回 null）。 */
export function frameSourceOpen(
  frame: StackFrameDto,
  projectRoot: string,
  projectId: string,
  sessionId?: string,
): SourceOpenRequest | null {
  if (frame.sourcePath) {
    return fsSourceOpen(projectRoot, projectId, frame.sourcePath, sessionId);
  }
  return virtualSourceOpen(frame.sourceName, frame.sourceReference ?? 0, sessionId);
}
