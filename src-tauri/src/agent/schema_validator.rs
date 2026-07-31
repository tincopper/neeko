//! Lightweight JSON Schema validation engine for Agent configuration.
//!
//! Validates a configuration value against an AgentPlugin's JSON Schema
//! (Draft-07 subset). Returns field-level error messages suitable for
//! displaying inline in the Settings UI.
//!
//! Supports: string, number, integer, boolean, object, array, enum, format
//! (password, url, path), required, default, min/max, minLength/maxLength.

use serde::Serialize;
use serde_json::Value;

/// A single validation error, pinpointing a field path.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    /// JSON pointer path (e.g. `"model"`, `"permissions/allow/0"`).
    pub path: String,
    /// Human-readable error message.
    pub message: String,
}

/// Result of validation: either Ok (with defaults applied) or a list of errors.
pub type ValidationResult = Result<Value, Vec<ValidationError>>;

/// Validate a configuration value against a JSON Schema.
///
/// On success, returns the config with defaults filled in.
/// On failure, returns a list of `ValidationError` with field paths.
pub fn validate_config(schema: &Value, config: &Value) -> ValidationResult {
    let mut errors = Vec::new();
    let mut result = config.clone();

    validate_value(schema, config, "", &mut errors);

    // Apply defaults from schema for missing fields.
    if errors.is_empty() {
        apply_defaults(schema, &mut result, "");
    }

    if errors.is_empty() {
        Ok(result)
    } else {
        Err(errors)
    }
}

/// Recursively validate a value against a schema.
fn validate_value(schema: &Value, value: &Value, path: &str, errors: &mut Vec<ValidationError>) {
    // Handle enum constraint.
    if let Some(enum_values) = schema.get("enum").and_then(|v| v.as_array()) {
        if !enum_values.iter().any(|e| e == value) {
            errors.push(ValidationError {
                path: path.to_string(),
                message: format!(
                    "Value must be one of: {}",
                    enum_values
                        .iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            });
            return;
        }
    }

    // Handle type constraint.
    let schema_type = schema.get("type").and_then(|v| v.as_str());
    match schema_type {
        Some("object") => {
            if let Value::Object(map) = value {
                validate_object(schema, map, path, errors);
            } else {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: "Expected an object".to_string(),
                });
            }
        }
        Some("array") => {
            if let Value::Array(arr) = value {
                validate_array(schema, arr, path, errors);
            } else {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: "Expected an array".to_string(),
                });
            }
        }
        Some("string") => {
            if !value.is_string() {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: "Expected a string".to_string(),
                });
            } else if let Some(s) = value.as_str() {
                validate_string(schema, s, path, errors);
            }
        }
        Some("number") | Some("integer") => {
            let is_int = schema_type == Some("integer");
            if is_int {
                if !value.is_i64() && !value.is_u64() {
                    // serde_json numbers: check if it's a whole number
                    if let Some(f) = value.as_f64() {
                        if f.fract() != 0.0 {
                            errors.push(ValidationError {
                                path: path.to_string(),
                                message: "Expected an integer".to_string(),
                            });
                        }
                    } else {
                        errors.push(ValidationError {
                            path: path.to_string(),
                            message: "Expected an integer".to_string(),
                        });
                    }
                }
            } else if !value.is_number() {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: "Expected a number".to_string(),
                });
            }
            validate_number(value, schema, path, errors);
        }
        Some("boolean") => {
            if !value.is_boolean() {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: "Expected a boolean".to_string(),
                });
            }
        }
        Some(_) | None => {
            // Unknown or missing type: skip type validation but still check properties.
            if let (Value::Object(map), Some(Value::Object(props))) =
                (value, schema.get("properties"))
            {
                validate_object(schema, map, path, errors);
                let _ = props;
            }
        }
    }
}

/// Validate an object against schema properties + required.
fn validate_object(
    schema: &Value,
    map: &serde_json::Map<String, Value>,
    path: &str,
    errors: &mut Vec<ValidationError>,
) {
    // Check required fields.
    if let Some(required) = schema.get("required").and_then(|v| v.as_array()) {
        for req in required {
            if let Some(key) = req.as_str() {
                if !map.contains_key(key) {
                    let field_path = if path.is_empty() {
                        key.to_string()
                    } else {
                        format!("{path}/{key}")
                    };
                    errors.push(ValidationError {
                        path: field_path,
                        message: "This field is required".to_string(),
                    });
                }
            }
        }
    }

    // Validate each known property.
    if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
        for (key, prop_schema) in props {
            if let Some(field_value) = map.get(key) {
                let field_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}/{key}")
                };
                validate_value(prop_schema, field_value, &field_path, errors);
            }
        }
    }

    // Validate additionalProperties if schema is an object definition.
    if let Some(Value::Object(additional_schema)) = schema.get("additionalProperties") {
        if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
            for (key, field_value) in map {
                if !props.contains_key(key) {
                    let field_path = if path.is_empty() {
                        key.to_string()
                    } else {
                        format!("{path}/{key}")
                    };
                    validate_value(
                        &Value::Object(additional_schema.clone()),
                        field_value,
                        &field_path,
                        errors,
                    );
                }
            }
        }
    }
}

/// Validate an array against schema items.
fn validate_array(schema: &Value, arr: &[Value], path: &str, errors: &mut Vec<ValidationError>) {
    if let Some(min_items) = schema.get("minItems").and_then(|v| v.as_u64()) {
        if (arr.len() as u64) < min_items {
            errors.push(ValidationError {
                path: path.to_string(),
                message: format!("At least {min_items} items required"),
            });
        }
    }
    if let Some(max_items) = schema.get("maxItems").and_then(|v| v.as_u64()) {
        if (arr.len() as u64) > max_items {
            errors.push(ValidationError {
                path: path.to_string(),
                message: format!("At most {max_items} items allowed"),
            });
        }
    }
    if let Some(items_schema) = schema.get("items") {
        for (i, item) in arr.iter().enumerate() {
            let item_path = format!("{path}/{i}");
            validate_value(items_schema, item, &item_path, errors);
        }
    }
}

