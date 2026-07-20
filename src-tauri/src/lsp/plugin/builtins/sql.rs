use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "sql",
        &["sql"],
        "sql-language-server",
        &["sql-language-server", "up", "--method", "stdio"],
        Some(LspInstallMethod {
            prerequisite: "npm",
            command: &["npm", "install", "-g", "sql-language-server"],
        }),
    )
    .with_detect_priority(95)]
}
