# Research: Spec Document Updates for Phase 2

- **Query**: Update spec documents to reflect Phase 2 backend layering changes (services.rs extraction, structural reorganization)
- **Scope**: internal
- **Date**: 2026-05-30

## Files Updated

### 1. `.trellis/spec/backend/directory-structure.md` (major rewrite)

**What changed**: Entire directory layout tree, `lib.rs` example, `AppStateWrapper` example, `models/` section → "领域模型和类型", `commands/` table, "新代码应该放在哪里" table, added §services.rs pattern section, updated "示例" section.

**Key additions**:
- Accurate directory tree showing all 13 domain subdirectories (agent/, browser/, connection/, core/, file/, git/, project/, session/, settings/, skill/, task/, terminal/, theme/)
- `lib.rs` module list updated to match current code (core replacing error/logger, adding connection/file/session/settings/task, removing old flat modules)
- `AppStateWrapper` import paths fixed (e.g. `terminal::remote::RemoteTerminalManager`, `session::StorageManager`, `file::WatcherManager`)
- Models section now describes per-domain `types.rs`/`model.rs` pattern instead of central `models/` directory
- Commands table shows per-domain `commands.rs` with domain-to-file mapping
- New "services.rs 模式" section with:适用条件, 三种提取场景, 命名约定, 委派模式, 已使用领域清单, 不适用条件
- "新代码应该放在哪里" table added services.rs row and fixed all old paths

### 2. `.trellis/spec/backend/command-guidelines.md` (moderate update)

**What changed**: Command organization table replaced flat-file listing with domain-module listing (13 domains with command counts). Added "commands.rs → services.rs 委派模式" subsection with delegation patterns, code examples, and decision table for services.rs vs Manager delegation.

### 3. `.trellis/spec/backend/quality-guidelines.md` (minor update)

**What changed**: Rule #5 ("mod.rs 仅保留模块声明") updated to show services.rs alongside service.rs in examples, and notes naming convention: new code uses `services.rs` (plural), `service.rs` (singular) is legacy (theme/ only).

### 4. `.trellis/spec/guides/cross-layer-thinking-guide.md` (minor update)

**What changed**: Fixed reference to `commands/mod.rs` → `lib.rs` for the `neeko_invoke_handler!` location.

## Notable Decisions Captured

1. **services.rs is a STATELESS extraction**: Pure I/O + data transformation functions that do NOT access `AppStateWrapper` or Tauri IPC. This is the key distinction from Manager methods.

2. **Three extraction scenarios documented**: From `commands.rs` (connection), from `mod.rs` Manager (terminal), and greenfield (task).

3. **Naming convention**: `services.rs` (plural) for new code; `service.rs` (singular) is legacy from Phase 1, only retained by `theme/`; `agent/services/` is a directory module exception.

4. **Delegation table**: Decision framework for choosing between `services.rs`, Manager methods, or inline command implementation based on State/IPC dependencies.

5. **Domains left as-is**: git/, session/, project/ were already clean and were NOT refactored — their internal structure already served as the service layer.
