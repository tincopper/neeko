mod agent;
mod ai_commit;
mod browser;
mod config;
mod file;
mod git;
mod ide;
mod opener;
mod project;
mod remote;
mod remote_git;
mod task;
mod terminal;
mod wsl;
mod wsl_git;

pub use agent::*;
pub use ai_commit::*;
pub use browser::*;
pub use config::*;
pub use file::*;
pub use git::*;
pub use ide::*;
pub use opener::*;
pub use project::*;
pub use remote::*;
pub use remote_git::*;
pub use task::*;
pub use terminal::*;
pub use wsl::*;
pub use wsl_git::*;

/// 聚合所有 Tauri 命令到 invoke_handler。
/// 因为 `generate_handler!` 是 proc macro，无法展开内部 macro_rules 调用，
/// 所以必须在一个宏内以平坦列表传递所有命令路径。
#[macro_export]
macro_rules! neeko_invoke_handler {
    () => {
        tauri::generate_handler![
            // --- Core ---
            $crate::commands::greet,
            $crate::commands::add_project,
            $crate::commands::remove_project,
            $crate::commands::list_projects,
            $crate::commands::get_project,
            $crate::commands::refresh_git_info,
            $crate::commands::set_active_project,
            $crate::commands::get_active_project,
            $crate::commands::set_view_terminal,
            $crate::commands::set_view_diff,
            $crate::commands::set_project_collapsed,
            $crate::commands::reorder_projects,
            $crate::commands::checkout_branch,
            $crate::commands::create_branch,
            $crate::commands::rename_branch,
            $crate::commands::rename_worktree,
            $crate::commands::get_file_diff_command,
            $crate::commands::create_worktree,
            $crate::commands::remove_worktree,
            $crate::commands::is_worktree_dirty,
            $crate::commands::delete_branch,
            $crate::commands::get_worktree_changed_files,
            $crate::commands::get_worktree_file_diff,
            $crate::commands::stage_files_command,
            $crate::commands::unstage_files_command,
            $crate::commands::stage_all_command,
            $crate::commands::unstage_all_command,
            $crate::commands::discard_file_command,
            $crate::commands::discard_all_command,
            $crate::commands::commit_command,
            $crate::commands::commit_and_push_command,
            $crate::commands::commit_files_command,
            $crate::commands::fetch_command,
            $crate::commands::pull_command,
            $crate::commands::push_command,
            $crate::commands::get_commit_log_command,
            $crate::commands::get_ahead_behind_command,
            $crate::commands::get_commit_detail_command,
            $crate::commands::get_commit_files_command,
            $crate::commands::get_commit_file_diff_command,
            $crate::commands::is_gh_installed_command,
            $crate::commands::list_prs_command,
            $crate::commands::view_pr_command,
            $crate::commands::create_pr_command,
            $crate::commands::merge_pr_command,
            $crate::commands::close_pr_command,
            $crate::commands::checkout_pr_command,
            $crate::commands::generate_commit_message_command,
            $crate::commands::cherry_pick_command,
            $crate::commands::revert_command,
            $crate::commands::create_tag_command,
            $crate::commands::checkout_detached_command,
            $crate::commands::create_and_switch_branch_command,
            $crate::commands::default_branch_command,
            $crate::commands::remote_web_url_command,
            $crate::commands::create_terminal_session,
            $crate::commands::close_terminal_session,
            $crate::commands::resize_terminal,
            $crate::commands::list_agents,
            $crate::commands::get_agent,
            $crate::commands::add_agent,
            $crate::commands::remove_agent,
            $crate::commands::set_project_agent,
            $crate::commands::check_agents_installed,
            $crate::commands::set_project_ide,
            $crate::commands::open_ide,
            $crate::commands::save_session,
            $crate::commands::load_session,
            $crate::commands::get_config_dir,
            $crate::commands::save_config,
            $crate::commands::load_config,
            $crate::commands::sync_agent_theme,
            $crate::commands::save_vcs_settings_command,
            $crate::commands::load_vcs_settings_command,
            $crate::commands::get_system_fonts,
            $crate::commands::read_dir_tree,
            $crate::commands::read_file_content,
            $crate::commands::write_file_content,
            // --- WSL ---
            $crate::commands::get_wsl_distros,
            $crate::commands::get_wsl_directories,
            $crate::commands::get_wsl_home_dir,
            $crate::commands::create_wsl_terminal_session,
            $crate::commands::refresh_wsl_git_info,
            $crate::commands::get_wsl_file_diff_command,
            $crate::commands::wsl_checkout_branch,
            $crate::commands::wsl_create_branch,
            $crate::commands::wsl_rename_branch,
            $crate::commands::wsl_create_worktree,
            $crate::commands::wsl_remove_worktree,
            $crate::commands::wsl_rename_worktree,
            $crate::commands::wsl_get_worktree_changed_files,
            $crate::commands::wsl_is_worktree_dirty,
            $crate::commands::wsl_get_worktree_file_diff,
            $crate::commands::open_wsl_ide,
            $crate::commands::wsl_stage_files,
            $crate::commands::wsl_unstage_files,
            $crate::commands::wsl_discard_file,
            $crate::commands::wsl_commit_files,
            $crate::commands::wsl_push,
            $crate::commands::wsl_pull,
            $crate::commands::wsl_fetch,
            $crate::commands::wsl_get_commit_log,
            $crate::commands::wsl_get_commit_detail,
            $crate::commands::wsl_get_commit_files,
            $crate::commands::wsl_get_commit_file_diff,
            $crate::commands::wsl_get_ahead_behind,
            $crate::commands::wsl_cherry_pick,
            $crate::commands::wsl_revert_commit,
            $crate::commands::wsl_create_tag,
            $crate::commands::wsl_read_dir_tree,
            $crate::commands::wsl_read_file_content,
            $crate::commands::wsl_write_file_content,
            $crate::commands::wsl_generate_commit_message,
            // --- Remote ---
            $crate::commands::create_remote_terminal_session,
            $crate::commands::close_remote_terminal_session,
            $crate::commands::resize_remote_terminal,
            $crate::commands::test_remote_connection,
            $crate::commands::list_remote_directories,
            $crate::commands::refresh_remote_git_info,
            $crate::commands::get_remote_file_diff_command,
            $crate::commands::remote_checkout_branch,
            $crate::commands::remote_create_branch,
            $crate::commands::remote_rename_branch,
            $crate::commands::remote_create_worktree,
            $crate::commands::remote_remove_worktree,
            $crate::commands::remote_rename_worktree,
            $crate::commands::remote_get_worktree_changed_files,
            $crate::commands::remote_is_worktree_dirty,
            $crate::commands::remote_get_worktree_file_diff,
            $crate::commands::get_remote_home_dir,
            $crate::commands::open_remote_ide,
            $crate::commands::remote_stage_files,
            $crate::commands::remote_unstage_files,
            $crate::commands::remote_discard_file,
            $crate::commands::remote_commit_files,
            $crate::commands::remote_push,
            $crate::commands::remote_pull,
            $crate::commands::remote_fetch,
            $crate::commands::remote_get_commit_log,
            $crate::commands::remote_get_commit_detail,
            $crate::commands::remote_get_commit_files,
            $crate::commands::remote_get_commit_file_diff,
            $crate::commands::remote_get_ahead_behind,
            $crate::commands::remote_cherry_pick,
            $crate::commands::remote_revert_commit,
            $crate::commands::remote_create_tag,
            $crate::commands::remote_read_dir_tree,
            $crate::commands::remote_read_file_content,
            $crate::commands::remote_write_file_content,
            $crate::commands::remote_generate_commit_message,
            // --- Task Runner ---
            $crate::commands::get_task_configs,
            $crate::commands::save_task_config,
            $crate::commands::delete_task_config,
            $crate::commands::run_task,
            $crate::commands::stop_task,
            // --- Browser ---
            $crate::commands::reveal_in_file_manager,
            $crate::commands::create_browser_webview,
            $crate::commands::browser_navigate,
            $crate::commands::browser_set_bounds,
            $crate::commands::browser_open_devtools,
            $crate::commands::browser_close,
            $crate::commands::browser_set_visible,
            $crate::commands::browser_go_back,
            $crate::commands::browser_go_forward,
            $crate::commands::open_in_default_browser,
            // --- Skill ---
            $crate::skill::commands::get_managed_skills,
            $crate::skill::commands::get_skill_document,
            $crate::skill::commands::delete_managed_skill,
            $crate::skill::commands::get_tag_groups,
            $crate::skill::commands::create_tag_group,
            $crate::skill::commands::delete_tag_group_cmd,
            $crate::skill::commands::install_local_skill,
            $crate::skill::commands::scan_local_skills,
            $crate::skill::commands::import_discovered_skill,
            $crate::skill::commands::preview_git_install,
            $crate::skill::commands::confirm_git_install,
            $crate::skill::commands::cancel_git_preview,
            $crate::skill::commands::check_skill_update,
            $crate::skill::commands::update_skill,
            $crate::skill::commands::update_tag_group_cmd,
            $crate::skill::commands::reorder_tag_groups_cmd,
            $crate::skill::commands::add_skill_to_tag_group_cmd,
            $crate::skill::commands::remove_skill_from_tag_group_cmd,
            $crate::skill::commands::get_skills_for_tag_group_cmd,
            $crate::skill::commands::get_all_tags_cmd,
            $crate::skill::commands::set_skill_tags_cmd,
            $crate::skill::commands::set_skill_tool_toggle_cmd,
            $crate::skill::commands::sync_tag_group_cmd,
            $crate::skill::commands::unsync_tag_group_cmd,
            $crate::skill::commands::get_project_tag_groups_cmd,
            $crate::skill::commands::set_project_tag_groups_cmd,
            $crate::skill::commands::add_project_tag_group_cmd,
            $crate::skill::commands::remove_project_tag_group_cmd,
            $crate::skill::commands::create_skill,
            // --- MARKETPLACE COMMANDS ---
            $crate::skill::commands::fetch_leaderboard,
            $crate::skill::commands::search_skillssh,
            $crate::skill::commands::install_from_skillssh,
        ]
    };
}

#[tauri::command]
pub async fn get_system_fonts() -> Vec<String> {
    crate::utils::fonts::get_monospace_fonts()
}
