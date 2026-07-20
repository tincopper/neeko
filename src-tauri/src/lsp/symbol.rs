//! Normalized LSP response parsing: unifies Location and LocationLink formats.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::{LspPosition, LspRange};

/// Normalized location that shields the frontend from LSP response format
/// differences (Location vs LocationLink vs arrays of either).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedLocation {
    /// Target document URI.
    pub uri: String,
    /// Range in the target document.
    pub range: LspRange,
    /// Present for LocationLink responses; None for plain Location.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_range: Option<LspRange>,
}

impl UnifiedLocation {
    /// Parse a single item from a textDocument/definition or
    /// textDocument/references response.
    ///
    /// Handles:
    /// - `Location`       { uri, range }
    /// - `LocationLink`   { targetUri, targetRange, targetSelectionRange }
    pub fn from_item(item: &Value) -> Option<Self> {
        if !item.is_object() {
            return None;
        }

        // LocationLink (rust-analyzer etc.)
        if let Some(target_uri) = item.get("targetUri").and_then(|v| v.as_str()) {
            let range = parse_range(item.get("targetRange")?)?;
            let selection_range = item.get("targetSelectionRange").and_then(parse_range);
            return Some(Self {
                uri: target_uri.to_string(),
                range,
                selection_range,
            });
        }

        // Location (standard)
        if let Some(uri) = item.get("uri").and_then(|v| v.as_str()) {
            let range = parse_range(item.get("range")?)?;
            return Some(Self {
                uri: uri.to_string(),
                range,
                selection_range: None,
            });
        }

        None
    }

    /// Parse a textDocument/definition response.
    ///
    /// The response may be a single Location/LocationLink or an array of them.
    pub fn from_definition_response(value: &Value) -> Vec<Self> {
        if let Some(arr) = value.as_array() {
            arr.iter().filter_map(Self::from_item).collect()
        } else {
            Self::from_item(value).into_iter().collect()
        }
    }

    /// Parse a textDocument/references response.
    ///
    /// The response is always an array of Locations.
    pub fn from_references_response(value: &Value) -> Vec<Self> {
        match value.as_array() {
            Some(arr) => arr.iter().filter_map(Self::from_item).collect(),
            None => vec![],
        }
    }

    /// Extract the target file URI from a definition response.
    /// Returns the URI of the first result, if any.
    pub fn first_target_uri(value: &Value) -> Option<String> {
        let locations = Self::from_definition_response(value);
        locations.into_iter().next().map(|l| l.uri)
    }
}

fn parse_range(value: &Value) -> Option<LspRange> {
    let start_line = u32::try_from(value.pointer("/start/line")?.as_u64()?).unwrap_or(u32::MAX);
    let start_char =
        u32::try_from(value.pointer("/start/character")?.as_u64()?).unwrap_or(u32::MAX);
    let end_line = u32::try_from(value.pointer("/end/line")?.as_u64()?).unwrap_or(u32::MAX);
    let end_char = u32::try_from(value.pointer("/end/character")?.as_u64()?).unwrap_or(u32::MAX);

    Some(LspRange {
        start: LspPosition {
            line: start_line,
            character: start_char,
        },
        end: LspPosition {
            line: end_line,
            character: end_char,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_standard_location() {
        let value = json!({
            "uri": "file:///home/user/main.rs",
            "range": {
                "start": { "line": 10, "character": 4 },
                "end": { "line": 10, "character": 8 }
            }
        });

        let loc = UnifiedLocation::from_item(&value).unwrap();
        assert_eq!(loc.uri, "file:///home/user/main.rs");
        assert_eq!(loc.range.start.line, 10);
        assert_eq!(loc.range.start.character, 4);
        assert_eq!(loc.range.end.line, 10);
        assert_eq!(loc.range.end.character, 8);
        assert!(loc.selection_range.is_none());
    }

    #[test]
    fn test_parse_location_link() {
        let value = json!({
            "targetUri": "file:///home/user/main.rs",
            "targetRange": {
                "start": { "line": 5, "character": 0 },
                "end": { "line": 10, "character": 1 }
            },
            "targetSelectionRange": {
                "start": { "line": 5, "character": 3 },
                "end": { "line": 5, "character": 7 }
            }
        });

        let loc = UnifiedLocation::from_item(&value).unwrap();
        assert_eq!(loc.uri, "file:///home/user/main.rs");
        assert_eq!(loc.range.start.line, 5);
        assert_eq!(loc.range.end.line, 10);
        assert!(loc.selection_range.is_some());
        let sr = loc.selection_range.unwrap();
        assert_eq!(sr.start.line, 5);
        assert_eq!(sr.start.character, 3);
    }

    #[test]
    fn test_from_definition_response_array() {
        let value = json!([
            {
                "uri": "file:///a.rs",
                "range": {
                    "start": { "line": 0, "character": 0 },
                    "end": { "line": 0, "character": 4 }
                }
            },
            {
                "targetUri": "file:///b.rs",
                "targetRange": {
                    "start": { "line": 1, "character": 2 },
                    "end": { "line": 1, "character": 6 }
                }
            }
        ]);

        let locs = UnifiedLocation::from_definition_response(&value);
        assert_eq!(locs.len(), 2);
        assert_eq!(locs[0].uri, "file:///a.rs");
        assert_eq!(locs[1].uri, "file:///b.rs");
    }

    #[test]
    fn test_from_definition_response_single() {
        let value = json!({
            "uri": "file:///single.rs",
            "range": {
                "start": { "line": 3, "character": 0 },
                "end": { "line": 3, "character": 1 }
            }
        });

        let locs = UnifiedLocation::from_definition_response(&value);
        assert_eq!(locs.len(), 1);
        assert_eq!(locs[0].uri, "file:///single.rs");
    }

    #[test]
    fn test_first_target_uri() {
        let value = json!([{
            "uri": "file:///target.rs",
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 1 }
            }
        }]);

        let uri = UnifiedLocation::first_target_uri(&value);
        assert_eq!(uri, Some("file:///target.rs".to_string()));

        // Empty response
        assert_eq!(UnifiedLocation::first_target_uri(&json!(null)), None);
    }

    #[test]
    fn test_from_references_response() {
        let value = json!([
            {
                "uri": "file:///a.rs",
                "range": {
                    "start": { "line": 1, "character": 0 },
                    "end": { "line": 1, "character": 3 }
                }
            },
            {
                "uri": "file:///b.rs",
                "range": {
                    "start": { "line": 5, "character": 2 },
                    "end": { "line": 5, "character": 6 }
                }
            }
        ]);

        let refs = UnifiedLocation::from_references_response(&value);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].uri, "file:///a.rs");
        assert_eq!(refs[1].uri, "file:///b.rs");
    }
}
