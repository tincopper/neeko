#![allow(unused_imports, missing_docs)]

/// Build a commit prompt containing the diff and recent commit style reference.
#[must_use]
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
#[must_use]
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
#[must_use]
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

// ─── AI Output Cleaning ─────────────────────────────────────────────────────

/// Clean AI output by removing markdown wrapping, ANSI codes, and common waste prefixes to extract the commit message.
#[must_use]
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
