//! 源码身份翻译 + 外部源码授权编排。
//!
//! ## 为什么独立成模块
//!
//! 这两件事此前是 `DapManager` 的私有方法，但它们**不需要管理器状态** ——
//! 输入只有「语言后端端口 + 执行环境 + 身份字符串」，输出是路径与用户可见诊断。
//! 抽成无状态函数后单测可以直接用合成帧 + fake 语言端口覆盖整条判定，
//! 不必构造真实会话（会话所有权留在 `manager`，判定与翻译在这里）。
//!
//! ## 两条不变量
//!
//! 1. **只翻适配器副本**：持久化与回传前端一律保持**规范身份**（`jdt:/…`）。
//!    java-debug 只认真实文件路径或带 JDT handle 的 `jdt://…` uri，而 handle 取不到，
//!    所以只有进适配器的那份被改写。
//! 2. **不可翻译必须可见**：伪路径会被适配器静默丢弃（`verified:false`），用户只看到
//!    "断点没命中"。每个不可翻译的身份产出**一条** note（同一文件多行不刷屏）。
//!
//! 授权链路复用同一个翻译结果（否则会出现"授权通过但打开失败"）。

use std::collections::HashMap;
use std::path::PathBuf;

use super::adapter::{LanguageBackend, SourcePathResolution};
use super::breakpoints::effective_breakpoints;
use super::external_source::{self, FrameSource};
use super::types::{BreakpointSpec, StackFrameDto};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;
use crate::AppStateWrapper;

/// 翻译一个规范身份 → 适配器可识别的**真实文件路径**。
///
/// 返回 `(Some(path), None)` 表示可翻译；`(None, Some(note))` 表示不可翻译，
/// 由调用方决定是拒发还是落到 Debug Console。
///
/// `backend` 为 `None` 的语言（Go / Lldb）走原样透传（无身份翻译）。
pub(crate) async fn adapter_source_path(
    backend: Option<&dyn LanguageBackend>,
    state: &AppStateWrapper,
    target: &ExecTarget,
    classpath: &[String],
    identity: &str,
) -> (Option<PathBuf>, Option<String>) {
    let resolution = match backend {
        Some(backend) => {
            backend
                .adapter_source_path(state, target, classpath, identity)
                .await
        }
        // 无编排后端的语言：无身份翻译，原样即适配器可读路径。
        None => SourcePathResolution::Adapter(PathBuf::from(identity)),
    };
    match resolution {
        SourcePathResolution::Adapter(path) => (Some(path), None),
        SourcePathResolution::Unresolvable { reason } => (
            None,
            Some(format!("Skipped the breakpoint(s) in {identity}: {reason}")),
        ),
    }
}

/// 翻译身份 → 真实路径；不可解析时**原样返回**（由调用方按「必须绝对路径」fail-closed）。
pub(crate) async fn translated_source_path(
    backend: Option<&dyn LanguageBackend>,
    state: &AppStateWrapper,
    target: &ExecTarget,
    identity: &str,
) -> PathBuf {
    adapter_source_path(backend, state, target, &[], identity)
        .await
        .0
        .unwrap_or_else(|| PathBuf::from(identity))
}

/// 身份 → 适配器路径（带 per-call 缓存），并汇报**一次性**诊断。
///
/// 抽成函数有两个目的：
/// 1. 拍平 `adapter_breakpoints` 里 `for → match → if let` 的三层解构（Pillar 11 量化红线）；
/// 2. 把"同一身份只翻译一次 / 只报一次"的缓存语义收在一处（调用点无法绕过它）。
async fn resolve_cached(
    backend: Option<&dyn LanguageBackend>,
    state: &AppStateWrapper,
    target: &ExecTarget,
    classpath: &[String],
    identity: &str,
    cache: &mut HashMap<String, Option<PathBuf>>,
) -> (Option<PathBuf>, Option<String>) {
    // 缓存命中：不再翻译，也不再重复报诊断（note 只对首次失败产出）。
    if let Some(cached) = cache.get(identity) {
        return (cached.clone(), None);
    }
    let (path, note) = adapter_source_path(backend, state, target, classpath, identity).await;
    cache.insert(identity.to_string(), path.clone());
    (path, note)
}

