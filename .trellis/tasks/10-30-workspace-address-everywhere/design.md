# 设计：执行地址 = 必填 WorkspaceSession

## 0. 判据

| 入参用途 | 允许的身份 |
| --- | --- |
| 决定 `cwd` / 文件根 / 执行目标 | **`WorkspaceSession`（必填）** |
| 项目聚合 / 注册 / 删除 / 配置 / 显示名 | 裸 `project_id` 合法 |

判据来自事实：`project_id` 只回答「哪个项目」，而 agent 进程的 cwd 决定它能读什么；
worktree 单元与主仓是**两个执行上下文**（git 语义下 1+N），用半地址表达必然失真，
且失真不报错（静默按主仓跑）。

## 1. 数据流（改后）

```
AgentChatTabView(session: WorkspaceSession)
  └─ useAgentChat / useAgentSessionLifecycle / useChatRestore
       └─ agentChatApi.{start,open,resume}AgentChat({ workspace })     ← 必填
            └─ StreamRequest.workspace                                ← serde 必填
                 └─ resolve_session_context  (async)
                      ├─ state.resolve_workspace_target_with_env(ws)  ← 唯一解析入口
                      │     → (environment, target, WorkspaceRef{root})
                      ├─ project_display(ws.project_id) → (name, env)
                      └─ AgentContext{ project_id: root, workspace: ws, … }
                           └─ adapter → ContextInit{ manifest{ project_id: root, workspace } }
                                └─ 前端「会话已开始」行直接用回显（root + worktree 标记）
```

## 2. 关键决定与理由

- **不设 `Option` 兼容**：缺少地址的请求在反序列化阶段就失败。理由：回退主仓等于把必然 cwd 错配的
  会话正常化（pi/opencode 原生 resume 会在更晚处拒绝），错误被推迟且更难归因。
- **地址对象而不是散字段**：不加裸 `project_path: Option<String>` —— 那会绕开 worktree 校验（红线 8 同类）
  并产生第二个「谁都能拼路径」的口子；`WorkspaceSession` 由 `resolve_workspace_target_with_env` 统一校验。
- **`ContextManifest.workspace` 用 `Option`**：它同时被项目级命令 `agent_chat_context` 使用（那里没有
  工作区上下文），`None` 表示「这次不是按单元开的」。语义是「有没有单元上下文」，不是「地址可缺」。
- **`owns()` 带 workspace**：会话 id 仍按项目前缀生成（排序友好），归属判定必须含维度，否则
  worktree 会话会被主仓 tab 续写（cwd 不同 → 行为不可预期）。

## 3. 护栏：判据 E（执行上下文台账）

静态规则只能看见「签名里已有 workspace」的形态（A2/D），看不见「该有却没有」。判据 E 把「该不该有」
变成可登记的事实：

- 扫描范围：与既有判据相同的命令层 glob。
- 命中形态：命令体内出现 `resolve_project_ctx(` 或 `get_project(...).path`（3 行窗口）。
- 出口：`ledger/exec_context_commands.json` 以 `相对路径::命令名` 登记且 `reason` 非空 ⇒ 放行；
  未登记 ⇒ 违规。理由必须是「为什么这确实是项目级操作」，不许写「暂时」。
- 台账只增不减需评审：新增登记 = 声称一个执行上下文不需要地址，正是要人看的地方。

## 4. 风险

- `AgentContext` 新增字段触达全部 adapter 构造点（含测试）：机械改动，编译器兜底。
- 前端三个 hook 都要接 `workspace`：漏传会编译失败（必填），不会静默降级。
- 旧 chat 会话（无 workspace 记录）在 `owns()` 后可能不再复用 ⇒ 会新建会话（可接受，明确报日志）。
