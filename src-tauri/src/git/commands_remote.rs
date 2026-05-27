use crate::models::*;
use crate::AppError;

/// 文件树默认递归深度
const DEFAULT_TREE_DEPTH: u32 = 4;

#[tauri::command]
pub async fn refresh_remote_git_info(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
) -> Result<GitInfo, AppError> {
    crate::git::remote::get_remote_git_info(&host, port, &username, &auth, &project_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_remote_home_dir(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
) -> Result<String, AppError> {
    crate::utils::command::ssh::exec_command(&host, port, &username, &auth, "echo $HOME")
        .await
        .map(|s| s.trim().to_string())
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_read_dir_tree(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    root_path: String,
    sub_path: Option<String>,
    max_depth: Option<u32>,
) -> Result<Vec<FileNode>, AppError> {
    let depth = max_depth.unwrap_or(DEFAULT_TREE_DEPTH);
    crate::git::remote::remote_read_dir_tree_fn(
        &host,
        port,
        &username,
        &auth,
        &root_path,
        sub_path.as_deref(),
        depth,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
pub async fn remote_read_file_content(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_path: String,
    root_path: Option<String>,
) -> Result<FileContent, AppError> {
    use crate::utils::command::ssh::{exec_command, safe_path};

    let base = root_path.unwrap_or(project_path);
    let full_path = format!("{}/{}", base, file_path);
    let safe_fp = safe_path(&full_path);

    // 文件大小
    let stat_cmd = format!("stat -c '%s' '{safe_fp}' 2>/dev/null || echo 0");
    let size: u64 = exec_command(&host, port, &username, &auth, &stat_cmd)
        .await
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    // 二进制检测
    let binary_cmd =
        format!("head -c 8192 '{safe_fp}' | grep -ql '\\x00' 2>/dev/null && echo 1 || echo 0");
    let is_binary = exec_command(&host, port, &username, &auth, &binary_cmd)
        .await
        .map(|out| out.trim() == "1")
        .unwrap_or(false);

    if is_binary {
        return Ok(FileContent {
            path: file_path,
            content: String::new(),
            size,
            is_binary: true,
        });
    }

    // 读取文件内容
    let cat_cmd = format!("cat '{safe_fp}'");
    let content = exec_command(&host, port, &username, &auth, &cat_cmd)
        .await
        .map_err(AppError::from)?;

    Ok(FileContent {
        path: file_path,
        content,
        size,
        is_binary: false,
    })
}

#[tauri::command]
pub async fn remote_write_file_content(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
) -> Result<(), AppError> {
    use crate::utils::command::ssh::{exec_command, safe_path};

    let base = root_path.unwrap_or(project_path);
    let full_path = format!("{}/{}", base, file_path);
    let safe_fp = safe_path(&full_path);

    // 确保父目录存在
    if let Some(parent) = std::path::Path::new(&full_path).parent() {
        let safe_parent = safe_path(parent.to_str().unwrap_or(""));
        let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
        let _ = exec_command(&host, port, &username, &auth, &mkdir_cmd).await;
    }

    // 使用 base64 编码传输，避免 shell 转义问题
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
    let write_cmd = format!("echo '{}' | base64 -d > '{safe_fp}'", encoded);
    exec_command(&host, port, &username, &auth, &write_cmd)
        .await
        .map_err(AppError::from)?;

    Ok(())
}

/// Remote/SSH 场景下通过 agent CLI 生成 commit message。
/// Agent 在远程服务器上执行，自行分析变更，不传入 diff 内容。
#[tauri::command]
pub async fn remote_generate_commit_message(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    agent_id: String,
    agent_command_override: Option<String>,
    file_paths: Vec<String>,
    state: tauri::State<'_, crate::AppStateWrapper>,
) -> Result<String, AppError> {
    use crate::utils::command::ssh;
    use crate::workspace::commands as ai_commit;
    let _ = agent_command_override; // WSL/SSH 不使用宿主机 override

    // 1. 解析 agent 配置（selected_agent 可能是 ID 或完整路径）
    let (agent_cmd, prompt_args, post_prompt_args) =
        ai_commit::resolve_agent_for_remote(&state, &agent_id);

    // 2. 构建 prompt
    let prompt = ai_commit::build_simple_commit_prompt(&file_paths);

    // 3. 构建命令字符串（共享函数）
    let sp = ssh::safe_path(&project_path);
    let actual_cmd = ai_commit::build_agent_commit_cmd(
        &sp,
        &agent_cmd,
        &prompt_args,
        &post_prompt_args,
        &prompt,
    );

    log::info!(
        "[AI commit Remote] agent_cmd='{}' prompt_args={:?} post_prompt_args={:?}",
        agent_cmd,
        prompt_args,
        post_prompt_args
    );
    log::info!(
        "[AI commit Remote] actual_cmd (first 500 chars): {}",
        &actual_cmd[..actual_cmd.len().min(500)]
    );

    // 4. 注入环境加载前缀，bash -ic 交互模式绕过 .bashrc 的 non-interactive guard
    let env_prefix = r#"source ~/.profile 2>/dev/null"#;
    let full_cmd = format!(
        "bash -ic <<'NEEKO_BASH'\n{}; {}\nNEEKO_BASH",
        env_prefix, actual_cmd
    );

    log::info!(
        "[AI commit Remote] host={}:{} full_cmd_len={}",
        host,
        port,
        full_cmd.len()
    );

    // 5. 通过 SSH 执行
    let output = match ssh::exec_command(&host, port, &username, &auth, &full_cmd).await {
        Ok(o) => {
            log::info!("[AI commit Remote] success, stdout_len={}", o.len());
            if !o.is_empty() {
                log::info!(
                    "[AI commit Remote] stdout (first 500 chars): {}",
                    &o[..o.len().min(500)]
                );
            }
            o
        }
        Err(e) => {
            log::error!("[AI commit Remote] exec failed: {}", e);
            return Err(AppError::InvalidInput(format!(
                "Failed to run agent on remote: {}",
                e
            )));
        }
    };

    // 6. 清理输出
    let message = ai_commit::clean_ai_output(&output);
    if message.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent returned an empty response.".to_string(),
        ));
    }
    Ok(message)
}

#[cfg(test)]
mod tests {
    use crate::workspace::commands::build_agent_commit_cmd;

    #[test]
    fn test_remote_build_agent_commit_cmd_file_mode() {
        let cmd = build_agent_commit_cmd(
            "/home/user/project",
            "opencode",
            &["-f".to_string()],
            &[],
            "test prompt",
        );
        assert!(cmd.contains("cd '/home/user/project'"));
        assert!(cmd.contains("cat > /tmp/.neeko_commit_prompt"));
        assert!(cmd.contains("test prompt"));
    }
}
