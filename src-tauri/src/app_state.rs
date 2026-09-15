//! 组合根：集中组装所有 manager / store，并提供**只读访问器**。
//!
//! 职责边界（见 `.trellis/spec/backend/directory-structure.md`「app_state.rs 的职责」）：
//! **只组装字段 + 构造 + 共享状态的读取**。域内策略（会话分派、清理机制、路径匹配…）
//! 一律留在各自的领域模块 —— 组合根不得沉淀业务逻辑。

use crate::agent::AgentManager;
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::WatcherManager;
use crate::common::runtime::AppRuntime;
use crate::conversation::ConversationManager;
use crate::library;
use crate::project::ProjectManager;
use crate::session::StorageManager;
use crate::terminal::TerminalRouter;
use crate::AppError;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

/// Central application state holding all managers and shared resources.
pub struct AppStateWrapper {
    /// Business async executor (Scheme C: logical own runtime, one Handle).
    pub runtime: Arc<AppRuntime>,
    /// Project CRUD and persistence.
    pub project_manager: Mutex<ProjectManager>,
    /// 终端会话路由器（持有本地 PTY / SSH 两个后端 + 会话归属路由表）。
    ///
    /// 需直连某后端的调用方用 [`TerminalRouter::local`] / [`TerminalRouter::remote`]。
    pub terminal_router: TerminalRouter,
    /// AI agent registration and configuration.
    pub agent_manager: Mutex<AgentManager>,
    /// Agent Chat live session registry (session_id → request channel).
    pub agent_chat_manager: Arc<crate::agent::chat::manager::AgentChatManager>,
    /// Agent Chat session persistence (SQLite-backed cursors + events).
    pub session_store: Arc<dyn crate::agent::chat::session_store::SessionStore>,
    /// Session and config file persistence.
    pub storage_manager: StorageManager,
    /// Currently active project ID, if any.
    pub active_project_id: Mutex<Option<String>>,
    /// Running project clone handle (single-clone slot; None when idle).
    pub project_clone: Mutex<Option<crate::project::clone::CloneHandle>>,
    /// File-system watcher for project changes.
    pub watcher_manager: WatcherManager,
    /// Shared skill store (tag groups, installed skills).
    /// Unified library store (skills, MCP, prompts, actions, tag groups).
    pub library_store: Arc<library::LibraryStore>,
    /// Language Server Protocol session manager.
    pub lsp_manager: Arc<crate::lsp::LspManager>,
    /// Debug Adapter Protocol session manager.
    ///
    /// 语言编排后端（Java 等）经 `DapManager::register_backend` 注入 —— 组合根不
    /// 为单个语言开字段（§9.4 方案 C）。
    pub dap_manager: crate::dap::DapManager,
    /// Conversation scanning and management.
    pub conversation_manager: ConversationManager,
    /// 主窗口句柄（setup 阶段注入；菜单/事件统一从此取）。
    ///
    /// 避免运行时 `get_webview_window("main")` 查找——其内部 `is_webview_window`
    /// 判定要求窗口上所有 webview 的 label 都等于窗口 label，浏览器子 webview
    /// （label = browser-xxx）会使其失效（Cmd+W 关闭标签页失效的根因）。
    main_window: RwLock<Option<tauri::WebviewWindow>>,
}

impl AppStateWrapper {
    /// 关闭全部后台服务并退出进程。
    ///
    /// 组合根只声明"要清理哪些域"（任务表）；并行清理的**机制**在
    /// [`crate::common::shutdown::run_cleanup_and_exit`]。
    pub fn shutdown_background_and_exit(&self) {
        let terminal_manager = self.terminal_router.local().clone();
        let remote_terminal_manager = self.terminal_router.remote().clone();
        let watcher_manager = self.watcher_manager.clone();
        let lsp_manager = self.lsp_manager.clone();

        let tasks: Vec<crate::common::shutdown::CleanupTask> = vec![
            (
                "terminal",
                Box::new(move || terminal_manager.close_all_sessions()),
            ),
            (
                "remote",
                Box::new(move || remote_terminal_manager.close_all_sessions()),
            ),
            ("watcher", Box::new(move || watcher_manager.stop_all())),
            ("lsp", Box::new(move || lsp_manager.close_all_sessions())),
        ];
        crate::common::shutdown::run_cleanup_and_exit(tasks);
    }

