# DAP 域（调试适配器协议）

> `src-tauri/src/dap/` 的分层、不变量与踩过的坑。
>
> 与 [质量指南](./quality-guidelines.md) 的红线互补：本文件记录的是 DAP 域**特有**的
> 约定，通用规则不在此重复。

---

## 1. 分层与依赖方向

```text
commands ──→ manager（门面：只转调 + 会话级透传）
                │
                ├─→ launch              (启动/重跑/语言编排：plan → 建会话 → 挂断点)
                ├─→ breakpoints::service (断点全链路：IPC → 内存 → 磁盘 → 适配器)
                ├─→ source_translation   (身份翻译 + 外部源码授权，无状态)
                └─→ sessions::registry   (会话所有权 / stop / list)
                           │
                     DapContext<'a> { state, sessions, breakpoints, backends }
                           │
                           ├─→ launch_config    (launch.json 读写 / 入口点发现)
                           ├─→ project_context  (项目根 / 执行环境 / 适配器可用性)
                           └─→ session ──→ events (DapEventSink 端口)
                                           ├─ adapter/*  (语言插件 + 编排后端)
                                           ├─ process / transport / client / protocol
                                           └─ (spawn 一律经 core::exec)
```

- 依赖**单向**：`commands → manager → {launch, breakpoints, source_translation, sessions}
  → DapContext → 领域服务 → session/adapter → core::exec`。
- 用例模块之间不互相依赖：`launch` 可以调 `breakpoints::service::ensure_loaded`（启动要挂断点），
  反向不成立。
- **Tauri 只允许出现在两处**：`commands`（IPC 翻译官）与 `events::TauriEventSink`
  （`AppHandle` → `DapEventSink` 适配器）。其余模块在 `#[cfg(test)]` 下不依赖 Tauri 运行时。

### `DapContext` 与 `DapManager` 的职责

- **`DapContext<'a>`**（`context.rs`）：四个协作者的借用打包（state / sessions /
  breakpoints / backends）。用例实现靠它搬进各自模块，而不是"传 4 个参数"（撞
  `too_many_arguments`）或"传 `&DapManager`"（用例反向依赖门面成环）。
- **`DapManager`**（`manager.rs`，≈ 330 行生产代码）：只做三件事 —— 组装 `DapContext`、
  转调用例模块（启动 3 个 + 断点 4 个 + 后端注册 2 个）、会话级透传
  （`control` / `stack_trace` / `variables` / `evaluate` / `source_content` / `stop_*` / `list_*`）。
  **门面里不允许再出现编排逻辑**：新增编排请落进对应用例模块。

### 门面纪律（2026-09-17 审查后固化）

1. **禁止"因 `pub` 而存活"的方法**：`DapManager` 的每个 `pub` 方法必须至少有**一个生产调用方**
   （组合根 / `commands` / 另一个用例模块），或明确属组合根 API（`register_backend`）。
   纯测试调用的方法 —— 删掉，把断言下沉到用例模块（用 `DapFixture`）。
   > 已两次发生此类问题（两轮审查各一次，共涉 3 个方法）：`list_configs`、
   > `stop_project_sessions`、`backend_for_config`。
2. **唯一的测试 seam**：`#[cfg(test)] impl DapManager::launch_via_endpoint`。
   它只为"会话必须落在**管理者**注册表里"的门面契约用例存在
   （`stop_session` 幂等、`resolve_external_source` 授权门）。**不得**为其他用例再加 seam。
3. 用例模块（`launch` / `breakpoints::service`）的测试一律用 `DapFixture` + `ctx()` 直调模块函数，
   **不经门面** —— 否则门面会为可测性长出专用 API（第 1 条的病根）。

---

## 2. 不变量（违反即为 Block）

### 2.1 断点状态是**一把锁**（`breakpoints/store.rs`）

`files` / `muted` / `loaded` 三份字段必须互相一致，因此同住 `Mutex<HashMap<project, ProjectBreakpoints>>`。

- **禁止**把 `loaded` 单独放一把锁：`磁盘读取` 与 `已装载标记` 分开会导致 check-then-act
  —— 并发 `set_breakpoints` 与 `get_breakpoints` 交错时，后完成的那个用**旧磁盘快照**
  整表覆盖内存，用户刚设的断点被吞（历史真实 bug）。
- 装载是**单飞**：`NotLoaded → Loading` 的认领在同一临界区完成；读盘在锁外；
  合并阶段**跳过认领后被改动过的文件**（`dirty_files` / `muted_dirty`），内存更新优先。