/// 翻译整批断点（**只产出适配器副本**）+ 每个不可翻译身份一条 note。
///
/// 翻译前先按 effective（`enabled && !muted`）过滤：disabled / 静音中的断点既不该
/// 进适配器载荷，也不该产生"不可解析"note 噪音。一个身份只翻译一次 —— 一个文件
/// 通常有多行断点。
pub(crate) async fn adapter_breakpoints(
    backend: Option<&dyn LanguageBackend>,
    state: &AppStateWrapper,
    target: &ExecTarget,
    classpath: &[String],
    breakpoints: &[BreakpointSpec],
    muted: bool,
) -> (Vec<BreakpointSpec>, Vec<String>) {
    let effective = effective_breakpoints(breakpoints, muted);
    let mut translated: Vec<BreakpointSpec> = Vec::with_capacity(effective.len());
    let mut notes: Vec<String> = Vec::new();
    let mut resolved: HashMap<String, Option<PathBuf>> = HashMap::new();

    for breakpoint in &effective {
        let (path, note) = resolve_cached(
            backend,
            state,
            target,
            classpath,
            &breakpoint.file_path,
            &mut resolved,
        )
        .await;
        if let Some(note) = note {
            notes.push(note);
        }
        if let Some(path) = path {
            // **不降级**：`to_string_lossy` 会把非 UTF-8 路径静默改写成带替换字符的
            // 另一个路径 —— 适配器拿到它只会回 `verified:false`，用户看到的是
            // "断点没命中"，与真实原因（路径无法表示）完全不同。改为剔除 + 诊断。
            let Some(adapter_path) = path.to_str() else {
                notes.push(format!(
                    "Skipped the breakpoint(s) in {}: the resolved path is not valid UTF-8 \
                     and cannot be sent to the debug adapter",
                    breakpoint.file_path
                ));
                continue;
            };
            translated.push(BreakpointSpec {
                file_path: adapter_path.to_string(),
                line: breakpoint.line,
                verified: breakpoint.verified,
                enabled: breakpoint.enabled,
            });
        }
    }
    (translated, notes)
}

/// 外部源码的**授权 + 解析**核心：帧列表由调用方提供 ⇒ **可脱离真实会话单测**。
///
/// 本函数是"能不能读这份源码"的唯一判定点，因此刻意只依赖三样输入：`state`（取翻译端口）、
/// `target`（执行环境）、`frames`（调停点真相）。
///
/// 匹配两条路径：帧路径**原样**命中（项目内文件 / 无需翻译的语言），或**翻译后**与请求的
/// 翻译结果一致（`jdt://…` 帧 ↔ 前端规范身份）。解析结果必须是**绝对路径**才可读 ——
/// 相对路径拼根后会落回项目内，绕过「外部源码」语义，直接拒绝。
pub(crate) async fn authorize_external_source(
    state: &AppStateWrapper,
    target: &ExecTarget,
    backend: Option<&dyn LanguageBackend>,
    frames: &[StackFrameDto],
    path: &str,
) -> Result<PathBuf, AppError> {
    let resolved = translated_source_path(backend, state, target, path).await;

    if !resolved.is_absolute() {
        return Err(external_source::deny());
    }

    // 帧侧同样翻译成真实路径，再交给纯判定：**授权策略在 `external_source`**
    // （可取栈帧 / 翻译的编排留在这里）。按**唯一路径**去重后再翻译：一个栈里同一
    // 文件常有多个帧，重复翻译等于重复的 `spawn_blocking` 往返。
    let mut translated_frames: HashMap<&str, PathBuf> = HashMap::with_capacity(frames.len());
    for frame in frames {
        let Some(raw) = frame.source_path.as_deref() else {
            continue;
        };
        translated_frames.insert(
            raw,
            translated_source_path(backend, state, target, raw).await,
        );
    }
    let frame_sources: Vec<FrameSource<'_>> = translated_frames
        .iter()
        .map(|(raw, resolved)| FrameSource { raw, resolved })
        .collect();

    if external_source::is_authorized(path, &resolved, &frame_sources) {
        return Ok(resolved);
    }
    Err(external_source::deny())
}

#[cfg(test)]
mod tests {
    //! 翻译与授权判定**不需要真实会话**：合成帧 + fake 语言端口即可覆盖。
    use super::*;
    use crate::dap::adapter::java::capability::JavaDebugCapability;
    use crate::dap::testing::{bp, bp_disabled, isolated_state};
    use std::sync::Arc;

    struct FakeCapability(JavaDebugCapability);

    #[async_trait::async_trait]
    impl crate::dap::adapter::java::capability::JavaDebugCapabilityProvider for FakeCapability {
        async fn probe(
            &self,
            _project_path: &str,
            _test_class: &str,
            _project_name_candidate: Option<&str>,
        ) -> JavaDebugCapability {
            self.0.clone()
        }
    }

