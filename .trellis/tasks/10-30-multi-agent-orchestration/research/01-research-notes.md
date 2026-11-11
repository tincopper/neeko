# Multi-Agent 调研笔记（待并入 .trellis/tasks/<task>/research/）

日期：2026-10-30 · 分支 `multi-agent` @ d00a4861
信源等级：**A** = 源码/官方文档/本仓库代码实测 · **B** = 二手深度解析 · **C** = 未验证

---

## 信源 1：Claude Code Agent Teams 源码剖析（等级 B，但内容为源码引用）

来源：微信公众号《Agent Teams 深度解析：Claude Code 的源码解读》（原文 `mp.weixin.qq.com/s?...sn=14ba6119...`，正文 55K 字，已存 `00-claude-code-agent-teams-source-analysis.txt`）

### 结构
三层：工具层（TeamCreate / SendMessage / TeamDelete）→ 执行层（Backend Registry）→ 协调层（Mailbox / TaskList / TeammateContext）

### 协调基质：文件即协调
```
~/.claude/teams/{team}/config.json            # TeamFile
~/.claude/teams/{team}/inboxes/{name}.json    # 每成员一个收件箱
~/.claude/tasks/{team}/task-N.json            # 团队与任务列表 1:1
```
- 写入用 `wx` flag 原子创建 + `lockfile`（10 次重试，5–100ms 退避）的「读-改-写」
- 理由：进程无关性（in-process 与 tmux 共用一套协议）、崩溃恢复、调试可直接读 JSON

### 执行后端：TeammateExecutor 统一抽象
```ts
type TeammateExecutor = {
  type: BackendType                    // 'tmux' | 'iterm2' | 'in-process'
  isAvailable(): Promise<boolean>
  spawn(config): Promise<SpawnResult>
  sendMessage(agentId, message): Promise<void>
  terminate(agentId, reason?): Promise<boolean>   // 协商式关机
  kill(agentId): Promise<boolean>                 // AbortController.abort()
  isActive(agentId): Promise<boolean>
}
```
- in-process：`AsyncLocalStorage` 隔离身份 + `AbortController` 管生命周期；**故意不传父对话**（`{...ctx, messages: []}`）
- tmux/iTerm2：`PaneBackendExecutor` 适配器包装 `PaneBackend`（splitPane / setPaneBorderColor / rebalancePanes…）
- 选择链：非交互 `-p` → 强制 in-process；`mode=in-process|tmux` 显式；auto → 在 tmux/iTerm2 内用 pane，否则 in-process；`inProcessFallbackActive` 防反复试探
- 检测结果 `cachedDetectionResult` 进程内只算一次 ⇒ **后端在团队创建后固定**

### 身份隔离：三级优先级
```ts
type TeammateContext = {
  agentId            // "researcher@my-team"
  agentName; teamName; color?
  planModeRequired   // 是否需要计划审批
  parentSessionId    // leader 的 session id
  isInProcess: true
  abortController
}
```
解析优先级：AsyncLocalStorage → `dynamicTeamContext`（运行期加入） → 环境变量（tmux/iTerm2 经 CLI 参数）
- Agent ID 格式 `{name}@{team}`，`sanitizeAgentName` 把 `@` 换成 `-`
- **leader 故意不设 `CLAUDE_CODE_AGENT_ID`**：否则 `isTeammate()` 为真，会启动 inbox poller、发空闲通知，破坏语义
- `isTeamLead()` 向后兼容：有 teamContext 但无 agentId ⇒ 视为原始会话=leader

### 消息协议：文本位承载结构化协议
`TeammateMessage{from, text, timestamp, read, color?, summary?}`，`text` 里塞 JSON：
| 类型 | 方向 | 用途 |
|---|---|---|
| idle_notification | Worker→Leader | 回合结束自动上报空闲（附最后私信摘要） |
| shutdown_request / _approved / _rejected | 双向 | 协商式关机，可拒绝并说明理由 |
| plan_approval_request / _response | 双向 | plan mode 审批，Leader 会把自己的权限模式传给 Worker |
| permission_request / _response | Worker→Leader | 工具授权代理 |
| sandbox_permission_request / _response | Worker→Leader | 沙箱网络访问 |
| mode_set_request | Leader→Worker | 切换权限模式 |
| task_assignment | Leader→Worker | 派活 |
| team_permission_update | Leader→All | 团队级权限广播 |

关键：`isStructuredProtocolMessage()` 把这些从 LLM 上下文里滤掉，路由到专用队列（workerPermissions / workerSandboxPermissions），否则协议消息会当正文投给模型。

