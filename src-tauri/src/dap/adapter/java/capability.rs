//! Java debug 能力探测：dap 侧定义的**窄端口**。
//!
//! 为什么要端口而不是直接调 `LspManager`（design §2.7）：
//! - 就绪判定需要 LSP 域的状态（会话是否可用、是否仍在导入），但 DAP 域不应把
//!   "LSP 的健康知识"再推导一遍（单一事实源）；
//! - 端口是测试缝：`DapManager` 的路由单测注入 fake，不构造 LSP 运行时。
//!
//! 实现由 lsp 侧提供（`crate::lsp::java_debug_probe`），组合根注入。
//!
//! ## 就绪判据（S0 真机修正）
//!
//! 真机实测：普通（非模块化）Maven 工程 `resolveClasspath` 返回
//! `modulePaths = []`、`classPaths = 11 条`。故**就绪只看 `class_paths` 非空**，
//! `module_paths` 合法为空 —— 若要求两段都非空，所有经典 Maven 工程会永远停在
//! `Warming`。

use async_trait::async_trait;

/// 探测结果三态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JavaDebugCapability {
    /// 可用：`port` 为 JDTLS 内 DAP 服务器端口（`127.0.0.1:<port>`）。
    Ready {
        /// DAP 服务器端口。
        port: u16,
        /// DAP `modulePaths`（模块化工程；普通工程合法为空）。
        module_paths: Vec<String>,
        /// DAP `classPaths`（就绪判据只看它非空）。
        class_paths: Vec<String>,
        /// **经 jdt.ls 验证通过**的 JDT 项目名（`evaluate` 的硬前置）。
        ///
        /// `None` = 未能确定（服务器按类解析成功但没给出名字）→ launch **省略** `projectName`：
        /// 断点/栈/变量照常可用，仅 `evaluate` 受限于 jdt.ls 自身的要求。
        ///
        /// 绝不填猜出来的名字 —— 传错名字会让 jdt.ls 直接拒（
        /// `The project '<x>' is not a valid java project`），而目录名**不是** JDT 项目名
        /// （真机：目录 `proj` 拒、Maven `artifactId` 接受）。
        project_name: Option<String>,
    },
    /// 稍后可成（transient）：LSP 仍在启动/导入，本次不建会话、不报错。
    Warming {
        /// 呈现给用户的原因。
        detail: String,
    },
    /// 不可用（terminal）：本轮无法使用 B'。
    Unavailable {
        /// 不可用原因。
        reason: JavaDebugUnavailable,
        /// 是否属**事前可静态判定**的不可用 —— 决定前端是"一次性询问改用 Host"
        /// 还是"报错 + 显式切换入口"（不替用户换引擎）。
        statically_detectable: bool,
    },
}

/// B' 不可用的原因分类。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JavaDebugUnavailable {
    /// 无 java LSP 会话，或服务器起不来（如运行 JDK 版本不足）。
    LspUnavailable,
    /// debug bundle 未加载（`vscode.java.startDebugSession` 报未知命令）。
    BundleMissing,
    /// 探测过程中的其他失败（携带原文供 UI 展示）。
    ProbeFailed(String),
}

/// `classpath` 解析为空时，是否需要继续等待。
///
/// - 有在途进度 → `Warming`（稍后可成）；
/// - 无在途进度 → `Unavailable(ProbeFailed)`：**真损坏工程不得拖成超时错误**
///   （对齐 VSCode / Zed 对 resolve 空一律硬报错的可预测性）。
#[must_use]
pub fn decide_empty_classpath(has_inflight_progress: bool) -> JavaDebugCapability {
    if has_inflight_progress {
        JavaDebugCapability::Warming {
            detail: "Java project import is still running".into(),
        }
    } else {
        JavaDebugCapability::Unavailable {
            reason: JavaDebugUnavailable::ProbeFailed(
                "The Java language server returned an empty classpath for this test class \
                 (the project may have build errors or unresolved dependencies)."
                    .into(),
            ),
            statically_detectable: false,
        }
    }
}

