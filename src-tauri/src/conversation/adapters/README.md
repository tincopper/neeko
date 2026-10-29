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

### 消息内容抽取（强制复用）

`message.content` 可能是**字符串**，也可能是**块数组**（text / thinking / toolCall / tool_result …）。
不要在 adapter 里各写一遍形态判断，统一走 `adapters/content_blocks.rs`：

```rust
let content = extract_message_content(entry); // → MessageContent { text, blocks }
```

- `text`：标题（P3）、列表预览、Markdown 导出；`blocks`：前端按块渲染（思考折叠 / 工具卡片）。
- 新方言的块 `type` 别名与 tool 入参字段差异**只加在** `content_blocks::block_kind` / `tool_input`。
- `tool_result` 不并入 `text`：工具输出体量不可控（红线 4），也不该在正文里冒充用户发言。
- 图片引用（`[Image #1]`、`[[Image #1]](file://…)`）不是标题素材，由 `normalize` 层统一剥离；
  adapter 只负责提供原文。

**fixture 必须与真实磁盘格式一致**。用字符串写 `content` 夹具会让「只兼容字符串」的实现全绿，
从而掩盖真实格式缺陷（Pi 适配器曾因此把标题退化成 `pi <id8>`、正文解析成 0 条消息）。

### 视图口径（强制一致）

三个用户可见的量必须同源，否则列表徽标与正文页对不上：

| 量 | 口径 |
|----|------|
| `message_count` | 正文能看到的回合数（`CONVERSATION_ROLES` 内、文本非空） |
| `recent_messages` / 预览 | 同一集合的最近 N 条 |
| `parse_messages` | 同一集合（同一条过滤规则） |

`CONVERSATION_ROLES`（`adapters/mod.rs`）= `["user", "assistant"]`。工具结果 / 系统注入记录
（Pi 的 `toolResult`、OMP 的 `toolResult` / `developer` / `bashExecution`）**不进正文、不进预览、
不计数**：它们不是人类发言，且输出体量不可控（红线 4）。

`parse_meta.model` 取会话级模型（Pi 的 `model_change.modelId`、OMP 的 `model_change.model`，
回退首条助手消息），`ParsedMessage.model` 取消息级 `message.model`（会话中途可能切模型）。

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