- 读盘失败 → 错误上抛 + 状态回退（可重试），**不**伪装成"没有断点"。
- 键序契约已消除：旧实现持 `breakpoints` 锁再取 `muted` 锁，反向取即死锁。
- **拆锁条件（当前不拆）**：临界区只有 `BTreeMap` 查表/插入（µs 级），且三字段强一致
  要求单锁。若出现"单次临界区 > 100µs"或"某项目断点变更成为热点"，改为
  `HashMap<project_id, Arc<Mutex<ProjectBreakpoints>>>`（跨项目并行，项目内仍单锁保一致性）。

### 2.2 语言身份只有一种表示：`AdapterKind`

- 编排后端注册表（`DapManager::register_backend` / `backend_for`）**以 `AdapterKind` 为键**，
  不得用 `config.type_` 字符串。
- 原因：`launch.json` 的 `type` 有别名（`junit` / `delve` / `rust` / `codelldb`）。
  用字符串当键会出现「启动路径查不到后端、实时路径（按 `session.kind()`）查得到」，
  同一条断点随操作路径分叉（`jdt:` 伪路径静默进适配器 ⇒ 断点永不命中）。
- 两条路径都必须经 `plugin_for(&config.type_).kind()` 归一：
  启动路径 = `DapManager::backend_for_config(&config)`；实时路径 = `backend_for(session.kind())`。
- 新增语言：给 `DebugRequest` 加变体（`kind()` 的 `match` 会强制你补分支），
  不要在调用点硬编码语言名。

### 2.3 断点下发只有一个过滤点

`effective = enabled && !muted` 由 `breakpoints::effective_breakpoints` 承担。
**实时**（`set_breakpoints`）与**启动/重跑**（`adapter_breakpoints`）两条路径都必须走它
—— 只堵实时路径会导致 mute 后 Rerun 复活全部断点。变异验证见
`adapter_breakpoints_skips_disabled_and_muted_without_notes`。

### 2.4 事件出口是端口（`DapEventSink`）

`session` / `manager` 只依赖 `Arc<dyn DapEventSink>`；`AppHandle` 只在 `TauriEventSink`。
收益：`launch_session` / `set_breakpoints` 下发 / mute 同步 / 停止清理都能用
`FakeAdapter`（TCP 上说 DAP 帧）+ `RecordingSink` 端到端单测，不再需要真实
`dlv`/`lldb` 或常驻 Tauri 运行时。

### 2.5 磁盘 IO 不占 tokio worker

async 路径内的 `std::fs`（读 `breakpoints.json` / `launch.json`、入口点扫描、读
`~/.neeko/config.json`）必须经 `common::runtime::run_blocking_result` 搬进阻塞线程池。
WSL 项目的根可能是 `\\wsl$\…` UNC 路径，同步读会占住 worker 直到重定向返回。
**同步** `#[tauri::command]`（如 `dap_list_configs`）不受此限。

### 2.6 路径不可以"降级表示"

`to_string_lossy` 会把非 UTF-8 路径**静默换成另一个路径**：适配器拿到它只会回
`verified:false`，用户看到的是"断点没命中"，与真实原因（路径无法表示）完全不同。

- 断点源路径：不可表示 → 剔除 + Console 诊断（与 `Unresolvable` 同一通道）。
- 项目根 / 外部源码读取：不可表示 → **fail-closed 拒绝**（外部源码读取与授权失败同口径，
  绝不读到"另一个文件"）。

### 2.7 只翻适配器副本

持久化与回传前端一律保持**规范身份**（`jdt:/…`）；只有进适配器的载荷被改写成真实路径
（java-debug 只认真实文件或带 JDT handle 的 `jdt://…` uri，而 handle 取不到）。
回传前端的 `BreakpointSpec.file_path` 必须是规范身份（前端用它匹配 tab / 黄线）。

### 2.9 plan 三态在**启动器层**必须被断言（不只是后端层）

`JavaBackend::plan` 的单测只证明"决策正确"；`start_language_debug` 的**分发**必须另有断言：
`Warming` / `Unavailable` ⇒ **会话表保持为空**，`Launch` ⇒ 建会话。
见 `launch.rs::language_plan_three_states_dispatch_without_leaking_sessions`
（fake 后端 `PlanBackend` 注入三态）。
**理由**：design §2.5 的核心承诺是"不可用时绝不建会话"，它属于启动器，不属于后端。

### 2.10 日志/文案语言

日志与用户可见文案（Console note、错误消息）用英文（见
[质量指南](./quality-guidelines.md)）；模块/函数注释用中文。

---

## 3. 常见坑

