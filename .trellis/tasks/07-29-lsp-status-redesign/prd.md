# LSP Status Menu Redesign

## Requirements

Redesign the status-bar LSP server display in `src/features/status-bar/StatusBar.tsx` to match the VS Code/Cursor-style menu shown in the reference image.

### Current State (as of 2026-07-29, post `60310141`)

- Chip already shows status dot + server name / `N LSPs` + chevron (no `detected` / `installed` text suffix)
- Detected-but-not-running: grey muted dot + server name, **not interactive**
- Running servers open a **flat** portal dropdown with per-row inline Restart / Stop
- No project header, no nested submenu, no Restart All / Stop All
- No version / commit / memory footer, no View Logs
- Session events omit server name / metadata; stderr only goes to Rust logs

### Target State

1. **Status bar chip**:
   - **Single server**: status dot + server name + chevron
   - **Multiple servers**: status dot + **LSP icon** (no count text on chip); hover tooltip shows `N LSPs`
   - No `detected` / `installed` text suffixes
2. **Main dropdown**:
   - Header row showing the active project name (`neeko` in reference)
   - Per-server row with status dot, server name, and right chevron
   - Separator
   - `Restart All Servers`
   - `Stop All Servers`
3. **Per-server submenu** (opens to the right of a server row):
   - `View Logs`
   - `Restart Server`
   - `Stop Server`
   - Bottom status bar: `{status} — {version} ({commit} {date}) — {memory}`
4. **View Logs**: reuses the existing bottom **Console** panel (not a new panel). Opens/focuses a Console tab for that LSP server and streams/polls its logs there.
5. **Backend support**: expose version, commit hash, build date, memory usage, and log history per LSP session.

### Locked Decisions (2026-07-29)

| Topic | Decision |
|-------|----------|
| View Logs destination | Reuse existing Console panel (`TaskConsolePanel`) |
| Version / commit / date source | Parse `--version` at server spawn and cache |
| Memory refresh | Fetch once when the per-server submenu opens (no continuous poll in v1) |
| Multi-server chip | LSP icon on chip; hover tooltip shows `N LSPs` |
| Detected-only chip | Stay non-interactive in v1 |

### Acceptance Criteria

1. Single-server chip: `dot + server name + chevron`. Multi-server chip: `dot + LSP icon + chevron`, with hover tooltip `N LSPs`.
2. The main dropdown follows the layout described in Target State (2).
3. Each running server row is hoverable/clickable and opens a submenu with actions described in Target State (3).
4. `Restart All Servers` stops and restarts every active session for the current project.
5. `Stop All Servers` stops every active session for the current project.
6. `View Logs` opens the existing Console panel, focuses (or creates) a tab for the selected LSP server, and shows that server's log history (poll refresh while the tab is active is acceptable for v1).
7. The submenu footer displays `version`, `commit`, `build date`, and `memory` returned by the backend for the selected session (memory snapshot at submenu open).
8. The new UI does not regress existing behavior: sessions still filter out `stopped`, status dots still reflect `ready/error/indexing/starting`.
9. Error status color uses the existing theme token (`status-failed` / equivalent), not a broken `status-error` class.
10. Frontend and backend changes pass `pnpm lint:fe`, `pnpm type-check`, and `cargo test`.
11. Tests cover: aggregated restart/stop handlers, submenu rendering, Console open/focus for View Logs, and backend info command serialization.

### Constraints

- Reuse existing status-bar dropdown positioning logic (`createPortal`, `dropdownStyle`).
- Reuse existing LSP commands (`lspRestartSession`, `lspStopSession`) where possible.
- Reuse Console panel UI; extend session model only as needed for non-task log tabs.
- No new dependencies; use existing icons / Tailwind utilities (prefer `ServerIcon` / shared icons for the multi-server chip).
- Keep English strings (no i18n framework).
- Backend changes live in `src-tauri/src/lsp/`.

## References

- Reference image: `image-b5fe086112435137.png`
- Affected frontend file: `src/features/status-bar/StatusBar.tsx`
- Affected backend module: `src-tauri/src/lsp/`
- Related API file: `src/features/lsp/api/lspApi.ts`
- Related store: `src/shared/store/lspStore.ts`
