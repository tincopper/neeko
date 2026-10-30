# opencode v2 存储兼容（v1 保留）

## Goal

opencode 升级到 v2 之后，Neeko 的 Conversations 面板对 opencode 只显示到升级前的历史。本任务让
adapter 能读 v2 的存储（`session_v2` + `session_message`），**同时保留 v1（`session`/`message`/`part`）
读取路径**：同一个 DB 按「哪套表有数据」判定，v1 用户行为一字不变。

## Background（一手实测，2026-10-30）

`~/.local/share/opencode/opencode.db`（4.5GB，WAL 模式）里同时存在两套表：

| 表 | 会话数 | 最新 `time_updated` |
| --- | --- | --- |
| `session` + `message` + `part`（v1） | 672 | **2026-10-23 11:08** |
| `session_v2` + `session_message`（v2） | 746 | **2026-10-30 12:23** |

- 升级时 v2 把旧数据**复制**进新表（666/672 重合），之后只写新表 ⇒ 旧表是快照。
- 按项目看最刺眼：`/…/neeko` 目录 v1 157 条（最新 **09-28**）vs v2 200 条（最新 **10-30**）
  —— 43 条最近会话只在 v2 里。其它目录两边完全一致（都是升级前没人再动的探针会话）。
- 交叉验证 Neeko 自己的冷启动索引 `~/.neeko/conversation-index.json`（当日 18:30 扫的）：
  opencode 184 条，最新 **2026-09-28** ⇒ 面板显示的就是 5 周前的最后一批。
- 6 条 v1-only 的会话（`ses_e9c3a8dd…` 等）v2 自己的 `opencode session list` **也不列**
  ⇒ v2 表是权威，旧表留下的是孤儿。

v2 的消息模型（`session_message`，`type` 列 + `data` JSON）：

| `type` | `data` 形状 | 是否算对话回合 |
| --- | --- | --- |
| `user` | `{text, time.created, files?, agents?, metadata?}`（`text` 平铺） | 是（`text` 非空） |
| `assistant` | `{content:[{type:text\|reasoning\|tool}], model{id,providerID,variant}, time.created}` | 是（`content` 非空） |
| `system` / `synthetic` / `compaction` / `idle` / `model-switched` / `agent-switched` / `location-switched` | 各自的元数据 | 否 |

content 项：`text{text}`、`reasoning{text}`、`tool{id, name, state}`
，`state` 为 `{status:'completed', input, content:[{type:'text'|'file',…}]}` 或
`{status:'error', input, error, metadata}`（实测计数：tool 34353 / reasoning 19113 / text 9355，
状态只有 completed 33894 / error 459）。

## Requirements

### R1 双存储，按 DB 判定（不是按版本号）

- R1.1 新增 `Store::{V1, V2}` 判定：`session_v2` 与 `session_message` 都存在**且有数据** → V2；
  否则 V1（v1 用户、以及 v2 迁移还没跑完的中间态都不会被隐藏）。
- R1.2 判定与读取都发生在 adapter 内，registry / manager / 前端**零改动**（红线 10：不写
  `agent_id ==` 分支）。
- R1.3 同一个 DB 只走一条路径，不混读（混读会把孤儿会话和权威会话混进同一个列表）。

### R2 v2 读取语义与 v1 对齐

- R2.1 只取 `parent_id IS NULL AND time_archived IS NULL`（子会话 / 归档不列）。
- R2.2 角色白名单 `user` / `assistant`；`system`/`synthetic`/`compaction`/`idle`/`*-switched`
  一律不进列表、不进预览、不计数（与既有 `CONVERSATION_ROLES` 口径一致）。
- R2.3 `message_count` 与 `parse_messages().len()` **必须相等**（`conversation-adapter.md` §4.6.3），
  两侧用同一个判据：user ⇒ `text` 非空；assistant ⇒ `content` 非空。
- R2.4 预览只取**文本**（user 的 `text`、assistant 的 `content[].type=="text"`），
  工具输出与 thinking 不进预览（工具输出体量不可控，红线 4）。
- R2.5 内容块映射：`text`→`Text`、`reasoning`→`Thinking`、`tool`→`ToolUse` +（completed
  ⇒ `ToolResult(content=state.content[].text 拼接)`；error ⇒ `ToolResult(content=state.error,
  is_error=true)`），与 v1 的 `tool` part 映射保持同一形状（前端按 callId 配对的既有管线不变）。
- R2.6 `title` 在 v2 可空（实测 7/746）⇒ 走既有「首条用户消息」兜底。
- R2.7 单会话 meta（`parse_meta`）的计数也用 R2.3 同一判据（v2 侧自洽；v1 侧保持原样不动）。

### R3 新鲜度：SQLite 的 WAL 不能被指纹忽略

- R3.1 `opencode.db` 处于 WAL 模式，新提交先在 `-wal` 里，主文件在 checkpoint 前**不变**；
  而 `scan_cache` 的指纹只看主文件（len+mtime）⇒ 扫描会命中旧快照，新会话在 checkpoints 前
  不可见。指纹必须把 SQLite 侧文件纳入（`source_signature_with_sidecars`）。

### R4 删除与恢复不变

- R4.1 删除仍为 `Native`：`opencode session delete <id>`（v2 的 CLI 删 v2 行 + 级联子会话）。
  改读 v2 之后，「CLI 删的就是 Neeko 列的那一条」才真正成立（此前 legacy 行无人清理，
  删除后该行会回到列表）。
- R4.2 `resume_command` / `extract_session_id` / 合成路径 `<dbPath>#<sessionId>` 不变。

## Constraints

- 红线 3/4/10 照旧；不新增依赖（`rusqlite` 已有）。
- **v1 逻辑保持不变**：允许抽公共 open/签名辅助函数，但 v1 的 SQL、过滤、映射、预览、计数口径不改变行为。
- TDD：v2 的纯函数（块映射、可见性判据、store 判定）与 SQL 行为都用 tempdir 里的真 SQLite 夹具
  （红线 13），先红后绿；关键判据做变异验证。

## Acceptance Criteria

- [ ] AC1 真机 DB 上，opencode 列表条数与最新时间从「最新 09-28」变为「最新 10-30、200 条」量级
      （以 `/…/neeko` 目录为准；人工核对）。
- [ ] AC2 对每个夹具会话断言 `meta.message_count == parse_messages().len()`（v2 与 v1 各一条）。
- [ ] AC3 v2 夹具：子会话 / 归档 / `system`+`compaction` 等噪声行都不出现在列表与正文。
- [ ] AC4 v2 夹具：assistant 的 `reasoning`→Thinking、`tool` completed→ToolUse+ToolResult 成对、
      error→`is_error=true`，且工具输出不进预览。
- [ ] AC5 判定：`session_v2` 有数据 → V2；只有 v1 表 → V1；`session_v2` 空表 + v1 有数据 → V1。
- [ ] AC6 WAL：只写 `-wal` 时指纹变化（缓存不再复用旧快照）。
- [ ] AC7 既有 v1 用例全绿且未改断言；`cargo test --lib conversation` / clippy / fmt / `pnpm check:quick` 绿。

## Out of Scope

- `session`/`message`/`part` 旧表清理（属 opencode 自己的迁移事务）。
- v2 的 `session_inbox` / `session_pending` / `event` 表。
- 工具输出的长度上界收紧（v1/v2 现状一致，另开任务）。
