use super::super::types::{InstallOp, LspInstallMethod, LspPlugin, RootScope};

/// TS/JS **工程根** marker：`typescript-language-server` 从 `initialize` 收到的会话根
/// 向上解析 `node_modules/typescript`，而 monorepo 的前端常在自己的子目录里 ——
/// 故会话根取「文档向上遇到的、含任一 marker 的最近目录」。
///
/// 注意与各插件的 `root_markers`（检测用途，如 typescript 只认 tsconfig.json）区分：
/// 两者语义不同，不能合并。
const TS_PROJECT_ROOT_MARKERS: &[&str] = &["tsconfig.json", "jsconfig.json", "package.json"];

const TS_SERVER: &str = "typescript-language-server";
const TS_CMD: &[&str] = &["typescript-language-server", "--stdio"];
const TS_INSTALL: LspInstallMethod = LspInstallMethod::new(
    "npm",
    InstallOp::exec("npm", &["install", "-g", "typescript-language-server"]),
);

pub fn plugins() -> Vec<LspPlugin> {
    vec![
        LspPlugin::builtin("typescript", &["ts"], TS_SERVER, TS_CMD, Some(TS_INSTALL))
            .with_root_markers(&["tsconfig.json"])
            .with_root_scope(RootScope::document_scoped(TS_PROJECT_ROOT_MARKERS))
            .with_detect_priority(15),
        LspPlugin::builtin(
            "typescriptreact",
            &["tsx"],
            TS_SERVER,
            TS_CMD,
            Some(TS_INSTALL),
        )
        .with_root_markers(&["tsconfig.json"])
        .with_root_scope(RootScope::document_scoped(TS_PROJECT_ROOT_MARKERS))
        .with_detect_priority(16),
        LspPlugin::builtin("javascript", &["js"], TS_SERVER, TS_CMD, Some(TS_INSTALL))
            .with_root_markers(&["jsconfig.json", "package.json"])
            .with_root_scope(RootScope::document_scoped(TS_PROJECT_ROOT_MARKERS))
            // package.json + tsconfig ⇒ 该工程是 TS，javascript 退出候选。
            // **不含 jsconfig.json**：它是 JS 工程配置（见 RootScope 文档与 profile 单测）。
            .with_detect_suppressed_by(&["tsconfig.json"])
            .with_detect_priority(20),
        LspPlugin::builtin(
            "javascriptreact",
            &["jsx"],
            TS_SERVER,
            TS_CMD,
            Some(TS_INSTALL),
        )
        .with_root_markers(&["jsconfig.json", "package.json"])
        .with_root_scope(RootScope::document_scoped(TS_PROJECT_ROOT_MARKERS))
        .with_detect_suppressed_by(&["tsconfig.json"])
        .with_detect_priority(21),
    ]
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn plugin(language_id: &str) -> LspPlugin {
        plugins()
            .into_iter()
            .find(|p| p.language_id == language_id)
            .unwrap_or_else(|| panic!("TS family plugin must exist: {language_id}"))
    }

    /// 数据契约：TS/JS 家族全部**文档定根**，且 markers 与原 `TS_ROOT_MARKERS`
    /// 逐字一致 —— 这是"白名单数据化后行为等价"的依据（会话根解析回归依赖它）。
    #[test]
    fn ts_family_declares_document_root_scope_with_engine_markers() {
        let expected: Vec<String> = TS_PROJECT_ROOT_MARKERS
            .iter()
            .map(|m| (*m).to_string())
            .collect();
        for language_id in [
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ] {
            assert_eq!(
                plugin(language_id).root_scope.walk_markers(),
                Some(expected.as_slice()),
                "{language_id} 必须声明文档定根，且 markers 与原 TS_ROOT_MARKERS 一致"
            );
        }
    }

    /// 数据契约：只有 javascript 家族被 `tsconfig.json` 压制，且**不含
    /// `jsconfig.json`**（后者是 JS 工程配置，压制 javascript 是语义错误）。
    #[test]
    fn only_javascript_family_is_suppressed_by_tsconfig() {
        assert_eq!(
            plugin("javascript").detect_suppressed_by,
            vec!["tsconfig.json".to_string()]
        );
        assert_eq!(
            plugin("javascriptreact").detect_suppressed_by,
            vec!["tsconfig.json".to_string()]
        );
        assert!(plugin("typescript").detect_suppressed_by.is_empty());
        assert!(plugin("typescriptreact").detect_suppressed_by.is_empty());
    }

    /// 反向契约：非 TS 家族（以 rust/go 为例）保持项目根 —— 数据化不得改变它们的语义。
    #[test]
    fn non_ts_languages_stay_project_scoped() {
        use crate::lsp::plugin::LspPluginRegistry;
        let registry = LspPluginRegistry::with_defaults();
        for language_id in ["rust", "go"] {
            let p = registry
                .resolve_by_language(language_id)
                .expect("builtin must exist");
            assert!(
                p.root_scope.walk_markers().is_none(),
                "{language_id} 不得声明文档定根"
            );
            assert!(p.detect_suppressed_by.is_empty());
        }
    }
}
