# Neeko Agent Chat — 页面与架构设计

> 状态：设计草案（v2，含 v3 增量标注）
> 范围：Agent Chat 页面 + **以 Tab 形式集成进 Neeko**（不动既有功能）+ 后端多 Agent 适配层 + 打通项目切换 / 文件浏览 / Skills
> **v3 增量**：第一性原理 + 元认知审查结论、契约补全（双向通道 / 话轮 / 上下文协议化）、**DeepSeek Harness 首个参考接入示范**，见 `design/first-principles-review.md`。本文档相应条目（trait / 事件 / 命令 / 适配器矩阵）已标注 `[v3 增量]`。
> 关联原型（已移入本任务目录统一管理）：
> - `.trellis/tasks/08-17-web-agent-page-design/prototypes/web-agent-tab.html` —— **Tab 集成 mockup**（推荐先看：展示 Agent Chat Tab 与 TUI 终端在窗口内并存）
> - 页面本体原型 `agent-chat-page.html` 已删除（不再需要）；独立 Web 形态布局见第 2 / 5.3 节描述
> 依据规范：`AGENTS.md`、`docs/neeko-development-spec.md`、`.trellis/spec/`

---

## 1. 背景与设计目标

### 1.1 需求拆解

Neeko 目前是 Tauri 桌面应用，Agent 使用方式主要是**终端 TUI**（opencode / claude-code 等跑在 PTY 里）。本设计新增 **Agent Chat 页面**，并且明确一条集成约束：

> **以 Tab 形式打开。** Agent Chat 是现有「终端 / 文件 / 浏览器 / 会话」Tab 之外的一种新 Tab，**其余功能照常不受影响**——用户想用 TUI 方式就继续用 TUI，Agent Chat 只是多了一种使用 agent 的选项。

### 1.2 设计目标（验收标准）

| # | 目标 | 验收 |
|---|------|------|
| G1 | 页面与 Agent 解耦 | 同一页面切换任意 agent（opencode / claude-code / gemini / codex / qoder / codebuddy / custom）不改变布局；agent 只影响模型/能力/外观标签 |
| G2 | 后端统一事件协议 | 所有 agent 输出统一流式事件（文本/工具/命令/diff/完成）；新增 agent 只写 adapter，不改页面 |
| G3 | 以 Tab 集成，既有功能不受影响 | Agent Chat 作为 `TabKind 'agent-chat'` 打开；终端 TUI / 浏览器 / 文件 / 会话 Tab 全部照常；桌面形态走原生 React 视图 + IPC |
| G4 | 打通现有功能 | 项目切换、文件浏览附加、skills 注入在会话中端到端生效 |

### 1.3 术语

- **Agent Chat（Agent 对话）**：本特性的产品命名（2026-08 定稿）。桌面 Tab 形态的正式名称；代码标识统一为 `TabKind 'agent-chat'` / Rust 域 `agent_chat` / 前端 `features/agent-chat` / 事件通道 `agent-chat://event`。
  - > 命名说明：早期草案称「Agent Chat」——已废弃。本 Tab 是 Neeko 桌面原生 React 视图（Tauri IPC），**不是网页**，叫 Web 会误导；「Web」一词仅保留给形态 B 的独立 Web 部署（见 5.3）。任务目录 / 原型文件物理名为 `08-17-web-agent-page-design`、`web-agent-tab.html`（2026-08-21 已同步修正引用路径）。
- **Agent Chat Tab**：本设计的核心产物——Neeko 编辑器区域里的一种新 Tab，内容即 Agent Chat 页面视图。
- **Agent Adapter**：把具体 agent（CLI/协议）翻译成统一事件的适配器。
- **StreamEvent**：统一事件协议，页面消费的唯一数据形态。

---

## 2. 集成形态：以 Tab 打开（核心）

### 2.1 形态决策

