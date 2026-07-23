# Design: 可扩展多 Agent 历史会话（L0–L3）

## 1. Goals & Non-goals

**Goals**
- 扫描契约对嵌套布局正确、可测、可观测
- 扩展路径 = 适配器插件；Manager/UI 保持 agent-agnostic
- 交付 Codex/Pi 修复 + OMP/Grok/Reasonix 适配器 + Grok launch
- 列表仅主会话（D3）

**Non-goals**
- L4 统一 AgentCapability 运行时注册表
- 重写 UI、持久化 Neeko 侧会话库
- recovery/subagent 展示

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (agent-agnostic)                                   │
│  ConversationPanel → scan/list/messages/resume              │
│  Resume 按钮：仅当 get_resume_command != null               │
└───────────────────────────┬─────────────────────────────────┘
                            │ Tauri commands
┌───────────────────────────▼─────────────────────────────────┐
│ ConversationManager                                         │
│  adapters: HashMap<agent_id, Box<dyn AgentSessionAdapter>>  │
│  scan: WalkDir | parse_all_metas → cache                    │
│  list(filter project_path) / messages / resume / export     │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Claude/OpenCode      Codex/Pi/…         OMP/Grok/Reasonix
   (reference)          (fix pattern)       (new adapters)
```

**边界**
| 组件 | 职责 | 不职责 |
|------|------|--------|
| `AgentSessionAdapter` | 路径、匹配、解析、主会话过滤、resume 参数 | 缓存、跨 Agent 列表、UI |
| `ConversationManager` | 扫描编排、标题/预览 normalize、缓存、查询 | 具体 JSON 格式 |
| `AgentManager` | 启动身份（command/icon） | 会话文件解析 |
| Frontend | 展示与触发 | 路径/格式知识 |

## 3. L0 — 扫描契约

### 3.1 问题

`pattern_to_regex` 将 `*` → `[^/]*`，整串 `^rel$`。  
`rollout-*.jsonl` 无法匹配 `2026/07/16/rollout-….jsonl`。

### 3.2 方案（推荐）

**Manager 自动规范化 pattern：**

```text
若 pattern 不含 '/' 且 不以 "**/" 开头：
  effective = "**/".to_string() + pattern
否则：
  effective = pattern
```

- 保留作者显式写 `**/…` 或带路径前缀的能力
- 单层 basename 模式（当前 Codex/Pi/Gemini/Qoder/CodeBuddy 多数情况）**默认递归**
- Claude 的 `**/*.jsonl` 不变
- OpenCode 走 `parse_all_metas`，不受影响

备选（不推荐优先）：逐个改适配器 pattern —— 易漏、契约仍不清晰。

### 3.3 可观测性

在 `scan_agent_inner` WalkDir 路径：
- 统计 `files_seen`（根下文件数，可采样上限）与 `pattern_hits`
- 若 `sessions_found == 0` 且 `files_seen > 0`：`log::warn!` + 可选在 `ScanReport.errors` 增加提示字符串（或扩展字段 `warnings`——若避免类型膨胀则仅 log + errors 文案）

优先：**不破坏**现有 `ScanReport` 序列化兼容；用 `errors` 推送一条 warn 级说明，或仅 log。推荐 **log + errors 中一条非致命提示**（前端已有 errors 展示则更佳）。

### 3.4 测试

`manager` 集成测试：
1. TempDir 建 `sessions/2026/07/16/rollout-x.jsonl`，adapter pattern `rollout-*.jsonl` → found ≥ 1
2. TempDir 建 `sessions/sanitized/a.jsonl`，pattern `*.jsonl` → found ≥ 1
3. 空根 → 0 不 panic

## 4. L1 — 扩展门槛

文档位置（实现期二选一，优先仓库内）：
- `docs/` 或 `src-tauri/src/conversation/adapters/README.md`：接入 checklist

Checklist 要点：
1. `agent_id` == `AgentConfig.id`
2. `session_root` / `file_pattern`（信任 Manager 自动 `**/`）
3. `parse_meta`：id、时间、project_path、title 候选、recent_messages
4. `parse_messages`：至少 text blocks
5. **主会话过滤**（D3）在 pattern 和/或 parse 阶段完成
6. `resume_command` 或明确 None
7. 单元测试 + nested scan 测试（可用 Manager + TestAdapter 或真实 adapter fixture）

共享 helper 继续放 `adapters/mod.rs`：`read_jsonl`、`parse_timestamp`、`linearize_tree_entries`、`recent_messages_from`、`strip_ansi`。

## 5. L2 — 能力对齐

### 5.1 测试 assert（首选，零运行时耦合）

```rust
// conversation 或 agent 模块测试
let agent_ids: HashSet<_> = default_agents().iter().map(|a| a.id.as_str()).collect();
for adapter in all_adapters() {
    assert!(agent_ids.contains(adapter.agent_id()),
        "history adapter {} missing AgentConfig", adapter.agent_id());
}
```

注意：`default_agents` 若为 private，测试可放在 `agent` 模块或导出 `#[cfg(test)]` / `pub(crate)` 测试钩子。

