//! Java debug 能力探测的 **LSP 侧适配实现**。
//!
//! 端口在 `crate::dap::java_capability`（dap 定义抽象，lsp 提供实现 —— 依赖倒置）。
//! 真机验证过的命令与载荷（见 `research/jdtls-debug-spike.md`）：
//!
//! - `workspace/executeCommand{command:"vscode.java.startDebugSession"}` → 端口号；
//! - `workspace/executeCommand{command:"vscode.java.resolveClasspath",
//!   arguments:[testClass, projectName, "test"]}` → `[modulePaths, classPaths]`。
//!
//! 实现**不启动**语言服务器（不阻塞 IPC）：会话缺失/启动中/失败分别映射为
//! `Unavailable` / `Warming` / `Unavailable(静态可判定)`。

use std::sync::Arc;

use serde_json::{json, Value};

use crate::dap::adapter::java::capability::{
    classify_start_debug_error, decide_empty_classpath, is_statically_detectable,
    JavaDebugCapability, JavaDebugCapabilityProvider, JavaDebugUnavailable,
};
use crate::lsp::LspManager;

/// java-debug bundle 注册的命令名（`plugin.xml`，真机已验证）。
const CMD_START_DEBUG_SESSION: &str = "vscode.java.startDebugSession";
/// classpath 真值入口（真机已验证返回 11 条 classPaths）。
const CMD_RESOLVE_CLASSPATH: &str = "vscode.java.resolveClasspath";
/// LSP 命令分发方法。
const EXECUTE_COMMAND: &str = "workspace/executeCommand";
/// 语言 id。
const JAVA: &str = "java";
/// 测试 scope（含测试源码与测试依赖）。
const TEST_SCOPE: &str = "test";

/// java LSP 会话的粗粒度状态（只关心与探测有关的三类）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JavaSessionStatus {
    /// 无该项目的 java 会话。
    Absent,
    /// 会话存在但尚未就绪（启动中/索引中）。
    Starting,
    /// 会话存在但已进入错误态（如运行 JDK 不足、服务器无法启动）。
    Failed,
    /// 会话就绪，可发命令。
    Ready,
}

/// 把 `LspSessionInfo` 的 status 串归类（未知取值按"仍在启动"处理，偏保守）。
#[must_use]
fn classify_session_status(status: Option<&str>) -> JavaSessionStatus {
    match status {
        None => JavaSessionStatus::Absent,
        Some("ready") => JavaSessionStatus::Ready,
        Some("error") => JavaSessionStatus::Failed,
        Some(_) => JavaSessionStatus::Starting,
    }
}

/// 解析 `resolveClasspath` 的返回值：`[modulePaths, classPaths]`。
///
/// 容错：缺段 / `null` / 非字符串项一律按空处理（真机上普通 Maven 工程的
/// `modulePaths` 就是空数组）。
#[must_use]
pub fn parse_classpath_payload(value: &Value) -> (Vec<String>, Vec<String>) {
    fn strings_at(value: &Value, index: usize) -> Vec<String> {
        value
            .as_array()
            .and_then(|arr| arr.get(index))
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }
    (strings_at(value, 0), strings_at(value, 1))
}

/// 解析 `startDebugSession` 返回值中的端口。
///
/// 纯函数（可单测）：拒绝 0 / 超 `u16` / 非数字 —— 不返回"默认端口"这种静默值，
/// 否则会连到一个语义未知的端口上（探错端口比报错更难排查）。
fn parse_port(value: &Value) -> Result<u16, String> {
    value
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0)
        .ok_or_else(|| format!("unexpected startDebugSession payload: {value}"))
}