| 形态 | 说明 | 取舍 |
|------|------|------|
| **A. 原生 React Tab（推荐）** | Agent Chat 页面用 React 组件实现，作为 `TabKind 'agent-chat'` 渲染在编辑器 pane 内，与 terminal/browser/conversation Tab 并列 | 直接复用 Tauri IPC 与现有 store，**打通成本最低**；无 webview 桥接开销 |
| B. 独立 Web 部署（预留） | 同一套页面以 HTTP + SSE 部署，浏览器访问 | 保持页面「事件驱动」，形态 A 到 B 只换传输层；需 Web Bridge（见 4.3） |
| A′. 桌面 webview 内嵌（可选） | 把 B 的产物经现有 `create_browser_webview` 加载进 Tab | 适合想复用纯 Web 产物时；桥接成本高于 A，非首期 |

> **结论**：首期采用 **形态 A**——Tab 内是原生 React 视图，直接 `invoke` 后端适配层。页面组件保持「纯事件驱动、不依赖 Tauri API」的边界，未来可低成本复用为形态 B。

### 2.2 与现有 Tab 体系对接（接入点，全部为真实代码位置）

Neeko 的 Tab 模型位于 `src/shared/types/tab.ts`，渲染分发位于 `src/features/editor/components/PaneContent.tsx`。新增 `agent-chat` kind 需改动：

| 接入点 | 现状 | 新增 |
|--------|------|------|
| `src/shared/types/tab.ts` | `TabKind = 'terminal'\|'file'\|'diff'\|'html-preview'\|'conversation'\|'prDetail'\|'browser'` | 追加 `'agent-chat'`；新增 `AgentChatTabData { kind:'agent-chat'; sessionId?: string; agentId?: string; conversationId?: string }` |
| `PaneContent.tsx` | `switch (activeTab.data.kind)` 分发视图 | 追加 `case 'agent-chat': return <AgentChatTabView .../>` |
| `TabItemLeading.tsx` / `getTabIcon` | 按 kind 取图标 | 注册 `agent-chat` 图标（聊天气泡 + 蓝色点） |
| `editorStore.ts` | `addTab(projectId, tab)` / `registerTabCleanup(kind, fn)` | `registerTabCleanup('agent-chat', stop stream + 清 per-tab 状态)` |
| 打开入口 | AgentBar / AgentSelector / TabBar `+` 菜单 | 「以 Agent Chat 打开」动作 → `addTab` |

### 2.3 与 TUI 并存（关键约束，见 `agent-chat-tab.html`）

- Agent Chat Tab 与终端 TUI **互不影响**：TUI 跑在独立 PTY（`terminal` 域），Agent Chat 跑在适配层会话。
- 用户在 Dock 终端里继续 `opencode`/`claude-code` TUI，同时在编辑器 Tab 里用 Agent Chat 图形界面——两者可**同时存在**。
- 不共享 TTY：Agent Chat 适配层用独立进程会话（spawn 新 CLI 实例），避免抢占 PTY。
- 会话可各自持久化（TUI 走现有 session 恢复；Agent Chat 走 `conversation` 扫描 + 原生恢复句柄）。

### 2.4 Tab 生命周期

1. **打开**：AgentBar / TabBar `+` → `addTab(projectId, { kind:'agent-chat', sessionId })` → pane 渲染 `AgentChatTabView`。
2. **激活**：Tab 激活时恢复该 tab 的会话状态（消息流、附件、agent/model 选择）——按 `tabId` 隔离在 `agentChatStore`（见 5.3）。
3. **切换项目**：沿用 Neeko 全局项目切换；Agent Chat Tab 收到项目变化 → 关闭当前流 → 重建 `AgentContext` → 插入「上下文已切换」系统消息。
4. **关闭**：`registerTabCleanup('agent-chat', ...)` 停止进行中的流（`agent_stream_cancel`）并清理 per-tab 状态。

---

## 3. 总体架构（形态 A 上下文）

