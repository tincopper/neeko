//! 语言调试后端抽象（编排层，§9.4 方案 C）。
//!
//! 调试链路分两层：
//!
//! - [`DebugAdapterPlugin`]（协议层，`plugin.rs`）：**无状态** —— 怎么和该语言的 DAP 适配器
//!   说话（spawn 描述 / launch 载荷 / 握手顺序）。各语言都是零大小 static 单例。
//! - [`LanguageBackend`]（编排层，本文件）：**有状态依赖** —— 怎么为这种语言做完整调试
//!   （能力探测 / 会话形态规划 / 断点源路径翻译 / 环境支持性 / 错误文案）。只有存在编排差异
//!   的语言才实现（当前仅 Java，见 `adapter::java::backend`）；Go / Lldb 走通用 spawn 路径
//!   （`backend_for` 未命中即既有行为，§9.7）。
//!
//! 组合关系：`JavaBackend { plugin: JavaAdapter, … }` —— 编排层**组合**协议层，不继承。

use async_trait::async_trait;

use super::plugin::DebugAdapterPlugin;
use crate::common::executor::factory::ExecTarget;
use crate::common::executor::ProcessGuard;
use crate::dap::types::{JavaDebugTarget, JavaJdtlsTarget, LaunchConfig};
use crate::AppError;
use crate::AppStateWrapper;

/// 一次调试动作的统一请求面（带 kind 的擦除容器）。
///
/// 目前仅 Java 有编排后端（A 与 B' 两种 target）。Go / Lldb 不经过本类型 —— 它们走
/// 既有 `DapManager::start_session` 通用 spawn 路径。新增语言的请求在需要编排时加入变体。
///
/// `project_id` 随请求携带：编排需要它解析执行环境（`AppStateWrapper::resolve_project`）
/// 与项目根，与 target 同源于一次编辑器 Debug 动作。
#[derive(Debug, Clone)]
pub enum DebugRequest {
    /// Java A（自写 host，attach-first）：spawn 测试 JVM + attach。
    JavaAttach {
        /// 目标项目 id（解析执行环境 / 项目根用）。
        project_id: String,
        /// attach-first 调试目标（command / cwd / test_name / classpath）。
        target: JavaDebugTarget,
    },
    /// Java B'（JDTLS 内 java-debug，launch）：能力探测 → 直连外部端点。
    JavaJdtls {
        /// 目标项目 id（解析执行环境 / 项目根用）。
        project_id: String,
        /// JDTLS 后端调试目标（probe_class / main_class / args / project_name）。
        target: JavaJdtlsTarget,
    },
}

impl DebugRequest {
    /// 该请求所属的**语言 kind** —— 编排后端注册表的查找键。
    ///
    /// 新增语言必须在这里给出 kind（`match` 缺分支即编译错误），调用点不再硬编码
    /// 语言名字符串（曾经 `start_language_debug` 里写死 `"java"`，与注册表键、
    /// 与 `config.type_` 三种表示并存）。
    #[must_use]
    pub const fn kind(&self) -> crate::dap::types::AdapterKind {
        match self {
            Self::JavaAttach { .. } | Self::JavaJdtls { .. } => {
                crate::dap::types::AdapterKind::Java
            }
        }
    }

    /// 目标项目 id（解析执行环境 / 项目根都用它）。
    #[must_use]
    pub fn project_id(&self) -> &str {
        match self {
            Self::JavaAttach { project_id, .. } | Self::JavaJdtls { project_id, .. } => project_id,
        }
    }
}

/// backend `plan` 的输出：会话形态（owned，避免借用生命周期）。
///
/// - [`SessionRoutePlan::Spawn`]：Neeko spawn 子进程（go / lldb / Java-A），可带附属 debuggee。
/// - [`SessionRoutePlan::Connect`]：直连 Neeko 不拥有的外部 DAP 端点（B'）。
///
/// 不 `derive(Debug)`：`ProcessGuard` 不实现 `Debug`（进程句柄无自省价值）。
pub enum SessionRoutePlan {
    /// 传统 spawn 形态。
    Spawn {
        /// 可选附属进程清理句柄（Java-A 的测试 JVM）。
        debuggee: Option<ProcessGuard>,
        /// 附属 debuggee 的输出行流（`("<stream>", line)`）；会话建立后由调用方挂载输出泵。
        /// 无附属进程时为 `None`。
        debuggee_output: Option<tokio::sync::mpsc::Receiver<(String, String)>>,
    },
    /// 外部 DAP 端点（`127.0.0.1:<port>`），不 spawn、无进程守卫。
    Connect {
        /// 外部端点地址。
        endpoint: String,
    },
}

/// backend `plan` 的统一结果：三态（不自动换引擎，见 §2.5）——与 `debug_java_start`
/// 的 IPC 契约一致，前端按 `kind` 分发。
///
/// 不 `derive(Debug)`：`Launch.route` 含 `ProcessGuard`（不实现 `Debug`）。
pub enum SessionPlan {
    /// 可以起会话。
    Launch {
        /// 会话形态（spawn / connect）。
        route: SessionRoutePlan,
        /// 组装好的 launch 配置（装箱避免与轻量变体的尺寸差）。
        config: Box<LaunchConfig>,
        /// 会话建立后要写入 Debug Console 的提示（如被剔除的断点原因）。
        notes: Vec<String>,
    },
    /// 稍后可成：不建会话、不报错，前端显示等待并可重试。
    Warming {
        /// 呈现给用户的原因（如 import 进行中）。
        detail: String,
    },
    /// 不可用：不建会话、不换引擎。
    Unavailable {
        /// 面向用户的信息。
        message: String,
        /// 是否属事前可静态判定的不可用（前端据此决定询问或报错）。
        statically_detectable: bool,
    },
}

