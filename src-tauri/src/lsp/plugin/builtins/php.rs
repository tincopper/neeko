use super::super::types::{InstallOp, LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "php",
        &["php"],
        "intelephense",
        &["intelephense", "--stdio"],
        Some(LspInstallMethod::new(
            "npm",
            InstallOp::exec("npm", &["install", "-g", "intelephense"]),
        )),
    )
    .with_detect_priority(65)]
}