```
┌───────────────────────────────────────────────────────────────┐
│ Neeko 窗口                                                     │
│  ├─ 项目侧边栏（现有，不受影响）                                  │
│  ├─ 编辑器 Tab 栏： [终端·TUI] [Agent 对话●] [浏览器] [会话] [+]   │
│  │        └─ AgentChatTabView（React，IPC 直连）                 │
│  │             Topbar 上下文 · 流式 Chat · Composer · 右栏        │
│  ├─ Dock 终端（现有 TUI，照常）                                  │
└───────────────┬───────────────────────────────────────────────┘
                │ Tauri invoke / listen（统一事件协议 StreamEvent）
┌───────────────▼───────────────────────────────────────────────┐
│ Agent Bridge（后端薄层，域：agent_chat）                           │
│  · 会话编排 / 事件扇出 / 取消 / 恢复                              │
│  · 能力注入：项目句柄 · 文件附件 · skills 列表                     │
└───────────────┬───────────────────────────────────────────────┘
┌───────────────▼───────────────────────────────────────────────┐
│ 适配层 AgentAdapter（统一 trait，OCP 扩展）                       │
│  ┌──────────┬───────────┬───────────┬──────────┬──────────┐    │
│  │ opencode │claude-code│  gemini   │  codex   │  custom  │    │
│  └──────────┴───────────┴───────────┴──────────┴──────────┘    │
│   复用 AgentManager + crate::core::exec（统一命令执行门面）        │
└───────────────┬───────────────────────────────────────────────┘
┌───────────────▼───────────────────────────────────────────────┐
│  Neeko 现有域（只读/注入，不改内部实现）                           │
│  project · file · library/skill · session · conversation ·    │
│  terminal · git                                                │
└───────────────────────────────────────────────────────────────┘
```

---

## 4. 后端 Agent 适配层（核心）

### 4.1 设计原则

对齐 AGENTS.md：

- **OCP**：新增 agent = 新增一个 adapter 实现，零修改页面与协议。
- **DIP**：页面/桥接层只依赖抽象 `AgentAdapter` / `StreamEvent`，不依赖具体 agent。
- **复用统一执行门面**：所有 agent 启动走 `crate::core::exec`（`run` / `spawn` / `collect` / `command_exists`）或 `common::executor`，**禁止**在 adapter 内直接用 `std::process::Command` / `tokio::process::Command`（红线 1）。
- **平台差异**：Local 路径区分 Windows `cmd /c` 与 Unix `sh -c`（红线 2）。
- **同步桥禁令**：async 路径只用 async 变体（红线 1 附则）。
- **mod.rs 极薄**：`agent_chat/mod.rs` 只放 `mod` + `pub use`；业务放 `bridge.rs` / `adapter.rs` / `events.rs` / `manager.rs`（红线 9）。

### 4.2 统一抽象（Rust 骨架）

