# Research: Spec Updates for Cross-Domain Rust Cleanup

- **Query**: Determine which spec files need updating after moving AI commit logic to `core/services/` and `GitStatusWorker` to `core/watcher.rs`
- **Scope**: Internal — codebase mapping audit
- **Date**: 2026-05-31

## Files Analyzed

| File | Purpose |
|------|---------|
| `src-tauri/src/core/mod.rs` | Now declares `services` and `watcher` modules |
| `src-tauri/src/core/services/mod.rs` | New — declares `commit` submodule |
| `src-tauri/src/core/services/commit.rs` | New — AI commit logic moved here (502 lines) |
| `src-tauri/src/core/watcher.rs` | New — `GitStatusWorker` logic moved here (386 lines) |
| `src-tauri/src/agent/mod.rs` | No longer declares `commands_commit` — only `commands`, `manager`, `model`, `services`, `types` |
| `src-tauri/src/agent/services/commit.rs` | Now re-exports `pub use crate::core::services::commit::*;` (1 line) |
| `src-tauri/src/agent/commands.rs` | Agent CRUD commands only — no commit-related commands |
| `src-tauri/src/git/commands.rs` | Now contains `generate_commit_message` Tauri command calling `core::services::commit` |
| `src-tauri/src/git/worker.rs` | Now re-exports `pub use crate::core::watcher::*;` (1 line) |
| `src-tauri/src/git/mod.rs` | Declares `worker` and uses `pub use worker::*;` |
| `src-tauri/src/lib.rs` | `neeko_invoke_handler!` — `generate_commit_message` registered via `git::commands`, no `agent::commands_commit` reference |
| `src-tauri/src/agent/commands_commit.rs` | **Deleted** — no longer exists |
| `.trellis/spec/backend/directory-structure.md` | Spec file to evaluate for updates |
| `.trellis/spec/backend/quality-guidelines.md` | Spec file to evaluate for updates |
| `docs/neeko-development-spec.md` | Spec file to evaluate for updates |

## Findings

### 1. `directory-structure.md` — Needs Updates (3 sections)

#### a) `core/` directory layout (line 35-39)
Current listing:
```
core/                 # 核心基础设施
  ├── mod.rs
  ├── error.rs          # AppError
  ├── logger.rs         # 自定义文件日志
  └── db.rs             # SQLite 数据库
```
Missing `services/` subdirectory and `watcher.rs`. Should add:
```
core/
  ├── mod.rs
  ├── error.rs
  ├── logger.rs
  ├── db.rs
  ├── services/         # 纯业务逻辑（无 State 依赖）
  │   ├── mod.rs
  │   └── commit.rs     # AI commit message 生成逻辑
  └── watcher.rs        # GitStatusWorker —— 常驻 git status 监听
```

#### b) `agent/` directory listing (line 40-49)
Current listing includes `commands_commit.rs` (line 44):
```
agent/
  ├── mod.rs
  ├── commands.rs
  ├── commands_commit.rs     ← needs REMOVAL
  ├── manager.rs
  ├── model.rs
  ├── types.rs
  └── services/
      ├── mod.rs
      └── commit.rs
```
Should remove `commands_commit.rs` (file no longer exists).

#### c) Services table (line 286-294) — `agent/services/` entry
Current (lines 263-264 in the services naming section):
```
agent/services/ 是目录模块（mod.rs + commit.rs）—— 这是 services 作为目录的例外，仅 agent 域使用
```
This is now outdated — `core/services/` is also a directory module. Should be updated to:
```
agent/services/ 和 core/services/ 是目录模块（mod.rs + commit.rs）—— services 作为目录用于承载复杂子模块
```

#### d) Command registration table (line 213)
Current:
```
agent/ | commands.rs + commands_commit.rs | Agent CRUD、commit message 生成
```
Should be updated — `commands_commit.rs` no longer exists. The `generate_commit_message` command is registered via `git/commands.rs`. Update to:
```
agent/ | commands.rs | Agent CRUD
git/ | commands.rs | ... (already has ~40 commands, now includes generate_commit_message)
```

#### e) New services table (line 286-294) — add `core/services/`
Current table lists `agent/services/` but not `core/services/`. Should add a new row:
```
| core/services/ | 新建 | AI commit message 生成逻辑（从 agent/services/commit.rs 迁移） | Phase A |
```

### 2. `quality-guidelines.md` — No Changes Needed

- Cross-domain dependency rules haven't changed — they were simply enforced by moving shared infrastructure to `core/`
- The `services.rs`/`services/` pattern is already documented in `directory-structure.md`
- No new lint rules, naming conventions, or prohibited patterns were introduced
- The `#[allow(dead_code)]` pattern (for RAII fields) is unchanged — `GitStatusWorker`'s `signal_tx` follows this pattern (held for drop semantics), but it's already covered

### 3. `neeko-development-spec.md` §8 — No Changes Needed

- §8 documents the **frontend** domain map (`features/` and `app/` directories), not the Rust backend structure
- The Rust backend changes (moving code to `core/`) don't affect the frontend domain mapping
- No update needed

### 4. Cross-Domain References — Clean

Verified zero remaining cross-domain references:
- `src-tauri/src/git/` — no `use crate::agent` or `crate::git::worker` imports
- `src-tauri/src/git/worker.rs` — now just `pub use crate::core::watcher::*;`
- `src-tauri/src/agent/services/commit.rs` — now just `pub use crate::core::services::commit::*;`
- `neeko_invoke_handler!` — `generate_commit_message` registered as `$crate::git::commands::generate_commit_message` (line 134), no `commands_commit` reference
- `agent/commands_commit.rs` — confirmed deleted (glob returned no matches)

### 5. Re-export Backward Compatibility

Two re-export stubs maintain backward compatibility for any external callers:
- `agent/services/commit.rs` → `pub use crate::core::services::commit::*;`
- `git/worker.rs` → `pub use crate::core::watcher::*;`

Both `git/mod.rs` and `agent/mod.rs` still declare their respective re-export modules, so `crate::agent::services::commit::generate_commit_message()` and `crate::git::worker::GitStatusWorker` continue to resolve through the re-export chain.

## Summary of Required Spec Updates

| Spec File | Changes Needed |
|-----------|---------------|
| `.trellis/spec/backend/directory-structure.md` | **Yes** — update `core/` listing, remove `commands_commit.rs` from `agent/` listing, add `core/services/` to services table, update commands table, update services naming exception note |
| `.trellis/spec/backend/quality-guidelines.md` | **No** — no rule changes |
| `docs/neeko-development-spec.md` | **No** — §8 is frontend-only, unaffected |
