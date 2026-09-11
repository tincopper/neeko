use super::super::types::{InstallOp, LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "ruby",
        &["rb"],
        "solargraph",
        &["solargraph", "stdio"],
        Some(LspInstallMethod::new(
            "gem",
            InstallOp::exec("gem", &["install", "solargraph"]),
        )),
    )
    .with_detect_priority(60)]
}