```rust
// src-tauri/src/agent_chat/events.rs —— 统一事件协议（[v3 增量] 标记者为审查新增）
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    SessionStart { session_id: String, agent: String, model: Option<String>, capabilities: Capabilities }, // [v3 增量] capabilities
    ContextInit  { session_id: String, manifest: ContextManifest },  // [v3 增量] 上下文协议化
    TurnStart    { session_id: String, turn_id: String },            // [v3 增量] 话轮模型
    TurnEnd      { session_id: String, turn_id: String, reason: TurnEndReason }, // [v3 增量]
    TextDelta  { session_id: String, delta: String },
    ToolStart  { session_id: String, call_id: String, name: String, title: String },
    ToolOutput { session_id: String, call_id: String, output: String },
    ToolEnd    { session_id: String, call_id: String, status: ToolStatus }, // done | failed
    RequestApproval { session_id, call_id, tool, title, prompt, diff: Option<String>, cmd: Option<String> }, // [v3 增量] Gate 回程
    UserInput  { session_id: String, turn_id: String, prompt: String },      // [v3 增量] agent 反问
    CommandRun { session_id: String, call_id: String, cwd: String, cmd: String },
    FileDiff   { session_id: String, call_id: String, path: String, diff: String },
    Meta       { session_id: String, model: Option<String>, usage: Option<Usage> }, // [v3 增量] 遥测
    SessionDone{ session_id: String, reason: DoneReason },                 // completed | cancelled | error
    Error      { session_id: String, kind: ErrorKind, code: String, message: String }, // [v3 增量] kind: Agent|Protocol|Transport
}

// [v3 增量] 双向通道：页面 → agent 的回程 + 控制
pub enum SessionRequest {
    Cancel,
    Approve  { call_id: String, allow: bool },
    Input    { turn_id: String, prompt: String },
    ContextSet { manifest: ContextManifest },
    Pause, Resume, // 可选
}

pub struct ContextManifest {   // [v3 增量] 上下文清单（协议化 G4）
    pub project: ProjectHandle,
    pub env: ProjectEnvironment,      // local | wsl | ssh
    pub skills: Vec<SkillId>,
    pub files: Vec<PathBuf>,
    pub mode: AgentMode,              // auto | confirm
}

pub struct Capabilities {      // [v3 增量] 轻量能力声明（不做协商系统）
    pub approvals: bool, pub command_echo: bool, pub diff: bool, pub resume: bool,
}

// src-tauri/src/agent_chat/adapter.rs —— 统一适配器抽象
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    fn kind(&self) -> AgentKind;                                  // opencode | claude-code | ... | custom
    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;
}

pub struct AgentContext {
    pub project: ProjectHandle,       // 打通 G4：项目切换 → 工作目录/环境
    pub env: ProjectEnvironment,      // local | wsl | ssh
    pub skills: Vec<SkillId>,         // 打通 G4：skills 注入
    pub files: Vec<PathBuf>,          // 打通 G4：文件浏览 → 上下文附件
    pub prompt: String,
    pub mode: AgentMode,              // 自动批准 / 逐条确认
}

#[async_trait]
pub trait AgentSession: Send + Sync {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>>;      // 拉；内部由泵任务灌入（适配器标准形态）
    async fn send(&mut self, req: SessionRequest) -> Result<(), AppError>;  // [v3 增量] 双向通道（审批/输入/重绑/取消）
    async fn cancel(&mut self);                                             // 泵退出 → 宽限期后 kill
    fn resume_id(&self) -> Option<String>;  // 原生恢复句柄
}
```

### 4.3 事件协议设计要点

- **增量优先**：`TextDelta` 增量推流（前端做 typewriter），不做大块 JSON 一次传输 —— 对齐「IPC 大文本边界（<2MB）」红线 4；大 diff / 长命令输出走 `Vec<u8>` 二进制流或分块。
- **工具调用三段式**：`ToolStart → (ToolOutput*) → ToolEnd`，前端据此渲染可折叠 tool-card。
- **命令可透传**：`CommandRun` 携带 cwd 与 cmd，桌面形态可将输出回显到 Neeko Dock 终端（打通扩展点）。
- **[v3 增量] 双向通道（Gate）**：`RequestApproval` / `UserInput` 是 agent→页面的「闸门」，`agent_approve` / `agent_input`（经 `SessionRequest`）是回程——没有这条，逐条确认/澄清无法闭环。
- **[v3 增量] 话轮模型**：`TurnStart` / `TurnEnd` 给出会话结构边界，页面据此渲染/恢复。
- **[v3 增量] 上下文协议化**：`ContextInit`（含 `ContextManifest`）绑定上下文，项目切换用 `agent_context_set` 重绑 —— G4 成为契约特性而非 per-adapter 惯例。
- **[v3 增量] 适配器标准形态**：`create()` 内 spawn/connect → 泵任务（外部流 → 翻译 → `mpsc`）→ `next()` 拉取；进程退出→通道关闭→`next()` 返回 `None`；错误分型 `ErrorKind::Agent|Protocol|Transport`。
- **事件名常量化**：Tauri 侧事件通道名（如 `agent-chat://event`）在 Rust 端定义常量，前端统一引用（红线 5）。