/// 编排层的统一返回（manager → 命令层 → IPC）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DebugStartOutcome {
    /// 会话已建立。
    #[serde(rename = "session")]
    Session {
        /// 会话信息。
        session: crate::dap::types::DapSessionInfo,
    },
    /// 稍后可成（transient）：前端显示等待并可重试。
    #[serde(rename = "warming")]
    Warming {
        /// 呈现给用户的原因。
        detail: String,
    },
    /// 不可用（terminal）：前端按 `statically_detectable` 决定询问或报错。
    #[serde(rename = "unavailable")]
    Unavailable {
        /// 呈现给用户的错误信息。
        message: String,
        /// 是否属事前可静态判定的不可用。
        statically_detectable: bool,
    },
}

/// 一次断点源身份翻译的结果（语言无关：任何语言都可能把规范身份翻译成真实文件）。
///
/// 由 [`LanguageBackend::adapter_source_path`] 返回；无编排后端的语言（Go / Lldb）经
/// `dap::source_translation` 的 `backend == None` 分支原样透传，恒为
/// [`SourcePathResolution::Adapter`]（原样即适配器可读路径）—— 与 trait 默认无关。
/// 语言实现（如 Java 的 `jdt://…` 翻译）返回 `Unresolvable` 时，调用方剔除该断点并给出
/// 用户可见原因。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourcePathResolution {
    /// 适配器可识别的**真实文件路径**。
    Adapter(std::path::PathBuf),
    /// 无法翻译：`reason` 面向用户（Console 诊断 + 通知）。
    Unresolvable {
        /// 不可用原因（英文，用户可见）。
        reason: String,
    },
}

/// 语言调试后端（编排层）。
///
/// 协议层只回答"怎么和适配器说话"；本 trait 回答"怎么为这种语言做完整调试"。
///
/// **`plan` / `adapter_source_path` 是抽象方法**（每个注册的 backend 都必须实现）；
/// 仅有 `supported_on` / `unsupported_error` 提供默认体。Go / Lldb 的"零成本"**不来自
/// trait 默认实现** —— 它们按 §9.7 不注册 backend（`backend_for` 未命中即走 manager
/// 通用 spawn 路径），断点身份翻译由 `dap::source_translation` 的 `backend == None` 分支
/// 原样透传（见 `adapter_source_path` 的 None 分支）。trait 默认体主要作为新增语言时的
/// 契约起点，不承载通用行为。
#[async_trait]
pub trait LanguageBackend: Send + Sync {
    /// 对应语言的协议层（spawn / launch args 走它）。
    fn plugin(&self) -> &dyn DebugAdapterPlugin;

    /// 环境支持性：该语言在 `target` 上是否可调试（Java: SSH 不支持；默认 true）。
    fn supported_on(&self, target: &ExecTarget) -> bool {
        let _ = target;
        true
    }

    /// `supported_on == false` 时的错误文案（默认通用占位；Java 覆盖为 SSH 指引）。
    fn unsupported_error(&self) -> AppError {
        AppError::Dap("Debugging is not supported in this environment.".into())
    }

    /// 会话形态规划：返回三态（`Launch` / `Warming` / `Unavailable`）。
    ///
    /// `Launch` 时**尚未**建立任何会话；调用方负责起会话 —— 保证"不可用时绝不建会话、
    /// 绝不换引擎"的可单测不变式。**无默认体**：spawn + 通用载荷是未注册 backend 时
    /// manager 的通用路径（§9.7），不是本方法的默认行为。
    async fn plan(
        &self,
        state: &AppStateWrapper,
        request: &DebugRequest,
    ) -> Result<SessionPlan, AppError>;

    /// 断点源路径翻译：规范身份 → 适配器可读真实路径。**无默认体**；"原样透传"是未注册
    /// backend 时 `dap::source_translation` 的 None 分支行为（Go / Lldb），Java 覆盖为
    /// jdt 翻译。
    async fn adapter_source_path(
        &self,
        state: &AppStateWrapper,
        target: &ExecTarget,
        classpath: &[String],
        identity: &str,
    ) -> SourcePathResolution;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `DebugRequest::kind` 是编排后端注册表的查找键 —— 必须与注册键同源，
    /// 且**新增变体时 `match` 强制补分支**（不再有调用点硬编码语言名）。
    #[test]
    fn debug_request_reports_language_kind_and_project() {
        let attach = DebugRequest::JavaAttach {
            project_id: "p1".into(),
            target: JavaDebugTarget {
                command: "java".into(),
                cwd: "/proj".into(),
                test_name: "t".into(),
                classpath: vec![],
            },
        };
        let jdtls = DebugRequest::JavaJdtls {
            project_id: "p2".into(),
            target: JavaJdtlsTarget {
                probe_class: "A".into(),
                cwd: "/proj".into(),
                test_name: "t".into(),
                main_class: "A".into(),
                args: vec![],
                launcher_jar: None,
                project_name: None,
            },
        };

        assert_eq!(attach.kind(), crate::dap::types::AdapterKind::Java);
        assert_eq!(jdtls.kind(), crate::dap::types::AdapterKind::Java);
        assert_eq!(attach.project_id(), "p1");
        assert_eq!(jdtls.project_id(), "p2");
    }
}
