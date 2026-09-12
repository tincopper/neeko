/**
 * Store-aware entry points for opening a debug stop's source.
 *
 * Wire the live session id (external-read / virtual-source authorization) and
 * the Debug Console error sink into the store-free `navigate` module, so panels
 * share a single policy for "which session authorizes the read" and "where
 * failures surface". Kept out of `navigate.ts` because that would make it import
 * the debug store, which already imports `navigate`.
 */
import { openSourceAtLine, openVirtualSourceAtLine } from './navigate';
import { useDebugStore } from './store/debugStore';

/** Open a filesystem-backed stop source (project-internal or external read-only). */
export async function openStopSource(
  projectId: string,
  projectPath: string,
  sourcePath: string,
  line: number,
  column = 0,
): Promise<void> {
  const { session, pushConsole } = useDebugStore.getState();
  await openSourceAtLine(projectId, projectPath, sourcePath, line, column, {
    sessionId: session?.sessionId,
    onError: (message) => pushConsole('err', message),
  });
}

/** Open an adapter-owned stop source (DAP `sourceReference`, no disk path). */
export async function openStopVirtualSource(
  projectId: string,
  sourceName: string | null | undefined,
  reference: number,
  line: number,
  column = 0,
): Promise<void> {
  const { session, pushConsole } = useDebugStore.getState();
  await openVirtualSourceAtLine(projectId, sourceName, reference, line, column, {
    sessionId: session?.sessionId,
    onError: (message) => pushConsole('err', message),
  });
}
