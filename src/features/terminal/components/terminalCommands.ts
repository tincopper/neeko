import { emit } from '@tauri-apps/api/event';

// eslint-disable-next-line import/no-restricted-paths -- terminal commands need agent API for agent config
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { safeDisposeTerminal } from '@/shared/utils/terminal';
import { terminalInputEvent } from '@/shared/utils/terminalEvents';

import { getAgent } from '../../agent/api/agentApi';
import { resizeTerminal, closeTerminalSession } from '../api/terminalApi';

import {
  terminalCache,
  terminalCacheKey,
  terminalWrapperRefs,
  terminalRebuildCallbacks,
  log,
} from './terminalCache';
import { createTerminalForProject } from './terminalFactory';

export function sendToTerminal(projectId: string, text: string, tabId?: string | null) {
  let sessionId: string | null = null;

  // When tabId is provided, build the exact cache key for precise lookup
  if (tabId) {
    const exactKey = terminalCacheKey(projectId, tabId);
    sessionId = terminalCache.get(exactKey)?.sessionId ?? null;
  }

  // Fallback: exact projectId match, then prefix match
  if (!sessionId) {
    sessionId = terminalCache.get(projectId)?.sessionId ?? null;
  }
  if (!sessionId) {
    for (const [key, c] of terminalCache.entries()) {
      if (key.startsWith(`${projectId}:`)) {
        sessionId = c.sessionId;
        break;
      }
    }
  }

  if (!sessionId) {
    log(`sendToTerminal: no session for ${projectId}${tabId ? `:${tabId}` : ''}`);
    return;
  }

  const bytes = Array.from(new TextEncoder().encode(text));
  emit(terminalInputEvent(sessionId), bytes).catch((err) => {
    log(`sendToTerminal error: ${err}`);
  });
}

/** Bracketed-paste start marker: wrapped input lands in the buffer, never executes. */
export const BRACKETED_PASTE_START = '\x1b[200~';
/** Bracketed-paste end marker. */
export const BRACKETED_PASTE_END = '\x1b[201~';

/**
 * Wrap text in bracketed-paste markers so the shell pastes it as one
 * buffer edit (multi-line stays multi-line, nothing auto-executes).
 */
export function wrapBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}

/**
 * Emit bracketed-paste bytes to an already-resolved terminal session.
 * Shares sendToTerminal's transport, never appends `\r`.
 */
export function pasteToTerminalSession(sessionId: string, text: string): void {
  const bytes = Array.from(new TextEncoder().encode(wrapBracketedPaste(text)));
  emit(terminalInputEvent(sessionId), bytes).catch((err) => {
    log(`pasteToTerminalSession error: ${err}`);
  });
}

/**
 * Paste text into the active terminal's PTY without executing it
 * (bracketed-paste wrapped). Same session lookup as sendToTerminal;
 * sendToTerminal itself is untouched (its trailing-`\r` paths stay intact).
 *
 * @returns true when a session matched and bytes were emitted, false otherwise.
 */
export function pasteToTerminal(projectId: string, text: string, tabId?: string | null): boolean {
  let sessionId: string | null = null;

  // When tabId is provided, build the exact cache key for precise lookup
  if (tabId) {
    const exactKey = terminalCacheKey(projectId, tabId);
    sessionId = terminalCache.get(exactKey)?.sessionId ?? null;
  }

  // Fallback: exact projectId match, then prefix match
  if (!sessionId) {
    sessionId = terminalCache.get(projectId)?.sessionId ?? null;
  }
  if (!sessionId) {
    for (const [key, c] of terminalCache.entries()) {
      if (key.startsWith(`${projectId}:`)) {
        sessionId = c.sessionId;
        break;
      }
    }
  }

  if (!sessionId) {
    log(`pasteToTerminal: no session for ${projectId}${tabId ? `:${tabId}` : ''}`);
    return false;
  }

  pasteToTerminalSession(sessionId, text);
  return true;
}

export function launchAgentInTerminal(projectId: string, command: string, args: string[]) {
  const cmdStr = [command, ...args].join(' ');
  sendToTerminal(projectId, '\x03');
  setTimeout(() => sendToTerminal(projectId, `${cmdStr}\r`), 50);
}

export async function switchAgentInTerminal(
  cacheKey: string,
  projectPath: string,
  projectName: string,
  agentId: string,
  fontSize: number,
  shell: string,
  fontFamily: string,
  backendProjectId: string,
  agentCommandOverrides?: Record<string, string>,
  gpuAcceleration?: boolean,
) {
  let resolvedKey = cacheKey;
  if (!terminalWrapperRefs.has(cacheKey)) {
    for (const key of terminalWrapperRefs.keys()) {
      if (key.startsWith(`${cacheKey}:`)) {
        resolvedKey = key;
        break;
      }
    }
  }

  const wrapper = terminalWrapperRefs.get(resolvedKey);
  if (!wrapper) {
    const agent = await getAgent(agentId).catch(() => null);
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
      launchAgentInTerminal(backendProjectId, cmd, agent.args);
    }
    return;
  }

  const oldCache = terminalCache.get(resolvedKey);
  if (oldCache) {
    oldCache.unlistenOutput?.();
    oldCache.unlistenClosed?.();
  }

  terminalCache.delete(resolvedKey);

  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }

  try {
    const newCache = await createTerminalForProject(
      resolvedKey,
      projectPath,
      projectName,
      agentId,
      fontSize,
      wrapper,
      shell,
      fontFamily,
      backendProjectId,
      agentCommandOverrides,
      undefined,
      undefined,
      gpuAcceleration,
    );
    requestAnimationFrame(() => {
      newCache.fitAddon.fit();
      if (newCache.sessionId) {
        // 静默豁免：高频 resize，尽力而为，失败无需上报
        resizeTerminal(newCache.sessionId, newCache.term.cols, newCache.term.rows).catch(() => {});
      }
      newCache.term.focus();
    });

    if (oldCache?.sessionId) {
      closeTerminalSession(oldCache.sessionId).catch((err) =>
        reportFrontendError('terminal.closeSession', err),
      );
    }
    if (oldCache?.term) safeDisposeTerminal(oldCache.term);
  } catch (err) {
    log(`switchAgentInTerminal: createTerminalForProject failed: ${err}`);
    terminalRebuildCallbacks.get(cacheKey)?.();
  }
}
