//! LSP plugin management.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::lsp::plugin::{LspAutoStart, LspPlugin, LspPluginRegistry, LspSettings};
use crate::AppError;

/// Manages LSP plugin discovery, registration, and project execution targets.
pub struct LspPluginManager {
    registry: Mutex<LspPluginRegistry>,
    project_exec_targets: Mutex<HashMap<String, crate::common::executor::factory::ExecTarget>>,
    default_auto_start: Mutex<LspAutoStart>,
}

impl LspPluginManager {
    pub(crate) fn new() -> Self {
        Self {
            registry: Mutex::new(LspPluginRegistry::with_defaults()),
            project_exec_targets: Mutex::new(HashMap::new()),
            default_auto_start: Mutex::new(LspAutoStart::OnFirstFile),
        }
    }

    pub(crate) fn resolve_language_for_path(&self, file_path: &str) -> Option<String> {
        let ext = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        self.registry
            .lock()
            .ok()
            .and_then(|r| r.resolve_by_extension(ext).map(|p| p.language_id.clone()))
    }

    pub(crate) fn resolve_by_language(&self, language_id: &str) -> Option<LspPlugin> {
        self.registry
            .lock()
            .ok()
            .and_then(|r| r.resolve_by_language(language_id).cloned())
    }

    pub(crate) fn plugin_server_binary(&self, language_id: &str) -> Option<String> {
        self.registry.lock().ok().and_then(|r| {
            r.resolve_by_language(language_id)
                .map(|p| p.server_binary.clone())
        })
    }

    pub(crate) fn extension_map(&self) -> Vec<super::plugin::LspExtensionMapEntry> {
        self.registry
            .lock()
            .map(|r| r.extension_map())
            .unwrap_or_default()
    }

    pub(crate) fn extension_conflicts(&self) -> Vec<super::plugin::LspExtensionConflict> {
        self.registry
            .lock()
            .map(|r| r.extension_conflicts())
            .unwrap_or_default()
    }

    pub(crate) fn detection_markers(&self) -> Vec<(String, String, String)> {
        self.registry
            .lock()
            .map(|r| r.detection_markers())
            .unwrap_or_default()
    }

    pub(crate) fn register_plugin(&self, plugin: LspPlugin) {
        match self.registry.lock() {
            Ok(mut r) => r.register(plugin),
            Err(poisoned) => {
                log::warn!("[LSP] plugin registry mutex poisoned, recovering");
                poisoned.into_inner().register(plugin);
            }
        }
    }

    pub(crate) fn apply_settings(&self, settings: &LspSettings) -> Result<(), AppError> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|e| AppError::Lsp(e.to_string()))?;
        registry.reset_to_defaults();
        for custom in &settings.custom_servers {
            if custom.language_id.trim().is_empty() || custom.command.is_empty() {
                continue;
            }
            registry.register(LspPlugin::from_custom(custom));
        }
        Ok(())
    }

    pub(crate) fn set_project_exec_target(
        &self,
        project_path: &str,
        target: crate::common::executor::factory::ExecTarget,
    ) {
        match self.project_exec_targets.lock() {
            Ok(mut map) => {
                map.insert(project_path.to_string(), target);
            }
            Err(poisoned) => {
                log::warn!("[LSP] project_exec_targets mutex poisoned, recovering");
                poisoned
                    .into_inner()
                    .insert(project_path.to_string(), target);
            }
        }
    }

    pub(crate) fn project_exec_target(
        &self,
        project_path: &str,
    ) -> Option<crate::common::executor::factory::ExecTarget> {
        self.project_exec_targets
            .lock()
            .ok()
            .and_then(|m| m.get(project_path).cloned())
    }

    pub(crate) fn require_project_exec_target(
        &self,
        project_path: &str,
    ) -> Result<crate::common::executor::factory::ExecTarget, AppError> {
        self.project_exec_target(project_path).ok_or_else(|| {
            AppError::Lsp(format!(
                "No execution environment recorded for project path '{project_path}'"
            ))
        })
    }

    pub(crate) fn resolve_auto_start(&self, language_id: &str) -> LspAutoStart {
        if let Some(p) = self.resolve_by_language(language_id) {
            if p.is_custom {
                return p.auto_start;
            }
        }
        self.default_auto_start
            .lock()
            .map(|x| *x)
            .unwrap_or(LspAutoStart::OnFirstFile)
    }

    pub(crate) fn set_default_auto_start(&self, policy: LspAutoStart) {
        match self.default_auto_start.lock() {
            Ok(mut s) => *s = policy,
            Err(poisoned) => {
                log::warn!("[LSP] default_auto_start mutex poisoned, recovering");
                *poisoned.into_inner() = policy;
            }
        }
    }

    pub(crate) fn default_auto_start(&self) -> LspAutoStart {
        self.default_auto_start
            .lock()
            .map(|x| *x)
            .unwrap_or(LspAutoStart::OnFirstFile)
    }
}
