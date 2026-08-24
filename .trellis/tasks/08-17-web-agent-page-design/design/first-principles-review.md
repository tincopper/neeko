# Agent Chat — 技术方案第一性原理审查 + DeepSeek Harness 接入示范（v3 增量）

> 状态：设计审查结论（v3 增量，基于 v2 架构文档 `agent-chat-architecture.md`）
> 目的：从第一性原理与元认知出发，对 v2 技术方案做一次彻底再审查，使契约能够**灵活接入任意 Agent**；并以 **DeepSeek Harness** 作为第一个参考接入示范，验证契约完备性。
> 依据：`AGENTS.md`、`docs/neeko-development-spec.md`、`.trellis/spec/`、v2 架构文档、Tab 集成 mockup。
> 结论先行：**v2 的方向（适配层 + 统一事件协议 + 传输正交）成立，但事件协议存在「单向流」这一根本缺陷——缺少人类在环（审批/澄清）的双向通道，且缺少话轮模型与上下文协议化。v3 增量补全这三者，并以 DeepSeek Harness 适配器作为首个闭环示范。**

---

## 0. 元认知开场：谁在审查谁

这份审查由 **DeepSeek Harness 运行时**产出；审查的对象，是把 **DeepSeek Harness 作为第一个适配器接入 Neeko Agent Chat** 的设计。

这是一个自我指涉（self-referential）的过程，它带来两个明确收益：

1. **首个示范是「真实」的，不是纸面示例**。DeepSeek Harness 适配器描述的是我自己的运行行为：模型 + 工具循环、流式文本、结构化工具事件（start/output/end）、中断/取消、子代理与工作流（可作为后续扩展点）。示范与实现之间没有语义落差。
2. **自我指涉逼迫抽象到位**。如果契约是为「某个具体 agent」量身定做的，那么把「我」自己接进去时，任何隐藏假设都会立刻暴露。因此审查的第一原则是：**契约不能假设 agent 的任何实现细节**——它必须只依赖「agent 在最小意义上是什么」这一本质。

同时声明元认知上的边界（避免自我欺骗）：
- 我不会因为「我来自 DeepSeek」就把适配器设计得对 DeepSeek 有利——示范必须走与 opencode/claude-code **完全相同的契约路径**，否则就失去了示范意义。
- 我不做超出需求的过度设计（YAGNI）：审查只把「契约上必须存在」的东西提级，其余留作扩展点，不提前实现。

---

## 1. 第一性原理：Agent 的本质契约

### 1.1 剥离表象：agent 到底是什么

去掉「CLI」「进程」「MCP」「SSH」「网页」等一切外壳，一个「agent」对宿主应用（Neeko）而言只有一件事：

> **给定上下文与一次用户输入，产出一个可观测的、可中断的、可在关键点请求用户决策的「效果流」。**

把这句话拆开，得到 agent 的最小语义（这是第一性原理的原子项）：

| 原子项 | 含义 | 反例（若无此概念会发生什么） |
|---|---|---|
| **Context（上下文）** | 会话所绑定的项目 / 环境(local·wsl·ssh) / 启用的 skills / 附加的文件 | 无法体现「打通 Neeko 功能」，G4 落空 |
| **Turn（话轮）** | 一次「用户输入 → agent 产出」的完整往返边界 | 页面无法结构化渲染、无法恢复、无法定位错误发生在哪一轮 |
| **Effect（效果）** | 文本增量 / 工具调用（读、写、跑命令）/ 文件 diff / 状态变化 / 遥测 | 页面无事可渲染 |
| **Gate（闸门）** | agent 在效果流中停下，等待用户决策（批准写文件、批准跑命令、要求澄清） | 无法做「逐条确认」，无法做任何安全护栏 |
| **Cancel（取消）** | 任意时刻停止当前流并回到可控状态 | 用户无法止损 |

于是 agent 的本质契约可以写成一个类型签名：

```
Agent : (Context, Turn) ⇒ Stream<Effect | Gate>      // 单向，但 Gate 需要回程
                ↑  cancelable at any point
```

### 1.2 最小不变量 Contract C

把上一节压缩成**必须永远成立**的三条不变量（无论接什么 agent、用什么协议、跑在什么形态）：

