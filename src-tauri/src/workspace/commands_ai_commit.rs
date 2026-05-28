use crate::AppError;
use crate::AppStateWrapper;
use std::path::{Path, PathBuf};
use tauri::State;

// ─── Types ──────────────────────────────────────────────────────────────────

/// Agent CLI 调用配置
pub(crate) struct AgentInvokeConfig {
    pub(crate) command: String,
    pub(crate) prompt_args: Vec<String>,
    pub(crate) post_prompt_args: Vec<String>,
}

/// Agent CLI 执行结果
#[allow(dead_code)]
struct AgentOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

// ─── Tauri Command ──────────────────────────────────────────────────────────

/// 通过当前项目选择的 Agent CLI，根据 selected diff 和近期 commit 历史，
/// 自动生成 commit message。
///
/// 执行方式：`<agent_command> [prompt_args...] "<prompt>"`
/// 例如 claude-code：`claude -p "<prompt>"`
#[tauri::command]
pub async fn generate_commit_message_command(
    project_id: String,
    agent_id: String,
    agent_command_override: Option<String>,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let config = resolve_agent_config(&state, &agent_id, agent_command_override.as_deref())?;
    let diff = get_selected_diff(&project_path, &file_paths)?;

    let recent_messages =
        crate::git::get_recent_commit_messages(&project_path, 5).unwrap_or_default();
    let prompt_content = build_commit_prompt(&diff, &recent_messages);

    log::info!(
        "[AI commit] diff_len={} recent_commits={}",
        diff.len(),
        recent_messages.len()
    );

    let output = execute_agent_cli(&config, &prompt_content, &project_path)?;

    let message = clean_ai_output(&output.stdout);
    if message.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent returned an empty response.".to_string(),
        ));
    }
    Ok(message)
}

// ─── Step 1: Project Path ───────────────────────────────────────────────────

fn get_project_path(state: &AppStateWrapper, project_id: &str) -> Result<PathBuf, AppError> {
    let manager = state.project_manager.lock().map_err(AppError::from)?;
    let path = manager
        .get_project(project_id)
        .map(|p| p.path.clone())
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
    log::info!("[AI commit] project_path={}", path.display());
    Ok(path)
}

// ─── Step 2: Agent Config ───────────────────────────────────────────────────

pub(crate) fn resolve_agent_config(
    state: &AppStateWrapper,
    agent_id: &str,
    command_override: Option<&str>,
) -> Result<AgentInvokeConfig, AppError> {
    let agent_manager = state.agent_manager.lock().map_err(AppError::from)?;
    let agent = agent_manager
        .get_agent(agent_id)
        .ok_or_else(|| AppError::NotFound(format!("Agent not found: {}", agent_id)))?;

    let prompt_args = agent.resolve_prompt_args().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Agent '{}' does not support prompt mode.",
            agent.name
        ))
    })?;

    let command = command_override
        .filter(|s| !s.is_empty())
        .unwrap_or(&agent.command)
        .to_string();

    let post_prompt_args = agent.resolve_post_prompt_args();

    log::info!(
        "[AI commit] agent_id={} command={} prompt_args={:?} post_prompt_args={:?}",
        agent_id,
        command,
        prompt_args,
        post_prompt_args
    );

    Ok(AgentInvokeConfig {
        command,
        prompt_args,
        post_prompt_args,
    })
}

// ─── WSL/SSH Agent Resolution ───────────────────────────────────────────────

