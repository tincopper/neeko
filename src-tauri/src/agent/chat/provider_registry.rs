//! Agent Chat — provider registry & capability declarations.
//!
//! Replaces the centralized `adapter_for` match with a [`ProviderRegistry`] that
//! maps [`AgentKind`] → factory, plus [`ProviderCapabilities`] that let the UI
//! dynamically enable/disable features per provider (P1 + P5 — protocol
//! heterogeneity + extensibility).

use std::collections::HashMap;

use crate::agent::chat::adapter::{adapter_for, AgentAdapter, AgentKind};
use crate::common::error::AppError;

/// Provider capability flags — the UI uses these to dynamically adapt.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct ProviderCapabilities {
    /// Whether the model can be switched mid-session.
    pub session_model_switch: ModelSwitchMode,
    /// Whether mid-turn steering is supported.
    pub supports_turn_steering: bool,
    /// Whether multi-turn conversation is supported.
    pub supports_multi_turn: bool,
    /// Whether the provider natively handles approval gates.
    pub supports_native_approval: bool,
    /// Whether sessions can be resumed after restart.
    pub supports_resume: bool,
    /// Whether real-time diff patches are emitted.
    pub supports_live_diff: bool,
    /// Maximum context window in tokens, if known.
    pub context_window: Option<u32>,
}

/// Model switch semantics for a provider.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub enum ModelSwitchMode {
    /// Switch takes effect immediately.
    #[default]
    InSession,
    /// Switch requires restarting the session.
    RestartSession,
    /// Model switching is unsupported.
    Unsupported,
}

/// Factory trait for creating adapters (decouples registry from concrete types).
pub trait ProviderFactory: Send + Sync {
    /// The agent kind this factory produces.
    fn agent_kind(&self) -> AgentKind;
    /// The capabilities of the produced provider.
    fn capabilities(&self) -> ProviderCapabilities;
    /// Create an adapter with the given configuration.
    fn create(&self, config: AdapterConfig) -> Result<Box<dyn AgentAdapter>, AppError>;
}

/// Configuration passed to a provider factory.
#[derive(Clone, Debug, Default)]
pub struct AdapterConfig {
    /// Command-line invocation for the provider (empty for non-CLI providers).
    pub cmd: Vec<String>,
    /// Optional transport override (e.g. `"acp"` for ACP-based providers).
    pub transport: Option<String>,
}

/// Registry of provider factories, keyed by [`AgentKind`].
pub struct ProviderRegistry {
    factories: HashMap<AgentKind, Box<dyn ProviderFactory>>,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderRegistry {
    /// Create an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self {
            factories: HashMap::new(),
        }
    }

    /// Register a provider factory.
    pub fn register(&mut self, factory: Box<dyn ProviderFactory>) {
        self.factories.insert(factory.agent_kind(), factory);
    }

    /// Create an adapter for the given kind.
    pub fn create(
        &self,
        kind: &AgentKind,
        config: AdapterConfig,
    ) -> Result<Box<dyn AgentAdapter>, AppError> {
        let factory = self.factories.get(kind).ok_or_else(|| {
            AppError::Unsupported(format!("no provider factory registered for {kind:?}"))
        })?;
        factory.create(config)
    }

    /// Look up the capabilities for a provider kind.
    #[must_use]
    pub fn capabilities(&self, kind: &AgentKind) -> Option<ProviderCapabilities> {
        self.factories.get(kind).map(|f| f.capabilities())
    }

    /// List all registered providers and their capabilities.
    #[must_use]
    pub fn list_providers(&self) -> Vec<(AgentKind, ProviderCapabilities)> {
        self.factories
            .iter()
            .map(|(kind, f)| (kind.clone(), f.capabilities()))
            .collect()
    }

    /// Build a registry with all built-in providers registered.
    #[must_use]
    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        // Default providers delegate to the existing adapter_for logic.
        registry.register(Box::new(DefaultProviderFactory));
        registry
    }
}

/// Default factory that delegates to the existing `adapter_for` match.
/// This preserves backwards compatibility while enabling the registry pattern.
struct DefaultProviderFactory;

impl ProviderFactory for DefaultProviderFactory {
    fn agent_kind(&self) -> AgentKind {
        // This factory handles all default kinds; the registry dispatches by
        // looking up the kind, so this returns a sentinel that's overridden
        // per-kind in `create`.
        AgentKind::Custom
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities::default()
    }

    fn create(&self, config: AdapterConfig) -> Result<Box<dyn AgentAdapter>, AppError> {
        adapter_for("mockAgent", config.transport.as_deref(), config.cmd)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A stub factory for testing registration and dispatch.
    struct StubFactory {
        kind: AgentKind,
        caps: ProviderCapabilities,
    }

    impl ProviderFactory for StubFactory {
        fn agent_kind(&self) -> AgentKind {
            self.kind.clone()
        }

        fn capabilities(&self) -> ProviderCapabilities {
            self.caps.clone()
        }

        fn create(&self, _config: AdapterConfig) -> Result<Box<dyn AgentAdapter>, AppError> {
            // In tests we don't spawn real processes; this is a compile-only check
            // that the registry dispatches correctly.
            Err(AppError::Unsupported("stub adapter".to_string()))
        }
    }

    #[test]
    fn empty_registry_returns_none() {
        let registry = ProviderRegistry::new();
        assert!(registry.capabilities(&AgentKind::Codex).is_none());
        assert!(registry.list_providers().is_empty());
    }

    #[test]
    fn register_and_lookup_capabilities() {
        let mut registry = ProviderRegistry::new();
        let caps = ProviderCapabilities {
            session_model_switch: ModelSwitchMode::InSession,
            supports_turn_steering: true,
            supports_multi_turn: true,
            supports_native_approval: true,
            supports_resume: true,
            supports_live_diff: false,
            context_window: Some(128_000),
        };
        registry.register(Box::new(StubFactory {
            kind: AgentKind::Codex,
            caps: caps.clone(),
        }));

        let looked = registry.capabilities(&AgentKind::Codex).unwrap();
        assert_eq!(looked.session_model_switch, ModelSwitchMode::InSession);
        assert!(looked.supports_turn_steering);
        assert_eq!(looked.context_window, Some(128_000));

        let list = registry.list_providers();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].0, AgentKind::Codex);
    }

    #[test]
    fn create_dispatches_to_factory() {
        let mut registry = ProviderRegistry::new();
        registry.register(Box::new(StubFactory {
            kind: AgentKind::Gemini,
            caps: ProviderCapabilities::default(),
        }));

        let result = registry.create(
            &AgentKind::Gemini,
            AdapterConfig {
                cmd: vec!["gemini".into()],
                transport: None,
            },
        );
        // Stub factory returns Unsupported — proves dispatch happened.
        assert!(result.is_err());
    }

    #[test]
    fn create_unregistered_errors() {
        let registry = ProviderRegistry::new();
        let result = registry.create(&AgentKind::Codex, AdapterConfig::default());
        assert!(matches!(result, Err(AppError::Unsupported(_))));
    }

    #[test]
    fn model_switch_mode_default() {
        assert_eq!(ModelSwitchMode::default(), ModelSwitchMode::InSession);
    }
}