/// `resolveClasspath` 的结果分类（决定"名字可不可信"与"是否 terminal"）。
#[derive(Debug, PartialEq, Eq)]
enum ClasspathOutcome {
    /// 候选名被 jdt.ls **接受** → 名字可信（可进 launch 的 `projectName`）。
    ResolvedByCandidate {
        /// 经服务器验证的项目名。
        name: String,
        /// `modulePaths`。
        module_paths: Vec<String>,
        /// `classPaths`。
        class_paths: Vec<String>,
    },
    /// 候选名缺失或被拒 → 服务器**按类**解析成功；名字仍未知（`None`，不得猜）。
    ResolvedByClass {
        /// `modulePaths`。
        module_paths: Vec<String>,
        /// `classPaths`。
        class_paths: Vec<String>,
    },
    /// 按类解析成功但 classpath 为空 → 交给 [`decide_empty_classpath`] 判 Warming / 报错。
    Empty,
    /// 两次都失败（服务器侧错误）。
    Failed(String),
}

/// 把"候选名结果 + 按类结果"归约为 [`ClasspathOutcome`]（纯函数，可单测）。
///
/// **不变式**：候选被拒（服务器报错 / 返回空）**不是 terminal** —— 必须继续尝试按类解析。
/// 真机教训：把目录名当项目名会被 jdt.ls 以
/// `The project '<x>' is not a valid java project` 拒绝；此时若直接判不可用，用户会拿到
/// 一条与真因无关的错误（本 bug 的实际形态）。
#[must_use]
fn decide_classpath(
    candidate: Option<(&str, Result<Value, String>)>,
    by_class: Result<Value, String>,
) -> ClasspathOutcome {
    if let Some((name, Ok(value))) = candidate {
        let (module_paths, class_paths) = parse_classpath_payload(&value);
        if !class_paths.is_empty() {
            return ClasspathOutcome::ResolvedByCandidate {
                name: name.to_string(),
                module_paths,
                class_paths,
            };
        }
    }
    match by_class {
        Ok(value) => {
            let (module_paths, class_paths) = parse_classpath_payload(&value);
            if class_paths.is_empty() {
                ClasspathOutcome::Empty
            } else {
                ClasspathOutcome::ResolvedByClass {
                    module_paths,
                    class_paths,
                }
            }
        }
        Err(msg) => ClasspathOutcome::Failed(msg),
    }
}

/// `resolveClasspath` 的请求参数。`project_name = None` → JSON `null`
/// （真机实证：null 时 jdt.ls 按类解析并成功）。
#[must_use]
fn resolve_classpath_params(test_class: &str, project_name: Option<&str>) -> Value {
    json!({
        "command": CMD_RESOLVE_CLASSPATH,
        "arguments": [test_class, project_name, TEST_SCOPE],
    })
}

/// LSP 支撑的能力探测实现。
pub struct LspJavaDebugCapability {
    lsp: Arc<LspManager>,
}

impl LspJavaDebugCapability {
    /// 以共享的 LSP 管理器构造。
    #[must_use]
    pub const fn new(lsp: Arc<LspManager>) -> Self {
        Self { lsp }
    }

    fn session_status(&self, project_path: &str) -> JavaSessionStatus {
        let status = self
            .lsp
            .list_sessions()
            .into_iter()
            .find(|s| s.project_path == project_path && s.language_id == JAVA)
            .map(|s| s.status);
        classify_session_status(status.as_deref())
    }

    async fn execute(&self, project_path: &str, params: Value) -> Result<Value, String> {
        // 观察请求：探测不得重启 / 新建语言服务器会话（否则"点一次 Debug"就会把
        // jdtls 重启一遍并消耗重启预算，见 `LspManager::send_request_observed`）。
        self.lsp
            .send_request_observed(project_path, JAVA, EXECUTE_COMMAND, params)
            .await
            .map_err(|e| e.to_string())
    }
}

