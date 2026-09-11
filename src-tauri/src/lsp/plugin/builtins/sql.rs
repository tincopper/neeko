use super::super::types::{InstallOp, LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "sql",
        &["sql"],
        "sql-language-server",
        &["sql-language-server", "up", "--method", "stdio"],
        Some(LspInstallMethod::new(
            "npm",
            InstallOp::exec("npm", &["install", "-g", "sql-language-server"]),
        )),
    )
    .with_detect_priority(95)]
}
