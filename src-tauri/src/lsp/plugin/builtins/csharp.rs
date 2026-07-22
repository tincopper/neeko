use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![
        LspPlugin::builtin("csharp", &["cs"], "omnisharp", &["omnisharp", "-lsp"], None)
            .with_detect_priority(55),
    ]
}
