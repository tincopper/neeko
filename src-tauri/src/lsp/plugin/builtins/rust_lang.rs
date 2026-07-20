use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "rust",
        &["rs"],
        "rust-analyzer",
        &["rust-analyzer"],
        Some(LspInstallMethod {
            prerequisite: "rustup",
            command: &["rustup", "component", "add", "rust-analyzer"],
        }),
    )
    .with_root_markers(&["Cargo.toml"])
    .with_detect_priority(10)]
}
