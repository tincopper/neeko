//! Custom theme types for UI theming.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A custom terminal theme with named CSS-like variables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTheme {
    /// Theme display name.
    pub name: String,
    /// Map of variable names to their values (e.g. "background": "#1e1e2e").
    pub variables: HashMap<String, String>,
}

/// A single theme entry in the theme selector list.
#[derive(Debug, Clone, Serialize)]
pub struct ThemeListItem {
    /// Internal theme name.
    pub name: String,
    /// Human-readable label.
    pub label: String,
    /// Whether this is a user-custom theme (vs built-in).
    pub is_custom: bool,
}
