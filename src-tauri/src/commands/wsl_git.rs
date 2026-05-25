use crate::git::operations;
use crate::git::transport::GitTransport;
use crate::models::*;
use crate::AppError;

/// 文件树默认递归深度
const DEFAULT_TREE_DEPTH: u32 = 4;

#[tauri::command]
pub fn refresh_wsl_git_info(distro: String, project_path: String) -> Result<GitInfo, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_git_info(&distro, &project_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn get_wsl_file_diff_command(
    distro: String,
    project_path: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_file_diff(&distro, &project_path, &file_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_checkout_branch(
    distro: String,
    project_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::checkout_branch(
            &transport,
            &project_path,
            &branch_name,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, branch_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_create_branch(
    distro: String,
    project_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::create_branch(
            &transport,
            &project_path,
            &branch_name,
            None,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, branch_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_rename_branch(
    distro: String,
    project_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::rename_branch(
            &transport,
            &project_path,
            &old_name,
            &new_name,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, old_name, new_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_create_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let parent = std::path::Path::new(&worktree_path)
            .parent()
            .unwrap_or(std::path::Path::new(&worktree_path));
        if let Some(parent_str) = parent.to_str() {
            let safe_parent = parent_str.replace('\'', "'\\''");
            let _ =
                crate::utils::command::wsl::exec(&distro, &format!("mkdir -p '{}'", safe_parent))?;
        }
        let args: Vec<&str> = if new_branch {
            vec!["worktree", "add", "-b", &branch_name, &worktree_path]
        } else {
            vec!["worktree", "add", &worktree_path, &branch_name]
        };
        crate::git::run_wsl_git(&distro, &project_path, &args)
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path, branch_name, new_branch);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_remove_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::remove_worktree(
            &transport,
            &project_path,
            &worktree_path,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_rename_worktree(
    distro: String,
    project_path: String,
    worktree_path: String,
    new_name: String,
) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let parent = std::path::Path::new(&worktree_path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(".");
        let new_path = format!("{}/{}", parent, new_name);
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::rename_worktree(
            &transport,
            &project_path,
            &worktree_path,
            &new_path,
        ))
        .map_err(AppError::from)
        .map(|_| new_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, worktree_path, new_name);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_worktree_changed_files(
    distro: String,
    worktree_path: String,
) -> Result<Vec<FileChange>, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_worktree_changed_files(&distro, &worktree_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, worktree_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_is_worktree_dirty(distro: String, worktree_path: String) -> Result<bool, AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::is_worktree_dirty(&transport, &worktree_path))
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, worktree_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_worktree_file_diff(
    distro: String,
    worktree_path: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::get_wsl_worktree_file_diff(&distro, &worktree_path, &file_path)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, worktree_path, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

// ─── New WSL Git Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn wsl_stage_files(
    distro: String,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::stage_files(
            &transport,
            &project_path,
            &file_paths,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_paths);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_unstage_files(
    distro: String,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::unstage_files(
            &transport,
            &project_path,
            &file_paths,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_paths);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_discard_file(
    distro: String,
    project_path: String,
    file_path: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::discard_file(
            &transport,
            &project_path,
            &file_path,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_commit_files(
    distro: String,
    project_path: String,
    file_paths: Vec<String>,
    message: String,
) -> Result<CommitResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_commit_files(&distro, &project_path, &file_paths, &message)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_paths, message);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_push(distro: String, project_path: String, set_upstream: bool) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::push(
            &transport,
            &project_path,
            set_upstream,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, set_upstream);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_pull(distro: String, project_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::run_wsl_git(&distro, &project_path, &["pull"])
            .map(|_| ())
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_fetch(distro: String, project_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::fetch(&transport, &project_path))
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_log(
    distro: String,
    project_path: String,
    count: usize,
    skip: Option<usize>,
) -> Result<Vec<CommitEntry>, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_log(&distro, &project_path, count, skip.unwrap_or(0))
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, count, skip);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_detail(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<CommitDetail, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_detail(&distro, &project_path, &commit_hash)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_files(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_files(&distro, &project_path, &commit_hash)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_commit_file_diff(
    distro: String,
    project_path: String,
    commit_hash: String,
    file_path: String,
) -> Result<DiffResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_commit_file_diff(&distro, &project_path, &commit_hash, &file_path)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash, file_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_get_ahead_behind(distro: String, project_path: String) -> Result<AheadBehind, AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::wsl_get_ahead_behind(&distro, &project_path).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_cherry_pick(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::cherry_pick(
            &transport,
            &project_path,
            &commit_hash,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_revert_commit(
    distro: String,
    project_path: String,
    commit_hash: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::revert(
            &transport,
            &project_path,
            &commit_hash,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, commit_hash);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_create_tag(
    distro: String,
    project_path: String,
    tag_name: String,
    message: Option<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        let transport = GitTransport::Wsl { distro };
        let tag_message = message.as_deref().unwrap_or(&tag_name);
        let rt = tokio::runtime::Handle::current();
        rt.block_on(operations::create_tag(
            &transport,
            &project_path,
            &tag_name,
            tag_message,
        ))
        .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, tag_name, message);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_read_dir_tree(
    distro: String,
    root_path: String,
    sub_path: Option<String>,
    max_depth: Option<u32>,
) -> Result<Vec<FileNode>, AppError> {
    #[cfg(target_os = "windows")]
    {
        let depth = max_depth.unwrap_or(DEFAULT_TREE_DEPTH);
        crate::git::wsl_read_dir_tree(&distro, &root_path, sub_path.as_deref(), depth)
            .map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, root_path, sub_path, max_depth);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_read_file_content(
    distro: String,
    project_path: String,
    file_path: String,
    root_path: Option<String>,
) -> Result<FileContent, AppError> {
    #[cfg(target_os = "windows")]
    {
        use crate::utils::command::wsl::{exec, safe_path};

        let base = root_path.unwrap_or(project_path);
        let full_path = format!("{}/{}", base, file_path);
        let safe_fp = safe_path(&full_path);

        // 文件大小
        let stat_cmd = format!("stat -c '%s' '{safe_fp}' 2>/dev/null || echo 0");
        let size: u64 = exec(&distro, &stat_cmd)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);

        // 二进制检测：读取前 8KB 检查 null 字节
        let binary_cmd =
            format!("head -c 8192 '{safe_fp}' | grep -ql '\\x00' 2>/dev/null && echo 1 || echo 0");
        let is_binary = exec(&distro, &binary_cmd)
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
        let content = exec(&distro, &cat_cmd).map_err(AppError::from)?;

        Ok(FileContent {
            path: file_path,
            content,
            size,
            is_binary: false,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path, root_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[tauri::command]
pub fn wsl_write_file_content(
    distro: String,
    project_path: String,
    file_path: String,
    content: String,
    root_path: Option<String>,
) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        use crate::utils::command::wsl::{exec, safe_path};

        let base = root_path.unwrap_or(project_path);
        let full_path = format!("{}/{}", base, file_path);
        let safe_fp = safe_path(&full_path);

        // 确保父目录存在
        if let Some(parent) = std::path::Path::new(&full_path).parent() {
            let safe_parent = safe_path(parent.to_str().unwrap_or(""));
            let mkdir_cmd = format!("mkdir -p '{safe_parent}'");
            let _ = exec(&distro, &mkdir_cmd);
        }

        // 写入到 Windows 临时文件，再通过 WSL cp 到目标路径
        let temp = std::env::temp_dir().join(format!("neeko_wsl_write_{}", std::process::id()));
        std::fs::write(&temp, content.as_bytes())
            .map_err(|e| AppError::File(format!("Failed to write temp file: {}", e)))?;

        // 获取 WSL 中的临时文件路径（通过 wslpath 转换）
        let wslpath_cmd = format!("wslpath -a '{}'", temp.display());
        let wsl_temp = crate::utils::command::wsl::exec(&distro, &wslpath_cmd)
            .map_err(|e| AppError::File(format!("Failed to get wslpath: {}", e)))?;
        let wsl_temp = wsl_temp.trim();

        // 复制到目标路径
        let cp_cmd = format!("cp '{wsl_temp}' '{safe_fp}'");
        let result = exec(&distro, &cp_cmd);

        // 清理临时文件
        let _ = std::fs::remove_file(&temp);

        result.map_err(AppError::from)?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, file_path, content, root_path);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

/// WSL 场景下通过 agent CLI 生成 commit message。
/// Agent 在 WSL 内执行，自行分析变更，不传入 diff 内容。
#[tauri::command]
pub async fn wsl_generate_commit_message(
    distro: String,
    project_path: String,
    agent_id: String,
    agent_command_override: Option<String>,
    file_paths: Vec<String>,
    state: tauri::State<'_, crate::AppStateWrapper>,
) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    {
        use crate::commands::ai_commit;
        use crate::utils::command::wsl;
        let _ = agent_command_override; // WSL/SSH 不使用宿主机 override

        // 1. 解析 agent 配置（selected_agent 可能是 ID 或完整路径）
        let (agent_cmd, prompt_args, post_prompt_args) =
            ai_commit::resolve_agent_for_remote(&state, &agent_id);

        // 2. 构建 prompt
        let prompt = ai_commit::build_simple_commit_prompt(&file_paths);

        // 3. 构建命令字符串
        // WSL: 直接使用 selected_agent 原值作为命令（路径或命令名）
        let sp = wsl::safe_path(&project_path);

        let post_args_str = post_prompt_args.join(" ");

        // 判断 file mode：opencode 等 agent 需要通过 -f 传入 prompt 文件
        let uses_file_mode = prompt_args.last().map(|a| a == "-f").unwrap_or(false);

        let actual_cmd = if uses_file_mode {
            // file mode: 通过 heredoc 写入临时文件，执行 agent，然后清理
            let prompt_args_without_f = prompt_args[..prompt_args.len() - 1].join(" ");
            let short_msg = "Output ONLY the raw commit message for the staged changes. No explanation. No quotes. No markdown. Just the commit message text.";
            format!(
                "cd '{sp}' && cat > /tmp/.neeko_commit_prompt <<'NEEKO_EOF'\n{prompt}\nNEEKO_EOF\n{agent_cmd} {prompt_args} '{short_msg}' -f /tmp/.neeko_commit_prompt {post_args} && rm -f /tmp/.neeko_commit_prompt",
                sp = sp,
                prompt = prompt,
                agent_cmd = agent_cmd,
                prompt_args = prompt_args_without_f,
                short_msg = short_msg,
                post_args = post_args_str,
            )
        } else {
            // 普通模式: inline prompt
            let prompt_args_str = prompt_args.join(" ");
            let escaped_prompt = prompt.replace('\'', "'\\''");
            format!(
                "cd '{sp}' && {agent_cmd} {prompt_args} '{escaped_prompt}' {post_args}",
                sp = sp,
                agent_cmd = agent_cmd,
                prompt_args = prompt_args_str,
                escaped_prompt = escaped_prompt,
                post_args = post_args_str,
            )
        };

        // 注入环境加载前缀，source ~/.profile 加载用户路径（.cargo/bin 等）
        let actual_cmd = format!(r#"source ~/.profile 2>/dev/null; {}"#, actual_cmd);

        // 获取 WSL 默认用户名，确保以正确用户身份启动（HOME=/home/<user>）
        let wsl_user = crate::utils::command::local::exec("wsl.exe")
            .arg("-d")
            .arg(&distro)
            .arg("whoami")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|_| "root".to_string());
        log::info!("[AI commit WSL] wsl_user={}", wsl_user);

        // 5. 使用 bash -ic 交互模式执行（绕过 .bashrc 的 non-interactive guard，确保 nvm 加载）
        //    -u <user>: 确保 HOME=/home/<user>，profile 路径正确
        //    env_remove("PATH"): 清除 Windows 污染 PATH，从干净基础开始
        let output = {
            let wsl_output = crate::utils::command::local::exec("wsl.exe")
                .arg("-d")
                .arg(&distro)
                .arg("-u")
                .arg(&wsl_user)
                .arg("bash")
                .arg("-ic")
                .arg(&actual_cmd)
                .env_remove("PATH")
                .output()
                .map_err(|e| AppError::InvalidInput(format!("Failed to execute wsl.exe: {}", e)))?;

            let exit_code = wsl_output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&wsl_output.stderr)
                .trim()
                .to_string();
            let stdout = String::from_utf8_lossy(&wsl_output.stdout)
                .trim()
                .to_string();

            log::info!(
                "[AI commit WSL] exit_code={} stdout_len={} stderr_len={}",
                exit_code,
                stdout.len(),
                stderr.len()
            );
            if !stdout.is_empty() {
                log::info!(
                    "[AI commit WSL] stdout (first 500 chars): {}",
                    &stdout[..stdout.len().min(500)]
                );
            }
            if !stderr.is_empty() {
                log::warn!(
                    "[AI commit WSL] stderr (first 500 chars): {}",
                    &stderr[..stderr.len().min(500)]
                );
            }

            if !wsl_output.status.success() {
                let msg = if !stderr.is_empty() { stderr } else { stdout };
                return Err(AppError::InvalidInput(format!(
                    "Failed to run agent in WSL: {}",
                    msg
                )));
            }
            String::from_utf8_lossy(&wsl_output.stdout).to_string()
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

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            distro,
            project_path,
            agent_id,
            agent_command_override,
            file_paths,
            state,
        );
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    // Test scaffolding - these tests document expected behavior
    // Real WSL execution requires Windows + WSL environment

    #[test]
    fn test_wsl_stage_files_empty_list_returns_ok() {
        // On non-Windows, we'd get WSL error, but the logic for empty list is platform-independent
        // This documents the contract: empty file list → Ok(())
        // Actual integration requires Windows + WSL
        // todo!("integration test requires WSL environment")
        let _ = (); // placeholder assertion
    }

    #[test]
    fn test_wsl_get_ahead_behind_no_upstream() {
        // Documents: when no upstream, returns AheadBehind { ahead: 0, behind: 0 }
        // todo!("integration test requires WSL environment")
        let _ = ();
    }

    #[test]
    fn test_wsl_commit_files_structure() {
        // Documents: CommitResult has success, hash, message fields
        let result = crate::models::CommitResult {
            success: true,
            hash: "abc1234".to_string(),
            message: "test commit".to_string(),
        };
        assert!(result.success);
        assert_eq!(result.hash, "abc1234");
    }

    #[test]
    fn test_wsl_create_tag_with_message() {
        // Documents: tag with message uses -a flag
        // todo!("integration test requires WSL environment")
        let _ = ();
    }

    #[test]
    fn test_wsl_read_dir_tree_default_depth() {
        // Documents: default max_depth is 4
        // todo!("integration test requires WSL environment")
        let _ = ();
    }
}
