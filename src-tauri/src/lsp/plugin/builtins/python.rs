use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "python",
        &["py"],
        "pyright-langserver",
        &["pyright-langserver", "--stdio"],
        Some(LspInstallMethod {
            prerequisite: "npm",
            command: &["npm", "install", "-g", "pyright"],
        }),
    )
    .with_root_markers(&["pyproject.toml", "requirements.txt", "setup.py"])
    .with_detect_priority(30)]
}
