use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![
        LspPlugin::builtin("elixir", &["ex", "exs"], "elixir-ls", &["elixir-ls"], None)
            .with_detect_priority(85),
    ]
}
