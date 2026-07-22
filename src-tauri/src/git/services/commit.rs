use crate::common::executor::factory::ExecTarget;
use crate::AppError;
use std::path::{Path, PathBuf};

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
    let recent_messages =
        crate::git::get_recent_commit_messages(project_path, 5).unwrap_or_default();
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

/// Get the diff for selected files.
pub fn get_selected_diff(project_path: &Path, file_paths: &[String]) -> Result<String, AppError> {
    if file_paths.is_empty() {
        return Err(AppError::InvalidInput(
            "No files selected. Please select files to commit first.".to_string(),
        ));
    }

    let diff =
        crate::git::get_diff_for_files(project_path, file_paths, 500).map_err(AppError::from)?;

    if diff.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "No changes found in selected files.".to_string(),
        ));
    }

    log::info!("[AI commit] files={:?} diff_len={}", file_paths, diff.len());
    Ok(diff)
}

/// Build a commit prompt containing the diff and recent commit style reference.
pub fn build_commit_prompt(diff: &str, recent_messages: &[String]) -> String {
    let recent_section = if recent_messages.is_empty() {
        "(no previous commits found)".to_string()
    } else {
        recent_messages
            .iter()
            .map(|m| format!("- {}", m))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r#"You are a git commit message generator. Output ONLY the raw commit message.

CRITICAL OUTPUT RULES:
- Your entire response must be ONLY the commit message itself
- Do NOT include any explanation, reasoning, or commentary
- Do NOT include phrases like "Here is...", "I suggest...", "This commit..."
- Do NOT wrap in quotes or code blocks
- Just the raw commit message text, nothing else

FORMAT (Conventional Commits):
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>

HEADER RULES (required):
- Format: <type>(<scope>): <subject>
- type MUST be one of: feat, fix, docs, style, refactor, perf, test, chore, revert, ci
- scope is optional, infer from changed files/modules (e.g. ui, api, auth, git)
- subject: imperative present tense, no capital first letter, no period at end
- Header MUST NOT exceed 50 characters

BODY RULES (optional, include only when changes need explanation):
- Explain motivation and contrast with previous behavior
- Each line MUST NOT exceed 72 characters
- Separate from header with one blank line

FOOTER RULES (optional, include only when applicable):
- Use for closing issues (e.g. Closes #123) or noting breaking changes

LANGUAGE:
- Match the language of the recent commits below
- Chinese commits → output Chinese, English commits → output English

Recent commits for style/language reference:
{recent_section}

Changes to commit:
{diff}"#,
        recent_section = recent_section,
        diff = diff,
    )
}

/// Build a short commit prompt for WSL/SSH environments (no diff content, agent analyzes changes).
pub fn build_simple_commit_prompt(file_paths: &[String]) -> String {
    let files_section = file_paths
        .iter()
        .map(|f| format!("- {}", f))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"Generate a commit message for the current staged changes in this repository.

CRITICAL OUTPUT RULES:
- Your entire response must be ONLY the commit message itself
- Do NOT include any explanation, reasoning, or commentary
- Do NOT wrap in quotes or code blocks
- Just the raw commit message text, nothing else

FORMAT (Conventional Commits):
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>

HEADER RULES (required):
- Format: <type>(<scope>): <subject>
- type MUST be one of: feat, fix, docs, style, refactor, perf, test, chore, revert, ci
- scope is optional, infer from changed files/modules
- subject: imperative present tense, no capital first letter, no period at end
- Header MUST NOT exceed 50 characters

BODY RULES (optional, include only when changes need explanation):
- Explain motivation and contrast with previous behavior
- Each line MUST NOT exceed 72 characters
- Separate from header with one blank line

FOOTER RULES (optional, include only when applicable):
- Use for closing issues (e.g. Closes #123) or noting breaking changes

LANGUAGE:
- Check recent commits with `git log --oneline -3` and match their language
- Chinese commits -> output Chinese, English commits -> output English

Files changed:
{files_section}

Output ONLY the raw commit message. No explanation, no quotes, no code blocks."#,
        files_section = files_section,
    )
}

/// Build a shell command string to invoke an agent for commit message generation in WSL/SSH.
pub fn build_agent_commit_cmd(
    project_path: &str,
    agent_cmd: &str,
    prompt_args: &[String],
    post_prompt_args: &[String],
    prompt: &str,
) -> String {
    let sp = project_path;
    let post_args = post_prompt_args.join(" ");
    let uses_file_mode = prompt_args.last().map(|a| a == "-f").unwrap_or(false);

    if uses_file_mode {
        let prompt_args = prompt_args[..prompt_args.len() - 1].join(" ");
        let short_msg = "Output ONLY the raw commit message for the staged changes. No explanation. No quotes. No markdown. Just the commit message text.";
        format!(
            "cd '{sp}' && cat > /tmp/.neeko_commit_prompt <<'NEEKO_EOF'\n{prompt}\nNEEKO_EOF\n{agent_cmd} {prompt_args} '{short_msg}' -f /tmp/.neeko_commit_prompt {post_args} && rm -f /tmp/.neeko_commit_prompt",
        )
    } else {
        let prompt_args = prompt_args.join(" ");
        let escaped_prompt = prompt.replace('\'', "'\\''");
        format!("cd '{sp}' && {agent_cmd} {prompt_args} '{escaped_prompt}' {post_args}",)
    }
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

// ─── AI Output Cleaning ─────────────────────────────────────────────────────

/// Clean AI output by removing markdown wrapping, ANSI codes, and common waste prefixes to extract the commit message.
pub fn clean_ai_output(raw: &str) -> String {
    let ansi_stripped = strip_ansi(raw);
    let trimmed = ansi_stripped.trim();

    let inner = if trimmed.starts_with("```") {
        let without_fence = trimmed.trim_start_matches('`');
        let after_lang = without_fence
            .find('\n')
            .map(|i| &without_fence[i + 1..])
            .unwrap_or(without_fence);
        after_lang.trim_end_matches('`').trim()
    } else {
        trimmed
    };

    let waste_prefixes: &[&str] = &[
        "here is",
        "here's",
        "the commit message",
        "commit message:",
        "suggested commit",
        "i suggest",
        "i'd suggest",
        "based on",
        "this commit",
        "sure,",
        "sure!",
        "of course",
        "以下是",
        "这是",
        "建议的",
        "提交信息：",
        "提交消息：",
    ];
    let lines: Vec<&str> = inner.lines().collect();
    let start_idx = lines
        .iter()
        .position(|l| {
            let lower = l.trim().to_lowercase();
            !lower.is_empty() && !waste_prefixes.iter().any(|p| lower.starts_with(p))
        })
        .unwrap_or(0);
    let lines = &lines[start_idx..];

    let mut result_lines: Vec<&str> = Vec::new();
    let mut blank_count = 0;
    for line in lines {
        if line.trim().is_empty() {
            blank_count += 1;
            if blank_count >= 2 {
                break;
            }
            result_lines.push(line);
        } else {
            blank_count = 0;
            result_lines.push(line);
        }
        if result_lines.len() >= 20 {
            break;
        }
    }

    result_lines.join("\n").trim().to_string()
}

/// Remove ANSI escape sequences (color codes) from a string.
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_agent_commit_cmd_file_mode() {
        let cmd = build_agent_commit_cmd(
            "/home/user/project",
            "opencode",
            &["-f".to_string()],
            &[],
            "some prompt text",
        );
        assert!(cmd.starts_with(
            "cd '/home/user/project' && cat > /tmp/.neeko_commit_prompt <<'NEEKO_EOF'"
        ));
        assert!(cmd.contains("some prompt text"));
        assert!(cmd.contains("Output ONLY the raw commit message"));
        assert!(cmd.ends_with("&& rm -f /tmp/.neeko_commit_prompt"));
    }

    #[test]
    fn test_build_agent_commit_cmd_inline_mode() {
        let cmd = build_agent_commit_cmd(
            "/home/user/project",
            "claude",
            &["-p".to_string()],
            &[],
            "feat: add feature",
        );
        assert!(cmd.starts_with("cd '/home/user/project' && claude -p 'feat: add feature'"));
    }

    #[test]
    fn test_build_agent_commit_cmd_inline_escapes_single_quotes() {
        let cmd = build_agent_commit_cmd(
            "/tmp/test",
            "echo",
            &["-p".to_string()],
            &[],
            "it's working",
        );
        assert!(cmd.contains("'it'\\''s working'"));
    }

    #[test]
    fn test_build_agent_commit_cmd_with_post_args() {
        let cmd = build_agent_commit_cmd(
            "/home/user/project",
            "opencode",
            &["-f".to_string()],
            &["--model".to_string(), "gpt-4".to_string()],
            "test prompt",
        );
        assert!(cmd.contains("--model gpt-4"));
    }

    #[test]
    fn test_build_agent_commit_cmd_with_prompt_args_and_post_args() {
        let cmd = build_agent_commit_cmd(
            "/data",
            "my-agent",
            &["-c".to_string(), "ai".to_string(), "-f".to_string()],
            &["--verbose".to_string()],
            "hello",
        );
        assert!(cmd.contains("my-agent -c ai"));
        assert!(cmd.contains("Output ONLY the raw commit message"));
        assert!(cmd.contains("--verbose"));
    }
}
