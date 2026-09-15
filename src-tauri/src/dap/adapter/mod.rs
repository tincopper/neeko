//! Debug adapter plugins — one cohesive strategy per language family.
//!
//! Business code resolves a plugin by launch `type`, then asks it for spawn
//! specs and launch args. All binary existence checks use
//! [`crate::core::exec`] with the project [`ExecTarget`].

mod backend;
mod go;
pub mod java;
mod lldb;
mod plugin;
mod registry;

pub use backend::{
    DebugRequest, DebugStartOutcome, LanguageBackend, SessionPlan, SessionRoutePlan,
    SourcePathResolution,
};
pub use go::GoAdapter;
pub use java::JavaAdapter;
pub use lldb::LldbAdapter;
pub use plugin::DebugAdapterPlugin;
pub use registry::{adapter_available, plugin_for};
