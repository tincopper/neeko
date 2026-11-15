# implement — 任务重试（retry）闭环（TDD，先红后绿）

> 改动面：`src-tauri/src/agent/team/{manager,mcp/schema,mcp/dispatch,authorize,commands}.rs`
> · `src-tauri/src/lib.rs` · `src/shared/types/team.ts` ·
> `src/features/agent-team/{api/teamApi.ts,utils/taskBoard.ts,hooks/useTaskRetry.ts,
> components/TeamTaskBoard.tsx,components/TaskCardRow.tsx,components/TeamTaskCenterView.tsx}`
> 及其测试。零迁移、零新事件、零新 MCP 副作用（`ToolReply::Task` 复用，`effect_for` 不动）。

## 动手前（硬指令）

- [x] Read `src-tauri/AGENTS.md`（红线 6/7）与 `src/AGENTS.md`（防火墙 / 状态管理 / 红线 17）。
- [x] Read `.trellis/spec/backend/team-domain.md` §2.5（两列语义）、§8.4（授权分界）、
      §2（两相位；本工具无副作用）。
- [x] 读本任务 `prd.md`（R1-R6 + AC1-AC6 + Non-Goals；用户决策 2026-11-13）。

## 关键设计（两条纪律）

1. **改派校验只有一个实现**：`dispatch::assignee_arg` 的校验体抽成 `assignee_value`（消息
   文案逐字不变，既有 task_create 测试不红）；`manager.retry_task` 内部对 `assignee`
   调它（manager → dispatch 的 import 有 `reject_control_chars` 先例）。本地命令因此不需要
   第二份校验（commands 不得出现 MCP 路径 —— 源码级护栏）。
2. **manager 侧 actor 判据镜像 `force_done`**：actor 必须是本队 Lead 成员行
   （MCP：principal.member_id；本地：经 lead 解析 —— 与 close 路径的 `lead_of` 同族）。

## 阶段 A：manager `retry_task`（AC1 / AC2 / AC3）

- [x] A1 红：`manager` 测试（夹具 `seeded()` / `task()` / `events()`）
      - `failed → pending`、`blocked → pending`：`state/owner/claimed_at/reclaim_count` 全断言
        （owner 清空、claimed_at 清空、count 归零、summary 与 body 保留 —— AC2 round-trip）；
      - `done → 拒绝`（文案指向「建新任务并声明依赖」）；
      - `pending / claimed / in_progress / awaiting_approval / proposed → 拒绝`（穷尽）；
      - actor 非 Lead ⇒ `Conflict`（镜像 `force_done_by_a_worker_is_rejected`）；
      - 审计行 `kind == "retry"`、actor、subject = 队内 task id、detail 含原状态（AC3）；
      - 改派：`assignee = Some(新成员)` ⇒ 落库成新 id；`None` ⇒ 保留原 assignee；
        别队 / 不存在 ⇒ `NotFound` 列花名册。
- [x] A2 绿：`EVENT_RETRY` 常量 + `TeamManager::retry_task(&TaskRef, actor, assignee: Option<&str>, now)`
      （状态门：`Failed | Blocked`；`reclaim_count = 0` = 人工重试是新预算，仍受
      `MAX_RECLAIM_COUNT` 约束 —— R6）。

## 阶段 B：MCP 工具 `task_retry`（AC4）

- [x] B1 红：`dispatch` 测试 —— Lead 调 `task_retry` 成功回 `ToolReply::Task`；
      Worker ⇒ 授权拒绝；`done` 任务 ⇒ 拒绝文案可行动；带 `assignee` 改派落库。
- [x] B2 绿：
      - `schema.rs`：`ToolName::TaskRetry` + `ALL_TOOL_NAMES` 12 条 + `TOOLS` 条目
        （wire `task_retry`；`input_schema` 只声明 `task_id`（必填）与 `assignee`（可选））；
      - `authorize.rs`：Worker 列拒绝格 +3 一格（`TaskRetry`）；矩阵测试补 2 行
        （Lead ✅ / Worker ❌）；模块文档 22 格 → 24 格；
      - `dispatch.rs`：`assignee_value` 抽取 + `retry` 函数 + 两个 match 补臂
        （编译器强制：无 `_`）。
- [x] B3 护栏自绿：`every_tool_reply_variant_is_translated`（无新变体，应保持绿）、
      `tools_cover_every_tool_name_exactly_once`、`matrix_is_enforced_cell_by_cell`。

## 阶段 C：本地命令 `team_task_retry`（AC5）

- [x] C1 红：`commands` camelCase 表加一行（`TeamTask` 载荷）；命令签名
      `(team_id, task_id, assignee: Option<String>)`。
- [x] C2 绿：`commands::team_task_retry`（极薄：require_id → spawn_blocking → manager）+
      `lib.rs` 注册 + 模块文档表补一行。

## 阶段 D：前端（AC6）

- [x] D1 红：`utils/__tests__/taskBoard.test.ts` 加 `canRetry` 8 态穷尽
      （failed/blocked ⇒ true；其余 6 态 ⇒ false）。
- [x] D1 绿：`taskBoard.ts::canRetry`（唯一判据，卡片与详情共用）。
- [x] D2 红：`TeamCardRow.test.tsx` —— 可重试卡渲染「重试」按钮且点击回调；
      不可重试卡无按钮（不做灰按钮）。
- [x] D2 绿：`TaskCardRow` 加 `onRetry?` prop（`canRetry(state) && onRetry` 才渲染）；
      `TeamTaskBoard` 透传 `onRetryTask`。
- [x] D3 红：`TeamTaskCenterView.test.tsx` —— `failed` 详情头部出现「重试」；
      点击调 `team_task_retry` 并重载详情；失败时错误可见（role=alert）。
- [x] D3 绿：详情头部动作 + `hooks/useTaskRetry.ts`（busy/error/toast/store.refresh，
      失败不清数据）+ `api/teamApi.ts::retryTask`（显式 null）+ `shared/types/team.ts`
      加 `TeamTask` 镜像（§8.2 键集纪律）。

## 阶段 E：收尾

- [x] E1 `cargo test --lib agent::team` 全绿（本域全集）。
- [x] E2 `pnpm check:quick`（只跑一次）。
- [x] E3 更新 spec `team-domain.md`：§2.5 补「重试」段（状态门 / count 归零语义 /
      done 拒绝理由 / 改派唯一入口）、§8.4 矩阵格数 22 → 24、文件布局表 authorize 行、
      「新增工具的清单」格数；`commands.rs` 模块文档条数。
- [x] E4 会话记录 + 任务归档。

## 判据汇总（谁红说明哪里退化了）

| 退化 | 变红的测试 |
| --- | --- |
| 重试把交接内容洗掉 | A1 的 summary/body round-trip |
| done 被重开 | A1 `done → 拒绝` |
| 回收预算被重试绕成无限 | A1 的 count 归零断言 + R6（重试后仍受限） |
| 成员能重试别人的队 | B1 Worker 授权 + A1 非 Lead Conflict |
| 改派写进别队 id | A1 改派 NotFound + B1 |
| 卡片按钮常驻（灰按钮） | D2 不可重试卡无按钮 |
| 前端判据与后端漂移 | D1 的 8 态穷尽（后端集合变了它先红） |