/// WSL/SSH 场景解析 agent 配置。
///
/// `selected_agent` 可能是 agent ID（如 `"opencode"`）或 WSL/SSH 内的完整命令路径
///（如 `/home/tomgs/.nvm/versions/node/v20.19.5/bin/opencode`）。
///
/// 返回 `(command, prompt_args, post_prompt_args)`，其中 command 直接使用 `selected_agent` 原值。
pub(crate) fn resolve_agent_for_remote(
    state: &AppStateWrapper,
    selected_agent: &str,
) -> (String, Vec<String>, Vec<String>) {
    log::info!(
        "[AI commit remote] resolve_agent_for_remote: selected_agent='{}'",
        selected_agent
    );

    // 1. 按 ID 直接查找
    if let Ok(config) = resolve_agent_config(state, selected_agent, None) {
        log::info!(
            "[AI commit remote] resolved by id: command='{}' prompt_args={:?} post_prompt_args={:?}",
            selected_agent, config.prompt_args, config.post_prompt_args
        );
        return (
            selected_agent.to_string(),
            config.prompt_args,
            config.post_prompt_args,
        );
    }

    // 2. 按 ID 找不到 → 可能是完整路径，从路径提取命令名再尝试匹配
    let cmd_name = selected_agent
        .rsplit('/')
        .next()
        .unwrap_or(selected_agent)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd");

    log::info!(
        "[AI commit remote] id lookup failed, trying filename='{}'",
        cmd_name
    );

    if let Ok(config) = resolve_agent_config(state, cmd_name, None) {
        log::info!(
            "[AI commit remote] resolved by filename: command='{}' prompt_args={:?} post_prompt_args={:?}",
            selected_agent, config.prompt_args, config.post_prompt_args
        );
        return (
            selected_agent.to_string(),
            config.prompt_args,
            config.post_prompt_args,
        );
    }

    // 3. 完全未知 agent，用传入值作为命令，无 prompt_args（普通 inline 模式）
    log::info!(
        "[AI commit remote] unknown agent, using as-is: command='{}' prompt_args=[]",
        selected_agent
    );
    (selected_agent.to_string(), vec![], vec![])
}

// ─── Step 3: Diff ───────────────────────────────────────────────────────────

