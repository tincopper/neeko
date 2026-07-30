# Agent 插件系统技术设计

> 任务：`07-30-agent-plugin-system`
> 前置：Phase 1/2（Skills/Prompts/Actions 已归档）
> 设计原则：**从根本上解决问题，对标业界最佳实践，而非仅满足当前需求**

---

## 1. 设计哲学

### 1.1 根本问题

Neeko 当前的痛点不是"缺个类型"，而是：

| 问题 | 表现 |
|------|------|
| 知识分散 | Agent 路径硬编码在 `tool_adapters.rs`、`agent/manager.rs` 三处 |
| 扩展困难 | 新增 Agent 要改 Rust + TS + DB 约 5+ 文件 |
| 能力不透明 | 无法声明式知道"这个 Agent 支持什么、资源在哪" |
| 部署碎片 | Skills/Prompts 部署逻辑各自独立 |

### 1.2 业界对标

| Agent | 执行 | 配置 | 扩展 | 路径 |
|-------|------|------|------|------|
| Claude Code | CLI | `settings.json` | MCP/commands/hooks/skills | `~/.claude/`, `.claude/` |
| Cursor | IDE ext | `settings.json` | MCP/rules/commands | `.cursor/` |
| Codex | CLI | `config.toml` | tools/AGENTS.md | `~/.codex/` |
| VS Code | — | `package.json` | contributes.* | 扩展目录 |

**共性**：每个 Agent = 执行方式 + 配置模型 + 扩展能力 + 资源路径。

### 1.3 核心理念

> **AgentPlugin = 一个 Agent 提供者的完整契约（Complete Contract）**

Neeko 通过它理解"如何与这个 Agent 交互"，而不是把知识散落在代码中。

---

## 2. 核心抽象：AgentPlugin

```ts
// src/shared/types/agentPlugin.ts

/** Agent 插件 — 描述一个 Agent 提供者的完整契约 */
interface AgentPlugin {
  id: string;
  name: string;
  icon: string | null;
  description?: string;
  version: string;
  isBuiltin: boolean;

  // ── 1. 执行契约：如何启动这个 Agent ──
  execution: AgentExecution;

  // ── 2. 配置契约：如何配置这个 Agent ──
  configuration: AgentConfiguration;

  // ── 3. 能力契约：这个 Agent 支持什么扩展 ──
  capabilities: AgentCapabilities;

  // ── 4. 路径契约：各类资源存在哪里 ──
  paths: AgentResourcePaths;

  // ── 5. 生命周期契约：如何干预 Agent 生命周期 ──
  lifecycle?: AgentLifecycle;
}

/** 执行定义 */
interface AgentExecution {
  command: string;
  args: string[];
  env: Record<string, string>;
  promptArgs?: string[];
  postPromptArgs?: string[];
  detection?: {
    type: 'command' | 'directory' | 'file';
    target: string;
  };
}

/** 配置定义 */
interface AgentConfiguration {
  schema: JSONSchema;                    // 配置 JSON Schema（验证 + UI 生成）
  defaults: Record<string, unknown>;     // 默认配置
  secrets?: SecretDefinition[];          // 需要用户提供的凭据
}

interface SecretDefinition {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'password' | 'path' | 'url';
  required: boolean;
}

/** 能力声明 */
interface AgentCapabilities {
  mcp?:        { supported: boolean; transports?: ('stdio' | 'sse')[] };
  commands?:   { supported: boolean; format?: 'markdown' | 'json' };
  hooks?:      { supported: boolean; events?: HookEvent[] };
  skills?:     { supported: boolean; format?: 'skill.md' };
  plugins?:    { supported: boolean };
}

type HookEvent = 'pre-send' | 'post-receive' | 'session-start' | 'session-end' | 'on-error';

/** 路径模板 */
interface AgentResourcePaths {
  config:   PathTemplate;   // Agent 自身配置
  skills:   PathTemplate;   // Skills
  commands: PathTemplate;   // Commands
  mcp:      PathTemplate;   // MCP 配置
  hooks:    PathTemplate;   // Hooks
  plugins:  PathTemplate;   // Plugins
  secrets?: PathTemplate;   // 凭据
}

/** 路径模板（支持变量） */
interface PathTemplate {
  relative: string;          // 相对路径（支持 {{home}}, {{projectPath}}）
  format: 'json' | 'toml' | 'yaml' | 'markdown' | 'script' | 'directory';
  description?: string;
  projectLevel?: boolean;    // 是否支持项目级覆盖
}

/** 生命周期钩子 */
interface AgentLifecycle {
  onProjectActivate?: string;  // 项目激活脚本
  onSessionStart?: string;     // 会话开始脚本
}
```

