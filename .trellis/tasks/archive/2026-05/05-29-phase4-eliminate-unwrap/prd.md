# Phase 4: Eliminate unwrap()

Replace 271 `unwrap()` calls with proper `?` operator and `AppError` variants.

## Scope

Total: 271 occurrences across 80 files. Production code clusters:

| File | Count | Priority |
|------|-------|----------|
| `skill/skill_store.rs` | 89 | High |
| `skill/sync_engine.rs` | 24 | High |
| `skill/content_hash.rs` | 16 | Medium |
| `skill/migrations.rs` | 13 | Medium |
| `skill/installer.rs` | 13 | Medium |
| `skill/skill_metadata.rs` | 10 | Low |
| `file/commands.rs` | 7 | Test-only, low |
| `skill/skillssh_api.rs` | 6 | Medium |
| `skill/scanner.rs` | 6 | Medium |

Note: large amounts in `git/local.rs` (60) are almost all in `#[cfg(test)]` blocks — lower priority.

## Replacement Strategy

### Pattern 1: Result-returning functions
```rust
// Before
let x = some_fn().unwrap();
// After
let x = some_fn().map_err(|e| AppError::Skill(e.to_string()))?;
```

### Pattern 2: Option unwraps
```rust
// Before
let x = optional_value.unwrap();
// After
let x = optional_value.ok_or_else(|| AppError::NotFound("thing".into()))?;
```

### Pattern 3: Lock unwraps (Mutex/RwLock)
```rust
// Before
let x = mutex.lock().unwrap();
// After
let x = mutex.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
```

### Pattern 4: Config/default values
```rust
// Before
let path = config.get("key").unwrap();
// After
let path = config.get("key").ok_or(AppError::NotFound("config key".into()))?;
```

## Clippy Gate

Once Phase 1 Clippy config is active with `unwrap_used = "deny"`, compile errors guide remaining work.

## Execution order

1. `skill/skill_store.rs` (89, biggest)
2. `skill/sync_engine.rs` (24)
3. Remaining skill/ files prioritized by count
4. Other domains (git, file, terminal)

## Completion criteria
- [ ] Zero `unwrap()` in non-test, non-generated code
- [ ] All replacements use descriptive AppError variants
- [ ] `cargo clippy` passes with `unwrap_used = "deny"`
- [ ] `cargo test` passes