### 权限四层
1. `teamAllowedPaths`（TeamFile 里，团队共享可编辑路径；绝对路径规则前缀 `//path/**`）
2. `planModeRequired` / `PermissionMode`
3. `toolPermissionContext` + 从 Leader 继承
4. 沙箱权限 + **权限代理链**：Worker → Leader → 用户

### 任务与生命周期
- `InProcessTeammateTaskState`：`status: running|idle|completed|failed|killed` + `messages`（供缩放视图）+ `pendingUserMessages` + `isIdle` + `shutdownRequested` + `abortController` + `onIdleCallbacks`
- 空闲检测：`Stop` hook 里 fire-and-forget 上报；`setMemberActive(team, name, false)`
- `waitForTeammatesToBecomeIdle`：回调式等待，注册 `onIdleCallbacks`，无轮询；含竞态处理（扫描→注册之间已空闲则直接回调）
- wait 是**回调式**，不是 LLM 轮询
- 清理：`registerTeamForSessionCleanup` 兜底，`cleanupSessionTeams` 先杀 pane 再删目录（`Promise.allSettled`）
- `isActive` 三态：`undefined`/`true`=活跃，`false`=空闲（防御性，防文件读失败误判）

### 设计模式总结（原文表）
文件即协调 · AsyncLocalStorage 隔离 · AbortController 生命周期 · 三级身份优先级 · 协商式关机 · 回调式等待 · 防御性注册

---

## 信源 2：业界调研（等级 A，官方文档 + 源码仓库；含对信源 1 的修正）

