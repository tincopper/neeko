//! 组合根：集中组装所有 manager / store，并提供**只读访问器**。
//!
//! 职责边界（见 `.trellis/spec/backend/directory-structure.md`「app_state.rs 的职责」）：
//! **只组装字段 + 构造 + 共享状态的读取**。域内策略（会话分派、清理机制、路径匹配…）
//! 一律留在各自的领域模块 —— 组合根不得沉淀业务逻辑。

use crate::agent::AgentManager;
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::WatcherManager;
use crate::common::git::WorkspaceRef;
use crate::common::runtime::AppRuntime;
use crate::conversation::ConversationManager;
use crate::library;
use crate::project::ProjectManager;
use crate::session::StorageManager;
use crate::terminal::TerminalRouter;
use crate::AppError;
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
    /// Running long git ops, keyed by workspace (`WorkspaceRef::key()`): same workspace is
    /// mutually exclusive, different units (main / linked worktrees) run in parallel.
    pub git_sync: crate::common::git::transport::GitSyncSlots,
    /// File-system watcher for project changes.
    pub watcher_manager: WatcherManager,
    /// Shared skill store (tag groups, installed skills).
    /// Unified library store (skills, MCP, prompts, actions, tag groups).
    pub library_store: Arc<library::LibraryStore>,
    /// Generic key-value cache over the same `neeko.db` pool.
    ///
    /// Shares the pool with `library_store` on purpose: one pool per database
    /// file, so there is a single owner for the handle.
    pub cache_store: Arc<crate::common::cache::CacheStore>,
    /// Language Server Protocol session manager.
    pub lsp_manager: Arc<crate::lsp::LspManager>,
    /// 应用级通知中心（业务无关裁决+投递；业务域单向依赖其门面，design.md T4/D6）。
    pub notification: Arc<crate::notification::NotificationCenter>,
    /// Debug Adapter Protocol session manager.
    ///
    /// 语言编排后端（Java 等）经 `DapManager::register_backend` 注入 —— 组合根不
    /// 为单个语言开字段（§9.4 方案 C）。
    pub dap_manager: crate::dap::DapManager,
    /// Conversation scanning and management.
    pub conversation_manager: ConversationManager,
    /// 进程内 HTTP 服务端句柄（setup 阶段由 agent-hooks boot 存入；关闭协议取走停机）。
    ///
    /// `Arc<Mutex<..>>` 是必需的：`shutdown_background_and_exit(&self)` 要构造 `move`
    /// 清理闭包，只能靠 `Arc` 克隆跨线程 take（裸 `Mutex` 字段版编译不过）。
    /// 组合根只存句柄 —— 不含任何 HTTP 逻辑（引擎在 `crate::server`）。
    http_server: Arc<Mutex<Option<crate::server::ServerHandle>>>,
    /// 主窗口句柄（setup 阶段注入；菜单/事件统一从此取）。
    ///
    /// 避免运行时 `get_webview_window("main")` 查找——其内部 `is_webview_window`
    /// 判定要求窗口上所有 webview 的 label 都等于窗口 label，浏览器子 webview
    /// （label = browser-xxx）会使其失效（Cmd+W 关闭标签页失效的根因）。
    main_window: RwLock<Option<tauri::WebviewWindow>>,
}

