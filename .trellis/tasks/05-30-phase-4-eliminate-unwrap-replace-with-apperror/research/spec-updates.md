# Research: Spec Updates for Phase 4 (unwrap elimination)

- **Query**: Identify spec files needing updates to reflect Phase 4 unwrap elimination changes
- **Scope**: internal (spec docs + Cargo.toml + git diff)
- **Date**: 2026-05-30

## Findings

### Phase 4 Changes Summary

- **55** `unwrap()` calls removed from production code across **8 files**
- **2 new patterns introduced** that are not currently documented in any spec
- **0 production unwrap warnings** remain (`cargo clippy` is clean for production code)
- Test code NOT modified — unwrap still allowed in `#[cfg(test)]` blocks

### Files Modified (production code only)

| File | unwrap removed | Replacement Pattern |
|---|---|---|
| `src-tauri/src/skill/repository.rs` | ~39 | `.map_err(\|e\| anyhow::anyhow!("Database lock poisoned: {}", e))?` |
| `src-tauri/src/git/cache.rs` | ~7 | `.map_err()` (GIT_PREVIEWS) + `.expect("infallible: ...")` (LRU cache) |
| `src-tauri/src/skill/skill_store.rs` | 1 | `.expect("infallible: database lock should not be poisoned")` |
| `src-tauri/src/browser/uri_scheme.rs` | 1 | `.expect("infallible: static response builder should not fail")` |
| `src-tauri/src/skill/installer.rs` | 3 | `.expect("infallible: ...")` + `.ok_or_else(\|\| ...)` + `.context("...")` |
| `src-tauri/src/terminal/remote.rs` | 2 | `.map_err(std::io::Error::other)` |
| `src-tauri/src/project/commands_ide.rs` | 1 | `.map_err(\|e\| anyhow::anyhow!("..."))?` |
| `src-tauri/src/task/services.rs` | 1 | `.map_err(...)?` |

### Replacement Pattern Distribution

| Pattern | Count | Usage |
|---|---|---|
| `.map_err(\|e\| anyhow::anyhow!("{} lock poisoned: {}", area, e))?` | ~43 | Mutex lock poisoning → anyhow::Error propagation |
| `.expect("infallible: ...")` | 7 | Logically infallible operations (LRU cache locks, database lock, static builder, prompt dedup) |
| `.context("...")` | 2 | Regex capture group extraction errors |
| `.map_err(std::io::Error::other)` | 2 | IO error wrapping |
| `.ok_or_else(\|\| ...)` | 1 | Iterator `next()` where `None` is a business error |

### Key Decision: `.expect("infallible: ...")` Convention

A new convention emerged: **`.expect("infallible: <description>")`** for Mutex locks that are guaranteed to never be poisoned in practice (e.g., a code-level invariant ensures no thread holds the lock across a panic boundary). The message always starts with `"infallible: "` to make the intent explicit.

This is distinct from the existing convention (still used in `state.project_manager.lock().unwrap()` in concurrency-guidelines.md) where `.unwrap()` on Mutex is considered acceptable because poisoning is a fatal error. The `.expect("infallible: ...")` form is more descriptive but semantically equivalent.

### Spec Documents Identified for Update

#### 1. `quality-guidelines.md` — NEEDS UPDATE

**Issue A**: The lint level table (line 286) shows `unwrap_used = "deny"` as an example of `"deny"` level. This is misleading — `unwrap_used` is actually `"warn"` in `Cargo.toml` (line 51). A better example: `cast_possible_truncation = "deny"`.

