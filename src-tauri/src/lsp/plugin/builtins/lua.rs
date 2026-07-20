use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "lua",
        &["lua"],
        "lua-language-server",
        &["lua-language-server"],
        None,
    )
    .with_detect_priority(80)]
}
