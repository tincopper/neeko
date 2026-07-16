# C4 Design: Terminal Strategy & Cache Merge

## Goal

Replace three parallel terminal strategies (local/wsl/remote) with a single configuration-driven strategy factory. Merge three cache backends into one.

## Design

### Strategy Factory

```typescript
// strategies/factory.ts
export function createTerminalStrategy(
  environment: ProjectEnvironment,
  options: StrategyOptions,
): TerminalStrategy
```

Where `StrategyOptions` provides the environment-specific config:

```typescript
interface StrategyOptions {
  createSession: (cols: number, rows: number, payload?: SessionPayload) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  resizeSession: (sessionId: string, cols: number, rows: number) => Promise<void>;
  agentDelayMs: number;
  connectingMessage: string;
  outputFilter?: (bytes: Uint8Array) => Uint8Array;
  cachePrefix: string;
  cacheKeyFactory: (...parts: string[]) => string;
}
```

Each environment provides its own `createSession` impl but the rest of the strategy (Terminal creation, event wiring, agent launch, resize observer, cleanup) is shared.

### Unified Cache

```typescript
// components/terminalCache.ts — already has createTerminalCacheBackend()
// Change: single export TerminalCacheManager class
class TerminalCacheManager {
  private backends: Map<string, ReturnType<typeof createTerminalCacheBackend>>;
  getBackend(prefix: string) { ... }
  destroyAll() { ... }
}
```

Actually, simpler: keep `createTerminalCacheBackend()` but export a single set of Maps with prefixed keys. The current design already does this — just need to consolidate the exports. 

**Key insight:** The current `terminalCache.ts` already uses a shared factory `createTerminalCacheBackend()`. The triple-export is an API split, not a logic split. We can:
1. Export a single `terminalCacheManager` with methods `get(key)`, `set(key, value)`, `destroy(key)`, etc.
2. Keep prefixed key strategy (e.g., `local:${projectId}`, `wsl:${distro}:${projectId}`, `remote:${entryId}:${projectId}`)
3. Export helper functions `launchAgent(key, cmd, args)` and `switchAgent(key, ...)` that work for all types

### Single TerminalView

```typescript
interface TerminalViewProps {
  paneId: string;
  environment: ProjectEnvironment;
  // Connection-specific overrides (for Remote)
  remoteConfig?: {
    entryId: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
  };
}
```

`EditorGroupPane.tsx` — remove inline IIFE 3-way check. Use a single `<TerminalView>` with `activeProject.environment`.

### Launch/Switch Agent

Consolidate:
- `launchAgentInTerminal` (local only)
- `launchAgentInWslTerminal`
- `launchAgentInRemoteTerminal`
→ single `launchAgentInTerminal(cacheKey, command, args, prefix?)`

- `switchAgentInTerminal` (local)
- `switchAgentInWslTerminal`
- `switchAgentInRemoteTerminal`
→ single `switchAgentInTerminal(cacheKey, ...)`