    /// 注入主窗口句柄（setup 阶段调用一次；菜单事件等从此取，见 [`Self::main_window`]）。
    pub fn set_main_window(&self, window: tauri::WebviewWindow) {
        *self
            .main_window
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(window);
    }

    /// 取主窗口句柄（None = 尚未注入）。
    #[must_use]
    pub fn main_window(&self) -> Option<tauri::WebviewWindow> {
        self.main_window
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// 项目 → (执行环境, 项目路径) 的**单次快照**。
    ///
    /// 需要同时拿到两者的调用方（如终端创建）用本访问器，避免两次加锁；
    /// [`Self::resolve_project`] 亦由它派生（同一份读取逻辑，不重复）。
    pub fn project_context(
        &self,
        project_id: &str,
    ) -> Result<(crate::core::project::ProjectEnvironment, String), AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
        Ok((
            project.environment.clone(),
            project.path.to_string_lossy().to_string(),
        ))
    }

    /// Resolve project path and a matching ExecTarget by project ID.
    pub fn resolve_project(&self, project_id: &str) -> Result<(ExecTarget, String), AppError> {
        let (environment, path) = self.project_context(project_id)?;
        Ok((environment.to_exec_target(), path))
    }

    /// Resolve a project's execution environment.
    ///
    /// 由 [`Self::project_context`] 派生：两者是同一份"按 id 读项目"逻辑的两个投影，
    /// 不各自持锁查表（否则改 `NotFound` 文案或查表方式时要改两处）。
    pub fn project_environment(
        &self,
        project_id: &str,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        Ok(self.project_context(project_id)?.0)
    }

    /// Resolve the execution environment for the active project.
    pub fn active_project_environment(
        &self,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        let id = self
            .active_project_id
            .lock()
            .map_err(AppError::from)?
            .clone()
            .ok_or_else(|| {
                AppError::NotFound(
                    "No active project — cannot resolve execution environment".into(),
                )
            })?;
        self.project_environment(&id)
    }

    /// Resolve execution environment by project filesystem path.
    ///
    /// 匹配规则属项目域（[`crate::project::lookup::environment_for_path`]）；
    /// 组合根只负责读出项目列表。
    pub fn environment_for_project_path(
        &self,
        project_path: &str,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        let projects = self
            .project_manager
            .lock()
            .map_err(AppError::from)?
            .list_projects();
        crate::project::lookup::environment_for_path(&projects, project_path)
    }

    /// Create `AppStateWrapper` with an external shared `LibraryStore`.
    #[allow(clippy::expect_used)]
    #[must_use]
    pub fn new_with_library_store(library_store: Arc<library::LibraryStore>) -> Self {
        let storage_manager = StorageManager::new().expect("Failed to create storage manager");
        Self::new_with_storage_and_library(storage_manager, library_store)
    }

