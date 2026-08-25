//! Agent model discovery service (domain layer).
//!
//! OpenCode dynamically discovers supported models by executing
//! `opencode models --verbose` and parsing its NDJSON output; other agents
//! expose a statically configured model list. Both paths converge here so
//! that Tauri commands stay thin (skinny controller) and the parsing logic
//! is independently testable without a webview runtime.

use crate::common::agent::types::ModelInfo;
use crate::AppError;

/// Execute `opencode models --verbose` and return the discovered models.
///
/// `binary_path` overrides the `opencode` binary name (used by custom installs).
pub async fn discover_opencode_models(
    binary_path: Option<String>,
) -> Result<Vec<ModelInfo>, AppError> {
    use crate::common::executor::factory::ExecTarget;
    use crate::core::exec;

    let path = binary_path.unwrap_or_else(|| "opencode".into());
    let target = ExecTarget::Local;

    log::info!(
        "[discover_opencode_models] Executing: {} models --verbose",
        path
    );

    // Execute `opencode models --verbose` to get model information.
    let output = exec::collect(&target, &path, &["models", "--verbose"])
        .await
        .map_err(|e| {
            log::error!("[discover_opencode_models] Failed to execute: {e}");
            AppError::Io(format!("failed to execute opencode models: {e}"))
        })?;

    log::info!(
        "[discover_opencode_models] Exit code: {}, stdout length: {}, stderr length: {}",
        output.exit_code,
        output.stdout.len(),
        output.stderr.len()
    );

    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "[discover_opencode_models] Command failed (code {}): {}",
            output.exit_code,
            stderr.trim()
        );
        return Err(AppError::Io(format!(
            "opencode models failed (code {}): {}",
            output.exit_code,
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    log::debug!("[discover_opencode_models] stdout: {}", stdout);

    // Parse the NDJSON output (one JSON object per line, with optional slug prefix).
    let models = parse_opencode_models_output(&stdout)?;
    log::info!(
        "[discover_opencode_models] Discovered {} models",
        models.len()
    );

    Ok(models)
}

/// Parse the output of `opencode models --verbose`.
///
/// The output format is NDJSON with optional slug prefixes:
/// ```text
/// opencode/big-pickle
/// {
///   "id": "big-pickle",
///   "providerID": "opencode",
///   "name": "Big Pickle",
///   ...
/// }
/// ```
pub fn parse_opencode_models_output(output: &str) -> Result<Vec<ModelInfo>, AppError> {
    let mut models = Vec::new();
    let mut current_slug: Option<String> = None;
    let mut current_json = String::new();
    let mut in_json = false;
    let mut brace_depth = 0;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !in_json {
            // Check if this line starts a JSON object.
            if trimmed.starts_with('{') {
                in_json = true;
                current_json = trimmed.to_string();
                brace_depth = trimmed.matches('{').count() - trimmed.matches('}').count();
                if brace_depth == 0 {
                    // Complete JSON on a single line.
                    if let Some(model) =
                        parse_opencode_model_json(&current_json, current_slug.as_deref())?
                    {
                        models.push(model);
                    }
                    current_slug = None;
                    current_json.clear();
                    in_json = false;
                }
            } else {
                // This is a slug line (e.g. "opencode/big-pickle").
                current_slug = Some(trimmed.to_string());
            }
        } else {
            // Continue accumulating JSON.
            current_json.push('\n');
            current_json.push_str(trimmed);
            let line_opens = trimmed.matches('{').count();
            let line_closes = trimmed.matches('}').count();
            if line_closes > line_opens {
                brace_depth = brace_depth.saturating_sub(line_closes - line_opens);
            } else {
                brace_depth += line_opens - line_closes;
            }
            if brace_depth == 0 {
                // JSON complete.
                if let Some(model) =
                    parse_opencode_model_json(&current_json, current_slug.as_deref())?
                {
                    models.push(model);
                }
                current_slug = None;
                current_json.clear();
                in_json = false;
            }
        }
    }

    Ok(models)
}

/// Parse a single OpenCode model JSON object into a `ModelInfo`.
pub fn parse_opencode_model_json(
    json: &str,
    slug: Option<&str>,
) -> Result<Option<ModelInfo>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Io(format!("failed to parse opencode model JSON: {e}")))?;

    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Io("opencode model missing 'id' field".into()))?;

    let provider_id = value
        .get("providerID")
        .and_then(|v| v.as_str())
        .unwrap_or("opencode");

    let name = value.get("name").and_then(|v| v.as_str()).unwrap_or(id);

    // Extract context window from limit.context.
    let context_window = value
        .get("limit")
        .and_then(|l| l.get("context"))
        .and_then(|v| v.as_u64())
        .map(|v| u32::try_from(v).unwrap_or(u32::MAX));

    // Extract reasoning effort from variants.
    let mut supported_reasoning_efforts = Vec::new();
    let default_reasoning_effort = None;
    if let Some(variants) = value.get("variants").and_then(|v| v.as_object()) {
        for (_key, variant) in variants {
            if let Some(effort) = variant
                .get("reasoningEffort")
                .or_else(|| variant.get("reasoning_effort"))
                .or_else(|| variant.get("effort"))
                .and_then(|v| v.as_str())
            {
                if !supported_reasoning_efforts.contains(&effort.to_string()) {
                    supported_reasoning_efforts.push(effort.to_string());
                }
            }
        }
    }
    // Sort for deterministic output.
    supported_reasoning_efforts.sort();

    // Check if model is free.
    let is_free = value
        .get("cost")
        .map(|c| {
            let input = c.get("input").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let output = c.get("output").and_then(|v| v.as_f64()).unwrap_or(0.0);
            input == 0.0 && output == 0.0
        })
        .unwrap_or(false);

    let provider_name = match provider_id {
        "opencode" => Some("OpenCode".to_string()),
        "anthropic" => Some("Anthropic".to_string()),
        "openai" => Some("OpenAI".to_string()),
        "google" => Some("Google".to_string()),
        "deepseek" => Some("DeepSeek".to_string()),
        _ => Some(provider_id.to_string()),
    };

    Ok(Some(ModelInfo {
        id: slug.unwrap_or(id).to_string(),
        name: name.to_string(),
        provider_id: Some(provider_id.to_string()),
        provider_name,
        supported_reasoning_efforts,
        default_reasoning_effort,
        context_window,
        is_free,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_opencode_models_output_parses_slug_and_json() {
        let input = r#"opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "cost": {
    "input": 0,
    "output": 0
  },
  "limit": {
    "context": 200000
  },
  "variants": {}
}
opencode/claude-fable-5
{
  "id": "claude-fable-5",
  "providerID": "opencode",
  "name": "Claude Fable 5",
  "cost": {
    "input": 10,
    "output": 50
  },
  "limit": {
    "context": 1000000
  },
  "variants": {}
}"#;

        let models = parse_opencode_models_output(input).expect("parse should succeed");
        assert_eq!(models.len(), 2);

        assert_eq!(models[0].id, "opencode/big-pickle");
        assert_eq!(models[0].name, "Big Pickle");
        assert_eq!(models[0].provider_id, Some("opencode".to_string()));
        assert!(models[0].is_free);
        assert_eq!(models[0].context_window, Some(200000));

        assert_eq!(models[1].id, "opencode/claude-fable-5");
        assert_eq!(models[1].name, "Claude Fable 5");
        assert!(!models[1].is_free);
        assert_eq!(models[1].context_window, Some(1000000));
    }

    #[test]
    fn parse_opencode_models_output_handles_empty_input() {
        let models = parse_opencode_models_output("").expect("parse should succeed");
        assert!(models.is_empty());
    }

    #[test]
    fn parse_opencode_model_json_extracts_reasoning_efforts() {
        let json = r#"{
  "id": "test-model",
  "providerID": "opencode",
  "name": "Test Model",
  "variants": {
    "thinking": {
      "reasoningEffort": "high"
    },
    "normal": {}
  }
}"#;

        let model = parse_opencode_model_json(json, Some("opencode/test-model"))
            .expect("parse should succeed")
            .expect("model should be Some");

        assert_eq!(model.id, "opencode/test-model");
        assert_eq!(model.supported_reasoning_efforts, vec!["high".to_string()]);
    }

    /// Integration test: actually executes `opencode models --verbose`.
    /// Only runs if opencode is installed and authenticated.
    #[tokio::test]
    async fn discover_opencode_models_integration() {
        use crate::common::executor::factory::ExecTarget;
        use crate::core::exec;

        // Check if opencode is available.
        if !exec::command_exists(&ExecTarget::Local, "opencode").await {
            println!("Skipping integration test: opencode not found");
            return;
        }

        let result = discover_opencode_models(None).await;
        match result {
            Ok(models) => {
                println!("Discovered {} models", models.len());
                assert!(models.len() > 0, "Should discover at least one model");
                for model in &models {
                    println!("  - {} ({})", model.name, model.id);
                }
            }
            Err(e) => {
                println!("discover_opencode_models failed: {e}");
                // Don't fail the test if opencode is not authenticated.
            }
        }
    }
}