- **C1 稳定面 = 事件协议 + 请求命令**。页面只消费 `StreamEvent`，只发命令（启动/发送/审批/输入/取消/重绑上下文）；这两者是唯一稳定面。
- **C2 扩展面 = 适配器矩阵**。接入新 agent = 新增一个 `AgentAdapter` 实现（OCP），零改页面、零改协议。
- **C3 正交面 = 传输/生命周期**。spawn 进程 / connect 已存在服务 / HTTP+SSE / MCP，只是「怎么把事件拿到手」，不改变 C1/C2。

**审查推论**：v2 的总体骨架（`AgentAdapter` trait + `StreamEvent` + `core::exec` 复用 + 形态 A/B 只换传输层）**满足 C1/C2/C3，方向正确，予以保留**。真正需要修订的是事件协议自身的完备性（见第 2、3 节）。

### 1.3 三个正交轴

任何 agent 接入都可以（也必须）落在三个正交轴上，互不纠缠：

1. **IO 形态**（怎么获得事件源）：`Spawn`（spawn 子进程读 stdout）｜ `Connect`（连已有进程/套接字）｜ `Serve`（agent 作为 HTTP/SSE 服务）｜ `SDK/MCP`（进程内库或协议客户端）。
2. **交互模型**（事件流的方向与闸门）：`OneWay`（纯单向流）｜ `Gate`（含审批/澄清回程）——**Gate 是本审查要求契约必须支持的最低交互模型**。
3. **传输**（事件怎么到达页面）：`IPC emit`（桌面形态 A）｜ `SSE`（Web 形态 B）｜ 二者可共存。

v2 已把「传输」正交化（形态 A/B）；本审查把「交互模型」从「隐含」提为「显式契约」（新增 Gate 事件与回程命令）；「IO 形态」在 trait 层面已正交（`create` 不指定实现），但文档/矩阵需去耦掉「agent=CLI」的隐含假设。

---

## 2. 元认知：对 v2 方案的自我审查

> 这一节模拟「提问自己」的过程：把 v2 里我们默认正确的每个判断拿出来，问它「你凭什么成立」。逐条给出：判断 → 反问 → 结论 → 修订。

### A1 判断：「agent = 可 spawn 的 CLI 进程」（隐含）

- **反问**：DeepSeek Harness 一定要以「子进程 + stdout 解析」的形式存在吗？如果它以服务形态（HTTP/SSE）或 MCP 暴露呢？如果我们把「spawn 子进程」写进契约，就耦合了生命周期。
- **结论**：`AgentAdapter::create(ctx) -> AgentSession` 在 **trait 层面已经传输/生命周期无关**（这是 v2 的正确设计）。问题在文档/矩阵默认了 CLI（全部 adapter 都是 `spawn`）。v3 只做**去耦表述**：明确「IO 形态」是适配器内部实现选择，矩阵补充 `deepseek-harness`（Spawn + stdio JSON-Lines）与「预留」行（Connect/SSE/MCP），不改变 trait。

### A2 判断（**最大盲点**）：「事件流是单向的」——只需 `agent_stream` / `agent_stream_cancel`

- **反问**：DeepSeek Harness 会写文件、会跑命令。当模式是「逐条确认」时，agent 停在「我要改 `adapter.rs`」这个点上，**页面拿什么把「同意/拒绝」送回去？** v2 的 `StreamEvent` 里没有任何「请求决策」事件，命令里也没有任何「决策回执」。`AgentMode`（自动批准/逐条确认）只是会话级开关——开关打开后，**协议层根本没有承载审批往返的通道**。
- **结论**：这是 v2 与「真实可用的 agent 图形界面」之间最大的鸿沟。**契约必须双向**：新增 `RequestApproval` 事件（agent→页面，携带 tool/title/diff/cmd）与 `agent_approve` 命令（页面→agent）。同理需要 `UserInput`（agent 反问澄清）与 `agent_input` 命令。没有这两条，DeepSeek Harness 示范就无法闭环，逐条确认功能是假的。

### A3 判断：「消息 = 事件流」——事件流本身就是会话

- **反问**：页面要渲染「第 2 轮用户问题 → agent 的回答（含 3 个工具调用）」，事件流里凭什么知道「第 2 轮」从哪里开始、到哪里结束？恢复会话时如何重建结构？当前只能靠「SessionStart 之后、SessionDone 之前」的扁平堆积——**话轮边界不存在**。
- **结论**：新增 `TurnStart` / `TurnEnd`（携带 `turn_id`）。这使页面有明确的会话结构模型、恢复/重放成本大幅下降，也让「上下文已切换」这类系统消息有明确归属。

