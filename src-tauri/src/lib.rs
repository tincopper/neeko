pub mod agent;
mod app;
mod app_state;
pub mod browser;
pub mod commands;
pub mod connection;
pub mod error;
pub mod git;
mod logger;
pub mod project;
pub mod skill;
pub mod task;
pub mod terminal;
pub mod theme;
pub mod utils;
pub mod workspace;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use error::AppError;

/// 聚合所有 Tauri 命令到 invoke_handler
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
            $crate::commands::set_project_color,
            $crate::commands::rename_project,
            $crate::commands::change_project_path,
            $crate::commands::reorder_projects,
            $crate::commands::is_gh_installed_command,
            $crate::commands::list_prs_command,
            $crate::commands::view_pr_command,
            $crate::commands::create_pr_command,
            $crate::commands::merge_pr_command,
            $crate::commands::close_pr_command,
            $crate::commands::generate_commit_message_command,
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
            $crate::commands::open_wsl_ide,
            $crate::commands::open_remote_ide,
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
            $crate::commands::wsl_set_project_color,
            // --- Remote ---
            $crate::commands::create_remote_terminal_session,
            $crate::commands::close_remote_terminal_session,
            $crate::commands::resize_remote_terminal,
            $crate::commands::test_remote_connection,
            $crate::commands::list_remote_directories,
            $crate::commands::remote_set_project_color,
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
            $crate::commands::browser_start_picker,
            $crate::commands::browser_stop_picker,
            // --- Skill ---
            $crate::commands::get_managed_skills,
            $crate::commands::get_skill_document,
            $crate::commands::delete_managed_skill,
            $crate::commands::get_tag_groups,
            $crate::commands::create_tag_group,
            $crate::commands::delete_tag_group_cmd,
            $crate::commands::install_local_skill,
            $crate::commands::scan_local_skills,
            $crate::commands::import_discovered_skill,
            $crate::commands::preview_git_install,
            $crate::commands::confirm_git_install,
            $crate::commands::cancel_git_preview,
            $crate::commands::check_skill_update,
            $crate::commands::update_skill,
            $crate::commands::update_tag_group_cmd,
            $crate::commands::reorder_tag_groups_cmd,
            $crate::commands::add_skill_to_tag_group_cmd,
            $crate::commands::remove_skill_from_tag_group_cmd,
            $crate::commands::get_skills_for_tag_group_cmd,
            $crate::commands::get_all_tags_cmd,
            $crate::commands::set_skill_tags_cmd,
            $crate::commands::set_skill_tool_toggle_cmd,
            $crate::commands::sync_tag_group_cmd,
            $crate::commands::unsync_tag_group_cmd,
            $crate::commands::get_project_tag_groups_cmd,
            $crate::commands::set_project_tag_groups_cmd,
            $crate::commands::add_project_tag_group_cmd,
            $crate::commands::remove_project_tag_group_cmd,
            $crate::commands::create_skill,
            $crate::commands::fetch_leaderboard,
            $crate::commands::search_skillssh,
            $crate::commands::install_from_skillssh,
            // --- GIT COMMANDS ---
            $crate::commands::stage_files,
            $crate::commands::unstage_files,
            $crate::commands::stage_all,
            $crate::commands::unstage_all,
            $crate::commands::discard_file,
            $crate::commands::discard_all,
            $crate::commands::fetch,
            $crate::commands::pull,
            $crate::commands::push,
            $crate::commands::commit_files,
            $crate::commands::cherry_pick,
            $crate::commands::revert,
            $crate::commands::create_tag,
            $crate::commands::checkout_branch,
            $crate::commands::create_branch,
            $crate::commands::delete_branch,
            $crate::commands::rename_branch,
            $crate::commands::create_and_switch_branch,
            $crate::commands::checkout_detached,
            $crate::commands::create_worktree,
            $crate::commands::remove_worktree,
            $crate::commands::rename_worktree,
            $crate::commands::is_worktree_dirty,
            $crate::commands::get_git_info,
            $crate::commands::get_git_branch_info,
            $crate::commands::get_worktree_changed_files,
            $crate::commands::get_changed_files_diff_stats,
            $crate::commands::get_file_diff,
            $crate::commands::is_git_repo,
            $crate::commands::get_commit_log,
            $crate::commands::get_commit_detail,
            $crate::commands::get_commit_files,
            $crate::commands::get_commit_file_diff,
            $crate::commands::get_ahead_behind,
            $crate::commands::default_branch,
            // --- UNIFIED FILE OPERATIONS ---
            $crate::commands::unified_read_dir_tree,
            $crate::commands::unified_read_file_content,
            $crate::commands::unified_write_file_content,
            // --- UNIFIED COMMIT MESSAGE ---
            $crate::commands::unified_generate_commit_message,
            // --- REMOTE UTILITIES ---
            $crate::commands::unified_get_remote_home_dir,
        ]
    };
}