### 4.4 适配器实现矩阵

| Adapter | 复用 | 启动方式（经 `core::exec`） | 事件映射 |
|---------|------|------------------------------|----------|
| `opencode` | `AgentManager::get_agent` | `spawn` CLI（`opencode run`） | stdout 行解析 → TextDelta / ToolStart/End |
| `claude-code` | 同上 | `spawn` CLI（`claude -p --output-format stream-json`） | stream-json → 统一事件 |
| `gemini` | 同上 | CLI 或 HTTP | 同左 |
| `codex` | 同上 | CLI（`codex exec`） | 同左 |
| `qoder` / `codebuddy` | 同上 | CLI | 同左 |
| **`deepseek-harness`（首个参考）** | `AgentManager::get_agent` / `AgentConfig` | `spawn` 会话（**stdio JSON-Lines**） | JSON-Lines → StreamEvent；**Gate 闭环**（审批/澄清）——详见 `design/first-principles-review.md` §4 |
| `custom` | `AgentConfig`（用户自定义 command/args/env） | `resolve_commands` → `spawn` | 通用行协议 + 提示词引导输出 JSON 事件 |
| `sse`（预留） | — | HTTP SSE | 直接透传 SSE 事件 → StreamEvent |
| `mcp`（预留） | — | MCP 客户端 | 工具调用 ←→ MCP tools |

> IO 形态正交：[v3 增量] `create()` 是「如何获得事件源」（Spawn / Connect / Serve / SDK），由适配器内部实现选择，契约不绑定任何形态；`deepseek-harness` 首期走 Spawn+stdio 与现有矩阵同构，未来可换 Connect/SSE 而不改协议。
> 复用点：`AgentManager` 已提供 `get_agents` / `get_agent` / `resolve_commands` / `check_installed`（`src-tauri/src/agent/manager.rs`），adapter 只负责「进程 IO ↔ 统一事件」的翻译，不重写会话管理。

### 4.5 会话生命周期

1. 页面发 `agent_stream`（携带 `StreamRequest`）→ Bridge 建会话，绑定 adapter。
2. Bridge `tokio::select!` 并发处理：`adapter.next()` 产出事件 / `cancel_rx` 收到取消。
3. 事件扇出：形态 A 走 `emit("agent-chat://event", ev)`；形态 B 经 SSE 连接推送。
4. `SessionDone` 触发会话持久化（复用 `session::save_session` / `conversation` 扫描），供 Tab 重开恢复。

---

## 5. 打通 Neeko 现有功能（G4）

### 5.1 能力清单与对接点

| Neeko 功能 | 现状命令（真实） | Agent Chat 打通方式 |
|------------|------------------|--------------------|
| **项目切换** | `list_projects` / `set_active_project` / `get_active_project` / `refresh_git_info`（`project/commands.rs`） | Tab 顶部项目下拉切换 → Bridge 重建 `AgentContext.project`，触发 `SessionStart`，并插入「上下文已切换」系统消息 |
| **文件浏览/选择** | `read_dir_tree` / `read_file_content` / `create_new_file` / `delete_path` / `rename_path`（`file/commands.rs`） | 右栏文件树浏览；点击文件 → `read_file_content` 预览；行末 `+` → 加入 `AgentContext.files` 附件，随下条消息注入 |
| **Skills** | `get_managed_skills` / `get_skill_document` / `set_managed_skill_enabled_cmd` / `get_tag_groups`（`library/skill/commands.rs`） | 右栏 Skills 面板启停（复用 enable 命令）；启用的 skill 进入 `AgentContext.skills`，随会话注入提示词 |
| **会话恢复（扩展）** | `save_session` / `load_session` / `conversation::scan_conversations` / `get_resume_command` | Tab 重开 / 会话列表来自扫描；Resume 复用 `get_resume_command` 与 `supports_resume` 字段 |
| **终端（扩展）** | terminal 域 PTY | `CommandRun` 事件回显到 Neeko Dock 终端 |
| **Git（扩展）** | git 域命令 | `FileDiff` 事件触发 Git diff 面板 |

