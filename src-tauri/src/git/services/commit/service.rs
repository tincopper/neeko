#![allow(unused_imports, missing_docs)]

use std::path::{Path, PathBuf};

use crate::common::executor::factory::ExecTarget;
use crate::AppError;

use super::diff_aggregator::get_selected_diff;
use super::prompt::{build_commit_prompt, clean_ai_output};

/// Agent CLI invocation configuration.
pub struct AgentInvokeConfig {
    /// Agent binary or path.
    pub command: String,
    /// Arguments prepended to the prompt.
    pub prompt_args: Vec<String>,
    /// Arguments appended after the prompt.
    pub post_prompt_args: Vec<String>,
}

/// Result of an agent CLI execution.
pub struct AgentOutput {
    /// Standard output from the agent.
    pub stdout: String,
    /// Standard error from the agent.
    pub stderr: String,
    /// Process exit code.
    pub exit_code: i32,
}

/// Generate a commit message using an AI agent (pure business logic, no State dependency).
pub fn generate_commit_message(
    project_path: &Path,
    config: &AgentInvokeConfig,
    file_paths: &[String],
) -> Result<String, AppError> {
    let diff = get_selected_diff(project_path, file_paths)?;
    // 显式走 common::git::local（仅 Local 语义）：本函数只被
    // agent/commands_commit::run_agent_local 在 ExecTarget::Local 分支调用。
    // 不经 `crate::git::*` 门面 —— 该门面曾同时 glob 再导出 local 与 operations
    // 的同名函数，易误选非目标实现。local 版 get_diff_for_files 含 untracked
    // 文件内容回退（operations 版无此处理），是此处选它的决定性原因。
    let recent_messages =
        crate::common::git::local::get_recent_commit_messages(project_path, 5).unwrap_or_default();
    let prompt_content = build_commit_prompt(&diff, &recent_messages);

    log::info!(
        "[AI commit] diff_len={} recent_commits={}",
        diff.len(),
        recent_messages.len()
    );

    let output = execute_agent_cli(config, &prompt_content, project_path)?;
    let message = clean_ai_output(&output.stdout);

    if message.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent returned an empty response.".to_string(),
        ));
    }
    Ok(message)
}

/// Execute the agent CLI locally to generate a commit message.
///
/// Always runs via [`crate::core::exec`] with an explicit [`ExecTarget`].
/// Local commit path uses `ExecTarget::Local`; WSL/SSH commit goes through
/// `agent/commands_commit` which already targets those environments.
pub fn execute_agent_cli(
    config: &AgentInvokeConfig,
    prompt_content: &str,
    project_path: &Path,
) -> Result<AgentOutput, AppError> {
    execute_agent_cli_on_target(config, prompt_content, project_path, &ExecTarget::Local)
}

/// Run agent CLI in the given execution environment (project cwd on that target).
pub fn execute_agent_cli_on_target(
    config: &AgentInvokeConfig,
    prompt_content: &str,
    project_path: &Path,
    target: &ExecTarget,
) -> Result<AgentOutput, AppError> {
    use crate::common::runtime::AppRuntime;
    use crate::core::exec;

    let uses_file_mode = config
        .prompt_args
        .last()
        .map(|a| a == "-f")
        .unwrap_or(false);

    let prompt_message = if uses_file_mode {
        "Output ONLY the raw commit message for the attached changes. No explanation. No quotes. No markdown. Just the commit message text.".to_string()
    } else {
        prompt_content.to_string()
    };

    let prompt_file = if uses_file_mode {
        Some(write_prompt_file(project_path, prompt_content)?)
    } else {
        None
    };

    let mut args: Vec<String> = Vec::new();
    if uses_file_mode {
        for arg in config
            .prompt_args
            .iter()
            .take(config.prompt_args.len().saturating_sub(1))
        {
            args.push(arg.clone());
        }
        args.push(prompt_message.clone());
        args.push("-f".into());
        if let Some(ref tmp) = prompt_file {
            args.push(tmp.to_string_lossy().into_owned());
        }
    } else {
        for arg in &config.prompt_args {
            args.push(arg.clone());
        }
        args.push(prompt_message.clone());
    }
    for arg in &config.post_prompt_args {
        args.push(arg.clone());
    }

    let cwd = project_path.to_string_lossy().into_owned();
    log::info!(
        "[AI commit] exec target={:?} cmd={} args_len={} cwd={}",
        std::mem::discriminant(target),
        config.command,
        args.len(),
        cwd
    );

    let cmd = config.command.clone();
    let runtime = AppRuntime::try_current_or_tauri();
    let collected = runtime.handle().block_on(async {
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        exec::collect_in_dir(target, &cmd, &arg_refs, Some(&cwd)).await
    });

    if let Some(ref tmp) = prompt_file {
        let _ = std::fs::remove_file(tmp);
    }

    let output = collected.map_err(|e| {
        log::error!("[AI commit] spawn/collect error: {}", e);
        AppError::InvalidInput(format!(
            "Failed to run agent '{}': {}. Check the agent path in Settings.",
            config.command, e
        ))
    })?;

    let exit_code = output.exit_code;
    let stdout_str = decode_output(&output.stdout);
    let stderr_str = decode_output(&output.stderr);

    log::info!("[AI commit] exit_code={}", exit_code);
    if !stdout_str.trim().is_empty() {
        log::info!("[AI commit] stdout={}", stdout_str.trim());
    }
    if !stderr_str.trim().is_empty() {
        log::warn!("[AI commit] stderr={}", stderr_str.trim());
    }

    if exit_code != 0 {
        let detail = if stderr_str.trim().is_empty() {
            stdout_str.trim().to_string()
        } else {
            stderr_str.trim().to_string()
        };
        return Err(AppError::InvalidInput(format!(
            "Agent '{}' failed (exit {}): {}",
            config.command, exit_code, detail
        )));
    }

    Ok(AgentOutput {
        stdout: stdout_str,
        stderr: stderr_str,
        exit_code,
    })
}

/// Write the prompt content to a temporary file under `.neeko/commit.prompt`.
fn write_prompt_file(project_path: &Path, content: &str) -> Result<PathBuf, AppError> {
    let neeko_dir = project_path.join(".neeko");
    std::fs::create_dir_all(&neeko_dir)
        .map_err(|e| AppError::InvalidInput(format!("Failed to create .neeko dir: {}", e)))?;
    let tmp_path = neeko_dir.join("commit.prompt");
    std::fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| AppError::InvalidInput(format!("Failed to write prompt file: {}", e)))?;
    log::info!("[AI commit] prompt file written to: {}", tmp_path.display());
    Ok(tmp_path)
}

/// Decode process output bytes, preferring UTF-8 with lossy fallback.
fn decode_output(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => String::from_utf8_lossy(bytes).to_string(),
    }
}