### A4 判断：「上下文注入是每个 adapter 的实现细节」（隐含）

- **反问**：`AgentContext { project, env, skills, files, mode }` 传给 adapter 后，**怎么**变成 agent 真正看到的上下文？v2 说的是「注入提示词」——但不同 agent 对「skills」「文件附件」的理解完全不同，DeepSeek Harness 有自己的一套上下文/工具模型。若上下文只是 adapter 内部约定，G4（打通项目/文件/skills）就只是「各 adapter 各搞各的」。
- **结论**：把上下文**协议化**为第一公民：会话起点发 `ContextInit`（携带上下文清单 manifest），项目切换发 `agent_context_set` / `ContextRebind`。于是「打通」成为**契约特性**而非 per-adapter 惯例——这也是「灵活接入」的试金石：任何新 agent 都知道上下文清单长什么样，而不是靠猜。

### A5 模式判断：「`next()` 拉取是自然形态」

- **反问**：真实 agent 是**推**（异步产事件），`next()` 是**拉**。两者如何衔接？若不在契约里讲清楚，每个 adapter 会各自发明一套「内部通道 + 泵任务」，且生命周期（泵任务泄漏、cancel 后 `next()` 悬挂、进程退出后通道不关闭）会成为反复出 bug 的地方。
- **结论**：把「适配器标准形态」写进契约：`create()` 内 spawn/connect → **起一个泵任务**把外部流翻译成事件灌入 `mpsc` 通道 → `next()` = `rx.recv().await`；`cancel()` 必须先让泵任务退出、再在宽限期后 kill 子进程；`next()` 在通道关闭后必须返回 `None`（而不是悬挂）；`drop` 时 abort 泵任务。同时定义错误分型：`StreamEnded`（进程退出）/ `ProtocolError`（行解析失败）/ `TransportError`（IO）。

### A6 盲点：「错误/恢复/遥测」只有一个 `Error` 事件

- **反问**：进程崩溃、协议错乱、token 用量、模型切换——页面如何区分「agent 报错」与「传输坏了」？恢复（resume）如何跨 adapter 一致？
- **结论**：错误分型进事件（`Error{ kind: Agent|Protocol|Transport }`），新增 `Meta` 事件承载用量/模型遥测；`resume_id` 语义统一（见 3.1）。不做过度设计——不加「完整遥测仪表盘」，只保证数据可达。

### A7 取舍：「能力协商」要不要做

- **反问**：不同 agent 支持的能力不同（是否支持逐条确认、是否支持命令回显、是否支持 diff、是否支持恢复）。要不要做完整的「能力发现系统」？
- **结论**：**不做完整系统（YAGNI）**。只在 `SessionStart` 里带一个轻量 `capabilities` 字段（approvals / commandEcho / diff / resume），页面按此决定是否显示审批面板等。够用即可，协议可版本化兜底。

### 2.x 缺口总表

| # | 缺口 | 严重度 | v3 修订 |
|---|---|---|---|
| A1 | 文档隐含「agent=CLI」 | 中（影响可读性，非正确性） | 去耦表述 + IO 形态轴 |
| A2 | **单向流，无 Gate 回程** | **高（致命）** | `RequestApproval` / `UserInput` + `agent_approve` / `agent_input` |
| A3 | 无话轮模型 | 高 | `TurnStart` / `TurnEnd` |
| A4 | 上下文注入隐式 | 高 | `ContextInit` / `ContextRebind`（协议化） |
| A5 | 泵/通道/取消语义未定义 | 中 | 「适配器标准形态」写进契约 + 错误分型 |
| A6 | 错误/遥测/恢复粗粒度 | 中 | `Error{kind}` + `Meta` + 统一 `resume_id` |
| A7 | 能力协商 | 低 | 轻量 `capabilities` 字段，不做系统 |

---

## 3. 修订契约（v3 增量，向后兼容）

> 只增不改：v2 的事件/命令全部保留，新增项均为「语义上必须存在」的最小集。

### 3.1 新增事件（agent → 页面）

