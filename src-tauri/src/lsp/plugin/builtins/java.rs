use super::super::types::{LspInstallMethod, LspPlugin};

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "java",
        &["java"],
        "jdtls",
        &["jdtls"],
        Some(LspInstallMethod {
            prerequisite: "npm",
            command: &["npm", "install", "-g", "@eclipse-wtp/jdtls"],
        }),
    )
    .with_root_markers(&["pom.xml", "build.gradle", "build.gradle.kts"])
    .with_detect_priority(40)]
}
