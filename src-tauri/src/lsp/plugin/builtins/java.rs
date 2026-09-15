use super::super::types::{InstallOp, LspInstallMethod, LspPlugin, LspServerTuning};
use super::java_install::jdtls_fallbacks;

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "java",
        &["java"],
        "jdtls",
        &["jdtls"],
        // 回退（platform/jdtls）：Unix 走 brew → 官方发行版下载。npm 主路径在
        // fnm/nvm 等 shell-init PATH 下不可解析时被跳过（installer 逐方法探测）。
        Some(
            LspInstallMethod::new(
                "Node.js (npm), Homebrew, or official download",
                InstallOp::exec("npm", &["install", "-g", "@eclipse-wtp/jdtls"]),
            )
            .with_fallbacks(jdtls_fallbacks()),
        ),
    )
    .with_root_markers(&["pom.xml", "build.gradle", "build.gradle.kts"])
    .with_detect_priority(40)
    // jdtls 经 ClientPreferences.isClassFileContentSupported 门控类文件跳转：
    // NavigateToDefinitionHandler 在返回 jdt:// 目标前检查该值。JDT 只从
    // `initializationOptions.extendedClientCapabilities` 读取（ClientPreferences
    // 构造器签名 `(ClientCapabilities, Map)`，Map 即 initializationOptions，
    // 与 Zed 的 jdtls 扩展同式）：放在 `capabilities` 下 JDT 永远看不见。
    // 缺此字段 JDK/依赖符号的 definition 直接回空（hover 不受影响）。
    // B'（JDTLS 后端）的 linchpin：把 java-debug 插件作为 `bundles` 注入 jdtls，
    // 否则 `vscode.java.startDebugSession` 不会注册，能力探测必然报 BundleMissing。
    // 载荷**在会话创建时求值**（`bundles` 必须指向真实存在的绝对路径，而该文件可能
    // 由 Neeko 稍后才下载）—— 正因如此"下载后重启会话"才真的生效。
    .with_initialization_options_provider(java_initialization_options)
    .with_extended_client_capabilities(serde_json::json!({
        "classFileContentsSupport": true,
        "progressReportProvider": true,
        "resolveAdditionalTextEditsSupport": true
    }))
    // jdtls 的两项调优（原为 session 层的 `language_id == "java"` + bool 开关）：
    // - `--version` = 完整 OSGi JVM 启动，且并发探测会在 data 目录锁上互相挂死
    //   → 跳过探测（版本降级为 unknown）；
    // - 注入 PATH `java` 推导的 JAVA_HOME（Tooling JDK 语义）。
    .with_tuning(LspServerTuning {
        version_probe: false,
        java_home_from_path: true,
    })]
}

/// jdtls 的 `initializationOptions`：java-debug bundle + import/settings。
///
/// 每次会话创建时求值（见 [`LspPlugin::initialization_options_provider`]）。
fn java_initialization_options() -> serde_json::Value {
    java_initialization_options_for(&crate::lsp::java_debug_bundle::bundle_path())
}

