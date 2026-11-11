//! Agent 静态事实表：**一个 CLI 的「在哪 + 报什么 + 落在哪」只允许写一遍**。
//!
//! # 为什么需要这张表（第一性原理）
//!
//! 同一件事实被抄在多处时，漂移只是时间问题 —— 而漂移的表现是**静默的**：
//! 「扫到 0 个会话」是合法结果，于是没人发现。本仓已经为此付过两次代价：
//!
//! - `qoder`：hook 配置装进 `~/.qoder`，conversation adapter 却读 `~/.qodercli/projects`
//!   ⇒ History 里 qoder **一条会话都没有**；
//! - `codebuddy`：adapter 读 `~/.codebuddy/sessions/*.json`（空目录），真实数据在
//!   `~/.codebuddy/projects/**/*.jsonl` ⇒ 只有两条兜底标题。
//!
//! 两处的共因完全相同：**「配置根」与「转录根」是同一个事实的两个投影**，却被写成两份
//! 字面量。所以这里把它们并排放在一行里 —— 同一行内的两个字段无法互相漂移。
//!
//! # 边界
//!
//! 这里只放**静态且与进程无关**的事实（路径、模式、hook 来源）。运行期可被用户覆盖的
//! 运行配置（命令、参数、env）属于 [`crate::common::agent::types::AgentConfig`]，两者
//! 分开：descriptor 是编译期常量，不该被用户编辑。
//!
//! `hook_source` 是 `/hook/{source}` 的路由段，也是设置页与回执里的展示名 ——
//! 它与 adapter 的 `agent_id` **不总是同名**（`claude-code` ↔ `claude`），
//! 这张表是那条对应关系的唯一落点。

use std::path::PathBuf;

