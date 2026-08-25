# Agent 统一架构执行方案

> AgentProvider（能力契约）+ AgentConfig（数据对象）分层，一个 Agent 三种承载形态（终端 CLI / Agent Chat / Headless），消灭 `AgentConfig`/`AgentPlugin` 双轨。
> 日期：2026-08-24 ｜ 状态：**✅ 已执行完成**（四阶段全部落地，验证全绿）

## 执行记录（2026-08-24 完成）

- **阶段 1 类型建模**：`ChatTransport` 枚举（Acp|Serve|Jsonl|Custom 兜底，serde 值兼容旧字符串）；`AgentConfig` 加 `provider_id` + `chat_transport` 枚举化 + `is_chat_agent()/cmd_vec()`；`plugin.rs` 的 `AgentPlugin` 加 `chat_transports/default_chat_transport` 字段 + `default_config()` 派生 + `pub type AgentProvider = AgentPlugin` 别名；新建 `builtin.rs`（14 provider + 12 config 单一源，cursor/windsurf 仅部署不生成 config）；`manager.rs` 数据源切换；`registry.rs` 改为兼容转发层；`adapter_for(&AgentConfig)` 按枚举分派；`provider_registry.rs` 重构为数据注册表（删缺陷 DefaultProviderFactory）；`chat/commands.rs` 抽取公共前缀（resolve_agent_config/resolve_project_ctx/new_session_id/build_context）；删除死代码 `common/agent/model.rs`。
- **阶段 2 存储与命令**：`StorageManager` 封装 `load_custom_agents/save_custom_agents`（命令层不再直写 JSON）；新增 `list_providers` 命令（内置 + 自定义 provider 合并）；`commands_commit.rs` remote/wsl 合并为 `run_agent_exec`。
- **阶段 3 前端**：`agent.ts`（provider_id + chat_transport 类型）、`agentPlugin.ts`（chat_transports + is_builtin 对齐后端键）、`agentPluginApi.ts`（listProviders + SaveCustomPluginInput 扩展）、`AgentPluginForm` 加 Chat 传输多选/默认选择；修复 `AgentPluginDetails`/`agentPluginPresets` 的 `isBuiltin` 键名 bug；后端 `agent_plugins` 表 v10→v11 迁移（chat_transports_json/default_chat_transport 列）+ `save_custom_plugin` 校验与持久化。
- **阶段 4 清理**：`SessionStart.agent` 硬编码 → `AgentContext.agent_id`（新增字段，三 adapter 统一）；删除无引用的 `deployer.rs`（DefaultDeployer 半成品）；`ChatTransport::from_str` 命名混淆修复（`From<&str>` + `FromStr`）；clippy 提示清理。
- **验证**：cargo test 838 + 99 全绿；前端 vitest 270 文件 2160 测试全过；tsc/ESLint 通过；cargo fmt 已应用。

## 遗留说明

- 旧 plugin 命令（`list_agent_plugins`/`get_agent_plugin`/`save_custom_plugin`/`delete_custom_plugin` 等）前端仍在使用，**未删除**（避免破坏前端编译）；`save_custom_plugin` 已扩展 chat 传输能力并作为自定义 provider 的正式入口，后续前端切换 `list_providers` 后可逐步退役旧命令。
- `customAgents` 存储仍走 config.json（已封装），未迁移 SQLite 表——如需统一可后续加 `agent_configs` 表迁移。
- `provider_registry.rs` 的 `ProviderRegistry` 已重构为数据注册表（有测试），但尚未接入 `AppStateWrapper`（chat 路径直接用 `adapter_for` 纯函数）；如需 `list_providers` 运行时注册自定义 provider 到 chat 路由，可后续接线。

---

## 0. 目标与原则

- **单一事实源**：所有 agent 数据只定义一次，`AgentProvider` 为能力契约，`AgentConfig` 为其持有的数据对象。
- **三形态正交**：终端形态（`command`+`args`，PTY 跑 TUI）、Chat 形态（`chat_transport: Option<Acp|Serve|Jsonl>`，adapter 驱动 Web UI）、Headless 形态（`prompt_args`，程序单轮）。
- **不推倒重来**：终端/Chat 已是两个独立 Tab 入口、共用同一个 `AgentConfig`（`list_chat_agents` 过滤 `chat_transport.is_some()` 方向已对）。本次核心 = ① 消灭 AgentPlugin 双轨 ② `chat_transport` 枚举化 ③ 存储与命令收敛 ④ 前端类型/表单收敛。
- **兼容优先**：`chat_transport` 枚举序列化值与现状字符串一致（`"acp"|"serve"|"jsonl"`），旧 `customAgents` 配置零迁移反序列化。