/// 路径参数化版本（免环境变量，便于单测）。
fn java_initialization_options_for(bundle: &std::path::Path) -> serde_json::Value {
    use crate::lsp::java_debug_bundle::{download_url, existing_bundle_at};

    let mut options = serde_json::json!({
        "settings": {
            "java": {
                "import": {
                    "maven": { "enabled": true },
                    "gradle": { "enabled": true }
                },
                // 保持 interactive（对齐 VSCode / Zed）：该键作用于**整个 Java 编辑会话**，
                // 不为调试便利全局放开；classpath 新鲜度由 resolveClasspath 按需保证。
                "configuration": { "updateBuildConfiguration": "interactive" }
            }
        }
    });

    // bundles 只在**已就绪**（存在且结构合法）时注入：jdtls 的
    // `BundleUtils.loadBundles` 对不存在/损坏的路径会报错，可能连带影响整个 Java
    // 语言服务器 —— 宁可让能力探测报 `BundleMissing` 并给出下载指引。
    match existing_bundle_at(bundle) {
        Some(ready) => {
            options["bundles"] = serde_json::json!([ready.to_string_lossy()]);
        }
        None => {
            log::warn!(
                "[java-debug] bundle not ready at {}; the JDTLS debug backend will report \
                 BundleMissing until it is downloaded from {}",
                bundle.display(),
                download_url()
            );
        }
    }
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_plugin_advertises_class_file_contents_support() {
        let plugin = plugins()
            .into_iter()
            .find(|p| p.language_id == "java")
            .expect("java builtin plugin must exist");
        let caps = plugin
            .extended_client_capabilities
            .as_ref()
            .expect("java 插件必须声明 extendedClientCapabilities");
        assert_eq!(caps["classFileContentsSupport"], serde_json::json!(true));
        assert_eq!(caps["progressReportProvider"], serde_json::json!(true));
        assert_eq!(
            caps["resolveAdditionalTextEditsSupport"],
            serde_json::json!(true)
        );
    }

    /// L1/L2 回归：jdtls 的两项特判（跳过 --version 探测、注入 JAVA_HOME）声明在
    /// **插件自身**，session 层只读 `plugin.tuning` —— 不再按 `language_id == "java"`
    /// 分支。重命名/新增第二个 Java 系服务器无需改 session。
    #[test]
    fn java_plugin_declares_jdtls_tuning() {
        let plugin = plugins()
            .into_iter()
            .find(|p| p.language_id == "java")
            .expect("java builtin plugin must exist");
        assert!(
            !plugin.tuning.version_probe,
            "jdtls 的 --version 会启动完整 OSGi JVM，必须跳过探测"
        );
        assert!(
            plugin.tuning.java_home_from_path,
            "jdtls 需要 PATH java 推导的 JAVA_HOME（Tooling JDK）"
        );
    }

    /// L7 回归：jdtls 回退链是**显式**的 `Exec(brew)` → `Script(sh -c …)`，
    /// 不再靠「argv[0] 恰好是 sh」的形状巧合被当作可探测工具；截断/解压类
    /// 非 argv 安装法由此可被表达。
    #[cfg(unix)]
    #[test]
    fn java_fallback_chain_is_explicit_exec_then_script() {
        let plugin = plugins()
            .into_iter()
            .find(|p| p.language_id == "java")
            .expect("java builtin plugin must exist");
        let install = plugin.install.as_ref().expect("java 有安装配方");
        assert_eq!(install.primary.probe_tool(), "npm", "首选仍是 npm");
        assert_eq!(install.fallbacks.len(), 2, "Unix 回退链：brew → 官方下载");
        assert_eq!(install.fallbacks[0].probe_tool(), "brew");
        match install.fallbacks[1] {
            InstallOp::Script { shell, body } => {
                assert_eq!(shell, "sh", "脚本形态探测 sh");
                assert!(
                    body.contains("download.eclipse.org/jdtls"),
                    "第二项应为官方发行版下载脚本"
                );
            }
            other => panic!("第二项应为 Script 形态，实为 {other:?}"),
        }
    }

    /// Windows 无 POSIX 回退（brew 不存在、下载脚本依赖 sh）→ 回退链为空。
    #[cfg(windows)]
    #[test]
    fn java_has_no_fallback_on_windows() {
        let plugin = plugins()
            .into_iter()
            .find(|p| p.language_id == "java")
            .expect("java builtin plugin must exist");
        assert!(plugin.install.as_ref().expect("配方").fallbacks.is_empty());
    }

    /// 其余 builtin 不得携带 jdtls 特判（调优是插件局部数据，不会泄漏到通用插件）。
    #[test]
    fn non_java_builtins_keep_generic_tuning() {
        for p in super::super::all_builtin_plugins() {
            if p.language_id == "java" {
                continue;
            }
            assert!(p.tuning.version_probe, "{} 应保持默认探测", p.language_id);
            assert!(
                !p.tuning.java_home_from_path,
                "{} 不应注入 JAVA_HOME",
                p.language_id
            );
        }
    }
}

#[cfg(test)]
mod initialization_options_tests {
    use super::*;
    use crate::lsp::java_debug_bundle::DEBUG_PLUGIN_FILE;

    fn valid_bundle_at(dir: &std::path::Path) -> std::path::PathBuf {
        let path = dir.join(DEBUG_PLUGIN_FILE);
        let mut body = vec![b'z'; 600 * 1024];
        body[..4].copy_from_slice(b"PK\x03\x04");
        body[100..110].copy_from_slice(b"plugin.xml");
        std::fs::write(&path, &body).expect("write");
        path
    }

    /// import / updateBuildConfiguration 必须与业界默认一致（`interactive`）。
    #[test]
    fn java_options_carry_import_settings_and_interactive_build() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let opts = java_initialization_options_for(&tmp.path().join("absent.jar"));
        assert_eq!(opts["settings"]["java"]["import"]["maven"]["enabled"], true);
        assert_eq!(
            opts["settings"]["java"]["import"]["gradle"]["enabled"],
            true
        );
        assert_eq!(
            opts["settings"]["java"]["configuration"]["updateBuildConfiguration"],
            "interactive"
        );
    }

    /// bundle 未就绪 → **不注入** bundles（避免 jdtls 因坏路径报错）；
    /// 就绪 → 注入其绝对路径。
    #[test]
    fn java_options_inject_bundles_only_when_ready() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let absent = java_initialization_options_for(&tmp.path().join("absent.jar"));
        assert!(
            absent.get("bundles").is_none(),
            "未就绪时不得注入 bundles（坏路径会拖垮 Java 语言服务器）"
        );

        let ready = valid_bundle_at(tmp.path());
        let opts = java_initialization_options_for(&ready);
        assert_eq!(
            opts["bundles"],
            serde_json::json!([ready.to_string_lossy()])
        );
    }

    /// 插件本身通过 provider 暴露该载荷（而非静态值）。
    #[test]
    fn java_plugin_declares_dynamic_initialization_options() {
        let plugin = plugins()
            .into_iter()
            .find(|p| p.language_id == "java")
            .expect("java builtin plugin must exist");
        assert!(
            plugin.initialization_options_provider.is_some(),
            "jdtls 的 bundles 必须在会话创建时求值"
        );
        let opts = (plugin.initialization_options_provider.expect("provider"))();
        assert_eq!(
            opts["settings"]["java"]["configuration"]["updateBuildConfiguration"],
            "interactive"
        );
    }
}
