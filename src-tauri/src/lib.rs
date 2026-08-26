//! Neeko — Multi-project AI Agent session manager for Tauri 2.

#![deny(
    clippy::dbg_macro,
    clippy::todo,
    clippy::print_stdout,
    clippy::wildcard_imports,
    unused_must_use
)]
// Notes on lints omitted from this deny block:
// - missing_docs: set to "warn" in Cargo.toml [lints.rust] instead; too many
//   undocumented public items for a blanket deny — needs a dedicated doc sprint.
// - rust_2018_idioms: set to "warn" in Cargo.toml (default for edition 2021);
//   the elided_lifetimes_in_paths sub-lint fires ~46 times across the codebase,
//   requiring a separate cleanup pass before promoting to deny.

/// Application about information (version & metadata).
pub mod about;
/// Agent lifecycle management, commands, configuration, and plugin system.
///
/// Agent Chat (multi-agent conversation surface) lives in the `chat` submodule.
pub mod agent;
mod app;
mod app_menu;
mod app_state;
/// Browser webview management for UI-embedded browsing.
pub mod browser;
/// Shared types, utilities, and helpers.
pub mod common;
/// Remote connection management (SSH, WSL).
pub mod connection;
/// Conversation scanning, search, and export.
pub mod conversation;
/// Core runtime, executor, and process utilities.
pub mod core;
/// Debug Adapter Protocol client management.
pub mod dap;
/// File system operations.
pub mod file;
/// Git integration (status, diff, branch, commit, PR).
pub mod git;
/// Skill management (install, configure, tag, sync).
/// Library management (skills, MCP, prompts, actions).
pub mod library;
/// Language Server Protocol client management.
pub mod lsp;
/// Platform difference centralization (Platform Adapter).
pub mod platform;
/// Project management (add, remove, list, config).
pub mod project;
/// Search domain (content full-text search across local / WSL / SSH).
pub mod search;
/// Session persistence (save / load workspace state).
pub mod session;
/// Application settings management.
pub mod settings;
/// Task configuration and execution.
pub mod task;
/// Terminal emulation (local, WSL, remote).
pub mod terminal;
/// Theme synchronization for agents and terminals.
pub mod theme;