### 5.2 打通边界（不改内部实现）

- Agent Chat 域对现有域只做**只读调用 + 状态注入**，不修改 `projectStore` / `skillStore` / `editorStore` 的内部逻辑；对 Tab 体系仅追加新 kind 分支。
- 前端侧：Agent Chat Tab 读取现有 zustand store（`projectStore` 等）与 `AgentConfig` 列表，但页面自身状态独立在 `agentChatStore`（见 6.3）。

### 5.3 Web 形态的桥接（形态 B，预留）

独立 Web 页面需要把 Neeko 能力经 HTTP 暴露，桥接层只做「白名单代理」：

```
POST /api/agent/stream        → SSE 流（等价 agent_stream）
GET  /api/projects            → list_projects（只读白名单）
GET  /api/projects/:id/tree   → read_dir_tree
GET  /api/projects/:id/file?path=… → read_file_content（canonicalize 校验）
GET  /api/skills              → get_managed_skills
POST /api/skills/:id/toggle   → set_managed_skill_enabled_cmd
```

> 安全：Web 形态必须显式配置 token / 本机绑定 + CORS 白名单；所有路径参数在消费前 `canonicalize()` 防路径穿越（红线 8）；capabilities 保持最小权限，不放 `fs:allow-all` / `shell:allow-all`。

---

## 6. 前端页面设计

### 6.1 Tab 内视图布局

Tab 内不重复 Neeko 已有的活动栏/项目侧边栏（窗口内已有），视图更紧凑：

```
┌──────────────────────────────────────────────────────────┐
│ Chat：用户气泡 · agent 流式消息 · tool-card · 代码块 · diff     │
│       （Tab 切换/项目切换时保留 per-tab 会话状态）              │
├──────────────────────────────────────────────────────────┤
│ Composer：Agent▼ · 模型▼ · 附件 chips · 自动批准 · 发送        │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────┐  右栏（可折叠，三 tab，可选）
│ 文件树 ｜ Skills ｜ 上下文   │
└──────────────────────────┘
```

> Tab 形态包含「Chat + Composer」主区与可选右栏。**Agent / 模型选择器放在 Composer 工具栏**（与主流 agent 输入面板一致，2026-08 设计决定）——顶部不再放独立工具条，项目名/环境复用窗口内项目侧边栏，文件与 skills 附件以 Composer chips 呈现，不重复占用顶部空间。**独立 Web 形态**（形态 B）另含活动栏 + 会话侧边栏，布局见第 2.2 / 5.3 节。

### 6.2 Feature-Based 结构映射

按 AGENTS.md 规范新增功能域（禁止根级 barrel、store 放 `store/`、`index.ts` 仅门面）：

```
src/features/agent-chat/
├── index.ts                    # 门面：仅 re-export 公开组件与 hooks
├── types.ts                    # 就近类型（AgentChatTabViewProps 等）
├── api/
│   ├── agentChatApi.ts          # invoke('agent_stream') / listen('agent-chat://event')
│   └── agentChatSse.ts          # 形态 B：SSE 客户端（可选）
├── store/
│   └── agentChatStore.ts        # 按 tabId 隔离的会话/流式/附件/面板状态（zustand）
├── hooks/
│   ├── useAgentChatTab.ts       # Tab 生命周期（激活/关闭/项目切换）
│   ├── useAgentChatStream.ts    # 事件 → store 归并（delta 累积、tool 生命周期）
│   └── useAttachments.ts       # 文件/skill 附件管理
└── components/
    ├── AgentChatTabView.tsx     # Tab 视图容器（注册进 PaneContent）
    ├── AgentContextBar.tsx     # 项目/agent/模型切换
    ├── AgentChat.tsx           # 消息流 + 虚拟滚动（大文本边界）
    ├── AgentComposer.tsx       # 输入 + 附件 + 模式
    ├── AgentContextPanel.tsx   # 文件/Skills/上下文 三 tab
    ├── ToolCallCard.tsx        # 可折叠工具卡片
    ├── StreamText.tsx          # 增量渲染（typewriter）
    └── CodeBlock.tsx           # 代码块 + 复制（复用 CodeMirror 主题色）
```

