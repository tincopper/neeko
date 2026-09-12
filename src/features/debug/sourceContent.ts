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

/** 虚拟源码 tab 的身份路径（`dap-source:` 前缀，非文件系统路径）。 */
export function virtualSourceIdentity(reference: number, name?: string | null): string {
  return `dap-source:/${reference}/${name && name.trim() ? name.trim() : 'source'}`;
}

/** POSIX `/…` or Windows drive `C:\` / `C:/`. */
function isAbsoluteSourcePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Load the source at a debug stop.
 *
 * In-project files take the normal read. When that fails and the path is
 * absolute, fall back to the external read-only channel — the backend
 * authorizes it only while the session is stopped at that exact frame path, so
 * a missing `sessionId` (or a non-stop path) simply yields `failed`.
 */
export async function loadStopSourceContent(
  projectId: string,
  sourcePath: string,
  sessionId?: string,
): Promise<StopSourceContent> {
  try {
    return { kind: 'project', content: await readFileContent(projectId, sourcePath, null) };
  } catch (projectError) {
    if (!sessionId || !isAbsoluteSourcePath(sourcePath)) {
      return { kind: 'failed', error: projectError };
    }
    try {
      const content = await dapReadExternalSource(projectId, sessionId, sourcePath);
      return { kind: 'external-readonly', content };
    } catch (externalError) {
      return { kind: 'failed', error: externalError };
    }
  }
}

/**
 * Load a paused frame's virtual source via DAP `sourceReference`.
 *
 * Nothing touches the filesystem: `identity` (see {@link virtualSourceIdentity})
 * doubles as the tab path and `FileContent.path`, so the tab renders read-only
 * and never enters save / dirty flows.
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
