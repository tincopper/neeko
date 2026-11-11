//! **事件模型**：CLI hook 上报的一条状态事件（源 B 的公共数据资产）。
//!
//! # 这是整个 ingest 的核心类型
//!
//! 一个上报事件从 CLI 的 hook 插件发出，经 shim → HTTP → 本域，最终**被多个消费者使用**：
//!
//! | 消费者 | 用途 | 状态 |
//! |---|---|---|
//! | 通知中心（[`super::notify`]） | 弹系统通知 | 已有 |
//! | Agent 实时状态面板 | 会话进度、当前工具、等待时长 | 规划中 |
//! | 未来其他（审计 / 统计 / 外部订阅） | — | — |
//!
//! 故**事件模型独立成文件，不依附任何一个消费者**：新增消费者只需读 [`HookEvent`]，
//! 不需要改动采集侧，也不需要理解通知域的词汇。
//!
//! # 与模板的契约
//!
//! 上报模板（`agent/hooks/templates/`，writers 生成）已把各 CLI 的原生事件名归一为
//! **语义 event_key**（与源 A `agent/chat/notify.rs` 同命名空间）。服务端不再认识
//! CLI 原生事件名 —— 新增一个 CLI 的翻译成本收敛在它自己的模板里。
//!
//! 字段白名单 + `serde(default)`：模板比服务端新时，未知字段被忽略（前向兼容）。

use serde::Deserialize;

use crate::common::agent::title::TitleSource;

/// 语义事件键：用户提交了一次 prompt（这一轮开始）。
///
/// # 为什么常量在这里
///
/// 它是**hook 上报面**的词汇：模板（写入 shim 的 argv）与 Rust 数据表
/// （`agent::hooks::targets::entries::CLAUDE_COMPAT_ENTRIES`）必须逐字一致，否则上报静默失效。
/// 单源放在本文件，两侧都引用它 —— 各写一份字面量只能靠测试粘住，改名时先红的是测试而不是编译器。
///
/// 它**不**进 `agent::chat::notify::event_keys`：那张表是通知词汇表（设置页清单 + 节流主键），
/// `ingest::notify::classify` 对未知键返回 `None` 正是本键能存活的前提 —— 它只驱动状态，不弹通知。
pub const EVENT_TURN_STARTED: &str = "turn_started";

/// CLI hook 上报的一条状态事件（Neeko 与 shim 之间唯一的载荷契约）。
///
/// 字段回答三个问题：**是谁**（`agent_session_id`）、**发生了什么**（`event` / `detail` /
/// `title` + `title_source`）、**在哪**（`cwd` / `hints`）。
///
/// # 扩展指引
///
/// 新增字段时：① 加 `#[serde(default)]` 保证旧模板仍可解析；② 若是**消费者专用**的
/// 派生信息，优先写在上报侧（模板）而不在这里膨胀；③ 必须同时在
/// `templates/tests.rs` 的契约锚点里补断言，避免「模板与服务端字段漂移」。
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct HookEvent {
    /// agent 侧会话 id（归属 instance 的原料）。
    pub agent_session_id: String,
    /// 语义事件键（模板侧归一）：`turn_completed` / `approval_requested` / `input_requested`
    /// / `session_failed`。
    ///
    /// 字符串而非枚举：模板与服务端可独立发版（枚举会让「未知事件」变成反序列化失败，
    /// 破坏 fail-open）。未知值由各消费者自行忽略。
    pub event: String,
    /// 上报时的工作目录（归属链第 2/3 级原料）。
    #[serde(default)]
    pub cwd: Option<String>,
    /// 人类可读细节（如 permission 标题、工具名），可缺省；截断由消费方负责。
    #[serde(default)]
    pub detail: Option<String>,
    /// 会话主题：模板侧解析好的 agent 原生标题，或原生标题缺失时回退的首条用户消息。
    /// 模板侧做优先级判定，服务端只做噪声过滤。
    #[serde(default)]
    pub title: Option<String>,
    /// 主题**来自哪一类观测**：`"native"`（CLI 自己写的会话名）或 `"prompt"`（用户敲的字）。
    ///
    /// 为什么必须随文本一起上报：标题阶梯的质量序（`Prompt < Native`）是判据的输入，
    /// 少了它「用户敲的字」会被当成 CLI 自述，于是同一串文本在实时侧栏与历史列表上
    /// 拿到两种判决（侧栏不剥客套包装、历史列表剥；单 token 路径在侧栏被判负）。
    /// 模板侧只在**取到哪个字段**处声明一次，服务端不猜。
    #[serde(default)]
    pub title_source: Option<String>,
    /// 环境提示（Neeko 自有 PTY 注入 env 的回传），缺省视为全 None。
    #[serde(default)]
    pub hints: super::attribution::EnvHints,
}

impl HookEvent {
    /// 这条事件是否可用（会话身份缺失的上报对所有消费者都无意义）。
    ///
    /// 判据故意极窄：只要求 `agent_session_id` 非空。其余字段的可用性由各消费者决定
    /// （通知需要 `event` 可识别；状态面板可能只需要 `cwd`）。
    #[must_use]
    pub fn is_usable(&self) -> bool {
        !self.agent_session_id.trim().is_empty()
    }

