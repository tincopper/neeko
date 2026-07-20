use super::super::types::{LspInstallMethod, LspPlugin};

const TS_SERVER: &str = "typescript-language-server";
const TS_CMD: &[&str] = &["typescript-language-server", "--stdio"];
const TS_INSTALL: LspInstallMethod = LspInstallMethod {
    prerequisite: "npm",
    command: &["npm", "install", "-g", "typescript-language-server"],
};

pub fn plugins() -> Vec<LspPlugin> {
    vec![
        LspPlugin::builtin("typescript", &["ts"], TS_SERVER, TS_CMD, Some(TS_INSTALL))
            .with_root_markers(&["tsconfig.json"])
            .with_detect_priority(15),
        LspPlugin::builtin(
            "typescriptreact",
            &["tsx"],
            TS_SERVER,
            TS_CMD,
            Some(TS_INSTALL),
        )
        .with_detect_priority(16),
        LspPlugin::builtin("javascript", &["js"], TS_SERVER, TS_CMD, Some(TS_INSTALL))
            .with_root_markers(&["jsconfig.json", "package.json"])
            .with_detect_priority(20),
        LspPlugin::builtin(
            "javascriptreact",
            &["jsx"],
            TS_SERVER,
            TS_CMD,
            Some(TS_INSTALL),
        )
        .with_detect_priority(21),
    ]
}