---

## 1. 目标架构

```
ProviderRegistry（数据注册表，接线复活现有 chat/provider_registry.rs）
    │ 注册
    ▼
AgentProvider ×14（能力契约 · 静态 · 唯一源）
    │ default_config() 派生
    ▼
AgentConfig（数据对象 · 实例 · 可编辑）
    ├─ 终端形态    command + args        → kind:'terminal' Tab + PTY（TerminalViewBase:198）
    ├─ Chat 形态   chat_transport        → kind:'agent-chat' Tab + adapter
    └─ Headless    prompt_args           → AI commit 等程序单轮
    + provider_id（反向引用）· models · skill_path · enabled · is_builtin
```

---

## 2. 阶段划分总览

| 阶段 | 内容 | 交付物 | 依赖 |
|---|---|---|---|
| 1 | 类型建模：ChatTransport 枚举、AgentProvider、单一内置源、adapter 路由 | `cargo test` 全绿，双轨消除 | 无 |
| 2 | 存储与命令：provider/config 表、save_agent/save_provider、customAgents 迁移、命令收敛 | 命令面收敛，旧接口兼容 | 1 |
| 3 | 前端：类型合并、API 收敛、AgentPluginForm 改造 | `tsc --noEmit` + 前端测试全绿 | 1,2 |
| 4 | 清理：死代码删除、deployer 接线、adapter 硬编码修复 | 无遗留 | 1,2,3 |

各阶段可独立合并提交。

---

## 3. 阶段 1：类型建模（核心）

### 3.1 新类型定义（`src-tauri/src/common/agent/types.rs` 草案）

```rust
/// Chat 形态的传输协议（序列化为 snake_case，与现状字符串一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatTransport {
    /// Agent Client Protocol over JSON-RPC stdio（opencode acp / mockAgent / Zed agents）。
    Acp,
    /// opencode serve：HTTP + SSE，支持按会话/轮次选模型。
    Serve,
    /// 自定义 JSON-Lines stdio（deepseek-harness 参考适配器）。
    Jsonl,
    /// 未知/未来值兜底（防旧配置或新协议值导致反序列化失败）。
    #[serde(untagged)]
    Custom(String),
}

/// 能力契约：描述一类 agent 的行为与能力（静态、全局、可注册）。
/// 来源：原 plugin.rs::AgentPlugin（execution 字段拆平 + chat 能力声明）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProvider {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub version: String,
    pub is_builtin: bool,
    // ── 默认执行（default_config() 复制给 AgentConfig，用户可覆盖）──
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub prompt_args: Option<Vec<String>>,      // None = 无 Headless 能力
    pub post_prompt_args: Option<Vec<String>>,
    // ── Chat 能力声明 ──
    pub chat_transports: Vec<ChatTransport>,   // 支持的集合（空 = 仅终端形态）
    pub default_chat_transport: Option<ChatTransport>,
    // ── 部署/检测/配置（原 AgentPlugin 字段原样）──
    pub detection: Option<AgentDetection>,
    pub capabilities: AgentCapabilities,       // mcp/commands/hooks/skills/plugins
    pub paths: AgentResourcePaths,             // config/skills/commands/mcp/hooks/plugins/secrets
    pub configuration: AgentConfiguration,     // schema/defaults/secrets
    pub lifecycle: Option<AgentLifecycle>,
}

impl AgentProvider {
    /// 派生一份默认 AgentConfig（内置 agent 即此产物）。
    pub fn default_config(&self) -> AgentConfig { /* command/prompt_args/chat_transport 等从 provider 复制 */ }
}

/// 数据对象：具体 agent 实例（现 AgentConfig + provider_id + chat_transport 枚举化）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub provider_id: String,                   // ← 关键新增：持有其 Provider
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub icon: Option<String>,
    pub enabled: bool,
    pub prompt_args: Option<Vec<String>>,
    pub post_prompt_args: Option<Vec<String>>,
    pub is_builtin: bool,
    pub skill_path: Option<String>,            // 全局 skills override（provider.paths.skills 为部署模板，两者并存）
    pub chat_transport: Option<ChatTransport>, // None = 仅终端形态
    pub models: Vec<String>,
}
```