    /// 注册一个项目并注入指定探测结果，返回 (state, project_id)。
    fn java_route_state(
        tmp: &tempfile::TempDir,
        capability: JavaDebugCapability,
    ) -> (AppStateWrapper, String) {
        java_route_state_named(tmp, "proj", capability)
    }

    /// 注册一个项目（无语言后端）并注入指定探测结果，返回 (state, project_id)。
    fn java_route_state_named(
        tmp: &tempfile::TempDir,
        dir_name: &str,
        capability: JavaDebugCapability,
    ) -> (AppStateWrapper, String) {
        let state = isolated_state(tmp);
        // 替换组合根装配的真实 Java 后端为 fake（探测结果由测试注入）。
        state.dap_manager.register_backend(
            crate::dap::types::AdapterKind::Java,
            Arc::new(crate::dap::adapter::java::JavaBackend::new(
                Arc::new(FakeCapability(capability)),
                Arc::new(FakeSourcePath {
                    resolutions: vec![],
                }),
            )),
        );
        let project_dir = tmp.path().join(dir_name);
        std::fs::create_dir_all(&project_dir).expect("mkdir");
        let project = state
            .project_manager
            .lock()
            .expect("project_manager")
            .add_project(project_dir.clone(), None, None, None)
            .expect("add_project");
        (state, project.id)
    }

    /// 注入式源路径 fake：不构造 LSP/JDK，按身份直接给出结论；未列出的身份原样透传
    /// （模拟普通文件路径）。
    struct FakeSourcePath {
        resolutions: Vec<(String, SourcePathResolution)>,
    }

    #[async_trait::async_trait]
    impl crate::dap::adapter::java::source_path::JavaSourcePathProvider for FakeSourcePath {
        async fn adapter_source_path(
            &self,
            _target: &ExecTarget,
            _classpath: &[String],
            identity: &str,
        ) -> SourcePathResolution {
            self.resolutions
                .iter()
                .find(|(known, _)| known == identity)
                .map_or_else(
                    || SourcePathResolution::Adapter(PathBuf::from(identity)),
                    |(_, resolution)| resolution.clone(),
                )
        }
    }

    /// 就绪探测结果（断点翻译测试只需注入源路径 fake，能力探测恒就绪）。
    fn ready_capability() -> JavaDebugCapability {
        JavaDebugCapability::Ready {
            port: 1,
            module_paths: vec![],
            class_paths: vec!["/cp".into()],
            project_name: None,
        }
    }

    /// 注册项目 + 注入源路径结论。
    fn source_path_state(
        tmp: &tempfile::TempDir,
        resolutions: Vec<(&str, SourcePathResolution)>,
    ) -> (AppStateWrapper, String) {
        let (state, project_id) = java_route_state(tmp, ready_capability());
        state.dap_manager.register_backend(
            crate::dap::types::AdapterKind::Java,
            Arc::new(crate::dap::adapter::java::JavaBackend::new(
                Arc::new(FakeCapability(ready_capability())),
                Arc::new(FakeSourcePath {
                    resolutions: resolutions
                        .into_iter()
                        .map(|(identity, resolution)| (identity.to_string(), resolution))
                        .collect(),
                }),
            )),
        );
        (state, project_id)
    }

    /// 合成一个栈帧（`source_path` = adapter 原样给的路径/uri）。
    fn dap_frame(source_path: &str) -> StackFrameDto {
        StackFrameDto {
            id: 1,
            name: "frame".into(),
            source_path: Some(source_path.to_string()),
            line: 1,
            column: 0,
            source_name: None,
            source_reference: None,
        }
    }

    /// **B' 现场（可脱离会话单测）**：帧给 `jdt://…` uri、请求给规范身份 `jdt:/…`，
    /// 两者原样永不相等，只有翻译收敛到同一真实文件后才授权通过。
    #[tokio::test]
    async fn external_source_authorizes_when_translations_converge() {
        const REAL: &str = "/h/.neeko/java-src-cache/jdk-src-21/java.base/java/io/PrintStream.java";
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(
            &tmp,
            vec![
                (
                    "jdt:/java.base/java/io/PrintStream.java",
                    SourcePathResolution::Adapter(PathBuf::from(REAL)),
                ),
                (
                    "jdt://contents/java.base/java.io/PrintStream.class?=api/x",
                    SourcePathResolution::Adapter(PathBuf::from(REAL)),
                ),
            ],
        );
        let frames = [dap_frame(
            "jdt://contents/java.base/java.io/PrintStream.class?=api/x",
        )];

        let backend = state
            .dap_manager
            .backend_for(crate::dap::types::AdapterKind::Java);
        let resolved = authorize_external_source(
            &state,
            &ExecTarget::Local,
            backend.as_deref(),
            &frames,
            "jdt:/java.base/java/io/PrintStream.java",
        )
        .await
        .expect("翻译收敛后必须授权");
        assert_eq!(resolved, PathBuf::from(REAL));
    }