/// 解析 `LSP error (<code>): <msg>` 前缀里的 JSON-RPC 错误码。
///
/// 该前缀由 `lsp::session::request::do_send_request` 单一产生，故解析点唯一；
/// 拿不到码时返回 `None`（非 JSON-RPC 错误，或服务器未带码）。
#[must_use]
pub fn lsp_error_code(message: &str) -> Option<i64> {
    let rest = message.strip_prefix("LSP error (")?;
    let (code, _) = rest.split_once(')')?;
    code.trim().parse().ok()
}

/// 无错误码时的保守兜底：文本同时提到 command 与否定词。
///
/// 仅在拿不到 JSON-RPC 错误码时使用（见 [`classify_start_debug_error`]）。
#[must_use]
fn looks_like_unknown_command(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let negative = [
        "unknown",
        "unsupported",
        "not supported",
        "not found",
        "no such",
        "not available",
    ]
    .iter()
    .any(|word| lower.contains(word));
    lower.contains("command") && negative
}

/// 把 `vscode.java.startDebugSession` 的失败分类为不可用原因。
///
/// **优先看协议错误码**：命令未注册是 JSON-RPC `-32601`（MethodNotFound），这是权威
/// 信号。按文本猜（"unknown" / "command not found"…）会把恰好含这些词的**其它**错误
/// 误判成 `BundleMissing` —— 那会把 "服务端内部错误" 说成 "插件没装"，而
/// `describe_unavailable(BundleMissing)` 不含原文，用户既看不到真因、又会去下载一个
/// 早已装好的插件。
///
/// 因此：有码且为 `-32601` → `BundleMissing`；有码但不是 → `ProbeFailed`（保留原文，
/// 明确不猜）；无码 → 退回文本兜底（老服务器 / 非 JSON-RPC 错误）。
#[must_use]
pub fn classify_start_debug_error(message: &str) -> JavaDebugUnavailable {
    /// JSON-RPC / LSP MethodNotFound。
    const METHOD_NOT_FOUND: i64 = -32601;
    match lsp_error_code(message) {
        Some(METHOD_NOT_FOUND) => JavaDebugUnavailable::BundleMissing,
        Some(_) => JavaDebugUnavailable::ProbeFailed(message.to_string()),
        None if looks_like_unknown_command(message) => JavaDebugUnavailable::BundleMissing,
        None => JavaDebugUnavailable::ProbeFailed(message.to_string()),
    }
}

/// 是否属静态可判定的不可用（前端据此决定"一次性询问"还是"报错 + 显式入口"）。
///
/// 仅 `BundleMissing` 为真：它不会因重试而自愈（需要重启会话加载 bundle 或改配置），
/// 此时提示用户"改用 Host（功能受限）"是有意义的；`LspUnavailable` / `ProbeFailed`
/// 都可能瞬时（服务器正在启动、依赖解析中），一律走"报错 + 显式入口"，不替用户决定。
#[must_use]
pub const fn is_statically_detectable(reason: &JavaDebugUnavailable) -> bool {
    matches!(reason, JavaDebugUnavailable::BundleMissing)
}

