# Phase 2: Backend Layering

Restructure Rust backend to match spec §2 directory tree and §6 layered architecture.

## 1. Create `src-tauri/src/core/` directory

Move infrastructure files from root:
- `error.rs` → `core/error.rs`
- `logger.rs` → `core/logger.rs`
- New: `core/db.rs` (database pool initialization)
- New: `core/mod.rs` (re-export public core types)

## 2. Split Domain Modules

Each domain directory should follow the pattern:
```
<domain>/
├── mod.rs          # declare submodules with visibility control
├── model.rs        # data structures (extracted from types.rs)
├── services.rs     # pure business logic (no SQL, no Tauri context)
├── repository.rs   # persistence layer (SQL only, where applicable)
└── commands.rs     # Tauri command handlers (thin glue layer)
```

### 2.1 Rename types.rs → model.rs
Keep pure data structures (structs, enums with Serialize/Deserialize). Move business logic out.

### 2.2 Create services.rs per domain
Extract business logic from commands.rs and mod.rs into dedicated service functions.
Services must NOT: write SQL, access Tauri State directly, use #[tauri::command].

### 2.3 Create repository.rs for persistence domains
Domains with SQL/file persistence: skill, session, settings.
Repository is the ONLY place allowed to write SQL.

### 2.4 Fix mod.rs visibility
```rust
// Correct:
pub mod model;
mod repository;    // private — only this domain
mod services;      // private — only this domain
pub mod commands;  // public — exposed to Tauri
```

### 2.5 Eliminate cross-domain direct calls
Replace direct `crate::git::xxx` calls with `crate::git::services::xxx`.
Current cross-domain import web (51 instances):
- git → project + connection
- terminal → agent + connection
- project → terminal
- file → git (calls git::worker directly)
- session → terminal

## 3. Update lib.rs module declarations

After creating core/, update:
```rust
pub mod core;
```

Update all domain re-exports. Update `neeko_invoke_handler!` macro paths.

## Files to create/modify

| Path | Action |
|------|--------|
| `src-tauri/src/core/mod.rs` | New |
| `src-tauri/src/core/error.rs` | Move from root |
| `src-tauri/src/core/logger.rs` | Move from root |
| `src-tauri/src/core/db.rs` | New |
| `src-tauri/src/<domain>/model.rs` | Rename from types.rs or new |
| `src-tauri/src/<domain>/services.rs` | New per domain |
| `src-tauri/src/<domain>/repository.rs` | New for skill, session, settings |
| `src-tauri/src/<domain>/mod.rs` | Update visibility |
| `src-tauri/src/<domain>/commands.rs` | Thin down |
| `src-tauri/src/lib.rs` | Add core, update paths |

## Completion criteria
- [ ] `core/` directory with error.rs, logger.rs, db.rs, mod.rs
- [ ] All domains have model.rs + commands.rs; services.rs where logic exists
- [ ] skill/, session/, settings/ have repository.rs
- [ ] Cross-domain calls go through services:: not direct
- [ ] cargo check passes
- [ ] cargo clippy passes