    /// 请求的源码**不在当前栈帧**里 → 拒绝（fail-closed：绝不越权读别的文件）。
    #[tokio::test]
    async fn external_source_denies_when_no_frame_matches() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let frames = [dap_frame("/proj/src/A.java")];

        let backend = state
            .dap_manager
            .backend_for(crate::dap::types::AdapterKind::Java);
        let err = authorize_external_source(
            &state,
            &ExecTarget::Local,
            backend.as_deref(),
            &frames,
            "/other/B.java",
        )
        .await
        .expect_err("未命中帧必须拒绝");
        assert!(
            err.to_string()
                .contains("not a readable external debug stop"),
            "{err}"
        );
    }

    /// 解析成**相对路径** → 拒绝（相对路径拼根后会落回项目内，绕过「外部源码」语义）。
    #[tokio::test]
    async fn external_source_denies_relative_resolution() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let frames = [dap_frame("src/rel.java")];

        let backend = state
            .dap_manager
            .backend_for(crate::dap::types::AdapterKind::Java);
        assert!(
            authorize_external_source(
                &state,
                &ExecTarget::Local,
                backend.as_deref(),
                &frames,
                "src/rel.java",
            )
            .await
            .is_err(),
            "相对路径不得作为外部源码授权"
        );
    }

    /// 原样命中（A 路径 / 项目内文件，翻译即透传）→ 授权。
    #[tokio::test]
    async fn external_source_authorizes_on_raw_match() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let frames = [dap_frame("/opt/lib/x.rs")];

        let backend = state
            .dap_manager
            .backend_for(crate::dap::types::AdapterKind::Java);
        let resolved = authorize_external_source(
            &state,
            &ExecTarget::Local,
            backend.as_deref(),
            &frames,
            "/opt/lib/x.rs",
        )
        .await
        .expect("原样命中必须授权");
        assert_eq!(resolved, PathBuf::from("/opt/lib/x.rs"));
    }

    /// JDK 源码身份被改写成**真实路径**；普通文件路径原样透传；规范身份（= 持久化与
    /// 回传前端用的那份）不被改动。
    #[tokio::test]
    async fn adapter_breakpoints_rewrite_only_the_adapter_copy() {
        let tmp = tempfile::tempdir().expect("tempdir");
        const REAL: &str =
            "/home/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java";
        let (state, _project) = source_path_state(
            &tmp,
            vec![(
                "jdt:/java.base/java/io/PrintStream.java",
                SourcePathResolution::Adapter(PathBuf::from(REAL)),
            )],
        );

        let input = vec![
            bp("jdt:/java.base/java/io/PrintStream.java", 1167),
            bp("jdt:/java.base/java/io/PrintStream.java", 1200),
            bp("/proj/src/test/java/com/demo/CalcTest.java", 9),
        ];
        let (translated, notes) = adapter_breakpoints(
            state
                .dap_manager
                .backend_for(crate::dap::types::AdapterKind::Java)
                .as_deref(),
            &state,
            &ExecTarget::Local,
            &[],
            &input,
            false,
        )
        .await;

        assert!(notes.is_empty(), "全部可解析不得产生诊断: {notes:?}");
        assert_eq!(translated.len(), 3);
        for breakpoint in &translated {
            assert!(
                !breakpoint.file_path.starts_with("jdt:"),
                "伪路径绝不允许下发: {}",
                breakpoint.file_path
            );
        }
        assert_eq!(translated[0].file_path, REAL);
        assert_eq!(translated[0].line, 1167);
        assert_eq!(translated[1].line, 1200);
        assert_eq!(
            translated[2].file_path,
            "/proj/src/test/java/com/demo/CalcTest.java"
        );
        // 输入（规范身份）不得被就地改写。
        assert_eq!(
            input[0].file_path,
            "jdt:/java.base/java/io/PrintStream.java"
        );
    }

    /// **非 UTF-8 路径不得降级下发**：`to_string_lossy` 会静默改写成另一个路径，
    /// 适配器只会回 `verified:false`。必须剔除 + 给可见诊断。
    #[cfg(unix)]
    #[tokio::test]
    async fn adapter_breakpoints_reject_non_utf8_resolution_with_note() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let tmp = tempfile::tempdir().expect("tempdir");
        let invalid = PathBuf::from(OsStr::from_bytes(b"/proj/\xff\xfe.java"));
        let (state, _project) = source_path_state(
            &tmp,
            vec![(
                "jdt:/java.base/java/io/PrintStream.java",
                SourcePathResolution::Adapter(invalid),
            )],
        );

        let input = vec![
            bp("jdt:/java.base/java/io/PrintStream.java", 7),
            bp("/proj/ok.java", 9),
        ];
        let (translated, notes) = adapter_breakpoints(
            state
                .dap_manager
                .backend_for(crate::dap::types::AdapterKind::Java)
                .as_deref(),
            &state,
            &ExecTarget::Local,
            &[],
            &input,
            false,
        )
        .await;

        assert_eq!(
            translated.len(),
            1,
            "不可表示的路径必须剔除: {translated:?}"
        );
        assert_eq!(translated[0].file_path, "/proj/ok.java");
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert!(
            notes[0].contains("not valid UTF-8"),
            "诊断必须点明原因: {}",
            notes[0]
        );
    }

    /// 未注册后端 + 无别名分支：`translated_source_path` 原样返回（fail-closed 由调用方负责）。
    #[tokio::test]
    async fn translated_source_path_passes_through_without_backend() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        let resolved =
            translated_source_path(None, &state, &ExecTarget::Local, "/opt/lib/x.rs").await;
        assert_eq!(resolved, PathBuf::from("/opt/lib/x.rs"));
    }

    /// 不可解析 → **剔除**（不发伪路径）+ 每个身份只报一次（同一文件多行不刷屏）。
    #[tokio::test]
    async fn adapter_breakpoints_drop_unresolvable_and_note_once_per_identity() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(
            &tmp,
            vec![(
                "jdt:/java.base/java/io/PrintStream.java",
                SourcePathResolution::Unresolvable {
                    reason: "the JDK source archive is missing".into(),
                },
            )],
        );

        let input = vec![
            bp("jdt:/java.base/java/io/PrintStream.java", 1167),
            bp("jdt:/java.base/java/io/PrintStream.java", 1200),
            bp("/proj/src/Demo.java", 3),
        ];
        let (translated, notes) = adapter_breakpoints(
            state
                .dap_manager
                .backend_for(crate::dap::types::AdapterKind::Java)
                .as_deref(),
            &state,
            &ExecTarget::Local,
            &[],
            &input,
            false,
        )
        .await;

        assert_eq!(translated.len(), 1, "只有可解析的那条能下发");
        assert_eq!(translated[0].file_path, "/proj/src/Demo.java");
        assert_eq!(notes.len(), 1, "同一身份只报一次: {notes:?}");
        assert!(
            notes[0].contains("jdt:/java.base/java/io/PrintStream.java"),
            "诊断要带上用户认得的身份: {}",
            notes[0]
        );
        assert!(notes[0].contains("the JDK source archive is missing"));
    }

    /// **启动/重跑路径**（评审 P1）：`adapter_breakpoints` 翻译前按 effective 过滤。
    /// 变异验证：删掉 `effective_breakpoints` 过滤行 ⇒ 本用例红（mute 下 Rerun 会复活命中）。
    #[tokio::test]
    async fn adapter_breakpoints_skips_disabled_and_muted_without_notes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let input = vec![
            bp("/proj/a.go", 10),
            bp_disabled("/proj/a.go", 20),
            bp("/proj/b.go", 30),
        ];

        // 未静音：disabled 行不下发，且不给 disabled 发"不可解析"note。
        let (translated, notes) = adapter_breakpoints(
            state
                .dap_manager
                .backend_for(crate::dap::types::AdapterKind::Java)
                .as_deref(),
            &state,
            &ExecTarget::Local,
            &[],
            &input,
            false,
        )
        .await;
        let mut lines: Vec<u32> = translated.iter().map(|b| b.line).collect();
        lines.sort_unstable();
        assert_eq!(lines, vec![10, 30], "disabled 行(20)不进启动载荷");
        assert!(notes.is_empty(), "disabled 行不产生诊断: {notes:?}");

        // 静音：启动/重跑载荷为空（mute 下 Rerun 新会话仍不命中）。
        let (translated, notes) = adapter_breakpoints(
            state
                .dap_manager
                .backend_for(crate::dap::types::AdapterKind::Java)
                .as_deref(),
            &state,
            &ExecTarget::Local,
            &[],
            &input,
            true,
        )
        .await;
        assert!(translated.is_empty(), "mute 下启动路径载荷必须为空");
        assert!(notes.is_empty());
    }
}