/// dap 侧窄端口：回答"这个项目现在能否用 JDTLS 后端调试"。
///
/// 实现必须**不阻塞**：不得在内部同步启动语言服务器（那会让一次 IPC 调用挂住
/// 数十秒且无法取消）；会话未就绪时返回 [`JavaDebugCapability::Warming`] 或
/// `Unavailable`，由调用方按"可重试"处理。
#[async_trait]
pub trait JavaDebugCapabilityProvider: Send + Sync {
    /// 探测指定项目的 Java debug 能力。
    ///
    /// `project_name_candidate` 是**候选**（显式配置 / 构建系统项目名），实现方必须把它交给
    /// jdt.ls **验证**后再采信；候选不成立时回落到"不带项目名、由服务器按类解析"。
    async fn probe(
        &self,
        project_path: &str,
        test_class: &str,
        project_name_candidate: Option<&str>,
    ) -> JavaDebugCapability;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 有在途进度 → Warming；无在途进度 → 直接报错（不得把损坏工程拖成超时）。
    #[test]
    fn empty_classpath_splits_on_inflight_progress() {
        match decide_empty_classpath(true) {
            JavaDebugCapability::Warming { detail } => assert!(detail.contains("import")),
            other => panic!("expected Warming, got {other:?}"),
        }
        match decide_empty_classpath(false) {
            JavaDebugCapability::Unavailable {
                reason,
                statically_detectable,
            } => {
                assert!(matches!(reason, JavaDebugUnavailable::ProbeFailed(_)));
                assert!(!statically_detectable);
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    /// 未知命令 → BundleMissing；其他错误保留原文。
    #[test]
    fn start_debug_errors_are_classified() {
        for msg in [
            "Unknown command: vscode.java.startDebugSession",
            "command not supported",
            "No such command",
            "UNSUPPORTED COMMAND 'vscode.java.startDebugSession'",
        ] {
            assert_eq!(
                classify_start_debug_error(msg),
                JavaDebugUnavailable::BundleMissing,
                "{msg}"
            );
        }
        match classify_start_debug_error("Server is busy") {
            JavaDebugUnavailable::ProbeFailed(m) => assert_eq!(m, "Server is busy"),
            other => panic!("expected ProbeFailed, got {other:?}"),
        }
    }

    /// 错误码解析：唯一前缀，非法/缺失一律 `None`。
    #[test]
    fn lsp_error_code_is_parsed_from_the_canonical_prefix() {
        assert_eq!(
            lsp_error_code("LSP error (-32601): Unknown command"),
            Some(-32601)
        );
        assert_eq!(lsp_error_code("LSP error (-32001): boom"), Some(-32001));
        assert_eq!(lsp_error_code("No live LSP session for java"), None);
        assert_eq!(lsp_error_code("LSP error (abc): x"), None);
        assert_eq!(lsp_error_code(""), None);
    }

    /// **误判守卫**：错误码是权威信号 —— 带其它错误码时即使文本含 "command" + "not found"
    /// 也不得判成 BundleMissing（否则会把"服务端内部错误"说成"插件没装"，且
    /// `describe_unavailable(BundleMissing)` 不含原文，用户看不到真因）。
    #[test]
    fn error_code_beats_keyword_matching() {
        assert_eq!(
            classify_start_debug_error(
                "LSP error (-32601): Unknown command: vscode.java.startDebugSession"
            ),
            JavaDebugUnavailable::BundleMissing
        );
        match classify_start_debug_error(
            "LSP error (-32603): internal error: command handler not found",
        ) {
            JavaDebugUnavailable::ProbeFailed(m) => {
                assert!(m.contains("-32603"), "必须保留原文供排查: {m}");
            }
            other => panic!("expected ProbeFailed, got {other:?}"),
        }
        // 无码时才退回文本兜底（老服务器 / 非 JSON-RPC 错误）。
        assert_eq!(
            classify_start_debug_error("Unknown command: vscode.java.startDebugSession"),
            JavaDebugUnavailable::BundleMissing
        );
        match classify_start_debug_error("Internal error: command handler crashed") {
            JavaDebugUnavailable::ProbeFailed(m) => {
                assert_eq!(m, "Internal error: command handler crashed")
            }
            other => panic!("expected ProbeFailed, got {other:?}"),
        }
    }

    /// 仅 BundleMissing 是静态可判定（前端据此给"一次性询问"）。
    #[test]
    fn only_bundle_missing_is_statically_detectable() {
        assert!(is_statically_detectable(
            &JavaDebugUnavailable::BundleMissing
        ));
        assert!(!is_statically_detectable(
            &JavaDebugUnavailable::LspUnavailable
        ));
        assert!(!is_statically_detectable(
            &JavaDebugUnavailable::ProbeFailed("x".into())
        ));
    }

    /// Ready 只看 classPaths：S0 真机实测普通 Maven 工程 modulePaths 合法为空；
    /// `project_name` 可为 None（未验证到就省略字段，而不是填猜值）。
    #[test]
    fn ready_allows_empty_module_paths_and_unknown_project_name() {
        let cap = JavaDebugCapability::Ready {
            port: 56984,
            module_paths: vec![],
            class_paths: vec!["/p/target/test-classes".into()],
            project_name: None,
        };
        match cap {
            JavaDebugCapability::Ready {
                port,
                module_paths,
                class_paths,
                project_name,
            } => {
                assert_eq!(port, 56984);
                assert!(module_paths.is_empty(), "modulePaths 为空是合法状态");
                assert_eq!(class_paths.len(), 1);
                assert_eq!(project_name, None, "未验证到名字时必须为 None（不得猜）");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }
}