**兼容要点**：
- `chat_transport: Option<String>` → `Option<ChatTransport>`：旧 JSON 值 `"acp"` 反序列化为 `Some(Acp)`（serde rename_all 值一致）；未知值进 `Custom(String)` 兜底，绝不失败。
- `AgentPlugin` → `AgentProvider`：`execution.command` → `command`（拆平），其余字段直接迁移；新增 `chat_transports`/`default_chat_transport`。
- `AgentProvider` 前端序列化兼容 `AgentPlugin`（字段名变化的只有 execution 拆平，前端同步改）。

### 3.2 内置 agent 字段合并对照表（核心交付物）

现状：`manager.rs::default_agents()`（12 个 AgentConfig）∪ `registry.rs::default_agent_plugins()`（12 个 AgentPlugin）→ 合并为 **14 个 AgentProvider + 12 个默认 AgentConfig**。

| agent id | command（两处一致✓） | prompt_args（一致✓） | chat_transport（config 独有） | 合并来源 |
|---|---|---|---|---|
| opencode | opencode | `[run --pure --dangerously-skip-permissions=true -f]` | **serve** | 重叠；skill_path 特例 `~/.config/opencode/skills` |
| claude-code | claude | `[--bare -p]` + post `[--dangerously-skip-permissions]` | None | 重叠；registry 手写全量（schema/capabilities 全开/secrets/lifecycle） |
| gemini | gemini | `[--prompt]` | None | 重叠（agent_plugin_shell） |
| codex | codex | `[]` | None | 重叠（agent_plugin_shell） |
| qoder | qodercli | `[--prompt]` | None | 重叠（agent_plugin_shell） |
| codebuddy | codebuddy | `[--prompt]` | None | 重叠（agent_plugin_shell） |
| pi | pi | `[-p]` | None | 重叠（agent_plugin_shell） |
| omp | omp | `[-p]` | None | 重叠（agent_plugin_shell） |
| reasonix | reasonix | `[run --yolo]` | None | 重叠（agent_plugin_shell） |
| grok | grok | `[-p]` | None | 重叠（agent_plugin_shell） |
| deepseek-harness | deepseek-harness | None | **jsonl** | manager 独有 → provider 新建（仿 shell 模板 + chat 能力） |
| mockAgent | （进程内） | None | **acp** | manager 独有 → provider 新建（capabilities 简单） |
| cursor | cursor（检测用） | None | — | registry 独有：**仅 provider（部署专用），不生成 config** |
| windsurf | windsurf（检测用） | None | — | registry 独有：**仅 provider（部署专用），不生成 config** |

**关键结论**：
1. 10 个重叠 agent 的 `command`/`prompt_args` 两处**已对齐**（无冲突），`skill_path` 与 `paths.skills` 语义不同需并存：`paths.skills` = 项目级部署模板（`{{projectPath}}/.{id}/skills`），`skill_path` = 全局 override（`~/.{id}/skills`，opencode 特例 `~/.config/opencode/skills`）。
2. `deepseek-harness`/`mockAgent` 是 **chat 专用**（manager 有 config，registry 无 plugin）→ 补建 provider（detection=command、capabilities 取 shell 模板、chat_transports=[Jsonl]/[Acp]）。
3. `cursor`/`windsurf` 是 **IDE 部署目标**（detection=directory、无终端启动语义）→ 只建 provider 不进 agent 列表；`list_agents` 只返回有 config 的 12 个，`skill/mcp 部署目标` = 全部 14 个 provider。
4. **合并校验测试**（防丢字段）：断言 14 个 provider 的 `id/command/prompt_args/paths.skills.relative/detection` 非空 + 12 个默认 config 的 `provider_id` 可解析 + `list_chat_agents` 恒等于 `{opencode, deepseek-harness, mockAgent}`。

### 3.3 单一内置源

- 新建 `src-tauri/src/agent/builtin.rs`：`pub fn builtin_providers() -> Vec<AgentProvider>`（14 个）+ `pub fn default_configs() -> Vec<AgentConfig>`（12 个，`provider.default_config()` 派生）。
- 删除 `manager.rs::default_agents()` 与 `registry.rs::default_agent_plugins()` 两处定义；`AgentManager::new()` 改从 `default_configs()` 构建。
- `registry.rs` 的 `plugin_map()` 改由 `builtin_providers()` 投影（保留给部署体系），或直接改部署体系引用 provider。

### 3.4 provider_registry 接线 + adapter 路由

- **重构 `chat/provider_registry.rs`**：移除缺陷的 `DefaultProviderFactory`（永远返回 mockAgent 的实现），改为**数据注册表**：

