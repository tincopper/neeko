# 可扩展多 Agent 历史会话接入

## Goal

让用户在 History 面板中发现并继续各 CLI Agent 的**主会话**（列表 / 详情 / 可恢复时 resume），且新增 Agent 历史能力只需实现并注册 `AgentSessionAdapter`，不改 Manager / UI 主流程。

## Decisions

| # | 决策 | 结论 |
|---|------|------|
| D1 | 架构深度 | **L0–L3**；L4 统一运行时注册表本迭代不做 |
| D2 | L3 交付集合 | **Codex、Pi、OMP、Grok、Reasonix**；Grok 补 `AgentConfig` |
| D3 | 列表可见性 | **仅主会话**；排除 recovery / events / ckpt / subagent 等噪声 |
| D4 | `resume_command = None` | **隐藏 Resume**（不降级 bare launch）；有 resume 才显示按钮 |

## Requirements

### R1 — L0 发现管道可靠
- 嵌套目录下的 session 文件必须能被 `ConversationManager` 扫描到
- 明确 `file_pattern` 契约：相对 `session_root` 的路径匹配；单层 `*` 不含 `/`；需要嵌套时用 `**/…`（或 Manager 对「无 `/` 且无 `**`」的 basename 模式自动加 `**/` 前缀——实现二选一，见 design）
- 扫描 0 命中但根目录存在候选文件时，写入 log 和/或 `ScanReport` 可观测信号
- 必须有 nested 布局的 Manager 级集成测试（不能只测 `parse_meta`）

### R2 — L1 扩展门槛
- 新 Agent：实现 `AgentSessionAdapter` + `all_adapters()` 注册；无需改 UI/Manager 主流程
- 文档化接入 checklist（路径、pattern、meta、messages、project_path、主会话过滤、resume、测试）
- 每个适配器：fixture + parse_meta + parse_messages + **nested scan** + resume（若支持）

### R3 — L2 能力对齐
- 每个 history adapter 的 `agent_id` 必须在 `default_agents()`（及本迭代新增的 Grok）中有对应 `AgentConfig.id`（测试 assert）
- 本迭代在 `default_agents` 增加 `grok`（icon 已有 `grok.ico`）
- Launch 有 / History 无 的缺口用测试清单或文档表暴露（不静默）

### R4 — L3 Agent 交付（主会话 only）

| Agent | 要求 |
|-------|------|
| Codex | 修扫描；列表+详情+`codex resume` |
| Pi | 修扫描；列表+详情+既有 resume 参数 |
| OMP | 新适配器；主 `*.jsonl`（非子目录 trace）；`omp --resume=…` |
| Grok | 新适配器 + launch；`summary.json` 驱动列表；`grok --resume <id>` |
| Reasonix | 新适配器；主 `*.jsonl`（配 `.jsonl.meta` 优先）；排除 recovery/events/ckpt/subagent；resume 优先可非交互参数 |
| Claude / OpenCode | 行为不回归 |
| Gemini / Qoder / CodeBuddy | L0 pattern 修复后冒烟，不重写 parser |

### R5 — TDD 与兼容
- 先测后实现；`cargo test` conversation 相关通过
- 前端公共类型无破坏性变更（除非增加可选字段且兼容）

## Acceptance Criteria

- [x] **AC1** nested 集成测试通过：`YYYY/MM/DD/rollout-*.jsonl` 与 `<sanitized>/*.jsonl` 可被 `scan` 发现
- [x] **AC2** Codex：L0 修复嵌套扫描；既有 parse/resume 测试通过
- [x] **AC3** Pi：L0 修复嵌套扫描；既有测试通过；无数据不 panic
- [x] **AC4** OMP：主会话适配器 + nested 过滤 + `--resume=<id>`
- [x] **AC5** Grok：default_agents + summary/updates 适配器 + `--resume <id>`
- [x] **AC6** Reasonix：主会话过滤 noise + `run --resume`；supportsResume 链路
- [x] **AC7** 新 Agent 仅适配器注册 + checklist（README）
- [x] **AC8** registry 对齐测试
- [x] **AC9** Claude / OpenCode 既有 adapter 测试通过
- [x] **AC10** conversation/adapters cargo tests + conversation vitest 通过

## Out of Scope

- L4 合并 Launch/History 单一运行时注册表、持久化索引
- 重写 History UI、Neeko 自建会话库
- 强制所有适配器 MessageBlock 达到 Claude 级丰富度
- Reasonix recovery / subagent 一等展示
- 未安装 Agent 的格式猜测

## Notes

- 图标：`grok.ico` / `omp.svg` / `reasonix.svg` 已存在于 `src/assets/agents/`
- 技术设计见 `design.md`；执行清单见 `implement.md`
