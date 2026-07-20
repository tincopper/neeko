use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "php",
        &["php"],
        "intelephense",
        &["intelephense", "--stdio"],
        Some(LspInstallMethod {
            prerequisite: "npm",
            command: &["npm", "install", "-g", "intelephense"],
        }),
    )
    .with_detect_priority(65)]
}
