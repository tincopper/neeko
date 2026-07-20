use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "go",
        &["go"],
        "gopls",
        &["gopls"],
        Some(LspInstallMethod {
            prerequisite: "go",
            command: &["go", "install", "golang.org/x/tools/gopls@latest"],
        }),
    )
    .with_root_markers(&["go.mod", "go.work", "go.sum"])
    .with_detect_priority(5)]
}