#[async_trait::async_trait]
impl JavaDebugCapabilityProvider for LspJavaDebugCapability {
    async fn probe(
        &self,
        project_path: &str,
        test_class: &str,
        project_name_candidate: Option<&str>,
    ) -> JavaDebugCapability {
        // ── 1. 会话状态（不启动服务器；启动策略属 LSP 域）─────────────────────
        match self.session_status(project_path) {
            JavaSessionStatus::Absent => {
                return unavailable(JavaDebugUnavailable::LspUnavailable, false);
            }
            JavaSessionStatus::Starting => {
                return JavaDebugCapability::Warming {
                    detail: "Java language server is starting".into(),
                };
            }
            JavaSessionStatus::Failed => {
                // 服务器进错误态（如运行 JDK 版本不足）—— 重试不会自愈。
                return unavailable(JavaDebugUnavailable::LspUnavailable, true);
            }
            JavaSessionStatus::Ready => {}
        }

        // ── 2. 能力探测：命令可用即证明 server 就绪 + bundle 已加载 ─────────────
        let port = match self
            .execute(project_path, json!({ "command": CMD_START_DEBUG_SESSION }))
            .await
        {
            Ok(v) => match parse_port(&v) {
                Ok(port) => port,
                Err(msg) => {
                    return unavailable(JavaDebugUnavailable::ProbeFailed(msg), false);
                }
            },
            Err(msg) => {
                let reason = classify_start_debug_error(&msg);
                let statically_detectable = is_statically_detectable(&reason);
                return unavailable(reason, statically_detectable);
            }
        };

        // ── 3. classpath 真值（就绪只看它非空；modulePaths 可为空）─────────────
        // 候选名先试（成功即得到可信的 `projectName`，evaluate 需要它）；
        // 被拒则**不算 terminal** —— 退回"不带名字、由服务器按类解析"。
        let candidate_result = match project_name_candidate.filter(|n| !n.trim().is_empty()) {
            Some(name) => Some((
                name,
                self.execute(
                    project_path,
                    resolve_classpath_params(test_class, Some(name)),
                )
                .await,
            )),
            None => None,
        };
        let by_class = self
            .execute(project_path, resolve_classpath_params(test_class, None))
            .await;

        match decide_classpath(candidate_result, by_class) {
            ClasspathOutcome::ResolvedByCandidate {
                name,
                module_paths,
                class_paths,
            } => JavaDebugCapability::Ready {
                port,
                module_paths,
                class_paths,
                project_name: Some(name),
            },
            ClasspathOutcome::ResolvedByClass {
                module_paths,
                class_paths,
            } => JavaDebugCapability::Ready {
                port,
                module_paths,
                class_paths,
                project_name: None,
            },
            ClasspathOutcome::Empty => {
                decide_empty_classpath(self.lsp.has_inflight_progress(project_path, JAVA))
            }
            ClasspathOutcome::Failed(msg) => {
                unavailable(JavaDebugUnavailable::ProbeFailed(msg), false)
            }
        }
    }
}

