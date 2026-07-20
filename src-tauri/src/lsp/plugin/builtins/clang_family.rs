use super::super::types::LspPlugin;

pub fn plugins() -> Vec<LspPlugin> {
    vec![
        LspPlugin::builtin("c", &["c", "h"], "clangd", &["clangd"], None)
            .with_detect_priority(50),
        LspPlugin::builtin(
            "cpp",
            &["cpp", "hpp", "cc", "cxx"],
            "clangd",
            &["clangd"],
            None,
        )
        .with_root_markers(&["CMakeLists.txt", "compile_commands.json"])
        .with_detect_priority(45),
    ]
}