---

## 3. 内置 Agent 插件定义

```ts
// src/shared/data/agentPluginPresets.ts

export const BUILT_IN_AGENT_PLUGINS: AgentPlugin[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'claude.svg',
    description: 'Anthropic Claude Code CLI agent',
    version: '1.0',
    isBuiltin: true,
    execution: {
      command: 'claude',
      args: [],
      env: {},
      detection: { type: 'command', target: 'claude' },
    },
    configuration: {
      schema: CLAUDE_SETTINGS_SCHEMA,
      defaults: { model: 'sonnet' },
      secrets: [{ key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', type: 'password', required: true }],
    },
    capabilities: {
      mcp:      { supported: true, transports: ['stdio', 'sse'] },
      commands: { supported: true, format: 'markdown' },
      hooks:    { supported: true, events: ['pre-send', 'post-receive', 'session-start', 'on-error'] },
      skills:   { supported: true, format: 'skill.md' },
      plugins:  { supported: true },
    },
    paths: {
      config:   { relative: '{{home}}/.claude/settings.json', format: 'json' },
      skills:   { relative: '{{projectPath}}/.claude/skills', format: 'directory', projectLevel: true },
      commands: { relative: '{{projectPath}}/.claude/commands', format: 'markdown', projectLevel: true },
      mcp:      { relative: '{{home}}/.claude/settings.json', format: 'json' },
      hooks:    { relative: '{{projectPath}}/.claude/hooks', format: 'script', projectLevel: true },
      plugins:  { relative: '{{projectPath}}/.claude/plugins', format: 'directory', projectLevel: true },
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: 'cursor.svg',
    version: '1.0',
    isBuiltin: true,
    execution: {
      command: 'cursor',
      args: [],
      env: {},
      detection: { type: 'directory', target: '{{projectPath}}/.cursor' },
    },
    configuration: { schema: CURSOR_SETTINGS_SCHEMA, defaults: {} },
    capabilities: {
      mcp:      { supported: true, transports: ['stdio'] },
      commands: { supported: true, format: 'markdown' },
      skills:   { supported: true, format: 'skill.md' },
    },
    paths: {
      config:   { relative: '{{projectPath}}/.cursor/settings.json', format: 'json', projectLevel: true },
      skills:   { relative: '{{projectPath}}/.cursor/skills', format: 'directory', projectLevel: true },
      commands: { relative: '{{projectPath}}/.cursor/commands', format: 'markdown', projectLevel: true },
      mcp:      { relative: '{{projectPath}}/.cursor/settings.json', format: 'json', projectLevel: true },
      hooks:    { relative: '{{projectPath}}/.cursor/hooks', format: 'script', projectLevel: true },
      plugins:  { relative: '{{projectPath}}/.cursor/extensions', format: 'directory', projectLevel: true },
    },
  },
  // ... Codex, Gemini, Qoder, CodeBuddy, OpenCode, OMP, Pi, Reasonix, Grok
];
```

---

## 4. 路径解析引擎

```rust
// src-tauri/src/agent/path_resolver.rs

pub struct PathResolver {
    home_dir: PathBuf,
    project_path: Option<PathBuf>,
}

impl PathResolver {
    pub fn new(project_path: Option<&Path>) -> Self;

    /// 解析路径模板为绝对路径
    pub fn resolve(&self, template: &PathTemplate) -> PathBuf;

    /// 检测 Agent 是否安装
    pub fn is_installed(&self, plugin: &AgentPlugin) -> bool;

    /// 确保目录存在
    pub fn ensure_dir(&self, path: &Path) -> Result<(), AppError>;

    /// 获取某类资源的所有路径（全局 + 项目级）
    pub fn resolve_all(&self, plugin: &AgentPlugin, resource: &str) -> Vec<PathBuf>;
}
```

路径模板变量：