/// 转录文件定位：相对配置根的固定子目录，或自己的绝对定位。
///
/// 之所以把它做成枚举而不是一个函数指针：**「跟配置同根」本身是值得表达的事实**。
/// qoder / codebuddy / claude 的会话都在 `<配置根>/projects/` 下 —— 把这条关系写进类型，
/// 「配置根改了、转录根没跟上」就变成一个不可能发生的形态（它们字面上是同一个字段）。
pub enum TranscriptRoot {
    /// `<配置根>/<subdir>`（如 `~/.qoder` + `projects`）。
    UnderConfig(&'static str),
    /// 与配置根无关的绝对定位（XDG 数据目录 / 第三方约定）。
    Elsewhere(fn() -> Option<PathBuf>),
}

/// 一个 CLI 的静态事实。
pub struct AgentDescriptor {
    /// Agent 标识：`AgentConfig.id` / adapter 的 `agent_id` / hook 回执里的展示名同一值。
    pub id: &'static str,
    /// `/hook/{source}` 的路由段与逐 CLI 开关键；`None` = 该 CLI 不向 Neeko 上报 hook。
    ///
    /// `None` 是**能力事实**，不只是「没装」：这类 CLI 没有推送通道，实时标题只能来自用户
    /// 改名（`User`）或已扫过的 conversation 缓存 —— 而缓存那条腿本身由 hook 事件驱动
    /// （`wiring::hooks::project`），所以实际不可达。它们的会话在侧栏只会停在占位标签。
    /// 要补上，是给这些 CLI 加一条上报面（`HOOK_TARGETS` 一行），**不是**改标题判据。
    pub hook_source: Option<&'static str>,
    /// CLI 配置根（hook 落地处所依附的根；解析不到 = 本机未初始化该 CLI）。
    pub config_root: fn() -> Option<PathBuf>,
    /// 会话转录的落点（目录 + glob 模式；相对 `config_root` 或绝对）。
    pub transcripts: Option<TranscriptSpec>,
}

/// 转录落点：根 + 相对根的 glob。
pub struct TranscriptSpec {
    /// 转录根的定位方式（与配置同根的相对子目录，或绝对定位）。
    pub root: TranscriptRoot,
    /// 相对根的 glob（`**/` 由 manager 统一补前缀，见 conversation-adapter.md §4.3.1）。
    pub pattern: &'static str,
}

impl AgentDescriptor {
    /// 该 CLI 的转录根（绝对路径）。
    ///
    /// 无法解析（`$HOME` 未知 / 行未声明转录）⇒ **空路径**。这与「未登记的行」同一个失败
    /// 形态：`transcript_root` 的调用方（扫描器）因此只需判 `is_empty()`，而不是去猜一个
    /// 形如 `~`（永不展开、相对当前目录）的假路径。
    fn transcript_root(&self) -> PathBuf {
        let Some(spec) = &self.transcripts else {
            return PathBuf::new();
        };
        match &spec.root {
            TranscriptRoot::UnderConfig(subdir) => {
                (self.config_root)().map_or_else(PathBuf::new, |root| root.join(subdir))
            }
            TranscriptRoot::Elsewhere(locate) => locate().unwrap_or_default(),
        }
    }
}

// ─── 配置根定位（本机环境事实，含官方支持的重定位变量）─────────────────────────
//
// 这些函数从这里导出：`agent::hooks::targets::dirs` 直接 re-export（hook 安装面复用同一份
// 实现），conversation adapter 经 [`transcript_root`] 间接复用。**不允许第二份实现**。

/// home 目录（不可解析 = 本机环境异常，由各根函数返回 `None`）。
fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// 官方重定位变量优先（绝对路径才算数：相对值会让「写入侧」与「读取侧」指向不同地方）。
fn env_abs_path(key: &str) -> Option<PathBuf> {
    let value = std::env::var_os(key)?;
    let path = PathBuf::from(value);
    path.is_absolute().then_some(path)
}

/// 自供源（无本地配置根）：DSH 的文件由它自己的插件管理，Neeko 不碰。
const fn none_config_root() -> Option<PathBuf> {
    None
}

/// 某个以 `~/.<name>` 为配置根的 CLI（codebuddy / qoder / gemini / grok / reasonix）。
fn home_dot(name: &str) -> Option<PathBuf> {
    home().map(|home| home.join(format!(".{name}")))
}

/// Claude Code 配置根：`CLAUDE_CONFIG_DIR` 优先，否则 `~/.claude`。
#[must_use]
pub fn claude_config_root() -> Option<PathBuf> {
    env_abs_path("CLAUDE_CONFIG_DIR").or_else(|| home_dot("claude"))
}

/// CodeBuddy 配置根：`~/.codebuddy`（Claude Code 的 fork，无官方重定位变量）。
#[must_use]
pub fn codebuddy_config_root() -> Option<PathBuf> {
    home_dot("codebuddy")
}

/// Qoder 配置根：`~/.qoder`。
#[must_use]
pub fn qoder_config_root() -> Option<PathBuf> {
    home_dot("qoder")
}

/// Codex 配置根：`CODEX_HOME` 优先，否则 `~/.codex`。
#[must_use]
///
/// 相对值被**有意忽略**（`env_abs_path`）：旧实现接受任意非空值，于是「相对 `CODEX_HOME`
/// 让写入侧与读取侧指向不同目录」这类漂移在两端都无法自证。与 claude / opencode 同一规则。
pub fn codex_config_root() -> Option<PathBuf> {
    env_abs_path("CODEX_HOME").or_else(|| home_dot("codex"))
}

/// Pi 配置根：`~/.pi/agent`（hook 面是其中的 `extensions/`）。
#[must_use]
pub fn pi_config_root() -> Option<PathBuf> {
    home().map(|home| home.join(".pi").join("agent"))
}

/// OMP 配置根：`~/.omp/agent`。
#[must_use]
pub fn omp_config_root() -> Option<PathBuf> {
    home().map(|home| home.join(".omp").join("agent"))
}

/// Gemini 配置根：`~/.gemini`（会话在 `tmp/`）。
#[must_use]
pub fn gemini_config_root() -> Option<PathBuf> {
    home_dot("gemini")
}

/// Grok 配置根：`~/.grok`（会话在 `sessions/`）。
#[must_use]
pub fn grok_config_root() -> Option<PathBuf> {
    home_dot("grok")
}

/// Reasonix 配置根：`~/.reasonix`（会话在 `projects/<sanitized>/sessions/`）。
#[must_use]
pub fn reasonix_config_root() -> Option<PathBuf> {
    home_dot("reasonix")
}

/// OpenCode 数据根：`OPENCODE_CONFIG_DIR` 优先，否则 XDG 风格 `~/.local/share/opencode`。
///
/// 不跟随 `dirs::data_dir()`：opencode 全平台都用 XDG 形态（实测 macOS 亦然），
/// 而 `dirs::data_dir()` 在 macOS 给 `~/Library/Application Support`。
fn opencode_data_root() -> Option<PathBuf> {
    env_abs_path("OPENCODE_CONFIG_DIR")
        .or_else(|| home().map(|home| home.join(".local").join("share").join("opencode")))
}

/// 全部受管 Agent 的静态事实（**新增一个 CLI = 加一行**）。
///
/// **顺序无展示语义**：设置页的清单与顺序来自 `HOOK_TARGETS`（安装面），本表只回答
/// 「这个 CLI 的会话落在哪」。`id` 与 `hook_source` 各自唯一（`tests` 守护），
/// 两表按 `hook_source` 双向一致（`targets/tests.rs` 守护）。
pub static AGENTS: &[AgentDescriptor] = &[
    AgentDescriptor {
        id: "claude-code",
        hook_source: Some("claude"),
        config_root: claude_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("projects"),
            pattern: "**/*.jsonl",
        }),
    },
    AgentDescriptor {
        id: "codebuddy",
        hook_source: Some("codebuddy"),
        config_root: codebuddy_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("projects"),
            pattern: "**/*.jsonl",
        }),
    },
    AgentDescriptor {
        id: "qoder",
        hook_source: Some("qoder"),
        config_root: qoder_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("projects"),
            pattern: "**/*.jsonl",
        }),
    },
    AgentDescriptor {
        id: "codex",
        hook_source: Some("codex"),
        config_root: codex_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("sessions"),
            pattern: "rollout-*.jsonl",
        }),
    },
    AgentDescriptor {
        id: "pi",
        hook_source: Some("pi"),
        config_root: pi_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("sessions"),
            pattern: "*.jsonl",
        }),
    },
    AgentDescriptor {
        id: "omp",
        hook_source: Some("omp"),
        config_root: omp_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("sessions"),
            pattern: "*.jsonl",
        }),
    },
    AgentDescriptor {
        id: "opencode",
        hook_source: Some("opencode"),
        config_root: opencode_data_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::Elsewhere(opencode_data_root),
            pattern: "opencode*.db",
        }),
    },
    AgentDescriptor {
        id: "gemini",
        hook_source: None,
        config_root: gemini_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("tmp"),
            pattern: "*.json",
        }),
    },
    AgentDescriptor {
        id: "grok",
        hook_source: None,
        config_root: grok_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("sessions"),
            pattern: "**/summary.json",
        }),
    },
    // DSH 是**自供源**（`packages/dsh-neeko` 插件在 DSH 进程内上报）：Neeko 既不写它的配置，
    // 也不读它的转录 —— 因此没有配置根、没有 transcripts。它必须在表里，否则
    // `/hook/dsh` 会落到「白名单外」而静默丢弃（见 agent-hooks-domain.md）。
    AgentDescriptor {
        id: "dsh",
        hook_source: Some("dsh"),
        config_root: none_config_root,
        transcripts: None,
    },
    AgentDescriptor {
        id: "reasonix",
        hook_source: None,
        config_root: reasonix_config_root,
        transcripts: Some(TranscriptSpec {
            root: TranscriptRoot::UnderConfig("projects"),
            pattern: "**/sessions/*.jsonl",
        }),
    },
];

