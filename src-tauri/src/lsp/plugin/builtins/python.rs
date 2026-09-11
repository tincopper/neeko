use super::super::types::{InstallOp, LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "python",
        &["py"],
        "pyright-langserver",
        &["pyright-langserver", "--stdio"],
        Some(LspInstallMethod::new(
            "npm",
            InstallOp::exec("npm", &["install", "-g", "pyright"]),
        )),
    )
    .with_root_markers(&["pyproject.toml", "requirements.txt", "setup.py"])
    .with_detect_priority(30)]
}
