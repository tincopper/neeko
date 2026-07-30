# LSP Review Findings Mapping

Source: reviewer agent `LspCodeReview` completed 2026-07-30.

## Legend

- Priority 0 = Critical
- Priority 1 = Major
- Priority 2 = Minor

## 07-30-lsp-critical-stability

| # | Title | File | Lines |
|---|-------|------|-------|
| 1 | Module-level hover tracker shared across all editor instances | `src/features/lsp/hooks/lspHoverExtension.ts` | 21-26 |
| 2 | Restart backoff reads restart_count but never increments it | `src-tauri/src/lsp/manager.rs` | 464-477 |
| 3 | Synchronous lsp_notification command blocks the JS main thread during session spawn | `src-tauri/src/lsp/commands.rs` | 99-115 |
| 4 | get_or_create_session holds the sessions mutex across spawn and initialize | `src-tauri/src/lsp/manager.rs` | 327-380 |

## 07-30-lsp-robustness

| # | Title | File | Lines |
|---|-------|------|-------|
| 5 | Reader and writer OS threads are spawned with unwrap() | `src-tauri/src/lsp/session/mod.rs` | 263-275 |
| 6 | Widespread use of expect('infallible') on std::sync::Mutex locks | `src-tauri/src/lsp/manager.rs` | 54-75 |
| 8 | lsp_request auto-opens documents with local filesystem reads for all targets | `src-tauri/src/lsp/commands.rs` | 56-85 |
| 9 | close_session sends shutdown as a notification and omits the exit notification | `src-tauri/src/lsp/manager.rs` | 538-552 |
| 13 | Shared LSP store depends on feature API, creating a layering cycle | `src/shared/store/lspStore.ts` | 8-16 |

## 07-30-lsp-frontend-cleanup

| # | Title | File | Lines |
|---|-------|------|-------|
| 7 | TauriLspTransport.subscribe leaks listeners on repeated calls | `src/features/lsp/transport/tauriLspTransport.ts` | 45-88 |
| 10 | DiagnosticBus replaces dropped subscribers with no-ops but never compacts | `src-tauri/src/lsp/diag_bus.rs` | 28-45 |
| 11 | useLspCapabilities probes with a fake hover request and hard-codes capability flags | `src/features/lsp/hooks/useLspCapabilities.ts` | 35-68 |
| 12 | language_for_path builds a fresh default registry and ignores custom servers | `src-tauri/src/lsp/manager.rs` | 810-822 |
| 22 | LspHoverTooltip component appears to be dead code | `src/features/lsp/components/LspHoverTooltip.tsx` | 1-13 |

## 07-30-lsp-polish

| # | Title | File | Lines |
|---|-------|------|-------|
| 14 | Install-progress listener cleanup returns a floating promise | `src/features/status-bar/StatusBar.tsx` | 105-117 |
| 15 | DiagnosticsPanel uses array index as React key | `src/features/lsp/components/DiagnosticsPanel.tsx` | 48-52 |
| 16 | TypeScriptReact and JavaScriptReact built-ins lack root markers | `src-tauri/src/lsp/plugin/builtins/typescript_family.rs` | 15-36 |
| 17 | Built-in display name 'ts-server' disagrees with the binary name | `src/features/status-bar/LspStatusSection.tsx` | 87-91 |
| 18 | Each LSP spawn creates a dedicated OS thread and a fresh Tokio runtime | `src-tauri/src/lsp/process.rs` | 75-93 |
| 19 | stderr log timestamp is Unix seconds, not ISO-8601 | `src-tauri/src/lsp/session/mod.rs` | 580-589 |
| 20 | stderr logger hard-codes every captured line to level 'warn' | `src-tauri/src/lsp/session/mod.rs` | 290-296 |
| 21 | Global install lock serializes installs across unrelated languages | `src-tauri/src/lsp/installer.rs` | 17-24 |
| 23 | Definition cache maps are unbounded | `src/features/lsp/hooks/lspCache.ts` | 15-18 |
