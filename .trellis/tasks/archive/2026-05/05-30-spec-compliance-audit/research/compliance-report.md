# Research: Spec Compliance Audit

- **Query**: Analyze the current project against `docs/neeko-development-spec.md` and report compliance gaps
- **Scope**: Mixed (internal code audit + config comparison against spec)
- **Date**: 2026-05-30

## Summary of Findings

| # | Gap | Severity | Category |
|---|---|---|---|
| 1 | `unwrap_used` is `"warn"` in Cargo.toml, spec says `"deny"` | **P0** | Clippy Config Drift |
| 2 | lib.rs `#![deny(...)]` missing `clippy::unwrap_used`, `rust_2018_idioms`, `missing_docs` vs spec | **P0** | Clippy Config Drift |
| 3 | No backend domain for `editor` feature (1:1 symmetry violated) | **P0** | Domain Alignment |
| 4 | `theme` feature frontend missing `index.ts`, `components/`, `stores/`, `types/` — only has `api/` | **P1** | Frontend Structure |
| 5 | `editor` feature frontend has no `api/` directory — cannot call backend | **P1** | Frontend Structure |
| 6 | No `routes/` directory exists at `src/` level | **P1** | Directory Tree |
| 7 | No `stores/` directory exists at `src/` level (spec §2 lists it) | **P1** | Directory Tree |
| 8 | No `components/` directory exists at `src/` level (spec §2 lists it) | **P1** | Directory Tree |
| 9 | No `utils/` directory exists at `src/` level (spec §2 lists it) | **P1** | Directory Tree |
| 10 | Cross-domain: `git/commands.rs` directly calls `agent::services::commit` and `agent::commands_commit` | **P1** | Cross-Domain Violation |
| 11 | Cross-domain: `file/watcher.rs` imports from `crate::git::worker` | **P1** | Cross-Domain Violation |
| 12 | Cross-domain: `project/mod.rs` imports from `crate::git` (reasonable, but bypasses service layer) | **P2** | Cross-Domain Violation |
| 13 | `import/no-cycle` set to `"warn"`, spec says `"error"` | **P1** | ESLint Config Drift |
| 14 | `import/order` set to `"warn"`, spec says `"error"` | **P1** | ESLint Config Drift |
| 15 | File naming violations: 10 kebab-case `.tsx` files (should be PascalCase per config) | **P2** | Naming Convention |
| 16 | Directory naming violations: `useActiveProject` and `DockLayout` are not kebab-case | **P2** | Naming Convention |
| 17 | Many `mod.rs` declare `services` as `pub mod` instead of private `mod` per spec §4.4 visibility | **P2** | Module Visibility |
| 18 | Many `mod.rs` use `pub use ...::*` wildcard re-exports, violating `wildcard_imports = "deny"` | **P2** | Clippy / Visibility |
| 19 | `core/db.rs` is a stub — only `pub struct DbConfig;` with comment "will contain ... once extracted" | **P2** | Infrastructure |
| 20 | Direct `invoke()` calls in `terminalCache.ts`, `TerminalViewBase.tsx`, `useRemoteActions.ts` outside `api/` dirs | **P1** | Data Flow Violation |
| 21 | Feature `session` has no `store.ts` / `stores/` directory | **P2** | Frontend Structure |
| 22 | Feature `settings` has no `store.ts` / `stores/` directory | **P2** | Frontend Structure |
| 23 | Feature `theme` completely lacks `index.ts`, `components/`, `stores/`, `types/` | **P1** | Frontend Structure |
| 24 | `git/mod.rs` uses `pub use local::*` / `pub use types::*` — wildcard re-exports | **P2** | Clippy / Visibility |
| 25 | ESLint zones reference `./src/features/editor` but editor has no api/ dir (it's a pure frontend feature) | **P2** | ESLint Zone Accuracy |
| 26 | `agent/services/mod.rs` declares `pub mod commit;` — services should be private per spec | **P2** | Module Visibility |
| 27 | Rust domains lacking `model.rs`: browser, file, settings, task, theme | **P2** | Backend Structure |
| 28 | Rust domains lacking `services.rs` in domains that have business logic: agent, git, project, session, skill | **P2** | Backend Structure |
| 29 | Rust domains lacking `repository.rs` in most domains (only skill has one) | **P3** | Backend Structure |
| 30 | No CI step combines `cargo clippy` + `eslint` into one unified lint command (spec §4.5) | **P3** | CI Integration |

---

## Detailed Findings

### §1 Global Design Philosophy

#### §1.1 Domain Alignment — 1:1 Naming Symmetry

**Status: P0 — VIOLATED**

| Frontend Feature | Backend Domain | Match? |
|---|---|---|
| `src/features/agent` | `src-tauri/src/agent/` | ✅ |
| `src/features/browser` | `src-tauri/src/browser/` | ✅ |
| `src/features/connection` | `src-tauri/src/connection/` | ✅ |
| `src/features/editor` | ❌ NO BACKEND DOMAIN | **P0 GAP** |
| `src/features/file` | `src-tauri/src/file/` | ✅ |
| `src/features/git` | `src-tauri/src/git/` | ✅ |
| `src/features/project` | `src-tauri/src/project/` | ✅ |
| `src/features/session` | `src-tauri/src/session/` | ✅ |
| `src/features/settings` | `src-tauri/src/settings/` | ✅ |
| `src/features/skill` | `src-tauri/src/skill/` | ✅ |
| `src/features/task` | `src-tauri/src/task/` | ✅ |
| `src/features/terminal` | `src-tauri/src/terminal/` | ✅ |
| `src/features/theme` | `src-tauri/src/theme/` | ✅ |

The `editor` feature exists only on the frontend side with no corresponding `src-tauri/src/editor/` backend. This is a fundamental violation of the 1:1 domain alignment rule.

#### §1.3 Unidirectional Flow

**Status: P1 — VIOLATED**

The `src/features/terminal/components/terminalCache.ts`, `TerminalViewBase.tsx`, and `src/features/connection/hooks/useRemoteActions.ts` use direct `invoke()` calls from `@tauri-apps/api/core` instead of going through their feature's `api/` wrapper:

- `src/features/terminal/components/terminalCache.ts:1` — `import { invoke } from "@tauri-apps/api/core"`
- `src/features/terminal/components/TerminalViewBase.tsx:7` — `import { invoke } from "@tauri-apps/api/core"`
- `src/features/connection/hooks/useRemoteActions.ts:4` — `import { invoke } from "@tauri-apps/api/core"`

Note: The ESLint `no-restricted-imports` rule is set to `"warn"` so these pass CI. They should either be `"error"` or the pattern should be fixed.

#### §1.4 Unidirectional Codebase

**Status: P2 — VIOLATED**

Cross-domain references at the Rust level:

1. `src-tauri/src/git/commands.rs:812` — `use crate::agent::services::commit as ai_svc;` and `use crate::agent::commands_commit as ai_commit;` — the `git` domain directly calls into `agent` domain internals. This should go through a public service interface if cross-domain is needed, or be extracted into a shared module.

2. `src-tauri/src/file/watcher.rs:1` — `use crate::git::worker::{GitStatusDiff, GitStatusWorker};` — the `file` domain imports from `git` domain internals.

3. `src-tauri/src/project/mod.rs:8` — `use crate::git;` — project imports git directly (less severe as it's at the mod.rs level for `ProjectManager`).

---

### §2 Directory Tree

#### Backend Structure

**Status: P2 — PARTIALLY COMPLIANT**

Per spec, each domain should follow `mod.rs + commands.rs + model.rs + services.rs + repository.rs + core/` pattern.

Domain file matrix:

| Domain | mod.rs | commands.rs | model.rs | services.rs | repository.rs |
|---|---|---|---|---|---|
| agent | ✅ | ✅ + `commands_commit.rs` | ✅ | `services/` dir | ❌ |
| browser | ✅ | ✅ | ❌ | ❌ | ❌ |
| connection | ✅ | ✅ | ✅ | ✅ | ❌ |
| file | ✅ | ✅ | ❌ | ✅ | ❌ |
| git | ✅ | ✅ + multiple sub-modules | ✅ | ❌ | ❌ |
| project | ✅ | ✅ + `commands_ide.rs` | ✅ | ❌ | ❌ |
| session | ✅ | ✅ | ✅ | ❌ | ❌ |
| settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| skill | ✅ | ✅ + many sub-modules | ✅ | ❌ | ✅ |
| task | ✅ | ✅ | ❌ | ✅ | ❌ |
| terminal | ✅ | ✅ | ✅ | ✅ | ❌ |
| theme | ✅ | ✅ | ❌ | ❌ | ❌ |

**Key gaps:**
- 6/12 domains missing `model.rs`
- 8/12 domains missing `services.rs`
- 11/12 domains missing `repository.rs`
- `core/db.rs` is a stub with `pub struct DbConfig;` and a doc comment saying it will be implemented later

#### Frontend Structure

**Status: P1 — VIOLATED**

Top-level `src/` directory comparison with spec §2:

| Spec Entry | Exists? | Notes |
|---|---|---|
| `app/` | ✅ | ✅ Correct |
| `assets/` | ✅ | ✅ Correct |
| `components/` | ❌ | Missing — spec lists as "全局通用基础 UI 组件" |
| `config/` | ❌ | Missing — spec lists as "全局静态配置" |
| `features/` | ✅ | ✅ Correct |
| `lib/` | ✅ | ✅ Correct |
| `routes/` | ❌ | **Missing** — spec requires routes directory for HashRouter/MemoryRouter |
| `stores/` | ❌ | Missing — spec lists as "全局状态管理" |
| `layout/` | ✅ | ✅ Correct |
| `types/` | ✅ | ✅ Correct |
| `utils/` | ❌ | Missing — spec requires utils for "全局通用工具函数" |
| `App.tsx` | → `app/App.tsx` | ✅ (moved under app/) |
| `main.tsx` | → `app/main.tsx` | ✅ (moved under app/) |

Additional directories not in spec: `shared/`, `styles/`, `testing/`, `ui/`. These may be valid project-specific additions but represent directory tree drift.

#### Feature Subdirectory Completeness

Per spec §2, each feature should have: `api/`, `components/`, `stores/`, `types/`, `index.ts`.

| Feature | api/ | components/ | stores/ | types/ | index.ts |
|---|---|---|---|---|---|
| agent | ✅ | ✅ | ❌ | ✅ | ✅ |
| browser | ✅ | ✅ | ✅ | ✅ | ✅ |
| connection | ✅ | ✅ | ✅ | ✅ | ✅ |
| editor | ❌ | ✅ | ✅ | ✅ | ✅ |
| file | ✅ | ✅ | ✅ | ✅ | ✅ |
| git | ✅ | ✅ | ✅ | ✅ | ✅ |
| project | ✅ | ✅ | ✅ | ✅ | ✅ |
| session | ✅ | ❌ | ❌ | ✅ | ✅ |
| settings | ✅ | ✅ | ❌ | ✅ | ✅ |
| skill | ✅ | ✅ | ✅ | ✅ | ✅ |
| task | ✅ | ✅ | ✅ | ✅ | ✅ |
| terminal | ✅ | ✅ | ❌ | ✅ | ✅ |
| theme | ✅ | ❌ | ❌ | ❌ | ❌ |

**Critical gaps:**
- `editor`: missing `api/` — no IPC communication possible
- `theme`: missing `index.ts`, `components/`, `stores/`, `types/` — only has `api/`
- `session`: missing `components/`, `stores/`
- `settings`: missing `stores/`
- `terminal`: missing `stores/`
- `agent`: missing `stores/`

---

### §3 ESLint Config

#### §3.2 Config Comparison

| Rule | Spec | Actual | Status |
|---|---|---|---|
| `import/no-restricted-paths` | Error | Error | ✅ |
| `import/no-cycle` | Error | **Warn** | ❌ P1 — weakens architecture enforcement |
| `import/order` | Error | **Warn** | ❌ P1 — weakens import organization enforcement |
| `check-file/filename-naming-convention` | Error for .ts/.tsx | **Warn** | ❌ P2 |
| `check-file/folder-naming-convention` | Error | Error | ✅ |
| `no-restricted-imports` for `@tauri-apps/api/core` | Should be Error | **Warn** | ❌ P1 — direct invoke bypasses data flow |

#### Zone Coverage

SLint zones in the config cover 13 features including `editor`. However:
- `editor` zone exists but editor has no `api/` directory, so the zone is technically valid but misleading
- `theme` zone is missing from the zones list entirely (it's not listed in any `except: []` array) — this means theme is isolated from cross-feature imports, which is correct but it's not explicitly listed as a target

Checking `theme` zone:
```js
// No target for './src/features/theme' exists — the ESLint zones don't list theme at all
```
This is a P2 gap.

#### Naming Convention Violations (ESLint `check-file`)

**kebab-case `.tsx` files (should be PascalCase):**

| File | Expected | Actual |
|---|---|---|
| `src/shared/contexts/app-context.tsx` | `AppContext.tsx` | `app-context.tsx` |
| `src/shared/contexts/sidebar-context.tsx` | `SidebarContext.tsx` | `sidebar-context.tsx` |
| `src/ui/context-menu.tsx` | `ContextMenu.tsx` | `context-menu.tsx` |
| `src/ui/dropdown-menu.tsx` | `DropdownMenu.tsx` | `dropdown-menu.tsx` |
| `src/ui/resizable-panel.tsx` | `ResizablePanel.tsx` | `resizable-panel.tsx` |
| `src/ui/scroll-area.tsx` | `ScrollArea.tsx` | `scroll-area.tsx` |
| `src/ui/toggle-group.tsx` | `ToggleGroup.tsx` | `toggle-group.tsx` |
| `src/features/editor/file-actions-context.tsx` | `FileActionsContext.tsx` | `file-actions-context.tsx` |
| `src/features/connection/contexts/remote-context.tsx` | `RemoteContext.tsx` | `remote-context.tsx` |
| `src/features/connection/contexts/wsl-context.tsx` | `WslContext.tsx` | `wsl-context.tsx` |

**Directory naming violations (should be kebab-case):**

| Directory | Expected | Actual |
|---|---|---|
| `src/features/project/hooks/useActiveProject/` | `use-active-project/` | `useActiveProject/` |
| `src/layout/DockLayout/` | `dock-layout/` | `DockLayout/` |

---

### §4 Rust Clippy

#### §4.2 Cargo.toml [lints.clippy] Comparison

| Lint | Spec | Actual | Status |
|---|---|---|---|
| `unwrap_used` | `"deny"` | **`"warn"`** | ❌ **P0** — Spec mandates deny, currently warn |
| `expect_used` | `"warn"` | `"warn"` | ✅ |
| `cast_possible_truncation` | `"deny"` | `"deny"` | ✅ |
| `cast_sign_loss` | `"deny"` | `"deny"` | ✅ |
| `cast_possible_wrap` | `"deny"` | `"deny"` | ✅ |
| `wildcard_imports` | `"deny"` | `"deny"` | ✅ |
| `module_inception` | `"deny"` | `"deny"` | ✅ |
| `needless_pass_by_ref_mut` | `"deny"` | `"deny"` | ✅ |
| `missing_docs` | `"warn"` | `"warn"` (in `[lints.rust]`) | ✅ |

Note: The spec places `missing_docs` under `[lints.clippy]`, but the project correctly places it under `[lints.rust]` since `missing_docs` is a `rustc` lint, not a `clippy` one. This is actually **more correct** than the spec.

#### §4.3 lib.rs `#![deny(...)]` Comparison

| Deny Entry | Spec | Actual | Status |
|---|---|---|---|
| `clippy::unwrap_used` | ✅ | ❌ **Missing** | **P0** |
| `clippy::dbg_macro` | ✅ | ✅ | ✅ |
| `clippy::todo` | ✅ | ✅ | ✅ |
| `clippy::print_stdout` | ✅ | ✅ | ✅ |
| `clippy::wildcard_imports` | ✅ | ✅ | ✅ |
| `rust_2018_idioms` | ✅ | ❌ **Missing** | P2 |
| `unused_must_use` | ✅ | ✅ | ✅ |
| `missing_docs` | ✅ | ❌ **Missing** | P2 |

#### §4.4 Module Visibility

Per spec §4.4:
- `services.rs` → `pub(crate)` (via `mod services;` — private)
- `repository.rs` → `pub(crate)` (via `mod repository;` — private)
- `commands.rs` → `pub` (via `pub mod commands;`)
- `model.rs` → `pub` (via `pub mod model;`)

**Violations found:**

| Domain | services visibility | Should be | Status |
|---|---|---|---|
| `agent/services/` | `pub mod` | `mod` (private) | P2 |
| `connection/` | `pub mod` | `mod` (private) | P2 |
| `terminal/` | `pub mod` | `mod` (private) | P2 |
| `file/` | `pub mod` | `mod` (private) | P2 |
| `task/` | `pub mod` | `mod` (private) | P2 |
| `theme/service` | `pub mod` | `mod` (private) | P2 |

Only `skill` correctly uses `mod repository;` (private). Only `git` correctly uses `mod local;` and `mod wsl;` (private) — but then re-exports them via `pub use` wildcard which defeats the purpose.

#### Wildcard Re-exports (`pub use ...::*`)

Despite `wildcard_imports = "deny"`, many `mod.rs` files use `pub use ...::*`:

- `src-tauri/src/browser/mod.rs`: `pub use commands::*; pub use uri_scheme::*;`
- `src-tauri/src/connection/mod.rs`: `pub use commands::*; pub use types::*;`
- `src-tauri/src/file/mod.rs`: `pub use commands::*; pub use watcher::{...};`
- `src-tauri/src/git/mod.rs`: `pub use local::*; pub use parsers::*; pub use pr::*; pub use remote::*; pub use types::*; pub use worker::*; pub use wsl::*;`
- `src-tauri/src/project/mod.rs`: `pub use commands_ide::*;`
- `src-tauri/src/session/mod.rs`: `pub use commands::*;`
- `src-tauri/src/settings/mod.rs`: `pub use commands::*;`
- `src-tauri/src/task/mod.rs`: `pub use services::*;`

Note: clippy's `wildcard_imports` lint typically only targets `use foo::*` import statements, not `pub use foo::*` re-exports. The spec's intent is still violated since these re-exports bypass module encapsulation.

---

### §5 Data Flow

#### §5.1 Cross-Domain Rust Calls

**Status: P1 — VIOLATED**

1. **`git/commands.rs` → `agent::services::commit`** (line 812)
   - The `git` domain directly calls into `agent` domain's internal services for AI commit message generation
   - This should go through a formal cross-domain service interface or extract the common logic into a shared module
   - File: `src-tauri/src/git/commands.rs`

2. **`file/watcher.rs` → `crate::git::worker`** (line 1)
   - The `file` domain directly imports `GitStatusDiff` and `GitStatusWorker` from the git domain
   - This couples watcher implementation to git internals
   - File: `src-tauri/src/file/watcher.rs`

3. **`project/mod.rs` → `crate::git` and `crate::terminal::types`** (lines 8-11)
   - `ProjectManager` calls `git::is_git_repo()` and uses `TerminalSession` type
   - Less severe since these are well-defined public functions/types, but spec says to use services layer

#### §5.2 Direct `invoke()` Outside API Files

**Status: P1 — VIOLATED**

Files that import `invoke` from `@tauri-apps/api/core` outside their feature's `api/` directory:

| File | Line | Import/Usage |
|---|---|---|
| `src/features/terminal/components/terminalCache.ts` | 1 | `import { invoke } from "@tauri-apps/api/core"` |
| `src/features/terminal/components/TerminalViewBase.tsx` | 7 | `import { invoke } from "@tauri-apps/api/core"` |
| `src/features/connection/hooks/useRemoteActions.ts` | 4 | `import { invoke } from "@tauri-apps/api/core"` |

Per spec §6.3, IPC calls should only happen in `api/` wrapper files. The ESLint `no-restricted-imports` rule is set to `"warn"` so it doesn't enforce this as an error.

---

### §7 Hard Rules

#### §7.1 Cross-Domain Isolation

Covered in §5.1 above.

#### §7.2 Barrel Files

- All features with `index.ts` use barrel exports ✅
- ESLint zones enforce barrel-import-only across features ✅

#### §7.3 Error Bubbling

- `AppError` in `core/error.rs` has `From` implementations for `io::Error`, `anyhow::Error`, `serde_json::Error`, `rusqlite::Error`, `PoisonError`, `String`, `tauri::Error`, `&str` ✅
- `AppError` implements `Serialize` ✅
- Most commands return `Result<_, AppError>` ✅
- However, some commands still use `anyhow::Result` (e.g., `project/mod.rs` line 13: `use anyhow::Result`) — this bypasses the `AppError` wrapper chain ⚠️ P2

#### §7.4 No BrowserRouter

- No `react-router-dom` dependency found ✅ (entirely avoids the issue)
- No `BrowserRouter` usage ✅
- Router not used at all — app is effectively single-page with no URL routing ⚠️ P3 (acceptable for desktop app but differs from spec expectation of HashRouter/MemoryRouter)

#### §7.5 Naming Conventions

Rust side uses `snake_case` for functions/variables ✅

Frontend naming violations documented in §3 section above.

---

## Caveats

- The `unwrap_used = "warn"` vs `"deny"` gap may be intentional (spec says "production unwrap 已消除，warn 保留给测试代码") — the inline comment in `Cargo.toml` explains this, but spec should be updated to match reality or lint should be changed
- The `missing_docs` lint is correctly placed under `[lints.rust]` rather than `[lints.clippy]` as the spec shows — this is actually a correction to the spec, not a violation
- Some `services` modules being `pub` may be intentional because other crate-internal domains need access (e.g., `agent/services` is called by `git/commands.rs`), but this bypasses the spec's architecture
- The `editor` feature may be a pure frontend feature that doesn't need backend commands — but then the 1:1 domain alignment spec is violated either way
- The `src/shared/` directory partially replaces the spec's `components/`, `hooks/`, `utils/` directories listed under `src/` level
- The `pnpm lint` script already includes `cargo clippy` and `eslint src/` which is good, but doesn't include `cargo fmt --check` as a separate step (it's included in the same chain)

