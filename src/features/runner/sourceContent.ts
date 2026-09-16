/**
 * Source acquisition for a debug stop — the DAP feature's single content boundary.
 *
 * Three channels, each with its own authorization:
 * 1. in-project read (the common case);
 * 2. session-gated external read-only (third-party / stdlib frames outside the
 *    project root; the backend authorizes it only while stopped at that frame);
 * 3. adapter-owned virtual source (DAP `sourceReference`, nothing on disk).
 *
 * Returning a discriminated union keeps UI concerns (tabs, console reporting)
 * out of this module — the tab / navigation layer decides what to do with the
 * result, so a further channel is added here alone.
 */
import { readFileContent } from '@/features/file/api/fileApi';
import type { FileContent } from '@/shared/types';

import { dapReadExternalSource, dapSourceContent } from './api/debugApi';

export type StopSourceContent =
  | { kind: 'project'; content: FileContent }
  | { kind: 'external-readonly'; content: FileContent }
  /** 适配器侧虚拟源码（`sourceReference`）：字节由 adapter 持有，不落盘。 */
  | { kind: 'virtual'; content: FileContent }
  | { kind: 'failed'; error: unknown };

/** POSIX `/…` or Windows drive `C:\` / `C:/`. */
function isAbsoluteSourcePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * `jdt:` 源码引用（规范身份 `jdt:/…` 或原始 uri `jdt://…`）。
 *
 * 它**不是**文件路径：项目内读取对它必然失败（后端 canonicalize 认不出），而拼根又会
 * 得到不存在的路径。适配器侧的真实文件由 Rust 在 DAP 边界翻译（缓存命中或从
 * `src.zip` / `-sources.jar` 落盘），所以一律走会话门控的外部通道。
 */
function isJdtSourceRef(p: string): boolean {
  return p.startsWith('jdt:');
}

/** 会话门控的只读外部读取（授权凭据 = 调试器正停在该源码上）。 */
async function readExternal(
  projectId: string,
  sessionId: string,
  sourcePath: string,
): Promise<StopSourceContent> {
  try {
    const content = await dapReadExternalSource(projectId, sessionId, sourcePath);
    return { kind: 'external-readonly', content };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

/**
 * Load the source at a debug stop.
 *
 * In-project files take the normal read. When that fails and the path is
 * absolute, fall back to the external read-only channel — the backend
 * authorizes it only while the session is stopped at that exact frame source, so
 * a missing `sessionId` (or a non-stop path) simply yields `failed`.
 */
export async function loadStopSourceContent(
  projectId: string,
  sourcePath: string,
  sessionId?: string,
): Promise<StopSourceContent> {
  // jdt 引用不是项目内文件：直接走外部通道，不做注定失败的往返。
  if (isJdtSourceRef(sourcePath)) {
    return sessionId
      ? readExternal(projectId, sessionId, sourcePath)
      : {
          kind: 'failed',
          error: new Error('a live debug session is required to read this source'),
        };
  }
  try {
    return { kind: 'project', content: await readFileContent(projectId, sourcePath, null) };
  } catch (projectError) {
    if (!sessionId || !isAbsoluteSourcePath(sourcePath)) {
      return { kind: 'failed', error: projectError };
    }
    return readExternal(projectId, sessionId, sourcePath);
  }
}

/**
 * Load a paused frame's virtual source via DAP `sourceReference`.
 *
 * Nothing touches the filesystem: `identity` (built by `virtualSourceIdentity` in
 * `./stackFrames`) doubles as the tab path and `FileContent.path`, so the tab renders
 * read-only and never enters save / dirty flows.
 */
export async function loadVirtualSourceContent(
  sessionId: string,
  identity: string,
  reference: number,
): Promise<StopSourceContent> {
  try {
    const content = await dapSourceContent(sessionId, reference);
    return {
      kind: 'virtual',
      content: {
        path: identity,
        content,
        size: new TextEncoder().encode(content).byteLength,
        is_binary: false,
      },
    };
  } catch (error) {
    return { kind: 'failed', error };
  }
}