### ⚠️ 重要修正：TeamCreate / TeamDelete 已被移除
`anthropics/claude-code` CHANGELOG v2.1.178：
> Agent teams: removed the `TeamCreate` and `TeamDelete` tools. With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` set, every session now has one implicit team — spawn teammates directly with the Agent tool's `name` parameter… The `team_name` parameter on the Agent tool is still accepted but ignored.

⇒ 信源 1 描述的 TeamCreate/TeamDelete 是**旧版**。现行形态：隐式团队 + `Agent(name=…)` 是唯一 spawn 原语。**取名时不要照抄这两个工具名。**

其余修正/补充：
- 需要 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，默认关；且**必须在交互式会话**里，`-p`/SDK 下命名子代理会静默降级为普通子代理
- 团队名派生自 session id（`session-` + 前 8 字符），**没有用户可选的团队身份**
- 跨 session 另有 **Unix domain socket**（`cc-socks-<uid>`，`CLAUDE_CODE_MESSAGING_SOCKET` + `..._TOKEN`）——同一产品里并存两种协调基质
- 无广播：`to:"*"` 实为逐收件人各写一份
- 投递语义：接收方**在 tool call 之间**读消息，运行中的工具不被打断；空闲则新起一轮 ⇒ 邮箱是「回合边界注入器」，不是读线程
- `TeammateIdle` hook，`exit 2` 可**否决**其进入空闲（supervisor 级否决权）
- **idle ≠ done ≠ task-complete**：官方文档明说「task status can lag，成员有时忘了标记完成，阻塞依赖任务」
- 权限：成员继承 leader 的 permission mode（`dontAsk` 除外）；**spawn 时无法设每成员权限模式**；成员权限提示**冒泡到 leader 会话**；成员不能代替用户批准权限，也不能把被拒动作转交同伴绕过
- leader **不会自动等待**——官方已知缺陷是「lead 自己动手干活而不是等队友」，修法居然是「改 prompt」⇒ **等待是提示词级行为，不是强制屏障**
- 限制：一 session 一 team、不可嵌套、lead 不可提升、in-process 成员**不支持 `/resume`**、成员不能起后台子代理、分屏在 VS Code 集成终端/Windows Terminal/Ghostty 不可用
- 收尾：协商式 shutdown（可拒绝）；团队配置目录删，任务目录留（受 `cleanupPeriodDays`）

### A2A vs ACP
- **A2A**：HTTP(S)+JSON-RPC，Agent Card 做发现，Task(含 contextId)/Message/Part/Artifact；OAuth/API key 在 HTTP 头。目标是**不归你管的远端 agent**，远端不透明。已成 Linux Foundation / Agentic AI Foundation 项目
- **ACP**：编辑器↔agent，stdio JSON-RPC，一次连接承载**多个并发 session**，反向请求让 agent 回调编辑器（`session/request_permission`、fs、terminal）
- 结论：**A2A 解决跨厂商远端 agent（可作 ingress 适配器）；ACP 解决 CLI 集成税（但只覆盖 session/permission，不暴露 team 语义）**。二者都不提供：任务分解、认领式任务板、冲突规避、审批路由、按 agent 记账 —— 这些都是 harness 层，各家自建

### 其他 harness
| 产品 | 隔离单元 | 分解者 | 结果回收 | 冲突处理 |
|---|---|---|---|---|
| Cursor Projects | 云 VM | **协调者 agent 自己不写码** | 共享上下文文件跨机同步 | 子代理默认共享 checkout ⇒ 并发覆盖；opt-in worktree/VM，**改动留在各自分支直到父代理合并** |
| Codex cloud | 每 task 独立 workspace | 任务本身 | diff 评审 UI | 本地并行靠 worktree |
| Devin Managed | **每子代理独立 VM** | 协调 session | **子完成/需输入时自动唤醒父（不轮询）** | 每子 ACU 记账 |
| Devin Dynamic Workflows | 每调用一个 agent | **编排即代码（Python 脚本）** | 记录回放，**可恢复** | 完成者重放已录结果 |
| Amp | Orb（每 thread 一机） | — | — | — |
| OpenHands | Docker 沙箱 | agent 自身循环 | — | — |
| Cline Agent Teams | SQLite `~/.cline/data/db/teams.db` | 协调者 | 任务板 + 邮箱 + mission log，可 `--id` 恢复 | — |
| Cline Subagents | 独立上下文 | — | 摘要回传 | **批准 spawn 即批准其后一切**（footgun） |
| Roo Boomerang | 独立上下文 | 编排者 | 仅摘要上行 | **编排者故意不给文件/命令/MCP 工具**（防上下文塞满） |
| Aider | — | 两模型一 agent（architect+editor） | — | — |
| Copilot coding agent | cloud sandbox / Actions / remote | — | PR + Agent Merge 迭代 | client/session/environment 三分 |
| Jules | 每 task 一 VM | 生成计划 | **改代码前必须批准计划** | 工作在自己的 branch |

### 框架范式 → GUI 可映射性
- supervisor（LangGraph / CrewAI hierarchical）：**控制转移=工具调用 ⇒ 可渲染、可 gate、可审计** ✅
- handoff-as-tool（OpenAI Agents SDK `transfer_to_<name>`）：同理 ✅
- swarm（LangGraph swarm）：控制隐式流动，"谁活着"是内部状态 ⇒ GUI 难表达 ❌
- selector group chat（AutoGen）：广播+LLM 选下一个发言者，无天然审批点 ❌
- debate：可作**评审透镜**（N 评审 + 1 汇总），不可作无人值守循环 ⚠️
- SOP/pipeline（MetaGPT `Code = SOP(Team)` / ChatDev ChatChain）：可映射，**但 SOP 必须是产品的意见而非模型的** ✅

### 三条必带走的结论
1. **idle ≠ done ≠ task-complete** —— 三种状态，UI 永不合并
2. **supervisor 的等待必须被强制** —— 提示词级等待是全场最可复现的 bug
3. **先定隔离单元，再定协调基质** —— 所有冲突故事本质上都是 worktree 故事

---

## 信源 3：Neeko 现有地基（等级 A，本仓库代码）

### 已有抽象
- `agent/chat/adapter.rs:AgentAdapter`（`async_trait`, `dyn Trait`）：`kind/create/resume/supports_chat_resume/list_models/list_commands/supports_model_selection/chat_capabilities/supports_session_config`；只有 `kind`+`create`+`chat_capabilities` 必填
- `agent/chat/adapter.rs:AgentSession`：`next/send(SessionRequest)/cancel/resume_id/request_channel`
- 分派：`adapter_for()` → `adapter/registry.rs:PROTOCOL_BUILDS`（按 `ChatTransport::{Acp,Serve,Jsonl,PiRpc}`），有护栏测试禁止在 `adapter_for` 里分支 transport
- 能力：`chat/capabilities.rs:ChatCapabilities{config: ConfigCapability, approvals, commands, resume}` —— **纯 bool，无三态**；`capability_probe.rs:assert_capabilities_hold` = 「声明↔行为」可执行校验（红线 14 纪律）
- 会话：`new_session_id` = `ac_{project_id[:8]}_{nanos:hex}`，**在命令层分配**；`chat/manager.rs:AgentChatManager` = `Mutex<HashMap<String, SessionHandle>>`
- 事件：`agent/chat/events.rs:AGENT_CHAT_EVENT`（单频道）；TS 镜像 `src/shared/events.ts` **手工维护，无护栏**
- 归一化模型：`conversation/types.rs:{ConversationMeta, ConversationMessage{role,content,blocks,model,timestamp,seq}, MessageBlock::{Text,Thinking,ToolUse,ToolResult}, ConversationMessagePage}`，按字节预算分页
- worktree：`common/git/workspace_ref.rs:WorkspaceSession/WorkspaceRef`（canonicalize + CheckoutPath 双渲染）；`git/commands/worktree.rs` 只是薄包装，`common/git/operations/worktree.rs` **可编程调用**
- **HTTP 服务端已存在**：`server/` = axum + `Router` + `RouteGroup{...}` + `FailurePolicy::{FailOpen,FailClosed}` + `gate.rs:AuthGate`（进程唯一 token，恒定时间比较）。模块文档明确写「**本模块禁止 import 任何业务域**，业务句柄由组合根注入」；`FailClosed` 变体的注释写的就是「未来的交互式客户端，B3」
- **MCP 注入能力已存在**：`DeploySpec.mcp_config`（每 agent 的 MCP 配置文件模板）+ `agent/resource_deployer.rs:{deploy_mcp,list_deployed_mcp,remove_mcp,agents_supporting}`
- 身份注入原语已存在：`agent/hooks/ingest/attribution.rs` 三级归因 `NEEKO_SESSION_ID` env → cwd 最长前缀 → basename

### 阻塞项（设计前必须知道）
1. **opencode serve 是进程单例**：`adapter/opencode/connection.rs:SERVE_CONNECTION: OnceCell<Arc<ServeConnection>>` ⇒ 一个 server 服务所有 session，首次之后的 `cmd`/`env` 被静默忽略 ⇒ 「每 team 一个 server」当前不可表达
2. **没有父子会话概念**：`AgentContext` / `SessionHandle` / `ResumeCursor` 全都没有
3. **session id 在命令层分配**（`ac_` 前缀 + nanos）⇒ 要确定性/结构化 id 得移动分配点，不是加前缀
4. **没有「等这一轮、拿返回值」的 API**：`AgentChatBridge::run` 的 emit 终点是 `app_handle.emit(AGENT_CHAT_EVENT,…)`，进程内唯一消费者是通知旁路
5. **单事件频道 + 前端过滤**（`useAgentChat` 按 `ev.session_id === sid` 过滤）⇒ N 个 worker 同时 streaming 全压在一个频道 + 一个 webview eval 预算上（红线 4 的变体风险）
6. **`SessionStatus::AwaitingApproval` 是死代码**：`AgentChatManager::update_status` 零生产调用方，只有 `Running`/`Closed` 被写
7. `chat/session_store.rs` 单 `Mutex<Connection>`，且 `register()` 在 spawn 路径上**同步** `save_cursor` ⇒ N 个并发 spawn 抢一个 SQLite 连接
8. **chat 会话无法寻址 worktree**；且 `AgentContext.project_id` 装的是**路径**、`SessionHandle.project_id` 装的是 **id**（命名撞车，加 workspace 维度前必须先理清）
9. 会话扫描**故意跳过子代理 transcript**（`conversation/adapters/codex.rs:should_skip_worker_subagent_session`）⇒ worker 在 Histor 里不可见

### 可用的接缝（按侵入性从低到高）
1. `chat/commands.rs:spawn_session_pipeline` 的 emit 闭包 —— **已经是多观察者**（`notify::project` → NotificationCenter 是第二路），加编排观察者是第三路，**不需要新 trait**
2. `chat/translation.rs` 是「在 spawn_session_pipeline 上再挂一条 StreamEvent 管道」的现成模板（自己的前缀 + 自己的事件常量 + 无 cursor）
3. `server/group.rs:RouteGroup` + `FailurePolicy::FailClosed` —— 加一个 `team` 路由组，架构上是既有设计**主动邀请**的
4. `AgentAdapter` + `ChatCapabilities` —— 若 worker 需要「一次性 dispatch 拿结果」，要加 trait 方法 + capability 字段（按本项目规矩，声明与实现必须同 diff）
5. `common/git/operations/worktree.rs:create_worktree` + `WorkspaceSession` —— worker 独立 worktree 的接缝；缺的是让 `AgentContext` 接受 `workspace/worktree_path`
6. `AgentConfig`（单一真相，`check_agent_config_single_source.py` 禁止前端复制）—— 每 agent 的编排标志（如 `can_be_worker`）应落这里