| 坑 | 症状 | 正确做法 |
|---|---|---|
| 用 `config.type_` 查后端 | `type: "junit"` 时断点永不命中（live toggle 却正常） | `backend_for_config` / `session.kind()` |
| `bp_loaded` 与 `breakpoints` 分锁 | 并发 set/get 丢断点（用户看到刚设的断点消失） | 单锁 + 认领式单飞装载 |
| 持会话表锁 `await session.info()` | 整张表串行化在 2N 次 await 上；`info()` 将来若要锁表即死锁 | 取 `Arc` 快照 → 放锁 → 再 await |
| async 里 `load_launch_file` | WSL/UNC 路径下卡住 tokio worker | `run_blocking_result` |
| 静默吞注册表锁中毒 | "注册后端失败"无迹可寻 | 容忍 + `log::warn`（`BackendRegistry::lock`） |
| 给 launch 配置回落第一个配置 | 点 A 文件却跑 B 的配置 | 已回传 `DapSessionInfo.config_name`；如需显式提示，走 route 级 note 通道（待做） |
| 用例测试经门面（`state.dap_manager.*`） | 门面被迫长测试专用 API，断言绑在转调层 | 用 `DapFixture` + `ctx()` 直调模块函数 |
| 删除方法时按"缩进处"定位 | 残留孤儿 `///` 文档（clippy `empty_line_after_doc_comments` 拦截） | 删除时按**行首**定位并连同 `#[attr]`/`///` 一起摘除 |

---

## 4. 测试支撑（`dap/testing.rs`，仅 `#[cfg(test)]`）

- `FakeAdapter`：TCP 上说 DAP 帧协议的假适配器（应答 initialize / launch|attach /
  setBreakpoints / configurationDone / stackTrace / source，并可推 `stopped` 事件）。
  可配置 `verify_breakpoints=false` 模拟"适配器未解析断点"。
- `RecordingSink`：`DapEventSink` 的记录实现（断言事件 kind / Console 输出 / 状态序列）。
- 夹具：`isolated_state`（隔离 `~/.neeko`）、`plain_project_state`、
  `go_launch_config`、`bp` / `bp_disabled`、`wait_until`（事件异步派发的等待）。

**要求**：新增会话生命周期 / 断点下发 / mute 同步 / 停止清理的行为，必须附一个
`FakeAdapter` 端到端用例 —— 这些路径在端口抽出前没有任何覆盖。

## 5. 用例模块的测试归属

| 模块 | 测什么 | 需要什么夹具 |
|---|---|---|
| `launch.rs` | 启动/重跑、别名归一、debuggee note、**plan 三态分发** | `DapFixture` + `FakeAdapter`（直调 `launch_session` / `start_language_debug`） |
| `breakpoints/service.rs` | 断点全链路、mute 同步、落盘/装载 | `DapFixture` + `DapSession::connect` |
| `source_translation.rs` | 身份翻译、授权判定、非 UTF-8 拒绝 | 合成帧 + fake 语言端口（无需会话） |
| `manager.rs` | **仅门面契约**：`NotFound` 口径、`stop_session` 幂等、外部源码入口、断点落盘 roundtrip（`set_breakpoints_persists_disabled_and_muted`，disabled+muted 持久化只经公开 IPC 面可见） | `FakeAdapter` + 唯一 seam |

**要求**：新增 session 生命周期 / 断点下发 / mute 同步 / 停止清理的行为，必须在
**对应模块**里补 `FakeAdapter` 端到端用例（不要都堆到 `manager.rs`）。

### 已知的契约细节（容易误判为 bug）

- `dap.adapterBinaries.<key>` 的键空间**在读取入口归一**（2026-09-17 修复）：
  规范键是 `AdapterKind::as_str()`（`go` / `lldb` / `java`），同时接受 launch.json 的
  `type` 别名（`delve` / `rust` / `codelldb` / `junit`）—— 归一用与编排后端注册表**同一个**
  事实源 `AdapterKind::from_config_type`，因此不存在"某一侧支持别名、另一侧不支持"。
  **优先级**：规范键恒优先；规范键缺失或为空串时依次看别名（对象键有序 ⇒ 确定性）。
  无法归一的键（`python` 等）忽略。
  锁定用例：`project_context::{adapter_binary_override_accepts_launch_type_aliases,
  canonical_key_wins_over_alias_and_alias_covers_empty_canonical}`。
  > 修前只读规范键 ⇒ 用户写 `adapterBinaries.rust` 被**静默忽略**、回落默认探测
  > （"我配了路径却没生效"）。修法是在**读取入口归一**，而不是在消费侧加别名回落 ——
  > 后者才是 AGENTS.md 红线 12 禁止的"别名匹配掩盖"。
- `set_breakpoints` 的回传是**适配器视图**（只含 `effective` 行）+ 身份改写回规范身份，
  **不是内存全量**。前端 `mergeBreakpointEntries(next, returned)` 用本地 `next`（全量、
  含 `enabled` 位）与回传**合并**，因此 disabled 条目在客户端保留、`verified` 以后端为准。
  改动回传口径前先看 `src/features/runner/store/debug/breakpointSlice.ts`。