| 变量 | 含义 |
|------|------|
| `{{home}}` | 用户主目录 |
| `{{projectPath}}` | 当前项目根目录 |
| `{{agentId}}` | Agent 插件 ID |
| `{{configDir}}` | 系统配置目录 |

---

## 5. ToolAdapter 替代方案

### 5.1 映射关系

| ToolAdapter | AgentPlugin |
|-------------|-------------|
| `key` | `id` |
| `display_name` | `name` |
| `relative_skills_dir` | `paths.skills.relative` |
| `relative_detect_dir` | `execution.detection.target` |
| `additional_scan_dirs` | `paths.skills.additional` |
| `override_skills_dir` | AgentConfig 覆盖 |
| `skills_dir()` | `path_resolver.resolve(paths.skills)` |
| `is_installed()` | `path_resolver.is_installed(plugin)` |
| `expand_skill_path()` | 迁移到 `path_resolver.rs` |

### 5.2 受影响代码迁移

| 当前 | 迁移后 |
|------|--------|
| `tool_adapters.rs` → `ToolAdapter` | `agent/plugin.rs` → `AgentPlugin` |
| `tool_adapters.rs` → `expand_skill_path()` | `agent/path_resolver.rs` → `resolve()` |
| `scanner.rs` 使用 `ToolAdapter[]` | 使用 `AgentPlugin[]` |
| `commands.rs:952` 构建 deploy targets | 使用 `AgentPlugin.paths` |
| `commands.rs:491` customToolAdapters | 合并到 AgentPlugin 自定义插件 |
| `sync_engine.rs` 使用 `SkillTargetDir` | 使用 `AgentPlugin` 路径 |

---

## 6. 统一部署引擎

```rust
// src-tauri/src/agent/deployer.rs

/// 统一资源部署接口
pub trait ResourceDeployer {
    /// 部署资源到目标 Agent
    fn deploy(
        &self,
        resource: &ResourceManifest,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<(), AppError>;

    /// 从目标 Agent 移除资源
    fn remove(
        &self,
        resource: &ResourceManifest,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<(), AppError>;

    /// 列出已部署的资源
    fn list_deployed(
        &self,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<Vec<ResourceManifest>, AppError>;
}

struct DeployTarget {
    project_path: PathBuf,
    agent_id: String,
    scope: DeployScope,  // global | project
}
```

---

## 7. 数据模型

### 7.1 SQLite 表

```sql
CREATE TABLE IF NOT EXISTS agent_plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  execution_json TEXT NOT NULL,     -- AgentExecution
  configuration_json TEXT NOT NULL, -- AgentConfiguration
  capabilities_json TEXT NOT NULL,  -- AgentCapabilities
  paths_json TEXT NOT NULL,         -- AgentResourcePaths
  lifecycle_json TEXT,              -- AgentLifecycle（可选）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 7.2 现有表扩展

```sql
-- 现有 skills 表增加 agent_id 关联（可选）
ALTER TABLE skills ADD COLUMN agent_id TEXT DEFAULT NULL;
-- prompts / actions 同理
```

---

## 8. 后端设计

### 8.1 模块结构

```
src-tauri/src/
├── agent/
│   ├── mod.rs              # 聚合
│   ├── plugin.rs           # AgentPlugin 类型 + 内置注册表
│   ├── plugin_commands.rs  # Tauri 命令
│   ├── path_resolver.rs    # 路径解析引擎
│   ├── deployer.rs         # 统一部署引擎
│   └── registry.rs         # 插件注册表（替代 default_tool_adapters）

删除：
src-tauri/src/skill/tool_adapters.rs  ← 完全替代
```

### 8.2 Tauri 命令

```rust
#[tauri::command]
pub fn list_agent_plugins() -> Result<Vec<AgentPlugin>, AppError>

#[tauri::command]
pub fn get_agent_plugin(id: String) -> Result<AgentPlugin, AppError>

#[tauri::command]
pub fn save_custom_plugin(plugin: AgentPlugin) -> Result<AgentPlugin, AppError>

#[tauri::command]
pub fn delete_custom_plugin(id: String) -> Result<(), AppError>

#[tauri::command]
pub fn resolve_plugin_path(
    plugin_id: String,
    resource_type: String,
    project_path: Option<String>,
) -> Result<String, AppError>

