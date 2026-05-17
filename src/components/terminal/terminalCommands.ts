import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AgentConfig } from "../../types";
import {
  terminalCache,
  terminalCacheKey,
  terminalWrapperRefs,
  terminalRebuildCallbacks,
  log,
} from "./terminalCache";
import { createTerminalForProject } from "./terminalFactory";

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
  emit(`terminal-input-${sessionId}`, bytes).catch((err) => {
    log(`sendToTerminal error: ${err}`);
  });
}

export function launchAgentInTerminal(
  projectId: string,
  command: string,
  args: string[],
) {
  const cmdStr = [command, ...args].join(" ");
  sendToTerminal(projectId, "\x03");
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
    const agent = await invoke<AgentConfig>("get_agent", { agentId }).catch(
      () => null,
    );
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
        invoke("resize_terminal", {
          sessionId: newCache.sessionId,
          cols: newCache.term.cols,
          rows: newCache.term.rows,
        }).catch(() => {});
      }
      newCache.term.focus();
    });

    if (oldCache?.sessionId) {
      invoke("close_terminal_session", { sessionId: oldCache.sessionId }).catch(
        () => {},
      );
    }
    oldCache?.term.dispose();
  } catch (err) {
    log(`switchAgentInTerminal: createTerminalForProject failed: ${err}`);
    terminalRebuildCallbacks.get(cacheKey)?.();
  }
}