    /// 会话主题（已 trim、已过滤占位标题）；`None` = 无主题可用。
    ///
    /// 供任意消费者复用 —— 通知用它做通知标题，状态面板用它做会话名。
    #[must_use]
    pub fn topic(&self) -> Option<&str> {
        self.title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .filter(|t| !is_placeholder_title(t))
    }

    /// 主题 + 它的来源（`None` = 无主题可用）。
    ///
    /// 来源缺省 ⇒ [`TitleSource::Native`]：模板比服务端旧时（已安装的 shim 还没重装）
    /// 它取的是 `session_title` 优先的旧字段链，按既有语义解释，不猜成 Prompt。
    #[must_use]
    pub fn topic_with_source(&self) -> Option<(TitleSource, &str)> {
        let topic = self.topic()?;
        let source = match self.title_source.as_deref() {
            Some("prompt") => TitleSource::Prompt,
            _ => TitleSource::Native,
        };
        Some((source, topic))
    }

    /// 人类可读细节（已 trim）；`None` = 无细节。
    #[must_use]
    pub fn detail_trimmed(&self) -> Option<&str> {
        self.detail
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
    }
}

/// 占位标题判定：opencode 自动生成的 `New session - <ISO 时间戳>`。
///
/// 判据放在 agent 域（业务知识），核心域不感知具体文案 —— 新 CLI 若引入别的占位形态，
/// 在此加一条即可，不影响投递链。
fn is_placeholder_title(title: &str) -> bool {
    let Some(rest) = title.strip_prefix("New session") else {
        return false;
    };
    let rest = rest
        .trim_start_matches(|c: char| c == '-' || c.is_whitespace())
        .trim();
    // 前缀命中且余下部分像时间戳（以 4 位年份开头）才算占位：避免误杀正常命名的
    // "New session handling" 这类标题。
    rest.len() >= 4 && rest.as_bytes()[..4].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(event: &str) -> HookEvent {
        HookEvent {
            agent_session_id: "agent-1".into(),
            event: event.into(),
            cwd: None,
            detail: None,
            title: None,
            title_source: None,
            hints: Default::default(),
        }
    }

    /// envelope 反序列化：字段白名单 + 未知字段忽略 + 可选项缺省（模板前向兼容）。
    #[test]
    fn deserializes_whitelisted_fields_and_ignores_unknown() {
        let e: HookEvent = serde_json::from_str(
            r#"{"agent_session_id":"a1","event":"turn_completed","cwd":"/x","future_field":42}"#,
        )
        .expect("valid event");
        assert_eq!(e.agent_session_id, "a1");
        assert_eq!(e.cwd.as_deref(), Some("/x"));
        assert_eq!(e.detail, None);
        assert_eq!(e.hints, Default::default());
    }

    /// 会话身份是唯一的可用性前提（其余字段由消费者自行判断）。
    #[test]
    fn blank_session_id_is_unusable() {
        let mut e = event("turn_completed");
        e.agent_session_id = "   ".into();
        assert!(!e.is_usable());
        e.agent_session_id = "a1".into();
        assert!(e.is_usable());
    }

    /// 主题：trim 后非空且非占位才返回。
    #[test]
    fn topic_trims_and_filters_placeholders() {
        let mut e = event("turn_completed");
        e.title = Some("  修复登录竞态  ".into());
        assert_eq!(e.topic(), Some("修复登录竞态"));

        e.title = Some("   ".into());
        assert_eq!(e.topic(), None);

        e.title = Some("New session - 2026-10-13T02:08:07.973Z".into());
        assert_eq!(e.topic(), None, "占位标题不算主题");

        e.title = Some("New session handling refactor".into());
        assert_eq!(
            e.topic(),
            Some("New session handling refactor"),
            "形近的正常标题不得误杀"
        );
    }

    /// 主题来源：模板声明为 `prompt` 才算用户敲的字；缺省 / 未知值一律按 CLI 自述。
    #[test]
    fn topic_source_defaults_to_native_and_recognises_prompt() {
        let mut e = event("turn_started");
        e.title = Some("修复登录竞态".into());

        assert_eq!(
            e.topic_with_source(),
            Some((TitleSource::Native, "修复登录竞态")),
            "缺省（旧 shim）必须按 Native 解释"
        );

        e.title_source = Some("prompt".into());
        assert_eq!(
            e.topic_with_source(),
            Some((TitleSource::Prompt, "修复登录竞态"))
        );

        // 未知值不是反序列化错误（fail-open），而是退回既有语义。
        e.title_source = Some("something-new".into());
        assert_eq!(
            e.topic_with_source().map(|(s, _)| s),
            Some(TitleSource::Native)
        );

        // 无主题时来源也不存在（不返回 `(_, "")` 这种半成品）。
        e.title = None;
        assert_eq!(e.topic_with_source(), None);
    }

    /// 细节：trim 后空串归一为 None。
    #[test]
    fn detail_trimmed_drops_blank() {
        let mut e = event("approval_requested");
        e.detail = Some("   ".into());
        assert_eq!(e.detail_trimmed(), None);
        e.detail = Some(" Bash  ".into());
        assert_eq!(e.detail_trimmed(), Some("Bash"));
    }
}