共享类型进 `src/shared/types/agentChat.ts`（`StreamRequest` / `StreamEventDto` / `Attachment` 等）。

### 6.3 状态模型（agentChatStore 关键字段，按 tabId 隔离）

```ts
interface AgentChatTabState {
  sessionId: string | null;
  agentId: string; model: string | null;
  project: { id: string; env: ProjectEnvironment } | null;
  stream: { phase: 'idle' | 'streaming' | 'done'; activeTools: Record<string, ToolCall> };
  attachments: Attachment[];              // { kind:'file'|'skill', name, path? }
  panel: { open: boolean; tab: 'files' | 'skills' | 'context' };
  skillsEnabled: string[];
}
interface AgentChatStore {
  tabs: Record<string, AgentChatTabState>;   // key = tabId
}
```

### 6.4 关键交互流程

1. **发消息**：Composer 提交 → `agent_stream(StreamRequest{agent_id, project_id, files, skills, prompt})`。
2. **流式**：`useAgentChatStream` 订阅事件 → `TextDelta` 累积渲染（typewriter）；`ToolStart/Output/End` 驱动 tool-card 状态机（running→done/failed）；`CommandRun` 可选回显终端。
3. **项目切换**：Topbar 切换 → `agent_stream_cancel` → 重建上下文 → 插入系统消息 → 重载文件树。
4. **文件附加**：右栏文件树点击 `+` → 附件 chip + 上下文 tab 更新；随下条消息注入。
5. **Skills 启停**：Skills tab 开关 → `set_managed_skill_enabled_cmd` → 更新 `skillsEnabled` 并提示随下次会话注入。

### 6.5 视觉规范

- 复用 Neeko 主题 token（`src/styles/tokens/theme.css`）：`--bg-primary #26292F` / `--bg-secondary #181A1C` / `--accent-blue #2997ff` / 状态 `--accent-green/yellow/red`。
- 深色为默认（`color-scheme: dark`），浅色通过 `data-theme="light"` 覆盖同组 token。
- 字体：UI 用系统栈，代码用等宽栈（`--font-mono`）。
- 代码高亮：复用 CodeMirror 语法 token（`--cm-keyword` 等），与桌面编辑器一致。
- 交互动效 150–300ms，`prefers-reduced-motion` 降级。

---

## 7. API 契约草案（形态 A 桌面为主）

### 7.1 命令（加入 `neeko_invoke_handler!`，`src-tauri/src/lib.rs`）

| 命令 | 入参 | 返回/效果 |
|------|------|-----------|
| `agent_stream` | `StreamRequest` | 启动流式会话，通过 `agent-chat://event` 事件推送 `StreamEvent` |
| `agent_stream_cancel` | `session_id` | 取消进行中的流 |
| `agent_chat_context` | `project_id` | 返回当前上下文快照（项目、skills、文件树元信息） |
| `agent_approve` [v3] | `session_id, call_id, allow` | 审批回执（`RequestApproval` 闸门的回程） |
| `agent_input` [v3] | `session_id, turn_id, prompt` | 澄清输入回执（`UserInput` 的回程） |
| `agent_context_set` [v3] | `session_id, manifest` | 项目切换时重绑上下文（触发 `ContextRebind`） |

### 7.2 事件通道（Rust 端常量，前端统一引用）

```rust
pub const AGENT_CHAT_EVENT: &str = "agent-chat://event";
```

### 7.3 前端调用示例

