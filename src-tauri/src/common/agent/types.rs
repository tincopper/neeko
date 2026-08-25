//! Agent 配置定义 —— 唯一数据结构（Single Source of Truth）。
//!
//! 一个 Agent 就是一个 [`AgentConfig`]：既是设置页编辑/持久化的数据结构，也是
//! 内置（`builtin::builtin_configs`）与自定义（`customAgents`）统一的载体。
//! 运行时按需经 `AgentProvider::from(&config)` 包装为行为对象（adapter 创建、
//! 部署路径解析、安装检测）。
//!
//! CLI / CHAT / Headless 是三个正交能力：
//! - CLI：`command` 非空（终端 Tab + PTY 跑 agent 自带 TUI）；
//! - CHAT：`chat: Option<ChatStart>`（`kind:'agent-chat'` Tab + adapter 驱动）；
//! - Headless：`prompt_args`（程序化单轮，如 AI commit）。

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;

/// CHAT 能力 = 传输协议 + 启动方式（自包含，`AgentProvider::chat_adapter` 直接
/// match，无需按 agent id 特判）。序列化为小写字符串（`"acp"|"serve"|"jsonl"|"mock"`），
/// 兼容旧配置 `chat_transport` 字面量。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ChatStart {
    /// Agent Client Protocol over JSON-RPC stdio（子进程）。
    /// `args` 为二进制后附加的 ACP 子命令参数（opencode 需 `["acp"]`；二进制本身
    /// 即 ACP 则空）。args 是内置启动特例，不随配置持久化。
    Acp {
        /// ACP 子命令参数（opencode: `["acp"]`）。
        args: Vec<String>,
    },
    /// opencode serve：HTTP + SSE，支持按会话/轮次选择模型。
    Serve,
    /// JSON-Lines stdio（自定义协议，保留供未来 agent 声明）。
    Jsonl,
    /// 进程内 mock（mockAgent，无子进程）。
    Mock,
}

impl ChatStart {
    /// 传输的协议标识（小写字符串）。
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Acp { .. } => "acp",
            Self::Serve => "serve",
            Self::Jsonl => "jsonl",
            Self::Mock => "mock",
        }
    }
}

impl Serialize for ChatStart {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ChatStart {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(match s.as_str() {
            "serve" => Self::Serve,
            "jsonl" => Self::Jsonl,
            "mock" => Self::Mock,
            // "acp" 及未知值 → Acp（args 由内置定义提供，用户配置不持久化 args）。
            _ => Self::Acp { args: Vec::new() },
        })
    }
}

/// 安装检测方式。
///
/// 注意：必须是**结构体载荷**变体（`Command { target }`）而非 newtype 元组
/// 变体（`Command(String)`）——`#[serde(tag)]` 的 internally-tagged 枚举无法
/// 序列化字符串/数字等标量载荷（serde 报 "cannot serialize tagged newtype
/// variant"），会导致 `AgentConfig` 整体序列化失败（`list_agents` 等命令
/// 直接报错）。结构体载荷序列化为 `{"type":"command","target":"..."}`，
/// 与前端 `Detection` 类型一致。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Detection {
    /// 命令是否存在于 PATH（如 `opencode`）。
    Command {
        /// 待检测的命令名。
        target: String,
    },
    /// 目录模板（含 `{{projectPath}}` 等变量）是否存在。
    Directory {
        /// 目录路径模板。
        target: String,
    },
}

/// 部署契约 —— Neeko 实际管理的三类资源目标。
///
/// `Option` 路径即支持位：`Some` = 支持该类型部署。skills 为必填（skill 库核心）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploySpec {
    /// skills 目录模板（支持 `{{home}}` / `{{projectPath}}` 变量）。
    pub skills: String,
    /// slash commands 目录模板（`None` = 不支持 command 部署）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commands: Option<String>,
    /// MCP 配置文件模板（`None` = 不支持 MCP 部署）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_config: Option<String>,
}

impl DeploySpec {
    /// 是否支持 MCP 部署。
    #[must_use]
    pub const fn supports_mcp(&self) -> bool {
        self.mcp_config.is_some()
    }