```rust
// 事件协议增量（合并进 src-tauri/src/agent_chat/events.rs）
ContextInit    { session_id, manifest: ContextManifest }            // 会话绑定上下文清单
TurnStart      { session_id, turn_id }                              // 话轮开始
TurnEnd        { session_id, turn_id, reason: TurnEndReason }       // completed | stopped | error
RequestApproval{ session_id, call_id, tool, title, prompt, diff: Option<String>, cmd: Option<String> }
UserInput      { session_id, turn_id, prompt }                      // agent 反问澄清
Meta           { session_id, model: Option<String>, usage: Option<Usage> }
Error          { session_id, kind: ErrorKind /* Agent|Protocol|Transport */, code, message }
```

> `ContextManifest = { project, env: local|wsl|ssh, skills: Vec<SkillId>, files: Vec<PathBuf>, mode: auto|confirm }`。

### 3.2 新增命令 / 双向通道（页面 → agent）

```rust
// 会话级请求（发送给 agent 的回程 + 控制）
pub enum SessionRequest {
    Cancel,                                       // 等价旧 agent_stream_cancel
    Approve  { call_id: String, allow: bool },    // 审批回执（Gate 回程）
    Input    { turn_id: String, prompt: String }, // 澄清输入回执
    ContextSet { manifest: ContextManifest },     // 项目切换时重绑上下文
    Pause, Resume,                                // 可选
}
```

Tauri 命令层新增（加入 `neeko_invoke_handler!`）：`agent_approve { session_id, call_id, allow }`、`agent_input { session_id, turn_id, prompt }`、`agent_context_set { session_id, manifest }`（`agent_stream` / `agent_stream_cancel` 保留）。

### 3.3 Adapter 契约修订

```rust
// src-tauri/src/agent_chat/adapter.rs —— v3
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    fn kind(&self) -> AgentKind;                       // opencode | claude-code | ... | deepseek-harness | custom
    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;
}

#[async_trait]
pub trait AgentSession: Send + Sync {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>>;  // 拉；内部由泵任务灌入
    async fn send(&mut self, req: SessionRequest) -> Result<(), AppError>; // 新增：双向通道
    async fn cancel(&mut self);                                          // 泵退出 → 宽限后 kill
    fn resume_id(&self) -> Option<String>;
}
```

**适配器标准形态（契约的一部分，A5 落点）**：`create()` → spawn/connect + 起泵任务（外部流 → 翻译 → `mpsc`）→ 返回 session；`send()` 写请求行到子进程 stdin；`next()` 从 `mpsc` 拉取；进程退出→通道关闭→`next()` 返回 `None`；`cancel()` 先停泵再宽限 kill；`drop` abort 泵任务。

### 3.4 不做清单（YAGNI 红线）

- ❌ 不做完整能力发现/协商系统（只带 `capabilities` 字段）。
- ❌ 首期不做 MCP / SSE / Connect 适配器（只把 IO 形态正交化，DeepSeek Harness 走 Spawn+stdio，与现有矩阵同构）。
- ❌ 不做审批 UI 的多级策略（如「本次会话仅此一次」），先做「允许/拒绝」两态。
- ❌ 不做跨 agent 的统一会话迁移（resume 只保证同 agent 同 session）。

---

## 4. DeepSeek Harness 参考适配器（首个接入示范）

> 目的：以 DeepSeek Harness 作为**第一个参考实现**，把第 3 节契约完整走一遍——证明契约完备、可落地，且其他 agent 走完全相同的路径。

### 4.1 定位与运行形态

- **Agent 标识**：`AgentKind::DeepSeekHarness`，UI 名「DeepSeek Harness」，发现方式复用 `AgentManager`（内置或 `AgentConfig` 自定义），与现有 agent 并列出现在 Composer 选择器里。
- **IO 形态**：`Spawn` —— 经 `crate::core::exec::spawn` 启动本机 DeepSeek Harness 会话进程（遵守红线 1：统一执行门面；红线 2：Windows `cmd /c` / Unix `sh -c` 由 exec facade 处理），**stdin/stdout JSON-Lines 协议**。
- **为什么首个示范选 stdio 而不是 HTTP/MCP**：与现有 adapter 矩阵（全部 spawn CLI）同构，`core::exec` 直接复用，最小新机制；同时验证「契约不偏向任何传输」——因为 DeepSeek Harness 也可以走 Connect/SSE，只是首期不演示。
- **交互模型**：`Gate`——支持逐条确认（审批回程），这正好压测 A2 缺口是否真的补上了。

### 4.2 线协议（JSON-Lines，harness ↔ Neeko）

**Neeko → Harness（请求行，写 stdin）**

