use std::collections::HashMap;

/// Installation method for an LSP server.
#[derive(Debug, Clone)]
pub struct LspInstallMethod {
    /// Prerequisite tool required (e.g. "npm", "rustup", "go").
    pub prerequisite: &'static str,
    /// Command and arguments to install the server.
    pub command: &'static [&'static str],
}

/// Descriptor for a language server plugin.
#[derive(Debug, Clone)]
pub struct LspPlugin {
    /// LSP language identifier (e.g. "rust", "python").
    pub language_id: &'static str,
    /// File extensions this plugin handles.
    pub extensions: &'static [&'static str],
    /// Server binary name (used for existence check).
    pub server_binary: &'static str,
    /// Server command and arguments (including --stdio etc.).
    pub server_command: &'static [&'static str],
    /// Optional auto-install method.
    pub install: Option<LspInstallMethod>,
}

/// Registry of all available LSP language plugins.
///
/// Supports built-in defaults plus user-registered custom plugins.
/// Queries resolve file extensions → language plugins.
pub struct LspPluginRegistry {
    /// language_id → plugin
    plugins: HashMap<String, LspPlugin>,
    /// file extension → language_id
    ext_index: HashMap<String, String>,
}

impl LspPluginRegistry {
    /// Create a registry populated with built-in language plugins.
    pub fn with_defaults() -> Self {
        let mut registry = Self {
            plugins: HashMap::new(),
            ext_index: HashMap::new(),
        };

        // ── Rust ──────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "rust",
            extensions: &["rs"],
            server_binary: "rust-analyzer",
            server_command: &["rust-analyzer"],
            install: Some(LspInstallMethod {
                prerequisite: "rustup",
                command: &["rustup", "component", "add", "rust-analyzer"],
            }),
        });

        // ── Python ────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "python",
            extensions: &["py"],
            server_binary: "pyright-langserver",
            server_command: &["pyright-langserver", "--stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "pyright"],
            }),
        });

        // ── TypeScript / JavaScript ──────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "typescript",
            extensions: &["ts"],
            server_binary: "typescript-language-server",
            server_command: &["typescript-language-server", "--stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        });
        registry.register(LspPlugin {
            language_id: "typescriptreact",
            extensions: &["tsx"],
            server_binary: "typescript-language-server",
            server_command: &["typescript-language-server", "--stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        });
        registry.register(LspPlugin {
            language_id: "javascript",
            extensions: &["js"],
            server_binary: "typescript-language-server",
            server_command: &["typescript-language-server", "--stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        });
        registry.register(LspPlugin {
            language_id: "javascriptreact",
            extensions: &["jsx"],
            server_binary: "typescript-language-server",
            server_command: &["typescript-language-server", "--stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        });

        // ── Go ────────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "go",
            extensions: &["go"],
            server_binary: "gopls",
            server_command: &["gopls"],
            install: Some(LspInstallMethod {
                prerequisite: "go",
                command: &["go", "install", "golang.org/x/tools/gopls@latest"],
            }),
        });

        // ── Java ──────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "java",
            extensions: &["java"],
            server_binary: "jdtls",
            server_command: &["jdtls"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "@eclipse-wtp/jdtls"],
            }),
        });

        // ── C / C++ ──────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "c",
            extensions: &["c", "h"],
            server_binary: "clangd",
            server_command: &["clangd"],
            install: None, // typically installed via system package manager
        });
        registry.register(LspPlugin {
            language_id: "cpp",
            extensions: &["cpp", "hpp", "cc", "cxx"],
            server_binary: "clangd",
            server_command: &["clangd"],
            install: None,
        });

        // ── C# ────────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "csharp",
            extensions: &["cs"],
            server_binary: "omnisharp",
            server_command: &["omnisharp", "-lsp"],
            install: None,
        });

        // ── Ruby ──────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "ruby",
            extensions: &["rb"],
            server_binary: "solargraph",
            server_command: &["solargraph", "stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "gem",
                command: &["gem", "install", "solargraph"],
            }),
        });

        // ── PHP ───────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "php",
            extensions: &["php"],
            server_binary: "intelephense",
            server_command: &["intelephense", "--stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "intelephense"],
            }),
        });

        // ── Swift ─────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "swift",
            extensions: &["swift"],
            server_binary: "sourcekit-lsp",
            server_command: &["sourcekit-lsp"],
            install: None,
        });

        // ── Kotlin ────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "kotlin",
            extensions: &["kt", "kts"],
            server_binary: "kotlin-language-server",
            server_command: &["kotlin-language-server"],
            install: None,
        });

        // ── Lua ───────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "lua",
            extensions: &["lua"],
            server_binary: "lua-language-server",
            server_command: &["lua-language-server"],
            install: None,
        });

        // ── Elixir ────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "elixir",
            extensions: &["ex", "exs"],
            server_binary: "elixir-ls",
            server_command: &["elixir-ls"],
            install: None,
        });

        // ── R ─────────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "r",
            extensions: &["r"],
            server_binary: "R",
            server_command: &["R", "--slave", "-e", "languageserver::run()"],
            install: None,
        });

        // ── SQL ───────────────────────────────────────────────────────────
        registry.register(LspPlugin {
            language_id: "sql",
            extensions: &["sql"],
            server_binary: "sql-language-server",
            server_command: &["sql-language-server", "up", "--method", "stdio"],
            install: Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "sql-language-server"],
            }),
        });

        registry
    }

    /// Register (or overwrite) a language plugin.
    pub fn register(&mut self, plugin: LspPlugin) {
        for ext in plugin.extensions {
            self.ext_index
                .insert(ext.to_string(), plugin.language_id.to_string());
        }
        self.plugins
            .insert(plugin.language_id.to_string(), plugin);
    }

    /// Resolve a file extension to its LSP plugin, if any.
    pub fn resolve_by_extension(&self, ext: &str) -> Option<&LspPlugin> {
        let language_id = self.ext_index.get(ext)?;
        self.plugins.get(language_id)
    }

    /// Resolve by language_id directly.
    pub fn resolve_by_language(&self, language_id: &str) -> Option<&LspPlugin> {
        self.plugins.get(language_id)
    }

    /// List all registered plugins.
    pub fn list_all(&self) -> Vec<&LspPlugin> {
        self.plugins.values().collect()
    }

    /// Check whether a plugin is registered for the given language id.
    pub fn is_registered(&self, language_id: &str) -> bool {
        self.plugins.contains_key(language_id)
    }
}