/// Validate string constraints.
fn validate_string(schema: &Value, s: &str, path: &str, errors: &mut Vec<ValidationError>) {
    if let Some(min_len) = schema.get("minLength").and_then(|v| v.as_u64()) {
        if (s.len() as u64) < min_len {
            errors.push(ValidationError {
                path: path.to_string(),
                message: format!("Minimum length is {min_len}"),
            });
        }
    }
    if let Some(max_len) = schema.get("maxLength").and_then(|v| v.as_u64()) {
        if (s.len() as u64) > max_len {
            errors.push(ValidationError {
                path: path.to_string(),
                message: format!("Maximum length is {max_len}"),
            });
        }
    }
    if let Some(pattern) = schema.get("pattern").and_then(|v| v.as_str()) {
        if let Ok(re) = regex::Regex::new(pattern) {
            if !re.is_match(s) {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: format!("Must match pattern: {pattern}"),
                });
            }
        }
    }
    if let Some(format) = schema.get("format").and_then(|v| v.as_str()) {
        validate_format(s, format, path, errors);
    }
}

/// Validate number constraints.
fn validate_number(value: &Value, schema: &Value, path: &str, errors: &mut Vec<ValidationError>) {
    let num = value.as_f64();
    if let Some(n) = num {
        if let Some(min) = schema.get("minimum").and_then(|v| v.as_f64()) {
            if n < min {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: format!("Minimum value is {min}"),
                });
            }
        }
        if let Some(max) = schema.get("maximum").and_then(|v| v.as_f64()) {
            if n > max {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: format!("Maximum value is {max}"),
                });
            }
        }
    }
}

/// Validate string format (url, path, etc.).
#[allow(clippy::collapsible_if)]
fn validate_format(s: &str, format: &str, path: &str, errors: &mut Vec<ValidationError>) {
    match format {
        "url" => {
            if !s.starts_with("http://")
                && !s.starts_with("https://")
                && !s.starts_with("ws://")
                && !s.starts_with("wss://")
            {
                errors.push(ValidationError {
                    path: path.to_string(),
                    message: "Must be a valid URL (http://, https://, ws://, wss://)".to_string(),
                });
            }
        }
        "uri" if !s.contains("://") && !s.starts_with('/') => {
            errors.push(ValidationError {
                path: path.to_string(),
                message: "Must be a valid URI".to_string(),
            });
        }
        // password and path don't need structural validation
        _ => {}
    }
}

/// Recursively apply schema defaults to a config object.
fn apply_defaults(schema: &Value, config: &mut Value, _path: &str) {
    if schema.get("type").and_then(|v| v.as_str()) != Some("object") {
        return;
    }
    if let Value::Object(map) = config {
        if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
            for (key, prop_schema) in props {
                if !map.contains_key(key) {
                    if let Some(default) = prop_schema.get("default") {
                        map.insert(key.clone(), default.clone());
                    }
                } else if prop_schema.get("type").and_then(|v| v.as_str()) == Some("object") {
                    if let Some(field) = map.get_mut(key) {
                        apply_defaults(prop_schema, field, key);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_schema() -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "model": {
                    "type": "string",
                    "enum": ["sonnet", "opus"],
                    "default": "sonnet"
                },
                "verbose": {
                    "type": "boolean",
                    "default": false
                },
                "count": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" }
                }
            },
            "required": ["model"]
        })
    }

    #[test]
    fn validate_valid_config() {
        let schema = sample_schema();
        let config = serde_json::json!({ "model": "opus" });
        let result = validate_config(&schema, &config);
        assert!(result.is_ok());
        let value = result.unwrap();
        // Default applied
        assert_eq!(value["verbose"], false);
        assert_eq!(value["model"], "opus");
    }

    #[test]
    fn reject_invalid_enum() {
        let schema = sample_schema();
        let config = serde_json::json!({ "model": "invalid" });
        let result = validate_config(&schema, &config);
        assert!(result.is_err());
        let errs = result.unwrap_err();
        assert!(!errs.is_empty());
        assert!(errs[0].message.contains("one of"));
    }

    #[test]
    fn reject_missing_required() {
        let schema = sample_schema();
        let config = serde_json::json!({});
        let result = validate_config(&schema, &config);
        assert!(result.is_err());
        let errs = result.unwrap_err();
        assert!(errs.iter().any(|e| e.path == "model"));
    }

    #[test]
    fn reject_wrong_type() {
        let schema = sample_schema();
        let config = serde_json::json!({ "model": "sonnet", "count": "not a number" });
        let result = validate_config(&schema, &config);
        assert!(result.is_err());
    }

    #[test]
    fn reject_out_of_range() {
        let schema = sample_schema();
        let config = serde_json::json!({ "model": "sonnet", "count": 200 });
        let result = validate_config(&schema, &config);
        assert!(result.is_err());
        let errs = result.unwrap_err();
        assert!(errs.iter().any(|e| e.message.contains("Maximum")));
    }

    #[test]
    fn validate_array_items() {
        let schema = sample_schema();
        let config = serde_json::json!({ "model": "sonnet", "tags": ["a", 123] });
        let result = validate_config(&schema, &config);
        assert!(result.is_err());
        let errs = result.unwrap_err();
        assert!(errs.iter().any(|e| e.path == "tags/1"));
    }
}
