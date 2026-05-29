#![deny(
    clippy::dbg_macro,
    clippy::todo,
    clippy::print_stdout,
    clippy::wildcard_imports,
    unused_must_use
)]

pub mod agent;
mod app;
mod app_state;
pub mod browser;
pub mod connection;
pub mod error;
pub mod file;
pub mod git;
mod logger;
pub mod project;
pub mod session;
pub mod settings;
pub mod skill;
pub mod task;
pub mod terminal;
pub mod theme;
pub mod utils;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use error::AppError;

/// 聚合所有 Tauri 命令到 invoke_handler
#[macro_export]
macro_rules! neeko_invoke_handler {
    () => {
        tauri::generate_handler![
            // ── project ──────────────────────────────────────────────────────
            $crate::project::commands::add_project,
            $crate::project::commands::remove_project,
            $crate::project::commands::list_projects,
            $crate::project::commands::get_project,
            $crate::project::commands::refresh_git_info,
            $crate::project::commands::set_active_project,
            $crate::project::commands::get_active_project,
            $crate::project::commands::set_view_terminal,
            $crate::project::commands::set_view_diff,
            $crate::project::commands::set_project_collapsed,
            $crate::project::commands::set_project_color,
            $crate::project::commands::rename_project,
            $crate::project::commands::change_project_path,
            $crate::project::commands::reorder_projects,
            // project — IDE
            $crate::project::commands_ide::set_project_ide,
            $crate::project::commands_ide::open_ide,
            $crate::project::commands_ide::open_wsl_ide,
            $crate::project::commands_ide::open_remote_ide,
            // ── session ──────────────────────────────────────────────────────
            $crate::session::commands::greet,
            $crate::session::commands::save_session,
            $crate::session::commands::load_session,
            $crate::session::commands::get_config_dir,
            $crate::session::commands::save_config,
            $crate::session::commands::load_config,
            $crate::session::commands::save_vcs_settings_command,
            $crate::session::commands::load_vcs_settings_command,
            // ── terminal ─────────────────────────────────────────────────────
            $crate::terminal::commands::create_terminal_session,
            $crate::terminal::commands::close_terminal_session,
            $crate::terminal::commands::resize_terminal,
            $crate::terminal::commands::create_wsl_terminal_session,
            $crate::terminal::commands::create_remote_terminal_session,
            $crate::terminal::commands::close_remote_terminal_session,
            $crate::terminal::commands::resize_remote_terminal,
            // ── agent ────────────────────────────────────────────────────────
            $crate::agent::commands::list_agents,
            $crate::agent::commands::get_agent,
            $crate::agent::commands::add_agent,
            $crate::agent::commands::remove_agent,
            $crate::agent::commands::set_project_agent,
            $crate::agent::commands::check_agents_installed,
            // ── connection ───────────────────────────────────────────────────
            $crate::connection::commands::get_wsl_distros,
            $crate::connection::commands::get_wsl_directories,
            $crate::connection::commands::get_wsl_home_dir,
            $crate::connection::commands::test_remote_connection,
            $crate::connection::commands::list_remote_directories,
            // ── git ──────────────────────────────────────────────────────────
            // staging
            $crate::git::commands::stage_files,
            $crate::git::commands::unstage_files,
            $crate::git::commands::stage_all,
            $crate::git::commands::unstage_all,
            $crate::git::commands::discard_file,
            $crate::git::commands::discard_all,
            // remote
            $crate::git::commands::fetch,
            $crate::git::commands::pull,
            $crate::git::commands::push,
            $crate::git::commands::commit_files,
            // cherry-pick / revert / tag
            $crate::git::commands::cherry_pick,
            $crate::git::commands::revert,
            $crate::git::commands::create_tag,
            // branching
            $crate::git::commands::checkout_branch,
            $crate::git::commands::create_branch,
            $crate::git::commands::delete_branch,
            $crate::git::commands::rename_branch,
            $crate::git::commands::create_and_switch_branch,
            $crate::git::commands::checkout_detached,
            // worktree
            $crate::git::commands::create_worktree,
            $crate::git::commands::remove_worktree,
            $crate::git::commands::rename_worktree,
            $crate::git::commands::is_worktree_dirty,
            // info / read
            $crate::git::commands::get_git_info,
            $crate::git::commands::get_git_branch_info,
            $crate::git::commands::get_worktree_changed_files,
            $crate::git::commands::get_changed_files_diff_stats,
            $crate::git::commands::get_file_diff,
            $crate::git::commands::is_git_repo,
            // commit log / history
            $crate::git::commands::get_commit_log,
            $crate::git::commands::get_commit_detail,
            $crate::git::commands::get_commit_files,
            $crate::git::commands::get_commit_file_diff,
            $crate::git::commands::get_ahead_behind,
            // default branch
            $crate::git::commands::default_branch,
            // unified file operations
            $crate::git::commands::read_dir_tree,
            $crate::git::commands::read_file_content,
            $crate::git::commands::write_file_content,
            // unified commit message
            $crate::git::commands::generate_commit_message,
            // remote utilities
            $crate::git::commands::get_remote_home_dir,
            // PR commands
            $crate::git::commands::is_gh_installed_command,
            $crate::git::commands::list_prs_command,
            $crate::git::commands::view_pr_command,
            $crate::git::commands::create_pr_command,
            $crate::git::commands::merge_pr_command,
            $crate::git::commands::close_pr_command,
            // ── file ──────────────────────────────────────────────────────────
            $crate::file::commands::reveal_in_file_manager,
            // ── task ─────────────────────────────────────────────────────────
            $crate::task::commands::get_task_configs,
            $crate::task::commands::save_task_config,
            $crate::task::commands::delete_task_config,
            $crate::task::commands::run_task,
            $crate::task::commands::stop_task,
            // ── browser ──────────────────────────────────────────────────────
            $crate::browser::commands::create_browser_webview,
            $crate::browser::commands::browser_navigate,
            $crate::browser::commands::browser_set_bounds,
            $crate::browser::commands::browser_open_devtools,
            $crate::browser::commands::browser_close,
            $crate::browser::commands::browser_set_visible,
            $crate::browser::commands::browser_go_back,
            $crate::browser::commands::browser_go_forward,
            $crate::browser::commands::open_in_default_browser,
            $crate::browser::commands::browser_start_picker,
            $crate::browser::commands::browser_stop_picker,
            // ── skill ────────────────────────────────────────────────────────
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
            $crate::skill::commands::fetch_leaderboard,
            $crate::skill::commands::search_skillssh,
            $crate::skill::commands::install_from_skillssh,
            // ── theme ────────────────────────────────────────────────────────
            $crate::theme::commands::sync_agent_theme,
            // ── settings ─────────────────────────────────────────────────────
            $crate::settings::commands::get_system_fonts,
        ]
    };
}