```rust
pub struct ProviderRegistry { providers: HashMap<String, AgentProvider>, configs: Vec<AgentConfig> }
impl ProviderRegistry {
    pub fn with_defaults() -> Self;                     // builtin_providers + default_configs
    pub fn register_provider(&mut self, p: AgentProvider);
    pub fn provider(&self, id: &str) -> Option<&AgentProvider>;
    pub fn configs(&self) -> &[AgentConfig];            // list_agents 数据源
    pub fn chat_configs(&self) -> Vec<&AgentConfig>;    // chat_transport.is_some()
    pub fn resolve_adapter(&self, config: &AgentConfig) -> Result<Box<dyn AgentAdapter>, AppError>;
}
```

- **`adapter_for` 重构**（`chat/adapter.rs`）：入参从 `(agent_id, Option<&str>, Vec<String>)` 改为 `&AgentConfig`，按 `config.chat_transport` 分派：

```rust
pub fn adapter_for(config: &AgentConfig) -> Result<Box<dyn AgentAdapter>, AppError> {
    match config.chat_transport {
        None => Err(AppError::Unsupported(format!("agent {} 仅支持终端形态，不支持 Agent Chat", config.id))),
        Some(ChatTransport::Acp) => { /* mockAgent 特判 in-process；其余 AcpAdapter::new(cmd) */ }
        Some(ChatTransport::Serve) => ServeAdapter::new(),
        Some(ChatTransport::Jsonl) => DeepSeekHarnessAdapter::new(config.cmd_vec()),
        Some(ChatTransport::Custom(_)) => Err(AppError::Unsupported("未知 chat 传输")),
    }
}
```

- `chat/commands.rs` 的 `agent_stream`/`agent_chat_resume`：不再手动取 `command + chat_transport` 再调 `adapter_for`，改为 `registry.resolve_adapter(&config)`，同时顺带抽取公共前缀（项目解析 + session_id 生成，见阶段 2 亦可）。

### 3.5 受影响文件与改动点（阶段 1）

| 文件 | 改动 |
|---|---|
| `common/agent/types.rs` | 新增 `ChatTransport`、`AgentProvider`；`AgentConfig` 加 `provider_id`、`chat_transport` 枚举化 |
| `agent/builtin.rs`（新） | 14 provider + 12 config 单一源 |
| `agent/manager.rs` | `new()` 用 `default_configs()`；删 `default_agents()`；`check_installed` 归位 `core::exec` |
| `agent/registry.rs` | 删 `default_agent_plugins()`；`plugin_map()` 改投影或删除 |
| `agent/plugin.rs` | 重构为 `AgentProvider`（字段迁移 + execution 拆平）或保留类型 + `From<AgentProvider>` 兼容 |
| `agent/chat/provider_registry.rs` | 重构为数据注册表，删 `DefaultProviderFactory` |
| `agent/chat/adapter.rs` | `adapter_for(&AgentConfig)` 按枚举分派 |
| `agent/chat/commands.rs` | 走 `resolve_adapter`；公共前缀抽取 |
| `agent/commands.rs` | `list_agents`/`list_chat_agents` 数据源切换（行为不变）；`list_agent_models` 兼容 |
| `agent/chat/session_store.rs` | `agent_kind` 持久化：`AgentKind` 可保留（独立于本次重构） |
| `resource_deployer.rs` / `path_resolver.rs` / `schema_validator.rs` / `plugin_commands.rs` / `deployer.rs` | 取数源从 `AgentPlugin` 切换为 `AgentProvider`（字段几乎同名，机械替换） |

### 3.6 序列化与迁移

- 阶段 1 不迁移存储：`customAgents` 旧 JSON 经 serde 兼容直接反序列化为新 `AgentConfig`（`chat_transport: Option<String>` → 枚举，未知值兜底 `Custom`）。
- `AgentProvider` 序列化：阶段 1 保留 `AgentPlugin` 兼容别名或前端同步（若阶段 1 就改前端字段名，`list_agent_plugins` 返回结构变化需前端一并处理——建议阶段 1 保留旧命令，阶段 3 统一收敛）。

### 3.7 测试策略（阶段 1）

- 新增：`builtin_providers` 字段完整性（14 个）、`default_configs` 与 provider 关联、`ChatTransport` serde round-trip（含未知值兜底）、`adapter_for` 路由矩阵（None/Acp/Serve/Jsonl/Custom → 期望 adapter 或 Err）。
- 适配：`manager.rs` 现有 12 断言（改走新数据源）、`registry.rs` 现有 11+ 断言（改走 provider）、`chat/commands.rs`/`session_store.rs` 测试（`AgentKind` 不变则基本不动）。
- 验收：`cargo test --manifest-path src-tauri/Cargo.toml` 全绿。

