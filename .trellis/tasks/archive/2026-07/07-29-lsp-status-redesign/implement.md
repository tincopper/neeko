# LSP Status Menu Redesign — Implementation Plan

## Scope

Frontend status-bar LSP menu redesign + backend metadata/logs/batch commands.
No code changes until this plan is reviewed and open decisions are confirmed.

## Ordered Checklist

### Phase A — Backend contracts

1. Add `LspServerInfo` / `LspServerLogEntry` types in `src-tauri/src/lsp/`.
2. Implement `lsp_get_server_info` (version/commit/date/memory).
3. Implement `lsp_get_server_logs` (recent ring buffer).
4. Implement `lsp_restart_all_sessions` / `lsp_stop_all_sessions`.
5. Populate version metadata at session start (`--version` parse preferred).
6. Memory via process RSS on demand (submenu open).
7. Unit tests for serialization + batch restart/stop.

### Phase B — Frontend API / store

1. Extend `src/features/lsp/api/lspApi.ts` with new wrappers/types.
2. Cache version metadata in `lspStore.serverInfoMap` (memory refreshed on submenu open).
3. Wire handlers for Restart All / Stop All.

### Phase C — Console reuse for View Logs

1. Extend Console session model with `source: 'task' | 'lsp'` (see `design.md` §7).
2. Add `openLspLogConsole(...)` on task store (or thin adapter).
3. `TaskConsolePanel`: hide Stop for LSP tabs; keep close-tab behavior without killing LSP process.
4. While active tab is LSP: poll `lspGetServerLogs` every 2s and update `output`.
5. View Logs action: close menus → open Console → focus/create tab → initial fetch.

### Phase D — Status bar UI

1. Extract or restructure LSP section in `StatusBar.tsx` per design component tree.
2. Status chip:
   - 1 server: dot + name + chevron
   - N servers: dot + `ServerIcon` + chevron; `title`/`tooltip` = `N LSPs`
3. Main dropdown: project header, server rows with right chevron, Restart All / Stop All.
4. Submenu portal: View Logs / Restart / Stop + info footer (fetch info on open).
5. Outside-click / Escape closes both menus.
6. Fix error color class to `status-failed` (or registered token).
7. Keep existing portal positioning patterns.

### Phase E — Validation

1. `pnpm type-check`
2. `pnpm lint:fe`
3. `cargo test --manifest-path src-tauri/Cargo.toml`
4. Manual: single server, multi server (icon + hover), detected-only, error/indexing dots, View Logs → Console tab.

## Validation Commands

```bash
pnpm type-check
pnpm lint:fe
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:run
```

## Review Gates

- [x] Product decisions locked (`design.md` §9)
- [ ] Prototype accepted (`prototype.html`) — multi-server icon + Console note
- [ ] Backend command names/types match frontend API
- [ ] Console LSP tabs do not stop LSP on close
- [ ] No regression on stopped-session filtering / status dots

## Rollback Points

1. After backend-only commands: frontend ignores unused commands.
2. After API wrappers: UI still uses old flat menu.
3. After UI swap: revert StatusBar LSP section if needed.

## Prototype

- Interactive HTML mock: `prototype.html` (open in browser)
- ASCII wireframes: `design.md` §1