/// 按 agent id 查一行。
#[must_use]
pub fn descriptor(agent_id: &str) -> Option<&'static AgentDescriptor> {
    AGENTS.iter().find(|row| row.id == agent_id)
}

/// 该 agent 的转录根。
///
/// 未登记的行返回**空路径**（扫描 0 个文件），而不是 panic —— 但没有行就是缺陷，
/// 由 `conversation::adapters::registry::tests::every_adapter_has_a_descriptor_row`
/// 在 CI 阶段拦下（与删除能力台账同一个形态：声明缺失必须红，不能靠运行时发现）。
#[must_use]
pub fn transcript_root(agent_id: &str) -> PathBuf {
    descriptor(agent_id).map_or_else(PathBuf::new, AgentDescriptor::transcript_root)
}

/// 该 agent 的转录 glob；未登记 ⇒ 空串（同 [`transcript_root`] 的失败语义）。
#[must_use]
pub fn file_pattern(agent_id: &str) -> &'static str {
    descriptor(agent_id)
        .and_then(|row| row.transcripts.as_ref())
        .map_or("", |spec| spec.pattern)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 两列唯一性：`id` 是 adapter / 注册表 / 缓存的键，`hook_source` 是路由段。
    /// 任一重复都会让「按 id 找行」与「按 source 路由」出现歧义。
    #[test]
    fn ids_and_hook_sources_are_unique() {
        let mut ids: Vec<&str> = AGENTS.iter().map(|row| row.id).collect();
        ids.sort_unstable();
        let mut deduped = ids.clone();
        deduped.dedup();
        assert_eq!(ids, deduped, "agent id 重复");

        let mut sources: Vec<&str> = AGENTS.iter().filter_map(|row| row.hook_source).collect();
        sources.sort_unstable();
        let mut deduped = sources.clone();
        deduped.dedup();
        assert_eq!(sources, deduped, "hook_source 重复");
    }

    /// 每一行都要把「会话在哪」表态清楚：
    ///
    /// - 本地转录型：`transcripts` 必须有非空 pattern，且配置根可解析；
    /// - 自供源型（DSH）：显式 `transcripts: None` + 有 `hook_source`（数据由它自己的插件上报）。
    ///
    /// 两者都不满足就是「既没有文件也没有上报」—— 一个永远不会有标题的 agent。
    #[test]
    fn every_row_states_where_its_sessions_live() {
        for row in AGENTS {
            match (&row.transcripts, row.hook_source) {
                (Some(spec), _) => {
                    assert!(!spec.pattern.is_empty(), "{} 的 pattern 为空", row.id);
                    assert!(
                        (row.config_root)().is_some(),
                        "{} 的配置根必须可解析（否则转录根也无从推导）",
                        row.id
                    );
                }
                (None, Some(_)) => {
                    assert!(
                        (row.config_root)().is_none(),
                        "{} 声明了配置根却不声明转录：要么它是自供源，要么少了 transcripts",
                        row.id
                    );
                }
                (None, None) => panic!("{} 既没有转录也没有上报源", row.id),
            }
        }
    }

    /// 转录根必须是配置根的后代（`UnderConfig`）或**显式**的绝对定位（`Elsewhere`）。
    ///
    /// 它拦的是「同一事实被抄成两处、各自 join home」这种隐式漂移（qoder 的形态：
    /// `~/.qoder` 装 hook、`~/.qodercli` 读会话）。注意它**不能**拦「有人把根写成别的
    /// 绝对路径」—— 那需要真实样例探针（见 M2 的 fixture probe），这里只保证关系必须
    /// 被**写清楚**，而不是歪曲成双方都对的两次 home join。
    #[test]
    fn transcript_root_hangs_under_the_config_root_or_is_absolute() {
        for row in AGENTS.iter().filter(|row| row.transcripts.is_some()) {
            let config = (row.config_root)().expect("config root");
            let root = row.transcript_root();
            let under_config = root.starts_with(&config);
            let elsewhere_absolute = matches!(
                row.transcripts.as_ref().map(|spec| &spec.root),
                Some(TranscriptRoot::Elsewhere(_))
            ) && root.is_absolute();
            assert!(
                under_config || elsewhere_absolute,
                "{} 的转录根 {:?} 既不在配置根 {:?} 之下，也不是显式的绝对定位",
                row.id,
                root,
                config
            );
        }
    }

    /// 查询助手与表一致；**未登记的行一律返回空**（同一个失败形态，不造假路径）。
    #[test]
    fn lookup_helpers_agree_with_the_table() {
        assert_eq!(file_pattern("qoder"), "**/*.jsonl");
        assert!(transcript_root("qoder").ends_with(".qoder/projects"));
        assert!(transcript_root("unknown-cli").as_os_str().is_empty());
        assert_eq!(file_pattern("unknown-cli"), "");
        // 自供源（DSH）没有本地转录：空根而不是某个 home 下的假目录。
        assert!(transcript_root("dsh").as_os_str().is_empty());
    }
}
