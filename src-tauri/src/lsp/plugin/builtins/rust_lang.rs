use super::super::types::{InstallOp, LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "rust",
        &["rs"],
        "rust-analyzer",
        &["rust-analyzer"],
        Some(LspInstallMethod::new(
            "rustup",
            InstallOp::exec("rustup", &["component", "add", "rust-analyzer"]),
        )),
    )
    .with_root_markers(&["Cargo.toml"])
    .with_detect_priority(10)]
}