fn get_selected_diff(project_path: &Path, file_paths: &[String]) -> Result<String, AppError> {
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

// ─── Step 4: Prompt Construction ────────────────────────────────────────────

fn build_commit_prompt(diff: &str, recent_messages: &[String]) -> String {
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

/// 构建 WSL/SSH 场景的简短 prompt（不含 diff 内容，agent 自行分析变更）
pub(crate) fn build_simple_commit_prompt(file_paths: &[String]) -> String {
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

// ─── Step 5: Remote/WSL Command String Construction ─────────────────────────

/// Build the bash command string for running an agent commit message generator
/// on a remote host or WSL distro. Shared by `commands_wsl` and `commands_remote`.
pub(crate) fn build_agent_commit_cmd(
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

// ─── Step 6: Local Agent CLI Execution ───────────────────────────────────────

fn execute_agent_cli(
    config: &AgentInvokeConfig,
    prompt_content: &str,
    project_path: &Path,
) -> Result<AgentOutput, AppError> {
    let full_path = resolve_full_path();
    let resolved_command = resolve_command_path(&config.command, &full_path);

    // 判断 file mode：prompt_args 末尾为 "-f" 时，将 prompt 写入临时文件
    let uses_file_mode = config
        .prompt_args
        .last()
        .map(|a| a == "-f")
        .unwrap_or(false);

    // file mode: 短指令作为 message 参数，完整 prompt 写入文件
    let prompt_message = if uses_file_mode {
        "Output ONLY the raw commit message for the attached changes. No explanation. No quotes. No markdown. Just the commit message text.".to_string()
    } else {
        prompt_content.to_string()
    };

    // 写入临时 prompt 文件（file mode 时）
    let prompt_file = if uses_file_mode {
        Some(write_prompt_file(project_path, prompt_content)?)
    } else {
        None
    };

    log::info!(
        "[AI commit] exec: {} {:?} <prompt({} chars)>",
        resolved_command,
        config.prompt_args,
        prompt_message.len()
    );
    log::info!("[AI commit] PATH={}", full_path);

    // 构建 Command（平台分支）
    let mut cmd = build_platform_command(&resolved_command, &full_path);

    // 拼接参数
    if uses_file_mode {
        // file mode: [flags...] "message" -f <file_path> [post_args...]
        for arg in config.prompt_args.iter().take(config.prompt_args.len() - 1) {
            cmd.arg(arg);
        }
        cmd.arg(&prompt_message);
        cmd.arg("-f");
        cmd.arg(prompt_file.as_ref().unwrap());
    } else {
        // 普通模式: [prompt_args...] "prompt" [post_args...]
        for arg in &config.prompt_args {
            cmd.arg(arg);
        }
        cmd.arg(&prompt_message);
    }

    for arg in &config.post_prompt_args {
        cmd.arg(arg);
    }
    cmd.current_dir(project_path);

    // 执行
    let output = cmd.output().map_err(|e| {
        log::error!("[AI commit] spawn error: {}", e);
        AppError::InvalidInput(format!(
            "Failed to run agent '{}': {}. Check the agent path in Settings.",
            config.command, e
        ))
    })?;

    // 清理临时文件
    if let Some(ref tmp) = prompt_file {
        let _ = std::fs::remove_file(tmp);
    }

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout_str = decode_output(&output.stdout);
    let stderr_str = decode_output(&output.stderr);

    log::info!("[AI commit] exit_code={}", exit_code);
    if !stdout_str.trim().is_empty() {
        log::info!("[AI commit] stdout={}", stdout_str.trim());
    }
    if !stderr_str.trim().is_empty() {
        log::warn!("[AI commit] stderr={}", stderr_str.trim());
    }

    if !output.status.success() {
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

/// 写入 prompt 到临时文件 .neeko/commit.prompt
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

/// 构建平台相关的 Command 对象
fn build_platform_command(resolved_command: &str, path_env: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = crate::utils::command::local::exec("cmd.exe");
        c.env("PATH", path_env);
        c.env("NO_COLOR", "1");
        c.arg("/C");
        c.arg(resolved_command);
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut c = crate::utils::command::local::exec(resolved_command);
        c.env("PATH", path_env);
        c.env("NO_COLOR", "1");
        c
    }
}

// ─── Step 6: Output Cleaning ────────────────────────────────────────────────

/// 清理 AI 输出：去除 markdown 包裹、ANSI 颜色码、常见废话前缀，只保留 commit message 本体。
pub(crate) fn clean_ai_output(raw: &str) -> String {
    // 1. 去除 ANSI 颜色/控制码（形如 \x1b[...m）
    let ansi_stripped = strip_ansi(raw);
    let trimmed = ansi_stripped.trim();

    // 2. 去除 ``` 代码块包裹
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

    // 3. 去除常见 AI 废话前缀（逐行检查第一个非空行）
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
    // 找到第一个非空且不是废话前缀的行作为起始
    let start_idx = lines
        .iter()
        .position(|l| {
            let lower = l.trim().to_lowercase();
            !lower.is_empty() && !waste_prefixes.iter().any(|p| lower.starts_with(p))
        })
        .unwrap_or(0);
    let lines = &lines[start_idx..];

    // 4. 取 subject + 可选 body（subject + 空行 + body），遇到第二个空行截止
    //    最多保留 20 行，丢弃 AI 在 commit message 后附加的解释
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

// ─── Utilities ──────────────────────────────────────────────────────────────

/// 去除字符串中的 ANSI 转义序列（颜色码等）。
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // 跳过 ESC [ ... m 序列
            if chars.peek() == Some(&'[') {
                chars.next();
                // 跳到序列终止字符（字母）
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

/// 解码进程输出字节，优先 UTF-8；Windows 上若 UTF-8 失败则尝试 GBK（通过 lossy 回退）。
fn decode_output(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            // 非 UTF-8（常见于 Windows GBK 输出），用 lossy 替换无效字节
            String::from_utf8_lossy(bytes).to_string()
        }
    }
}

/// 用 where.exe（Windows）或 which（Unix）在给定 PATH 下解析命令的真实可执行路径。
/// 找不到时回退到原始命令名（让系统自己报错）。
fn resolve_command_path(command: &str, path_env: &str) -> String {
    // 已经是绝对路径，直接返回
    if std::path::Path::new(command).is_absolute() {
        return command.to_string();
    }

    #[cfg(target_os = "windows")]
    {
        // where.exe 支持 /F（带引号）和按 PATHEXT 顺序查找 .exe/.cmd/.bat
        let output = crate::utils::command::local::exec("where.exe")
            .arg(command)
            .env("PATH", path_env)
            .output();

        if let Ok(o) = output {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout);
                // where 可能返回多行，取第一行（优先 .exe，但 .cmd 也可以直接被 cmd /C 执行）
                if let Some(first) = text.lines().next() {
                    let p = first.trim().to_string();
                    if !p.is_empty() {
                        log::info!("[AI commit] resolved '{}' -> '{}'", command, p);
                        return p;
                    }
                }
            }
        }
        command.to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        use which::which_in;
        match which_in(
            command,
            Some(path_env),
            std::env::current_dir().unwrap_or_default(),
        ) {
            Ok(p) => {
                let s = p.to_string_lossy().to_string();
                log::info!("[AI commit] resolved '{}' -> '{}'", command, s);
                s
            }
            Err(_) => command.to_string(),
        }
    }
}

/// 获取完整 PATH：合并当前进程 PATH + 用户级/系统级 PATH，
/// 解决 Tauri GUI 进程不继承用户 shell PATH 的问题（如 npm global bin、nvm 等）。
fn resolve_full_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        // Windows: 读取注册表中的用户级和系统级 PATH 并合并
        let user_path = std::env::var("USERPROFILE")
            .map(|home| {
                // 常见 npm global bin 位置
                let appdata = std::env::var("APPDATA").unwrap_or_default();
                vec![
                    format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home),
                    format!("{}\\npm", appdata),
                    format!("{}\\npm", home),
                ]
            })
            .unwrap_or_default();

        // 从系统环境变量读取用户级 PATH（注册表 HKCU）
        let reg_user_path = read_registry_path_windows();

        let mut parts: Vec<String> = vec![current.clone()];
        if !reg_user_path.is_empty() {
            parts.push(reg_user_path);
        }
        parts.extend(user_path);

        // 去重合并
        let mut seen = std::collections::HashSet::new();
        parts
            .join(";")
            .split(';')
            .filter(|p| !p.is_empty() && seen.insert(p.to_string()))
            .collect::<Vec<_>>()
            .join(";")
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix/macOS: 追加常见 npm/nvm/homebrew 路径
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = [
            format!("{}/.local/bin", home),
            format!("{}/.nvm/versions/node/current/bin", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        let mut parts: Vec<&str> = current.split(':').collect();
        for e in &extra {
            if !parts.contains(&e.as_str()) {
                parts.push(e);
            }
        }
        parts.join(":")
    }
}

#[cfg(target_os = "windows")]
fn read_registry_path_windows() -> String {
    // 通过 reg.exe 读取用户级 PATH（HKCU\Environment）
    let output = crate::utils::command::local::exec("reg")
        .args(["query", "HKCU\\Environment", "/v", "PATH"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            // reg query 输出格式：
            //     PATH    REG_EXPAND_SZ    <value>
            for line in text.lines() {
                let line = line.trim();
                if line.to_uppercase().starts_with("PATH") {
                    // 找最后一个 REG_xxx 后的值
                    if let Some(pos) = line.rfind("REG_") {
                        let after = &line[pos..];
                        if let Some(val_pos) = after.find("    ") {
                            let val = after[val_pos..].trim();
                            // 展开 %USERPROFILE% 等变量
                            return expand_env_vars_windows(val);
                        }
                    }
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

#[cfg(target_os = "windows")]
fn expand_env_vars_windows(s: &str) -> String {
    // 简单展开 %VAR% 形式的环境变量
    let mut result = s.to_string();
    let re_start = result.find('%');
    if re_start.is_none() {
        return result;
    }
    // 用 cmd /C echo 展开（最简单可靠的方式）
    let output = crate::utils::command::local::exec("cmd.exe")
        .args(["/C", &format!("echo {}", s)])
        .output();
    if let Ok(o) = output {
        let expanded = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !expanded.is_empty() && !expanded.starts_with("echo") {
            result = expanded;
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
        // file mode: prompt_args without last "-f" are joined
        assert!(cmd.contains("my-agent -c ai"));
        // contains short_msg inline
        assert!(cmd.contains("Output ONLY the raw commit message"));
        // post_args appended
        assert!(cmd.contains("--verbose"));
    }
}
