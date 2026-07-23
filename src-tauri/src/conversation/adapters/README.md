# Agent session adapters — extension checklist

History is a **read-only scan** of each CLI agent’s native storage. Neeko does not own transcripts.

## Add a new agent

1. **Implement** `AgentSessionAdapter` in `adapters/<agent_id>.rs`.
2. **Register** in `adapters/mod.rs` (`mod`, `pub use`, `all_adapters()`).
3. **Align id**: `agent_id()` must equal `AgentConfig.id` in `agent/manager.rs` `default_agents()` (covered by `registry_tests::should_align_history_adapter_ids_with_default_agents`).
4. **Icon / launch**: if the agent is launchable from Neeko, add `AgentConfig` + asset under `src/assets/agents/` and map it in `src/shared/utils/agents.ts`.

## Contract

| Method | Purpose |
|--------|---------|
| `session_root` | Absolute root to walk (or bulk root for DB) |
| `file_pattern` | Glob relative to root. Basename-only patterns (no `/`) are auto-prefixed with `**/` by `ConversationManager` so nested layouts work. |
| `parse_meta` | Fast list row; set `project_path` from real cwd when possible |
| `parse_messages` | Full detail on demand |
| `resume_command` | `Some(cli_args)` or `None` (UI hides Resume when unsupported) |
| `parse_all_metas` | Optional bulk path (e.g. SQLite multi-session) |

### Main sessions only (D3)

Filter noise **inside the adapter** (pattern + `parse_meta` bail):

- No recovery copies, event logs, indexes, ckpt dirs, subagent dumps unless product asks later.
- Intentional filters must `bail!("skip: …")` so Manager does **not** count them as parse errors.
- Prefer injectable `session_root` (or `with_root`) so nested/main filters are testable without home paths.

### Codex-specific notes

- `session_root` honors `$CODEX_HOME` when set; default `~/.codex/sessions`.
- Lazy thread titles: when rollout `session_meta` has no `title` / `thread_name`, best-effort lookup of `{codex_home}/session_index.jsonl` (`id` → `thread_name`). Missing index is non-fatal.
- Worker / subagent rollouts are skipped via `bail!("skip: …")`.

### Tests (required)

- Fixture `parse_meta` / `parse_messages`
- **Nested scan** through `ConversationManager` (not only direct parse)
- `resume_command` shape if supported

```bash
cargo test --manifest-path src-tauri/Cargo.toml adapters
```

## Do not

- Hardcode agent names in Manager or frontend list UI
- Persist full transcripts in Neeko (memory cache only)
- Unify every agent into one on-disk format