```json
{"type":"init","session_id":"s1","context":{"project":{"id":"p1","name":"neeko"},"env":"local","skills":["tdd"],"files":["src-tauri/src/agent_chat/adapter.rs"],"mode":"confirm"}}
{"type":"turn","turn_id":"t1","prompt":"重构 adapter.rs 的事件映射，抽取 3 处重复"}
{"type":"approval","call_id":"c2","allow":true}
{"type":"input","turn_id":"t1","prompt":"改成 `agent_chat` 前缀"}
{"type":"context","session_id":"s1","context":{...}}    // 项目切换重绑
{"type":"cancel"}
```

**Harness → Neeko（事件行，写 stdout）**

```json
{"type":"ready","capabilities":{"approvals":true,"commandEcho":true,"diff":true,"resume":true}}
{"type":"turn_start","turn_id":"t1"}
{"type":"text","delta":"先读 adapter.rs 看现状。"}
{"type":"tool","event":"start","call_id":"c1","name":"read_file","title":"src-tauri/src/agent_chat/adapter.rs"}
{"type":"tool","event":"output","call_id":"c1","output":"...文件内容..."}
{"type":"tool","event":"end","call_id":"c1","status":"done"}
{"type":"approval","request":true,"call_id":"c2","tool":"edit_file","title":"src-tauri/src/agent_chat/adapter.rs","diff":"@@ -12,3 +12,5 @@"}
{"type":"file_diff","call_id":"c2","path":"src-tauri/src/agent_chat/adapter.rs","diff":"...unified diff..."}
{"type":"command","call_id":"c3","cwd":"/Users/.../neeko","cmd":"cargo test --manifest-path src-tauri/Cargo.toml"}
{"type":"turn_end","turn_id":"t1","reason":"completed"}
{"type":"meta","model":"deepseek-v4-flash","usage":{"input_tokens":8123,"output_tokens":2041}}
{"type":"done","reason":"completed"}
{"type":"error","code":"E_STREAM","message":"..."}
```

### 4.3 事件映射表（Harness 行 → StreamEvent）

| Harness 事件行 | StreamEvent | 页面行为 |
|---|---|---|
| `ready` | `SessionStart` + capabilities | 会话开始，按能力显示 UI |
| `turn_start` | `TurnStart` | 新话轮开始 |
| `text` | `TextDelta` | 流式 typewriter |
| `tool.start / output / end` | `ToolStart / ToolOutput / ToolEnd` | tool-card 状态机 running→done/failed |
| `approval.request` | `RequestApproval` | **审批弹层**（模式=逐条确认时）|
| `file_diff` | `FileDiff` | diff 面板（触发 git diff 联动，扩展）|
| `command` | `CommandRun` | 回显到 Dock 终端（扩展）|
| `turn_end` | `TurnEnd` | 话轮收束，更新会话结构 |
| `meta` | `Meta` | 用量/模型展示 |
| `done` | `SessionDone{reason}` | 会话结束 |
| `error` | `Error{kind}` | 错误分型呈现 |

### 4.4 会话时序（sequence，一次完整示范）

```
用户: 选择 DeepSeek Harness，发送「重构 adapter.rs」
 │
 │ 页面 → agent_stream(StreamRequest{agent_id:"deepseek-harness", ...})
 │ Bridge → DeepSeekHarnessAdapter::create(ctx) → core::exec::spawn + 泵任务
 │         └─(stdin) init{context manifest, mode:"confirm"}
 │         └─(stdout) ready{capabilities}
 │
 │ (stdout) turn_start t1 ──► TurnStart ──► 页面：新话轮
 │ (stdout) text …        ──► TextDelta ──► 流式渲染
 │ (stdout) tool.start c1 read_file ──► ToolStart ──► tool-card(运行中)
 │ (stdout) tool.output / tool.end ──► ToolOutput/ToolEnd ──► tool-card(✓)
 │
 │ (stdout) approval.request c2 edit_file + diff ──► RequestApproval
 │         ──► 页面弹出审批弹层「允许 DeepSeek Harness 修改 adapter.rs？(diff 预览)」
 │         ──► 用户点「允许」→ agent_approve{session_id, call_id:c2, allow:true}
 │         └─(stdin) approval{call_id:c2, allow:true}  ──► harness 继续
 │
 │ (stdout) file_diff / command(cargo test) / turn_end / meta / done
 │         ──► FileDiff / CommandRun / TurnEnd / Meta / SessionDone
 │
中途: 用户点「停止」→ agent_stream_cancel → (stdin) cancel → SessionDone{stopped}
项目切换: agent_context_set → (stdin) context{...} → ContextRebind → 「上下文已切换」系统消息
```

