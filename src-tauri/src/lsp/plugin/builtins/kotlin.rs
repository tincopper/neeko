use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "kotlin",
        &["kt", "kts"],
        "kotlin-language-server",
        &["kotlin-language-server"],
        None,
    )
    .with_detect_priority(75)]
}