const fn unavailable(
    reason: JavaDebugUnavailable,
    statically_detectable: bool,
) -> JavaDebugCapability {
    JavaDebugCapability::Unavailable {
        reason,
        statically_detectable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 端口解析：合法值通过；0 / 溢出 / 非数字 / null / 字符串 一律拒绝（不静默取默认）。
    #[test]
    fn parse_port_rejects_invalid_values() {
        assert_eq!(parse_port(&json!(56984)), Ok(56984));
        assert_eq!(parse_port(&json!(1)), Ok(1));
        assert_eq!(parse_port(&json!(65535)), Ok(65535));
        for bad in [
            json!(0),
            json!(65536),
            json!(-1),
            json!(null),
            json!("56984"),
            json!(1.5),
        ] {
            assert!(parse_port(&bad).is_err(), "{bad} 必须被拒");
        }
    }

    /// **本 bug 的回归测试**：候选名被 jdt.ls 拒 → 必须回落到按类解析，绝不判 terminal。
    #[test]
    fn rejected_candidate_falls_back_to_class_resolution() {
        let class_ok = json!([[], ["/cp/target/classes"]]);
        let rejected = Err(
            "Failed to resolve classpath: The project 'proj' is not a valid java project."
                .to_string(),
        );
        match decide_classpath(Some(("proj", rejected)), Ok(class_ok)) {
            ClasspathOutcome::ResolvedByClass { class_paths, .. } => {
                assert_eq!(class_paths, vec!["/cp/target/classes".to_string()]);
            }
            other => panic!("候选被拒必须回落到按类解析，实为 {other:?}"),
        }
    }

    /// 候选被接受 → 采用它（名字可信，供 launch 的 `projectName` 用）。
    #[test]
    fn accepted_candidate_yields_verified_name() {
        let ok = json!([[], ["/cp/target/classes"]]);
        match decide_classpath(Some(("s0-demo", Ok(ok))), Err("unused".into())) {
            ClasspathOutcome::ResolvedByCandidate { name, .. } => assert_eq!(name, "s0-demo"),
            other => panic!("expected ResolvedByCandidate, got {other:?}"),
        }
    }

    /// 候选「成功但 classpath 为空」不能采信（可能是错项目返回空）→ 仍走按类解析。
    #[test]
    fn empty_candidate_result_is_not_trusted() {
        let empty_candidate = json!([[], []]);
        let class_ok = json!([[], ["/cp/target/classes"]]);
        match decide_classpath(Some(("w", Ok(empty_candidate))), Ok(class_ok)) {
            ClasspathOutcome::ResolvedByClass { class_paths, .. } => {
                assert_eq!(class_paths.len(), 1)
            }
            other => panic!("expected ResolvedByClass, got {other:?}"),
        }
    }

    /// 两路都空 → `Empty`（交给 Warming 判定）；按类报错 → `Failed`（携带服务器原文）。
    #[test]
    fn empty_and_failed_outcomes_are_distinguished() {
        assert_eq!(
            decide_classpath(None, Ok(json!([[], []]))),
            ClasspathOutcome::Empty
        );
        match decide_classpath(None, Err("boom".into())) {
            ClasspathOutcome::Failed(m) => assert_eq!(m, "boom"),
            other => panic!("expected Failed, got {other:?}"),
        }
    }

    /// 参数形态：候选 → 字符串；无候选 → JSON `null`（真机实证 null 可按类解析）。
    #[test]
    fn resolve_params_serialize_null_when_no_candidate() {
        let with = resolve_classpath_params("com.example.CalcTest", Some("s0-demo"));
        assert_eq!(with["arguments"][1], json!("s0-demo"));
        let without = resolve_classpath_params("com.example.CalcTest", None);
        assert_eq!(without["arguments"][1], Value::Null);
        assert_eq!(without["command"], "vscode.java.resolveClasspath");
    }

    #[test]
    fn session_status_classification_is_conservative() {
        assert_eq!(classify_session_status(None), JavaSessionStatus::Absent);
        assert_eq!(
            classify_session_status(Some("ready")),
            JavaSessionStatus::Ready
        );
        assert_eq!(
            classify_session_status(Some("error")),
            JavaSessionStatus::Failed
        );
        // 未知/启动中一律按"仍在启动"处理（宁可 Warming 也不要误判为不可用）。
        for s in ["starting", "weird", ""] {
            assert_eq!(
                classify_session_status(Some(s)),
                JavaSessionStatus::Starting,
                "{s}"
            );
        }
    }

    /// 真机载荷：`[[], [11 条 classPaths]]` —— modulePaths 为空必须被接受。
    #[test]
    fn parses_real_resolve_classpath_payload() {
        let payload = json!([
            [],
            [
                "/private/tmp/neeko-s0/proj/target/test-classes",
                "/private/tmp/neeko-s0/proj/target/classes",
                "/Users/tomgs/.m2/repository/org/junit/jupiter/junit-jupiter/5.10.2/junit-jupiter-5.10.2.jar"
            ]
        ]);
        let (module_paths, class_paths) = parse_classpath_payload(&payload);
        assert!(module_paths.is_empty());
        assert_eq!(class_paths.len(), 3);
        assert!(class_paths[0].ends_with("target/test-classes"));
    }

    #[test]
    fn classpath_payload_tolerates_malformed_shapes() {
        for payload in [
            json!(null),
            json!([]),
            json!([[], null]),
            json!([null, null]),
            json!("nope"),
            json!([[], [1, 2, ""]]),
        ] {
            let (m, c) = parse_classpath_payload(&payload);
            assert!(m.is_empty(), "{payload}");
            // 非字符串项与空白项必须被过滤掉。
            assert!(c.iter().all(|s| !s.trim().is_empty()), "{payload}");
        }
    }
}