#[tauri::command]
pub fn deploy_resource_to_agent(
    resource_id: String,
    resource_type: String,
    agent_id: String,
    project_path: Option<String>,
) -> Result<(), AppError>

#[tauri::command]
pub fn detect_installed_agents() -> Result<Vec<String>, AppError>
```

---

## 9. 前端设计

### 9.1 新增文件

```
src/features/agent/
├── types/
│   └── agentPlugin.ts       # AgentPlugin 类型
├── data/
│   └── presets.ts           # 内置 Agent 插件定义
├── hooks/
│   └── useAgentPlugins.ts   # 状态管理
├── components/
│   ├── AgentPluginCard.tsx      # 插件卡片
│   ├── AgentPluginDetails.tsx   # 插件详情（执行/配置/能力/路径）
│   ├── AgentPluginForm.tsx      # 自定义插件表单（schema 生成）
│   └── ResourcePathEditor.tsx   # 路径编辑器
└── api/
    └── agentPluginApi.ts    # IPC 封装
```

### 9.2 UI 集成

**Settings → Agents 面板**：
- 展示 Agent 插件列表（内置 + 自定义）
- 点击展开详情：执行定义 / 配置 Schema / 能力声明 / 路径定义
- 支持添加自定义 Agent 插件
- 检测已安装 Agent

**Library 面板**：
- 增加"按 Agent 分组"视图
- 每个 Agent 下展示其挂载的资源

---

## 10. 关键文件清单

| 文件 | 角色 |
|------|------|
| `src/shared/types/agentPlugin.ts` | AgentPlugin 类型 |
| `src/shared/data/agentPluginPresets.ts` | 内置定义 |
| `src-tauri/src/agent/plugin.rs` | Rust 类型 + 注册表 |
| `src-tauri/src/agent/plugin_commands.rs` | Tauri 命令 |
| `src-tauri/src/agent/path_resolver.rs` | 路径解析 |
| `src-tauri/src/agent/deployer.rs` | 统一部署引擎 |
| `src-tauri/src/agent/registry.rs` | 插件注册表 |
| `src-tauri/src/skill/migrations.rs` | v5→v6 migration |
| `src-tauri/src/skill/tool_adapters.rs` | **删除** |
| `src/features/agent/hooks/useAgentPlugins.ts` | 状态管理 |
| `src/features/agent/components/AgentPluginCard.tsx` | 插件卡片 |
| `src/features/agent/components/AgentPluginDetails.tsx` | 插件详情 |
| `src/features/agent/api/agentPluginApi.ts` | IPC 封装 |

---

## 11. 与 Phase 1/2 关系

| 资源 | 影响 |
|------|------|
| Skills 部署 | 重构：通过 AgentPlugin 路径 |
| Skills CRUD | 无影响 |
| Prompts/Actions | 无影响（可选增加 agent_id） |
| Library 面板 | 扩展：增加 Agent 分组视图 |
| AgentConfig | 保留，关联 plugin_id |
| ToolAdapter | **完全替代** |

---

## 12. 设计决策（已确认）

| # | 问题 | 决策 |
|---|------|------|
| 1 | 内置插件是否允许用户覆盖？ | **允许** — 用户可覆盖内置插件的路径/配置，覆盖存储在 AgentConfig 中 |
| 2 | Schema 验证用 JSON Schema 还是简化版？ | **JSON Schema** — 标准格式，支持 UI 自动生成和校验 |
| 3 | 部署引擎是否统一处理所有资源类型？ | **统一处理** — 单一 `ResourceDeployer` trait 处理 skills/prompts/actions/mcp/commands |
| 4 | 自定义插件是否需要版本管理？ | **不需要** — 始终使用最新版本，无历史版本概念 |

---

## 13. 用户覆盖机制

内置插件定义默认值，用户可在 AgentConfig 中覆盖：

```
AgentPlugin (内置定义)          AgentConfig (用户覆盖)
─────────────────────          ─────────────────────
paths.skills.relative:         skill_override_path: {
  ".claude/skills"               ".claude/skills": ".my-skills"
                             }
                             → 解析时优先使用用户覆盖
```

覆盖存储在 `~/.neeko/config.json` → `agentPluginOverrides{}`。