---

## 4. 阶段 2：存储与命令收敛

- **存储**：新增 `agent_configs` 表（id, provider_id, name, command, args, env, prompt_args, post_prompt_args, chat_transport, models, skill_path, enabled, is_builtin, created_at, updated_at）；启动迁移 `customAgents` → 表（保留兼容读取到 v2）。`agent_plugins` 表改造为 `agent_providers`（自定义 provider）。
- **命令面**：
  - `save_agent`（合并 add_agent/save_custom_plugin 语义）、`remove_agent`、`save_provider`、`delete_provider`、`list_providers`
  - 保留：`list_agents`、`list_chat_agents`、`get_agent`、`list_agent_models`、`discover_opencode_models`、`check_agents_installed`、`import_agent_icon`、`detect_installed_agents`（检测改走 provider.detection + config.command）
  - 删除（阶段 3 前端切换后）：`add_agent` 直写 JSON 版、`list_agent_plugins`、`get_agent_plugin`、`save_custom_plugin`、`delete_custom_plugin`、`get_agent_schema`、`validate_against_schema`（`validate_agent_config` 保留走 provider.schema）
- `commands_commit.rs`：`run_agent_remote`/`run_agent_wsl` 合并为 `run_agent_exec(target, ...)`；Local/Remote/WSL 执行抽象统一。

---

## 5. 阶段 3：前端

- `shared/types/agent.ts`：`AgentConfig` 对齐（`chat_transport: 'acp'|'serve'|'jsonl'|null` + `provider_id`）；新增 `agentProvider.ts`（或合并）。`agentPlugin.ts` 删除/收敛。
- `features/agent/api/agentApi.ts`：`listProviders` 新增；`addAgent`→`saveAgent`；删 plugin 专属 API。
- `AgentPluginForm.tsx` 改造：主流程 = 选 provider 模板 → 编辑 AgentConfig（命令/参数/模型/chat_transport/启用）；高级模式 = 自定义 provider 录入。
- agent 列表统一：`list_agents` 全量 + 派生 `has_chat`（chat_transport 非空）/`has_headless`（prompt_args 非空）；action menu Agent 组/AgentBar/Chat 选择器共用，各自过滤 + 形态徽标。
- 验收：`pnpm type-check` + `pnpm test:run`（agent-chat/agent/skill 相关）全绿。

---

## 6. 阶段 4：清理

- 删 `chat/provider_registry.rs` 旧 trait 工厂残留（阶段 1 已重构，确认无引用后删旧路径）。
- `deployer.rs::DefaultDeployer`：接线 `deploy_skill_to_agent` 复用，或删除。
- adapter 内 `SessionStart.agent` 硬编码（`"acp"`/`"deepseek-harness"`）→ 从 `config.id` 传入。
- 删 `agent_plugin_shell` 的 `_capabilities_extra` 死参数、`registry.rs` 旧辅助函数。

---

## 7. 验收标准（全阶段）

1. `cargo test` + `pnpm lint:fe` + `pnpm type-check` 全绿。
2. `list_agents` 返回 12 个 config（10 终端 + deepseek-harness + mockAgent），`list_chat_agents` = 3 个，部署目标 = 14 个 provider。
3. opencode 三形态可用：终端 Tab（TUI）/ Chat Tab（serve）/ AI commit（headless）。
4. 旧 `customAgents` 配置升级后数据零丢失（迁移日志可查）。
5. `AgentPlugin` 类型及其前端引用全仓清零（或明确保留为兼容 re-export）。

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 合并丢字段（最大坑） | 阶段 1 的 14/12 完整性测试先行锁定 |
| 前端类型破坏 | 阶段 3 一次性收敛，阶段 1/2 保持旧命令兼容 |
| customAgents 迁移丢失 | 迁移前备份 config 文件 + 保留兼容读取到 v2 |
| cursor/windsurf 无 config 导致部署断链 | `list_agents` 与部署目标分离，部署按 provider 全量 |
| adapter 路由回归 | 阶段 1 的 `adapter_for` 路由矩阵测试（含 mockAgent 特判） |

每阶段独立提交、独立可回滚；阶段 1 完成后即达到"双轨消除"，后续阶段为增量优化。