```ts
// src/features/agent-chat/api/agentChatApi.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AGENT_CHAT_EVENT } from '@/shared/events/agentChat';

export async function agentStream(req: StreamRequest) {
  const unlisten = await listen<StreamEvent>(AGENT_CHAT_EVENT, (e) => onEvent(e.payload));
  await invoke('agent_stream', { req });
  return unlisten;
}
```

---

## 8. 实施路线图

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| **M0 协议与桥接** | `agent_chat` 域骨架：`events.rs` 事件协议（含 [v3] 双向通道 / 话轮 / 上下文清单）+ `bridge.rs` 会话编排 + 命令注册（`agent_stream` / `agent_approve` / `agent_input` / `agent_context_set`） | 冒烟：`agent_stream` 回放 mock 事件流；**协议单测覆盖 `RequestApproval`→`agent_approve` 往返** |
| **M1 Tab 接入** | `TabKind 'agent-chat'` + `AgentChatTabData` + `PaneContent` 分支 + 图标 + 清理注册 + 打开入口 | 编辑器可开/关 Agent Chat Tab，与终端 Tab 并存；`pnpm type-check` 通过（不依赖任何具体 agent） |
| **M2 适配器** | opencode / claude-code adapter；custom 框架；**DeepSeek Harness 首个参考适配器**（Spawn + stdio JSON-Lines + Gate 闭环） | 真实 agent 输出统一事件；`cargo test` 覆盖事件映射；**DeepSeek Harness 示范场景（审批/澄清/diff）闭环** |
| **M3 页面与打通** | React 视图（AgentChatTabView）+ store + 项目/文件/skills 打通 + 审批面板 | 原型交互全量落地；组件测试通过 |
| **M4 Web 形态（可选）** | SSE 传输 + Web Bridge（白名单 HTTP）+ 安全配置 | 独立部署可用；形态 A/B 切换仅换传输层 |
| **M5 扩展** | 终端回显、Git diff 联动、会话恢复强化 | 打通 terminal/git 域 |

> 每个里程碑遵循 Red-Green-Refactor：先定义事件协议与类型 → 写测试（Red）→ 实现（Green）→ 重构。

---

## 9. 安全与边界

1. **命令执行**：adapter 一律经 `crate::core::exec` / `common::executor`，禁裸 `std::process::Command`（红线 1）；async 只用 async 变体。
2. **跨平台 shell**：Local 路径 Windows 用 `cmd /c`、Unix 用 `sh -c`（红线 2）。
3. **路径安全**：前端传入路径在 Rust 端 `canonicalize()` 后消费（红线 8）；capabilities 不放 `fs:allow-all` / `shell:allow-all`。
4. **IPC 大文本**：diff / 命令输出超限走 `Vec<u8>` 二进制流或前端虚拟滚动按需请求（红线 4）。
5. **事件名常量化**：事件通道字符串 Rust 端常量 + 前端统一模块引用（红线 5）。
6. **mod.rs 极薄**：`agent_chat/mod.rs` 仅 `mod` + `pub use`（红线 9）。
7. **Web 形态**：token 鉴权、本机绑定、CORS 白名单；Bridge 只代理白名单命令。

---

## 附：原型自检记录

- `.trellis/tasks/08-17-web-agent-page-design/prototypes/web-agent-tab.html`：Tab 集成 mockup（项目侧边栏 + Tab 栏 + Agent Chat 视图 + Dock TUI 终端并存）。jsdom 自检全部通过，无 JS 错误。
- **[v3] 审批交互（Gate 回程）已入原型**：发送消息后模拟 `edit_file` 需批准——逐条确认（默认）弹出审批弹层（含 diff 预览），允许/拒绝驱动 tool-card 状态 + diff 卡片 + 系统消息；自动批准直接应用。jsdom 20 项自检通过（含允许/拒绝/自动三路径 + 回归），无 JS 错误。
- 页面本体原型 `agent-chat-page.html`：已于 2026-08-17 由用户删除（不再需要）。