### 4.5 Rust 适配器骨架（设计级，TDD 见 M2）

```rust
// src-tauri/src/agent_chat/adapter/deepseek.rs —— 设计级骨架
pub struct DeepSeekHarnessAdapter { cmd: Vec<String> }

#[async_trait]
impl AgentAdapter for DeepSeekHarnessAdapter {
    fn kind(&self) -> AgentKind { AgentKind::DeepSeekHarness }
    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError> {
        // 红线1：统一执行门面；红线2：跨平台 shell 由 exec facade 处理
        let mut child = crate::core::exec::spawn(ExecTarget::Local, &self.cmd, spawn_opts()?)?;
        let (tx, rx) = tokio::sync::mpsc::channel(64);
        // 泵任务：读 child.stdout 的 JSON-Lines → 逐行翻译成 StreamEvent → tx.send
        let writer = child.stdin.take().ok_or(AppError::Io(...))?;
        let pump = tokio::spawn(pump_loop(child.stdout, tx));
        // init：先发 ContextInit 清单（协议化上下文，A4）
        write_line(&writer, &Init { session_id, context: manifest_of(ctx) }).await?;
        Ok(Box::new(DeepSeekSession { rx, writer, pump, resume: None }))
    }
}

struct DeepSeekSession { rx: mpsc::Receiver<StreamEvent>, writer: ChildStdin, pump: JoinHandle<()>, resume: Option<String> }
#[async_trait]
impl AgentSession for DeepSeekSession {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>> {
        match self.rx.recv().await { Some(ev) => Some(Ok(ev)), None => None } // 通道关闭即会话结束
    }
    async fn send(&mut self, req: SessionRequest) -> Result<(), AppError> {
        let line = match req {
            SessionRequest::Approve{call_id, allow} => Approval{call_id, allow},
            SessionRequest::Input{turn_id, prompt}  => Input{turn_id, prompt},
            SessionRequest::ContextSet{manifest}    => ContextSet{manifest},
            SessionRequest::Cancel                  => CancelLine,
            SessionRequest::Pause | SessionRequest::Resume => /* 可选 */
        };
        write_line(&mut self.writer, &line).await
    }
    async fn cancel(&mut self) {
        let _ = self.send(SessionRequest::Cancel).await;   // 泵退出 → 宽限期后 kill child
        if self.pump.is_finished() { return; }
        self.pump.abort();
    }
    fn resume_id(&self) -> Option<String> { self.resume.clone() }
}
```

### 4.6 首条验收示范（这条验收通过，即证明契约完备）

1. **选择**：Composer 选择器出现「DeepSeek Harness」（与其他 agent 同列，不改变布局——G1 验收）。
2. **发送**：「重构 `src-tauri/src/agent_chat/adapter.rs` 的事件映射，抽取 3 处重复」。
3. **流式**：`TextDelta` 打字机；tool-card 展示 `read_file` → `edit_file`。
4. **审批（模式=逐条确认）**：`RequestApproval` 触发审批弹层（含 diff 预览）；「允许」→ `agent_approve` → harness 继续产出 `FileDiff` → diff 面板展示。
5. **完成**：`Meta` 显示用量/模型；`TurnEnd` 收束话轮；`SessionDone` 结束。
6. **并行**：全程 Dock 终端 TUI 照常（独立会话，不抢占 PTY）——R2 验收。
7. **中断**：中途「停止」→ `SessionDone{stopped}`；项目切换 → 上下文重绑 + 系统消息。

> 该验收同时在回归现有 adapter：opencode/claude-code 走同一契约路径，只是 `create()` 的翻译器不同。

### 4.7 与适配器矩阵的关系

| Adapter | IO 形态 | 翻译器 | 审批 | 备注 |
|---|---|---|---|---|
| `opencode` | Spawn (CLI) | stdout 行解析 | 可 | 现有 |
| `claude-code` | Spawn (CLI) | stream-json | 可 | 现有 |
| `gemini` / `codex` / `qoder` / `codebuddy` | Spawn (CLI) | 行/JSON | 视能力 | 现有 |
| **`deepseek-harness`（首个参考）** | **Spawn (stdio JSON-Lines)** | **JSON-Lines → StreamEvent** | **是（Gate 闭环）** | **新增示范** |
| `custom` | Spawn (用户 command) | 通用行协议 | 视能力 | 现有 |
| `sse` / `mcp`（预留） | Connect / SDK | — | — | 只做正交化，不实现 |