**Issue B**: The `Cargo.toml` comment on line 50 says `# --- 正确性（Phase 4 会将 unwrap_used 升级为 deny）---`. This comment is now stale — Phase 4 is complete but the decision is to keep `unwrap_used = "warn"` (because clippy can't distinguish test vs production code, and test code legitimately uses unwrap). **Note: this Cargo.toml comment is outside spec scope — the main agent should update it separately.**

**Issue C**: The "禁止模式" section (line 130-143) documents `.unwrap()` on I/O as forbidden and Mutex `.unwrap()` as the exception. This is correct but should also mention that `".expect("infallible: ...")` is the preferred form for Mutex locks in new code, while `.unwrap()` remains acceptable for legacy code.

**Suggested updates**:
1. Fix the example in the lint level table: change `unwrap_used = "deny"` to `cast_possible_truncation = "deny"`
2. Add a subsection documenting the Phase 4 patterns (`.expect("infallible:")`, `.map_err()` for lock poisoning, `.ok_or_else()` for iterators)
3. Add a note that `unwrap_used = "warn"` is intentionally kept as `warn` (not deny) because test code still uses unwrap, and clippy cannot distinguish test from production code

#### 2. `error-handling.md` — NEEDS UPDATE

**Issue A**: Section "错误创建模式" (lines 100-130) documents `.bail!()`, `.context()`, `.map_err(AppError::from)`, `.ok_or_else()`. It does NOT document the `.expect("infallible: ...")` pattern.

**Issue B**: Section "Mutex 锁处理" (lines 133-148) correctly allows `.unwrap()` on Mutex locks but doesn't mention the `.expect("infallible: ...")` alternative or the `.map_err(|e| anyhow::anyhow!("..."))?` pattern for propagating lock errors.

**Issue C**: Section "常见错误", item 2 (lines 202-213) is about I/O unwrap — still correct.

**Suggested updates**:
1. Add `.expect("infallible: ...")` to "错误创建模式" section as a new pattern for logically infallible operations
2. Expand "Mutex 锁处理" to document the two styles:
   - `.unwrap()` – acceptable for legacy code, Manager-level state locks (fatal on poison)
   - `.expect("infallible: ...")` – preferred for new code where lock is guaranteed not poisoned
   - `.map_err(|e| anyhow::anyhow!("..."))?` – when the caller should handle/recover from lock poisoning

#### 3. `concurrency-guidelines.md` — NEEDS MINOR UPDATE

**Issue A**: Code examples (lines 59-61, 84) show `.lock().unwrap()` as the only pattern. Should mention that new code may use `.expect("infallible: ...")` for better documentation.

**Issue B**: The "常见错误" section (lines 238-278) is still correct — `.lock().unwrap()` is still the expected pattern in threading contexts. The new `repository.rs` patterns show lock usage in a non-threaded SQL context where `.map_err()` propagation makes more sense.

**Suggested updates**:
1. Add a note in the "Mutex" section that `.expect("infallible: ...")` is a valid alternative when the lock is guaranteed unpoisoned
2. Add a note that `.map_err(|e| anyhow!("..."))?` is used when lock poisoning should propagate as an error

#### 4. `backend/index.md` — NO UPDATE NEEDED

This is just an index. No content about unwrap or error patterns.

#### 5. `backend/type-safety.md` — NO UPDATE NEEDED

No unwrap-related content.

### Cargo.toml Comment (outside spec scope)

```
Line 50: # --- 正确性（Phase 4 会将 unwrap_used 升级为 deny）---
```

This comment is stale. Phase 4 is done. The decision is to keep `unwrap_used = "warn"`. The main agent should update this comment to reflect the current state.

### Key Design Decision to Document

**Why `unwrap_used` stays `"warn"` instead of being upgraded to `"deny"`:**

- Test code (`#[cfg(test)]` blocks) frequently uses `.unwrap()` for brevity (e.g., `assert_eq!(result.unwrap(), expected)`)
- Clippy applies `unwrap_used` uniformly — it cannot distinguish production code from test code within the same file
- Upgrading to `"deny"` would require either:
  - Adding `#[allow(clippy::unwrap_used)]` to every test function (noisy)
  - Disabling the lint for entire files with `#![allow()]` (too broad)
- Solution: keep `"warn"`, ensure production code has 0 warnings (verified by `cargo clippy`), and use `#[cfg(test)]` gating to naturally scope unwrap to tests

## Caveats / Not Found

- The Cargo.toml comment on line 50 is stale but is NOT a spec file — the main agent should update it separately
- No other spec files (frontend, unit-test, security, guides) mention unwrap or error-handling patterns relevant to Phase 4
- The git diff shows only production code files were modified; no test files were touched