### 5.2 Grok launch

在 `default_agents()` 增加：

```rust
AgentConfig {
  id: "grok".into(),
  name: "grok".into(),
  command: "grok".into(),
  icon: Some("grok.ico".into()), // 已有资源
  enabled: true,
  prompt_args: /* 按 CLI 能力：有 -p/print 则填，否则 None */,
  is_builtin: true,
  skill_path: Some("~/.grok/skills".into()),
  ..Default::default()
}
```

`prompt_args` 以 `grok --help` 为准（实现期核对）；不影响 history，仅影响「发 prompt」能力。

### 5.3 不做

- 运行时强制合并两表（L4）
- 为每个 AgentConfig 加 `supports_history` 字段（可用测试表代替，减少 API 面）

## 6. L3 — 适配器设计

### 6.1 Codex（修复）

| 项 | 值 |
|----|-----|
| root | `~/.codex/sessions` |
| pattern | `rollout-*.jsonl`（依赖 L0 自动 `**/`） |
| id | 文件名 UUID |
| resume | `["resume", id]` |
| 过滤 | 仅 rollout 主文件（pattern 已限） |

验证：本机 nested 路径 + 既有 unit tests。

### 6.2 Pi（修复）

| 项 | 值 |
|----|-----|
| root | `~/.pi/agent/sessions` |
| pattern | `*.jsonl` → 自动 `**/*.jsonl` |
| 过滤 | 仅 session jsonl；若存在附属文件用命名规则排除 |
| resume | 既有 `--session` |

### 6.3 OMP（新增）

| 项 | 值 |
|----|-----|
| root | `~/.omp/agent/sessions` |
| pattern | `*.jsonl`（自动递归） |
| 主会话 | **仅** `sessions/<sanitized>/<sessionId>.jsonl` 文件；**排除** `sessions/<sanitized>/<sessionId>/**` 子目录内 trace jsonl |
| 解析 | 行 type：`session`（id/cwd/ts）、`title`、`message`（树 id/parentId，可复用 `linearize_tree_entries`）——与 Pi 高度相似，可抽 shared 或仿 Pi |
| project_path | session 行 `cwd` |
| resume | `["--resume", native_session_id]` 或 path（以 CLI 实测为准，优先 id） |

实现提示：WalkDir 命中后，若 `path.parent()` 的父级已是 sanitized 且文件名匹配 uuid/时间戳模式，且不在更深子目录——`path.components` 深度相对 session 文件：`rel` 深度 == 2（`sanitized/file.jsonl`）。

### 6.4 Grok（新增）

| 项 | 值 |
|----|-----|
| root | `~/.grok/sessions` |
| 发现 | 每个 `<urlenc-cwd>/<uuid>/` 目录为一会话；主文件 `summary.json`；消息 `updates.jsonl` |
| pattern | `**/summary.json` 或 `parse_all_metas` 风格 WalkDir 自定义 |
| meta | `summary.info.id`、`info.cwd`、`session_summary`、`created_at`/`updated_at`、`num_chat_messages`、`current_model_id` |
| messages | 解析 `updates.jsonl` 中用户可见 chat 更新（实现期用真实样本提炼 role/text；达不到全量 tool block 时至少 text） |
| resume | `["--resume", id]` |
| 过滤 | 忽略 `prompt_history.jsonl`、根级 sqlite、memtrace |

`file_path`：指向 `summary.json` 或 session 目录；`parse_messages` 据此找 sibling `updates.jsonl`。

