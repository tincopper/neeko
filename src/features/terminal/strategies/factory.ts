import type { Terminal } from "@xterm/xterm";

import type { CacheEntry, TerminalStrategy } from "./types";

// =============================================================================
// StrategyOptions — environment-provided configuration
// =============================================================================

export interface StrategyOptions {
  kind: "local" | "wsl" | "remote";
  createSession: (
    cols: number,
    rows: number,
    payload?: { command?: string; configId?: string },
  ) => Promise<string>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  agentDelayMs: number;
  connectingMessage: string;
  outputFilter?: (bytes: Uint8Array) => Uint8Array;
  setupFileLinks?: (term: Terminal) => void;
  cacheKey: string;
  cache: Map<string, CacheEntry>;
  rebuildCallbacks: Map<string, () => void>;
  wrapperRefs: Map<string, HTMLDivElement>;
  fontSize: number;
  fontFamily: string;
  gpuAccel: boolean;
  onSessionReady?: () => void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Creates a `TerminalStrategy` from environment-agnostic options.
 *
 * Each call site (local / WSL / remote) is responsible for resolving its own
 * API functions, cache backend, and config constants.  This keeps the factory
 * free of store / context dependencies.
 */
export function createTerminalStrategy(options: StrategyOptions): TerminalStrategy {
  const {
    kind,
    cacheKey,
    cache,
    rebuildCallbacks,
    wrapperRefs,
    createSession,
    resize,
    closeSession,
    agentDelayMs,
    connectingMessage,
    fontSize,
    fontFamily,
    gpuAccel,
    onSessionReady,
    outputFilter,
    setupFileLinks,
  } = options;

  return {
    kind,
    cacheKey,
    cache,
    rebuildCallbacks,
    wrapperRefs,
    createSession,
    resize,
    closeSession,
    agentDelayMs,
    connectingMessage,
    fontSize,
    fontFamily,
    gpuAccel,
    onSessionReady,
    outputFilter,
    setupFileLinks,
  };
}
