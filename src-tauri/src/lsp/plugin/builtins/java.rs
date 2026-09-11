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