### 6.5 Reasonix（新增）

| 项 | 值 |
|----|-----|
| root | `~/.reasonix/projects` |
| pattern | `**/sessions/*.jsonl` 但需排除噪声 |
| 主会话规则（D3） | 文件名匹配主会话、**不**含 `recovery`；**不**以 `.events.jsonl` 结尾；**不**匹配 `*.event-index.json` 等；优先存在同 stem 的 `.jsonl.meta` |
| meta | 读 `.jsonl.meta`：`id`, `created_at`, `updated_at`, `model`, `preview`, `turns`；`project_path` 从 sanitized 目录名还原（` -` → `/` 等，与 Claude sanitize 逆变换尽量一致，失败则 None 仍可按列表策略显示） |
| messages | 主 `.jsonl` 中 `role`/`content` 行（跳过超长 system 或截断 preview 策略与 normalize 一致） |
| 排除 | `sessions/subagents/**`、`.ckpt` 目录、goal-state、conflicts |
| resume | 调研：`reasonix run --resume PATH` 可非交互；交互 TUI 的 `--resume` picker 不适配 Neeko。优先 `["run", "--resume", file_path]` 或文档确认后的 path 参数；若仅交互则 `None` + UI 隐藏 |

**过滤实现位置**：适配器 `file_pattern` 尽量收窄 + `parse_meta` 对路径 bail 双保险。

### 6.6 Gemini / Qoder / CodeBuddy

仅依赖 L0 自动 `**/`；冒烟：nested fixture 或本机有数据时 scan > 0。不改解析逻辑 unless 测试失败。

## 7. Frontend

| 变更 | 说明 |
|------|------|
| Resume 可见性 | `get_resume_command` 为 null 时不显示 Resume（D4）；或 item 级 `supportsResume`——若 API 已是 null，前端判空即可 |
| Grok icon | `getAgentIconSrc` 已映射 `grok.ico` 则无改；否则补映射 |
| 无列表 API 变更 | `ConversationMeta` 保持 |

避免在 `DockPanelWrappers` 与 hook 双份 resume 逻辑漂移：本迭代若改动 Resume 显示，以单一路径为准（优先现有实际调用路径）。

**与既有 spec 对齐：** `.trellis/spec/backend/conversation-adapter.md` §4.3 写有 `None` 时「build_resume_context 注入」。本任务 **D4 产品决策** 覆盖为：无原生 `resume_command` → **不注入、不降级 bare launch、隐藏 Resume**。实现期同步更新该 spec 段落，避免检查与代码矛盾。

## 8. Data flow（resume）

```
User click Resume
  → get_resume_command(id) → adapter.resume_command(native_id, project)
  → getAgent(agentId) → command
  → open terminal tab: `{command} {args...}` cwd=project
```

Grok/OMP/Codex/Pi 均走此路径；Reasonix 若 None 则按钮隐藏。

## 9. Compatibility & Migration

- 无持久化 schema 迁移（缓存内存）
- `ScanReport` 尽量不改字段；若加 `warnings` 需 TS 同步——**优先不改类型**
- 旧 pattern 行为：basename 模式从「仅顶层」变为「递归」——**有意破坏错误行为**，属 bugfix

## 10. Risks & Mitigations

| 风险 | 缓解 |
|------|------|
| Grok `updates.jsonl` 格式复杂/噪声 | 列表不依赖 messages；详情 best-effort text；fixture 来自本机脱敏样本 |
| Reasonix sanitize 反解失败 | project_path None 时列表仍可能靠全局 list 或用户切换项目看到（现有 filter：None 仍显示） |
| OMP 与 Pi 格式细微差别 | 独立 adapter，共享 helper，不为抽象而抽象 |
| `**/` 自动前缀误匹配过多文件 | parse_meta 失败进 errors；主会话过滤；pattern 仍应尽量具体（如 rollout-） |
| Reasonix resume 非交互不确定 | 实现期 `reasonix --help`/试验；不行则 None |

## 11. Rollback

- 按 adapter 文件 / pattern 规范化独立回滚
- L0 规范化若异常可 feature 开关或仅改各 adapter pattern（保留测试）

## 12. L4 演进备注（不做）

未来可将 `AgentConfig` + optional history factory 收入单一 registry，启动时挂载；本迭代用测试对齐 id 足够。