pub use app::run;
pub use app_state::AppStateWrapper;
pub use common::error::AppError;

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
            $crate::project::commands::set_project_primary_language,
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
            // ── app lifecycle ────────────────────────────────────────────────
            $crate::about::commands::get_app_info,
            $crate::app::confirm_app_exit,
            // ── terminal ─────────────────────────────────────────────────────
            $crate::terminal::commands::create_terminal_session,
            $crate::terminal::commands::close_terminal_session,
            $crate::terminal::commands::resize_terminal,
            $crate::terminal::commands::terminal_drain,
            // ── agent ────────────────────────────────────────────────────────
            $crate::agent::commands::list_agents,
            $crate::agent::commands::get_agent,
            $crate::agent::commands::list_chat_agents,
            $crate::agent::commands::list_agent_models,
            $crate::agent::commands::add_agent,
            $crate::agent::commands::remove_agent,
            $crate::agent::commands::set_project_agents,
            $crate::agent::commands::check_agents_installed,
            $crate::agent::commands::import_agent_icon,
            $crate::agent::commands::discover_opencode_models,
            // ── MCP server commands ──────────────────────────────────────
            $crate::library::mcp::commands::list_mcp_servers,
            $crate::library::mcp::commands::get_mcp_server,
            $crate::library::mcp::commands::save_mcp_server,
            $crate::library::mcp::commands::update_mcp_server_cmd,
            $crate::library::mcp::commands::delete_mcp_server_cmd,
            $crate::library::mcp::commands::deploy_mcp_to_agent,
            $crate::library::mcp::commands::list_deployed_mcp,
            $crate::library::mcp::commands::remove_deployed_mcp,
            $crate::library::mcp::commands::test_mcp_server_cmd,
            $crate::library::mcp::commands::search_mcp_registry_cmd,
            $crate::library::mcp::commands::fetch_mcp_registry_server_cmd,
            // MCP tag groups
            $crate::library::mcp::commands::get_mcp_tag_groups,
            $crate::library::mcp::commands::create_mcp_tag_group,
            $crate::library::mcp::commands::delete_mcp_tag_group_cmd,
            $crate::library::mcp::commands::update_mcp_tag_group_cmd,
            $crate::library::mcp::commands::reorder_mcp_tag_groups_cmd,
            $crate::library::mcp::commands::add_server_to_mcp_tag_group_cmd,
            $crate::library::mcp::commands::remove_server_from_mcp_tag_group_cmd,
            $crate::library::mcp::commands::get_servers_for_mcp_tag_group_cmd,
            $crate::library::mcp::commands::set_mcp_server_agent_toggle_cmd,
            // MCP project bindings
            $crate::library::mcp::commands::get_project_mcp_tag_groups_cmd,
            $crate::library::mcp::commands::set_project_mcp_tag_groups_cmd,
            $crate::library::mcp::commands::add_project_mcp_tag_group_cmd,
            $crate::library::mcp::commands::remove_project_mcp_tag_group_cmd,
            $crate::library::mcp::commands::get_all_project_mcp_tag_group_counts_cmd,
            $crate::library::mcp::commands::apply_project_mcp_servers_cmd,
            // MCP targets
            $crate::library::mcp::commands::get_mcp_server_targets_cmd,
             $crate::library::mcp::commands::deploy_command_to_agent,
             $crate::library::mcp::commands::list_deployed_commands,
             $crate::library::mcp::commands::remove_deployed_command,
             $crate::library::mcp::commands::resolve_slash_resource,
             $crate::library::mcp::commands::get_agent_capabilities,
             $crate::library::mcp::commands::list_agents_supporting,
            // ── connection ───────────────────────────────────────────────────
            $crate::connection::commands::get_wsl_distros,
            $crate::connection::commands::get_wsl_directories,
            $crate::connection::commands::get_wsl_home_dir,
            $crate::connection::commands::test_remote_connection,
            $crate::connection::commands::list_remote_directories,
            // ── conversation ─────────────────────────────────────────────────
            $crate::conversation::commands::scan_conversations,
            $crate::conversation::commands::list_conversations,
            $crate::conversation::commands::get_conversation_messages,
            $crate::conversation::commands::search_conversations,
            $crate::conversation::commands::update_conversation,
            $crate::conversation::commands::get_resume_command,
            $crate::conversation::commands::export_conversation,
            // ── agent chat ───────────────────────────────────────────────────
            $crate::agent::chat::commands::agent_stream,
            $crate::agent::chat::commands::agent_chat_resume,
            $crate::agent::chat::commands::agent_chat_supports_resume,
            $crate::agent::chat::commands::agent_stream_cancel,
            $crate::agent::chat::commands::agent_approve,
            $crate::agent::chat::commands::agent_input,
            $crate::agent::chat::commands::agent_context_set,
            $crate::agent::chat::commands::agent_chat_context,
            // ── search ────────────────────────────────────────────────────────
            $crate::search::commands::search_run,
            $crate::search::commands::search_stop,
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
            $crate::git::commands::fetch_with_credentials,
            $crate::git::commands::pull_with_credentials,
            $crate::git::commands::push_with_credentials,
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
            $crate::git::commands::get_ignored_files,
            $crate::git::commands::get_changed_files_diff_stats,
            $crate::git::commands::get_file_diff,
            $crate::git::commands::is_git_repo,
            // commit log / history
            $crate::git::commands::get_commit_log,
            $crate::git::commands::get_commit_detail,
            $crate::git::commands::get_commit_files,
            $crate::git::commands::get_commit_file_diff,
            $crate::git::commands::get_ahead_behind,
            $crate::git::commands::get_stash_list,
            $crate::git::commands::get_stash_files,
            $crate::git::commands::get_stash_file_diff,
            $crate::git::commands::stash_apply,
            $crate::git::commands::stash_pop,
            // default branch
            $crate::git::commands::default_branch,
            // unified commit message
            $crate::agent::commands_commit::generate_commit_message,
            // remote utilities
            $crate::git::commands::get_remote_home_dir,
            // PR commands
            $crate::git::commands::is_gh_installed_command,
            $crate::git::commands::is_gh_authenticated_command,
            $crate::git::commands::list_prs_command,
            $crate::git::commands::list_repo_labels_command,
            $crate::git::commands::list_repo_authors_command,
            $crate::git::commands::view_pr_command,
            $crate::git::commands::create_pr_command,
            $crate::git::commands::merge_pr_command,
            $crate::git::commands::close_pr_command,
            $crate::git::commands::list_pr_files_command,
            $crate::git::commands::list_pr_commits_command,
            // PR comment commands
            $crate::git::commands::list_pr_comments_command,
            $crate::git::commands::add_pr_comment_command,
            $crate::git::commands::edit_pr_comment_command,
            $crate::git::commands::delete_pr_comment_command,
            $crate::git::commands::add_comment_reaction_command,
            // PR review comment commands
            $crate::git::commands::add_pr_review_comment_command,
            $crate::git::commands::list_pr_review_comments_command,
            // ── file ──────────────────────────────────────────────────────────
            $crate::file::commands::reveal_in_file_manager,
            $crate::file::commands::read_dir_tree,
            $crate::file::commands::read_file_content,
            $crate::file::commands::write_file_content,
            $crate::file::commands::create_new_file,
            $crate::file::commands::save_new_file,
            $crate::file::commands::create_directory,
            $crate::file::commands::delete_path,
            $crate::file::commands::rename_path,
            // ── task ─────────────────────────────────────────────────────────
            $crate::task::commands::get_task_configs,
            $crate::task::commands::discover_task_configs,
            $crate::task::commands::import_discovered_task,
            $crate::task::commands::save_task_config,
            $crate::task::commands::delete_task_config,
            $crate::task::commands::run_task,
            $crate::task::commands::stop_task,
            // ── browser ──────────────────────────────────────────────────────
            $crate::browser::commands::create_browser_webview,
            $crate::browser::commands::browser_navigate,
            $crate::browser::commands::browser_set_bounds,
            $crate::browser::commands::browser_open_devtools,
            $crate::browser::commands::browser_reset_zoom,
            $crate::browser::commands::browser_close,
            $crate::browser::commands::browser_set_visible,
            $crate::browser::commands::browser_go_back,
            $crate::browser::commands::browser_go_forward,
            $crate::browser::commands::open_in_default_browser,
            $crate::browser::commands::browser_start_picker,
            $crate::browser::commands::browser_stop_picker,
            $crate::library::skill::commands::get_managed_skills,
            $crate::library::skill::commands::get_skill_document,
            $crate::library::skill::commands::get_skill_document_at_path,
            $crate::library::skill::commands::refresh_skill_metadata,
            $crate::library::skill::commands::clear_all_managed_skills,
            $crate::library::skill::commands::delete_managed_skill,
            $crate::library::skill::commands::get_tag_groups,
            $crate::library::skill::commands::create_tag_group,
            $crate::library::skill::commands::delete_tag_group_cmd,
            $crate::library::skill::commands::install_local_skill,
            $crate::library::skill::commands::scan_local_skills,
            $crate::library::skill::commands::import_discovered_skill,
            $crate::library::skill::commands::preview_git_install,
            $crate::library::skill::commands::confirm_git_install,
            $crate::library::skill::commands::cancel_git_preview,
            $crate::library::skill::commands::check_skill_update,
            $crate::library::skill::commands::update_skill,
            $crate::library::skill::commands::update_tag_group_cmd,
            $crate::library::skill::commands::reorder_tag_groups_cmd,
            $crate::library::skill::commands::add_skill_to_tag_group_cmd,
            $crate::library::skill::commands::remove_skill_from_tag_group_cmd,
            $crate::library::skill::commands::get_skills_for_tag_group_cmd,
            $crate::library::skill::commands::get_all_tags_cmd,
            $crate::library::skill::commands::set_skill_tags_cmd,
            $crate::library::skill::commands::set_managed_skill_enabled_cmd,
            $crate::library::skill::commands::set_skill_tool_toggle_cmd,
            $crate::library::skill::commands::sync_tag_group_cmd,
            $crate::library::skill::commands::unsync_tag_group_cmd,
            $crate::library::skill::commands::apply_project_skills_cmd,
            $crate::library::skill::commands::get_project_tag_groups_cmd,
            $crate::library::skill::commands::set_project_tag_groups_cmd,
            $crate::library::skill::commands::add_project_tag_group_cmd,
            $crate::library::skill::commands::remove_project_tag_group_cmd,
            $crate::library::skill::commands::create_skill,
            $crate::library::skill::commands::fetch_leaderboard,
            $crate::library::skill::commands::search_skillssh,
            $crate::library::skill::commands::install_from_skillssh,
            $crate::library::skill::commands::get_agent_skills_cmd,
            $crate::library::skill::commands::import_skill_to_agent_cmd,
            $crate::library::skill::commands::remove_skill_from_agent_cmd,
            $crate::library::skill::commands::get_project_skills_cmd,
            $crate::library::skill::commands::import_skills_to_project_cmd,
            $crate::library::skill::commands::remove_skill_from_project_cmd,
            $crate::library::skill::commands::set_project_skill_agent_enabled_cmd,
            $crate::library::skill::commands::set_project_skill_enabled_cmd,
            $crate::library::skill::commands::get_all_project_skill_counts,
            $crate::library::skill::commands::get_all_project_tag_group_counts,
            $crate::library::skill::commands::list_prompts,
            $crate::library::skill::commands::get_prompt,
            $crate::library::skill::commands::save_prompt,
            $crate::library::skill::commands::update_prompt_cmd,
            $crate::library::skill::commands::delete_prompt_cmd,
            $crate::library::skill::commands::use_prompt_cmd,
            $crate::library::skill::commands::resolve_slash_prompt,
            $crate::library::skill::commands::get_all_prompt_tags_cmd,
            // ── action (resource library) ─────────────────────────────────
            // ── library bundle (import/export) ─────────────────────────────
            // ── theme ────────────────────────────────────────────────────────
            $crate::theme::commands::sync_agent_theme,
            $crate::theme::commands::list_custom_themes,
            $crate::theme::commands::get_custom_theme,
            // ── settings ─────────────────────────────────────────────────────
            $crate::lsp::commands::lsp_request,
            $crate::lsp::commands::lsp_notification,
            $crate::lsp::commands::lsp_open_document,
            $crate::lsp::commands::lsp_change_document,
            $crate::lsp::commands::lsp_close_document,
            $crate::lsp::commands::lsp_close_session,
            $crate::lsp::commands::lsp_list_sessions,
            $crate::lsp::commands::lsp_restart_session,
            $crate::lsp::commands::lsp_stop_session,
            $crate::lsp::commands::lsp_get_server_info,
            $crate::lsp::commands::lsp_get_server_logs,
            $crate::lsp::commands::lsp_restart_all_sessions,
            $crate::lsp::commands::lsp_stop_all_sessions,
            $crate::lsp::commands::lsp_go_to_definition,
            $crate::lsp::commands::lsp_transport,
            $crate::lsp::commands::lsp_detect_project_profile,
            $crate::lsp::commands::lsp_check_server_installed,
            $crate::lsp::commands::lsp_get_extension_map,
            $crate::lsp::commands::lsp_get_extension_conflicts,
            $crate::lsp::commands::lsp_apply_settings,
            $crate::lsp::commands::lsp_resolve_language,
            // ── dap ──────────────────────────────────────────────────────────
            $crate::dap::commands::dap_list_configs,
            $crate::dap::commands::dap_save_configs,
            $crate::dap::commands::dap_discover_entries,
            $crate::dap::commands::dap_start_session,
            $crate::dap::commands::dap_stop_session,
            $crate::dap::commands::dap_get_session,
            $crate::dap::commands::dap_list_sessions,
            $crate::dap::commands::dap_set_breakpoints,
            $crate::dap::commands::dap_get_breakpoints,
            $crate::dap::commands::dap_control,
            $crate::dap::commands::dap_stack_trace,
            $crate::dap::commands::dap_variables,
            $crate::dap::commands::dap_evaluate,
            $crate::dap::commands::dap_check_adapter,
            // ── common (cross-domain) ────────────────────────────────────────
            $crate::common::commands::log_frontend_error,
            $crate::settings::commands::get_system_fonts,
        ]
    };
}
