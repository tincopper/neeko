# Fix OpenCode History Session Loading

## Background

OpenCode 历史会话从未在 Neeko 界面中展示过。根本原因是 `OpenCodeAdapter` 的实现存在多处问题。

### Root Cause

| # | 问题 | 严重程度 | 说明 |
|---|---|---|---|
| 1 | 数据库路径错误 | 阻塞 | `dirs::data_dir()` 在 macOS 上返回 `~/Library/Application Support`，但 OpenCode 三平台统一用 `~/.local/share/opencode/`（xdg-basedir 无平台分支） |
| 2 | 表名/列名错误 | 阻塞 | 代码用 `sessions`/`messages`/`createdAt`/`updatedAt`/`projectPath`，实际是 `session`/`message`/`time_created`/`time_updated`/`directory` |
| 3 | 架构不匹配 | 阻塞 | `role` 在 `message.data` JSON 中，`content` 在关联 `part` 表中，不是扁平列 |
| 4 | LIMIT 1 限制 | 阻塞 | Trait 是 1 file → 1 session，OpenCode 是 N sessions → 1 file |
| 5 | 错误静默吞掉 | 次要 | `ScanReport.errors` 前端从不检查 |

### Orca 参考方案

[Orca](https://github.com/anomalyco/opencode) 已实现 OpenCode 会话加载（`session-scanner-opencode-sqlite.ts`），核心模式：
1. **合成路径机制**：`<dbPath>#<sessionId>` 将 SQLite 会话编码为"文件路径"，通过现有解析管线路由
2. **Schema 探测**：`PRAGMA table_info` + 动态列选择，兼容不同 OpenCode 版本
3. **只读打开**：`readonly: true` + `PRAGMA query_only = ON`
4. **去重**：SQLite 优先于 Legacy JSON 文件

本任务参考 Orca 方案，基于 Neeko 现有 Rust 架构实现。

## Requirements

### R1: 正确发现 OpenCode 数据库

- 数据库路径：`~/.local/share/opencode/`（三平台统一）
- 支持 `OPENCODE_CONFIG_DIR` 环境变量覆盖
- 匹配 `opencode*.db`（含 `opencode-work.db` 等多数据库场景）
- 只读打开：`rusqlite::Connection::open_with_flags` + `PRAGMA query_only = ON`

### R2: 列出所有有效会话

- 从 `session` 表查询，过滤条件：
  - `parent_id IS NULL`（排除子会话）
  - `time_archived IS NULL`（排除归档会话）
- 按 `time_updated DESC` 排序
- 返回全部（或可配置上限）

### R3: 正确解析会话元数据 （每会话一个 ParsedMeta）

**标题优先级**：
1. `session.title`
2. 首条用户消息的 `summary.title`（从 `message.data` JSON 提取）
3. 首条用户消息的 `summary.body`
4. 兜底：`"OpenCode <sessionId[:8]>"`

**模型提取**：`session.model` JSON → `$.id` | `$.modelID` | null

**项目路径**：`session.directory`

**消息计数**：子查询 `SELECT COUNT(*) FROM message m WHERE m.session_id = s.id AND json_extract(m.data, '$.role') IN ('user','assistant')`

**预览消息**（最近 5 条文本块）：
```sql
SELECT json_extract(m.data, '$.role') AS role,
       p.data AS part_data,
       p.time_created
FROM message m
JOIN part p ON p.message_id = m.id
WHERE m.session_id = ?
  AND json_extract(m.data, '$.role') IN ('user','assistant')
  AND json_extract(p.data, '$.type') = 'text'
ORDER BY p.time_created DESC
LIMIT 5
```
反向迭代（最旧优先入环形缓冲区）。

### R4: 正确解析完整消息

- 从 `message` 表查询指定 `session_id` 的会话
- `role` 从 `data` JSON 的 `$.role` 提取
- 内容从关联的 `part` 表 `data` JSON 的 `$.text` 拼接
- 支持消息级的 `model`（`message.data.model.$id`）
- `blocks` 解析：`part.data.type` 为 `tool_use`/`tool_result` 时生成对应 `MessageBlock`

### R5: 适配器架构兼容

- 不破坏现有其他适配器（Claude Code、Codex 等）
- 现有 `AgentSessionAdapter::parse_meta(&self, file_path)` 保留

### R6: 恢复命令

- 输出：`["--session", "<sessionId>"]`

## Non-Goals

- 不支持 Legacy JSON 文件格式（旧版 OpenCode）—— 如有需要后续任务
- 不支持跨数据库去重 —— 当前 OpenCode 单 DB 场景无此需求
- 不修改其他适配器
- 不修改前端错误显示（ScanReport.errors 改进为后续任务）

## Acceptance Criteria

1. `cargo test` 全部通过
2. `cargo check --manifest-path src-tauri/Cargo.toml` 无错误
3. `pnpm type-check` 无错误
4. `pnpm lint` 无新增 error
5. 扫描后 `ScanReport.sessions_found > 0`（本地 OpenCode DB 存在时）
6. 历史列表正确显示 OpenCode 会话标题、模型、预览
7. 点击会话可查看完整消息内容
8. 按 project filter 时 OpenCode 会话出现在对应项目下