impl Default for LspPluginRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_by_extension() {
        let registry = LspPluginRegistry::with_defaults();

        assert_eq!(
            registry.resolve_by_extension("rs").unwrap().language_id,
            "rust"
        );
        assert_eq!(
            registry.resolve_by_extension("py").unwrap().language_id,
            "python"
        );
        assert_eq!(
            registry.resolve_by_extension("ts").unwrap().language_id,
            "typescript"
        );
        assert_eq!(
            registry.resolve_by_extension("tsx").unwrap().language_id,
            "typescriptreact"
        );
        assert_eq!(
            registry.resolve_by_extension("go").unwrap().language_id,
            "go"
        );
        assert_eq!(
            registry.resolve_by_extension("java").unwrap().language_id,
            "java"
        );
        assert!(registry.resolve_by_extension("unknown_ext").is_none());
    }

    #[test]
    fn test_resolve_by_language() {
        let registry = LspPluginRegistry::with_defaults();

        let rust_plugin = registry.resolve_by_language("rust").unwrap();
        assert_eq!(rust_plugin.server_command[0], "rust-analyzer");

        let python_plugin = registry.resolve_by_language("python").unwrap();
        assert_eq!(python_plugin.server_command[0], "pyright-langserver");

        assert!(registry.resolve_by_language("unknown_lang").is_none());
    }

    #[test]
    fn test_custom_plugin_registration() {
        let mut registry = LspPluginRegistry::with_defaults();

        registry.register(LspPlugin {
            language_id: "customlang",
            extensions: &["cl"],
            server_binary: "custom-lsp",
            server_command: &["custom-lsp", "--stdio"],
            install: None,
        });

        assert_eq!(
            registry.resolve_by_extension("cl").unwrap().language_id,
            "customlang"
        );
        assert!(registry.is_registered("customlang"));
    }

    #[test]
    fn test_list_all() {
        let registry = LspPluginRegistry::with_defaults();
        let all = registry.list_all();
        // Should include at minimum: rust, python, typescript, go
        assert!(all.iter().any(|p| p.language_id == "rust"));
        assert!(all.iter().any(|p| p.language_id == "python"));
        assert!(all.iter().any(|p| p.language_id == "go"));
        assert!(all.iter().any(|p| p.language_id == "typescript"));
    }

    #[test]
    fn test_language_for_file_path() {
        let registry = LspPluginRegistry::with_defaults();

        let ext = |path: &str| -> Option<&str> {
            let e = std::path::Path::new(path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            registry.resolve_by_extension(e).map(|p| p.language_id)
        };

        assert_eq!(ext("/some/path/main.rs"), Some("rust"));
        assert_eq!(ext("/some/path/app.py"), Some("python"));
        assert_eq!(ext("/some/path/no_ext"), None);
        assert_eq!(ext(""), None);
    }
}
