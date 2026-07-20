use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "ruby",
        &["rb"],
        "solargraph",
        &["solargraph", "stdio"],
        Some(LspInstallMethod {
            prerequisite: "gem",
            command: &["gem", "install", "solargraph"],
        }),
    )
    .with_detect_priority(60)]
}