/// Workspace 解析的**完整投影**：`(项目环境, 执行目标, 已解析 Workspace 身份)`。
///
/// 单次读项目即可取齐三者，供需要项目级产物落点（终端主题等）的命令使用，
/// 避免再单独 [`AppStateWrapper::project_environment`] 造成同一事实两次读取。
pub type ResolvedWorkspace = (
    crate::core::project::ProjectEnvironment,
    ExecTarget,
    WorkspaceRef,
);

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
        // HTTP 句柄用 Arc 克隆取走：清理闭包是 FnOnce + Send，不能借用 &self。
        let http_server = Arc::clone(&self.http_server);

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
            // git 长操作子进程树（git → hook → pnpm → vitest/cargo）没有自己的生命周期
            // 守卫：退出前按登记表逐个驱动终止策略（宿主本地树杀 / SSH 远端 kill）。
            (
                "git-children",
                Box::new(crate::common::executor::kill_all_live),
            ),
            // HTTP 引擎：发 graceful shutdown 并等待在途请求收敛（有界 ≤200ms）。
            // 运行在独立的 `shutdown-http` OS 线程 → `block_on_shutdown` 契约成立。
            (
                "http",
                Box::new(move || {
                    let handle = http_server
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .take();
                    if let Some(mut handle) = handle {
                        handle.stop();
                    }
                }),
            ),
        ];
        crate::common::shutdown::run_cleanup_and_exit(tasks);
    }

    /// 存入 HTTP 服务端句柄（setup 阶段由 agent-hooks boot 成功后调用一次）。
    pub fn set_http_server(&self, handle: crate::server::ServerHandle) {
        *self
            .http_server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
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
        // 合法 project id 绝不含 NUL —— 它只可能来自「复合 WorkspaceKey（`id\0wt`）误当裸 id」
        // （历史事故：前端把 tab 空间键塞进身份槽位 → 后端按精确匹配失败）。显式拒绝优于
        // 按 NotFound 处理：后者会把排障引向「项目缺失」，掩盖真正的身份污染。
        if project_id.contains('\0') {
            return Err(AppError::InvalidInput("Invalid project id".into()));
        }
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

    /// 解析**核心**（唯一实现）：项目 + worktree → [`ResolvedWorkspace`]。
    ///
    /// 单次读项目、单次 `spawn_blocking`，[`Self::resolve_workspace`]
    /// （git/file 域）与 [`Self::resolve_workspace_target_with_env`]（终端等需要项目环境）
    /// 都是它的**投影** —— 两个外观共享同一实现，不会漂移。
    ///
    /// **异步**：解析内含 `exists` / `canonicalize`（阻塞 fs），故「项目根 + worktree」两次解析
    /// 在**同一次** `spawn_blocking` 内完成（红线 3）—— 一次线程池 hop，且两次解析共用同一时刻的
    /// fs 视图。线程池 panic / 运行时关停才走 `AppError::Unknown`，领域错误逐字保留。
    async fn resolve_workspace_core(
        &self,
        project_id: &str,
        worktree_path: Option<&str>,
    ) -> Result<ResolvedWorkspace, AppError> {
        let (environment, project_root) = self.project_context(project_id)?;
        let target = environment.to_exec_target();
        let task_target = target.clone();
        let task_project_id = project_id.to_string();
        let task_worktree_path = worktree_path.map(str::to_string);
        let repo = tokio::task::spawn_blocking(move || {
            WorkspaceRef::resolve(
                &task_project_id,
                &project_root,
                task_worktree_path.as_deref(),
                &task_target,
            )
        })
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
        .map_err(AppError::from)?;
        Ok((environment, target, repo))
    }

    /// 项目 + worktree 路径 → **Workspace身份**（[`WorkspaceRef`]）与执行环境。
    ///
    /// 取代旧的 `path_guard::resolve_validated_work_dir`（校验时 canonicalize、返回时丢弃，
    /// 于是同一工作树可有多种字符串身份）。校验、归一化与「路径等于项目根 → 主仓」的收敛都在
    /// [`WorkspaceRef::resolve`] 内；本方法只是 [`Self::resolve_workspace_core`] 的投影。
    pub async fn resolve_workspace(
        &self,
        project_id: &str,
        worktree_path: Option<&str>,
    ) -> Result<(ExecTarget, crate::common::git::WorkspaceRef), AppError> {
        let (_environment, target, repo) = self
            .resolve_workspace_core(project_id, worktree_path)
            .await?;
        Ok((target, repo))
    }

    /// 文件/通用命令的统一入口：**Workspace 目标 → (执行环境, 已解析 [`WorkspaceRef`])**。
    ///
    /// 与 [`Self::resolve_workspace`] 同源（委托），使「按 Workspace 寻址」的命令不必各自拼
    /// `project_id` + `worktree_path` —— 地址是一个值对象（[`crate::common::git::WorkspaceSession`]）。
    pub async fn resolve_workspace_target(
        &self,
        workspace: &crate::common::git::WorkspaceSession,
    ) -> Result<(ExecTarget, crate::common::git::WorkspaceRef), AppError> {
        self.resolve_workspace(&workspace.project_id, workspace.worktree_path.as_deref())
            .await
    }

    /// [`Self::resolve_workspace_target`] 的**全投影**：额外返回项目环境。
    ///
    /// 需要项目级产物落点（终端主题等）的命令用本入口一次解析取齐，不必再单独
    /// [`Self::project_environment`]（那会二次读项目）。与前者同源（同一 `resolve_workspace_core`）。
    pub async fn resolve_workspace_target_with_env(
        &self,
        workspace: &crate::common::git::WorkspaceSession,
    ) -> Result<ResolvedWorkspace, AppError> {
        self.resolve_workspace_core(&workspace.project_id, workspace.worktree_path.as_deref())
            .await
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
                &crate::common::paths::agent_sessions_db_path(),
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
            crate::dap::types::AdapterKind::Java,
            std::sync::Arc::new(crate::dap::adapter::java::JavaBackend::new(
                std::sync::Arc::new(crate::lsp::LspJavaDebugCapability::new(Arc::clone(
                    &lsp_manager,
                ))),
                std::sync::Arc::new(crate::lsp::LspJavaSourcePath::new()),
            )),
        );

        // 用户级 watcher 排除由配置域读取、经组合根注入 watcher 域（依赖倒置：
        // watcher 不感知 `~/.neeko/config.json`）。每次挂载调用一次，保持配置冻结语义。
        let watcher_manager = {
            let storage = storage_manager.clone();
            WatcherManager::new().with_watcher_excludes(move || storage.watcher_excludes())
        };

        // 通知设置只读一次（构造期），运行期由薄命令 update_settings 刷新快照 ——
        // 与 watcher_excludes 同源的「配置域读取、组合根注入」模式。
        let notification = Arc::new(crate::notification::NotificationCenter::new(
            storage_manager.notification_settings(),
        ));

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
            git_sync: crate::common::git::transport::GitSyncSlots::default(),
            watcher_manager,
            cache_store: Arc::new(crate::common::cache::CacheStore::with_pool(
                library_store.pool().clone(),
            )),
            library_store,
            lsp_manager,
            dap_manager,
            conversation_manager: ConversationManager::new(
                crate::conversation::adapters::all_adapters(),
            ),
            notification: Arc::clone(&notification),
            http_server: Arc::new(Mutex::new(None)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::testing::isolated_state;

    #[test]
    fn project_context_rejects_nul_in_project_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        // 复合 WorkspaceKey（主仓单元）误当裸 id 的形态：`<uuid>\0`
        let err = state
            .project_context("3122d984-3c86-4ba4-b67c-105ed5b69853\0")
            .expect_err("NUL-containing project id must be rejected");
        assert!(
            matches!(err, AppError::InvalidInput(ref m) if m == "Invalid project id"),
            "expected InvalidInput(\"Invalid project id\"), got {err:?}"
        );
    }
}