    /// 是否支持 slash command 部署。
    #[must_use]
    pub const fn supports_commands(&self) -> bool {
        self.commands.is_some()
    }
}

/// Information about a model supported by an agent（运行时动态发现，不持久化）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelInfo {
    /// Model identifier (slug), e.g. "anthropic/claude-sonnet-4-20250514".
    pub id: String,
    /// Human-readable model name.
    pub name: String,
    /// Upstream provider ID (e.g. "anthropic", "openai").
    #[serde(default)]
    pub provider_id: Option<String>,
    /// Upstream provider name.
    #[serde(default)]
    pub provider_name: Option<String>,
    /// Supported reasoning efforts (e.g. "low", "medium", "high").
    #[serde(default)]
    pub supported_reasoning_efforts: Vec<String>,
    /// Default reasoning effort, if any.
    #[serde(default)]
    pub default_reasoning_effort: Option<String>,
    /// Context window in tokens, if known.
    #[serde(default)]
    pub context_window: Option<u32>,
    /// Whether this model is free.
    #[serde(default)]
    pub is_free: bool,
}

/// Agent 配置 —— 唯一数据结构（内置 + 自定义同构，设置页编辑/持久化的对象）。
///
/// 能力正交：CLI = `command` 非空；CHAT = `chat: Some(_)`；Headless = `prompt_args`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentConfig {
    /// Unique identifier for this agent.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// Whether this agent is enabled.
    pub enabled: bool,
    /// 是否为内置 agent。仅由后端设置，前端无法伪造。
    #[serde(default)]
    pub is_builtin: bool,
    /// Executable command path（CLI 能力基础；空 = 无终端 TUI，如 mockAgent）。
    pub command: String,
    /// Arguments to pass to the command.
    pub args: Vec<String>,
    /// Environment variables for the agent process.
    pub env: HashMap<String, String>,
    /// CHAT 能力：传输协议 + 启动方式（`None` = 无 CHAT 能力）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat: Option<ChatStart>,
    /// prompt 前置参数（Headless 能力），如 `["--bare", "-p"]` 表示
    /// `command --bare -p "<prompt>" [post_prompt_args]`。None = 无 Headless 能力。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_args: Option<Vec<String>>,
    /// prompt 后置参数，追加在 prompt 之后。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_prompt_args: Option<Vec<String>>,
    /// 全局 skills 目录 override（如 `~/.claude/skills`；opencode 特例
    /// `~/.config/opencode/skills`；与 `deploy.skills` 项目级模板并存）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_path: Option<String>,
    /// 安装检测方式（`None` = 不可检测，恒视为已安装，如 mockAgent）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detection: Option<Detection>,
    /// 部署契约（skills / commands / MCP 目标模板）。
    #[serde(default)]
    pub deploy: DeploySpec,
}

impl AgentConfig {
    /// 是否具备 CHAT 能力。
    #[must_use]
    pub const fn is_chat_agent(&self) -> bool {
        self.chat.is_some()
    }

    /// 是否具备 CLI 能力（有命令即可终端 TUI）。
    #[must_use]
    pub const fn is_cli_agent(&self) -> bool {
        !self.command.is_empty()
    }

    /// 是否具备 Headless 能力（AI commit 等程序单轮）。
    #[must_use]
    pub const fn is_headless_agent(&self) -> bool {
        self.prompt_args.is_some()
    }

    /// 拼装 `command + args` 作为子进程启动参数。
    #[must_use]
    pub fn cmd_vec(&self) -> Vec<String> {
        let mut v = Vec::with_capacity(1 + self.args.len());
        v.push(self.command.clone());
        v.extend(self.args.iter().cloned());
        v
    }

    /// Resolve prompt prefix args. Returns None if agent doesn't support prompt mode.
    #[must_use]
    pub fn resolve_prompt_args(&self) -> Option<Vec<String>> {
        self.prompt_args.clone()
    }

    /// Resolve prompt suffix args (appended after prompt).
    #[must_use]
    pub fn resolve_post_prompt_args(&self) -> Vec<String> {
        self.post_prompt_args.clone().unwrap_or_default()
    }
}