---

## 5. 审查结论与决策

### 保持（v2 的正确部分）
- `AgentAdapter` / `AgentSession` trait 骨架（生命周期/传输已在 trait 层正交）。
- `StreamEvent` 作为唯一稳定面 + 形态 A/B 只换传输层。
- 复用 `AgentManager` + `crate::core::exec`；严格遵守 AGENTS.md 红线（统一执行门面、跨平台 shell、事件名常量化、mod.rs 极薄）。

### 新增（v3 增量）
1. **双向通道**：`RequestApproval` / `UserInput` + `agent_approve` / `agent_input` —— 补上 A2 致命缺口。
2. **话轮模型**：`TurnStart` / `TurnEnd` —— 会话结构化，支撑渲染/恢复。
3. **上下文协议化**：`ContextInit` / `agent_context_set`(ContextRebind) —— G4 成为契约特性。
4. **适配器标准形态**：泵任务 + mpsc + 错误分型（A5/A6）—— 消灭每 adapter 各自发明通道的隐患。
5. **首个参考实现**：`DeepSeek Harness` 适配器（Spawn + stdio JSON-Lines + Gate 闭环），作为契约完备性的试金石与后续 agent 的接入模板。

### 风险与缓解
- **协议膨胀风险**：v3 只加「语义必须」项，`capabilities` 轻量兜底，不做协商系统；后续 agent 若需新事件，走「事件协议版本化 + 新增 variant」路径（枚举加 variant 强制处理所有 match，符合 OCP/编译期分派）。
- **DeepSeek Harness 自身形态演进风险**：首期绑定 stdio JSON-Lines，但 IO 形态已正交——未来 harness 若以服务/SSE 暴露，只换 `create()` 的获取方式，翻译器与协议不动。
- **审批安全风险**：审批面板展示 diff/命令全文，`allow`/`deny` 两态先落地；更细策略（单次/会话级）留后续。

### 待定（留给实施期决策）
- DeepSeek Harness 的启动命令/环境（`deepseek` CLI 或自建封装）——M2 定。
- **审批 UI 形态已更新：内联审批面板（inline）**——新原型 `prototypes/agent-chat-v2.html` 将审批渲染为消息流内的 `.approval-panel` 卡片（4 个编号选择：Approve once / Always allow this session / Decline / Cancel turn），M3 落地保持该形态；早期 `agent-chat-tab.html` 的 modal 形态已被取代。
- **命令执行样式已更新：Codex 风格终端块（`.cmd-card`）**——`command_run` 不再渲染为普通 work-row，而是参考 OpenAI Codex CLI 的终端块：`$ 命令` + mono 输出 + 状态角标（running 转圈 / done ✓ / failed ✗），输出经 `tool_output` 驱动；文本叙述不再重复命令内容（如"✅ 命令已执行：$ …"），只保留结果评论（如"✅ 编译通过。"）。
- **文件读写样式已更新：Codex 风格文件块（`.file-card`）**——`read_file` / `edit_file` / `write_file` 各自单独一行，参考 OpenAI Codex CLI 的文件操作卡片：读取（eye 图标）/ 编辑（pencil 图标）+ mono 文件路径 + 状态角标，`--bg-primary` 底与命令卡片视觉一致。
- `Pause` / `Resume` 是否首期实现——按 YAGNI，默认不做，除非示范场景需要。

---

## 附：与 v2 架构文档的关系

- 本文档是 v2 `agent-chat-architecture.md` 的**审查结论与契约增量**；v2 架构文档保留为总览，其 §4.2（trait）、§4.3/§7（事件/命令）、§4.4（适配器矩阵）已按本文档增量更新（见「v3 增量」标注）。
- 里程碑不变（M0-M5），但 **M0/M1 验收点补充**：M0 的事件协议测试须覆盖 `RequestApproval` 往返；M1 的 Tab 接入不依赖任何具体 agent。
- **DeepSeek Harness 参考适配器**作为 M2 的一部分，与 opencode/claude-code adapter 并行实现，作为「首个接入示范」的验收入口。
