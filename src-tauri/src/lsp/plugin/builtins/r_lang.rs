use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "r",
        &["r"],
        "R",
        &["R", "--slave", "-e", "languageserver::run()"],
        None,
    )
    .with_detect_priority(90)]
}
