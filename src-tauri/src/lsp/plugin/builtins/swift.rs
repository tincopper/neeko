use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "swift",
        &["swift"],
        "sourcekit-lsp",
        &["sourcekit-lsp"],
        None,
    )
    .with_detect_priority(70)]
}