    /// Create `AppStateWrapper` with an explicit storage manager (config dir) and
    /// an external shared `LibraryStore`.  Tests MUST pass an isolated storage
    /// (e.g. `StorageManager::with_dir(tempdir)`) so that project mutations never
    /// touch the real `~/.neeko/sessions.json`.
    ///
    /// # Why `#[allow(clippy::expect_used)]` is safe
    ///
    /// This constructor only composes already-constructed values into `Self`;
    /// it performs no fallible operations itself. The `expect` allowance exists
    /// solely so that the *caller* (`new_with_library_store`) can propagate a
    /// `StorageManager::new()` failure as a hard panic — which is intentional
    /// for the production path (a missing config dir is unrecoverable). Test
    /// code bypasses this by calling `new_with_storage_and_library` directly
    /// with an isolated `StorageManager`.
    #[allow(clippy::expect_used)]
    #[must_use]
    pub fn new_with_storage_and_library(
        storage_manager: StorageManager,
        library_store: Arc<library::LibraryStore>,
    ) -> Self {
        // Persist callback: auto-saves projects after every mutation
        let persist = {
            let sm_clone = storage_manager.clone();
            move |projects: &[crate::project::types::Project]| {
                let session = sm_clone.create_session_from_projects(projects, None);
                if let Err(e) = sm_clone.save_session(&session) {
                    log::error!("Auto-save session failed: {}", e);
                }
            }
        };

        // Bind business runtime to Tauri's global Tokio handle (safe before/after setup).
        let runtime = AppRuntime::shared_default();
        let lsp_manager = Arc::new(crate::lsp::LspManager::new(Arc::clone(&runtime)));

        // Open the agent session store (SQLite at ~/.neeko/agent_sessions.db).
        // Falls back to in-memory if the file cannot be opened.
        let session_store: Arc<dyn crate::agent::chat::session_store::SessionStore> = Arc::new(
            crate::agent::chat::session_store::SqliteSessionStore::open(
                &dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".neeko")
                    .join("agent_sessions.db"),
            )
            .unwrap_or_else(|e| {
                log::error!("Failed to open agent session store, falling back to in-memory: {e}");
                crate::agent::chat::session_store::SqliteSessionStore::open_in_memory()
                    .expect("failed to open in-memory session store")
            }),
        );

        // 装配 DAP 语言编排后端：Java 需要 lsp 域的两个端口（能力探测 / 断点源路径翻译）。
        // 组合根只组装一次 —— 不把端口暴露为 AppStateWrapper 字段（§9.4 方案 C）。
        let dap_manager = crate::dap::DapManager::new();
        dap_manager.register_backend(
            "java",
            std::sync::Arc::new(crate::dap::adapter::java::JavaBackend::new(
                std::sync::Arc::new(crate::lsp::LspJavaDebugCapability::new(Arc::clone(
                    &lsp_manager,
                ))),
                std::sync::Arc::new(crate::lsp::LspJavaSourcePath::new()),
            )),
        );

        Self {
            runtime,
            project_manager: Mutex::new(ProjectManager::new(persist)),
            terminal_router: TerminalRouter::new(),
            agent_manager: Mutex::new(agent_manager_with_overrides(&storage_manager)),
            agent_chat_manager: Arc::new(
                crate::agent::chat::manager::AgentChatManager::with_store(session_store.clone()),
            ),
            session_store,
            storage_manager,
            active_project_id: Mutex::new(None),
            project_clone: Mutex::new(None),
            watcher_manager: WatcherManager::new(),
            library_store,
            lsp_manager,
            dap_manager,
            conversation_manager: ConversationManager::new(
                crate::conversation::adapters::all_adapters(),
            ),
            main_window: RwLock::new(None),
        }
    }

    /// Create `AppStateWrapper` with an auto-initialized `LibraryStore`.
    #[allow(clippy::expect_used)]
    #[must_use]
    pub fn new() -> Self {
        library::db::ensure_db_ready().expect("Failed to prepare library database");
        let store = Arc::new(
            library::LibraryStore::open(&library::db::db_path())
                .expect("Failed to create library store"),
        );
        Self::new_with_library_store(store)
    }
}

impl Default for AppStateWrapper {
    fn default() -> Self {
        Self::new()
    }
}

/// 构造 AgentManager 并从 config.json `agentOverrides` 恢复内置覆盖。
fn agent_manager_with_overrides(
    storage_manager: &crate::session::manager::StorageManager,
) -> AgentManager {
    let mut manager = AgentManager::new();
    let overrides = storage_manager
        .load_agent_overrides()
        .into_iter()
        .filter_map(|(id, v)| {
            serde_json::from_value::<crate::common::agent::types::AgentConfig>(v)
                .ok()
                .map(|cfg| (id, cfg))
        })
        .collect::<std::collections::HashMap<_, _>>();
    manager.restore_overrides(&overrides);
    manager
}
