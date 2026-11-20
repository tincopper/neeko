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
    /// Live session registry — 会话状态与标题的**唯一事实源**（两个生产者：chat 事件流 / PTY）。
    ///
    /// 与 `agent_chat_manager` 共存而非合并：chat 管理器只管「页面 → agent 请求路由」，
    /// 而注册表还要登记终端会话。写穿共用同一个 `session_store` 实例（同一张 cursor 表）。
    pub live_sessions: Arc<crate::live_sessions::Registry>,
    /// 纯 shell 终端历史日志的**单一所有者**。目录只在 `at_default_dir()` 解析一次，
    /// 注入 Registry（生命周期通知）与 TerminalRouter（回放准备）。
    /// 组合根持有它只是为了在 `on_setup` 做一次孤儿 GC。
    pub terminal_history: crate::common::terminal::history::SharedHistoryStore,
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
    /// 团队域管理器（团队 / 成员 / 任务板 / 租约 / 审计的唯一写入口）。
    ///
    /// 与 `cache_store` 同理**共享** `library_store` 的池：一个数据库一个池
    /// （[`library::LibraryStore::with_pool`] 的注释已钉住这条），而且迁移链
    /// （含 v14 的团队建表）只在那个入口跑过一次。
    ///
    /// 因果链（换池之前先读完这条）：`app/boot.rs` 的 `open_pool` →
    /// `LibraryStore::with_pool` → `common::db::run_migrations` →
    /// `migrate_step(13)` → [`crate::agent::team::store::v13_to_v14`]。
    /// [`crate::agent::team::TeamStore::with_pool`] **自己不起池、也不跑迁移**（它是
    /// `const fn`），文档写明的唯一前置条件就是「调用方已在这个池上跑过迁移链」——
    /// 换一个池的后果不是慢，而是每一条团队查询都以 `no such table: team` 失败。
    ///
    /// # 构造必须走 `load`（hydrate）而不是 `new`
    ///
    /// 库是**真相源**，内存镜像是**缓存** —— 所以「缓存初始化」是启动的硬步骤，不是可选优化。
    /// [`crate::agent::team::TeamManager::new`] 给的是空镜像，第二次启动起 `team()` /
    /// `member()` 恒 `None`，而 `add_member` 的团队存在性判据读的正是空镜像（于是对一个库里
    /// 真实存在的团队报 `NotFound`）。机器判据是
    /// `a_restart_hydrates_the_team_domain_from_the_database`（本文件 `tests`）。
    pub team_manager: Arc<crate::agent::team::TeamManager>,
    /// 工作项域管理器（Local Provider 工作项 + 执行记录的唯一写入口）。
    ///
    /// 与 `cache_store` / `team_manager` 同理**共享** `library_store` 的池：一个数据库一个池
    /// （[`library::LibraryStore::with_pool`] 的注释已钉住这条），而且迁移链只在那个入口跑过
    /// 一次。
    ///
    /// 因果链（换池之前先读完这条）：`app/boot.rs` 的 `open_pool` →
    /// `LibraryStore::with_pool` → `common::db::run_migrations` → `migrate_step(17)` →
    /// [`crate::work_items::store::v17_to_v18`]。
    /// [`crate::work_items::WorkItemStore::with_pool`] **自己不起池、也不跑迁移**（它是
    /// `const fn`），文档写明的唯一前置条件就是「调用方已在这个池上跑过迁移链」—— 换一个池
    /// 的后果不是慢，而是每一条工作项查询都以 `no such table: work_item` 失败。
    ///
    /// # 构造不需要 hydrate（与 `team_manager` 的区别）
    ///
    /// 本域**没有内存镜像**：每次读都直接打库，库就是唯一真相源。所以这里用 `with_store`
    /// 而不是 `load` —— 需要一个 `load` 只是「有第二份状态要同步」的信号。
    pub work_item_manager: Arc<crate::work_items::WorkItemManager>,
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
    /// 团队 MCP 端点（`agent::team::boot` 起；**与 hooks 分开的独立 listener**，design §3.1b）。
    ///
    /// 不合并进 `http_server`：两个端点各有自己的门（hooks = 单进程 token，团队 = 成员
    /// token 的活集合）与失败策略（fail-open vs fail-closed），共用一个 handle 会让「谁在
    /// 什么端口上」重新变成隐式知识。
    ///
    /// `Option` 是因为它可能起不来（端口/读库失败）：那时团队功能不可用，但**整个应用
    /// 不该跟着起不来**（hooks 那条常开路径更不该受影响）。
    team_server: Arc<Mutex<Option<crate::agent::team::TeamServer>>>,
    /// 租约回收器（`agent::team::reaper` 起；**时间驱动**的团队迁移）。
    ///
    /// `Option` 只为「关闭协议取一次」：启动后恒为 `Some`（它没有构造失败的可能 ——
    /// 只是 spawn 一个循环）。与团队端点分开存：端点可能起不来（端口/读库失败），
    /// 而回收器不该因为端点没起来就停摆（租约与 MCP 面无关）。
    team_reaper: Arc<Mutex<Option<crate::agent::team::TeamReaper>>>,
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
    /// 组合根只声明"要清理哪些域"（两阶段任务表）；两阶段清理的**机制**在
    /// [`crate::common::shutdown::run_cleanup_and_exit`]。
    ///
    /// 阶段划分（顺序不可交换）：
    /// - `tasks`：各域**自己**收尾（terminal / watcher / lsp / http）。LSP 需要秒级
    ///   宽限跑完 `shutdown` → `exit` → 等进程退出；
    /// - `finalizers`：对所有域生效的**收割器**，只在全部 task 结束后才跑。
    ///   `kill_all_live` 是整树 SIGKILL（毫秒级），与优雅域并行就会截断在途写入。
    pub fn shutdown_background_and_exit(&self) {
        // 第一行：置「退出中」标志 —— 之后任何清理路径触发的 `unregister` 都只摘内存条目，
        // 不删持久化行。否则「退出」会被写成「用户删光了所有会话」，下次启动侧栏为空。
        self.live_sessions.begin_shutdown();

        let terminal_manager = self.terminal_router.local().clone();
        let remote_terminal_manager = self.terminal_router.remote().clone();
        let watcher_manager = self.watcher_manager.clone();
        let lsp_manager = self.lsp_manager.clone();
        // HTTP 句柄用 Arc 克隆取走：清理闭包是 FnOnce + Send，不能借用 &self。
        let http_server = Arc::clone(&self.http_server);
        let team_server = Arc::clone(&self.team_server);
        let team_reaper = Arc::clone(&self.team_reaper);

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
            // 租约回收器：只 abort 一个循环（见 `reaper` 模块文档）。
            (
                "team-reaper",
                Box::new(move || {
                    let reaper = team_reaper
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .take();
                    if let Some(reaper) = reaper {
                        reaper.stop();
                    }
                }),
            ),
            // 团队端点：独立 listener，同样要 graceful shutdown —— 否则关闭时在途的
            // `team_wait` 会把进程退出拖到超时。`TeamServer::stop` 消费自身，取出来再停。
            (
                "team-http",
                Box::new(move || {
                    let server = team_server
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .take();
                    if let Some(server) = server {
                        server.stop();
                    }
                }),
            ),
        ];

        // 收割阶段：git 长操作子进程树（git → hook → pnpm → vitest/cargo）没有自己的
        // 生命周期守卫，退出前按登记表逐个驱动终止策略（宿主本地树杀 / SSH 远端 kill）。
        // 必须**最后**跑：LSP 的 checkpoint 窗口是秒级，整树 SIGKILL 是毫秒级，并行
        // 等于每次退出都截断在途写入（审计 lifecycle #1）。
        let finalizers: Vec<crate::common::shutdown::CleanupTask> = vec![(
            "git-children",
            Box::new(crate::common::executor::kill_all_live),
        )];

        crate::common::shutdown::run_cleanup_and_exit(tasks, finalizers);
    }

    /// 存入 HTTP 服务端句柄（setup 阶段由 agent-hooks boot 成功后调用一次）。
    pub fn set_http_server(&self, handle: crate::server::ServerHandle) {
        *self
            .http_server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
    }

    /// 存入团队 MCP 端点（setup 阶段由 `team::boot` 成功后调用一次）。
    pub fn set_team_server(&self, server: crate::agent::team::TeamServer) {
        *self
            .team_server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(server);
    }

    /// 存入租约回收器（setup 阶段调用一次；与团队端点**各自独立**，见字段文档）。
    pub fn set_team_reaper(&self, reaper: crate::agent::team::TeamReaper) {
        *self
            .team_reaper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(reaper);
    }

    /// 团队端点的 URL（成员 MCP 配置里要写的那串）。端点没起来时 `None`。
    ///
    /// 执行层（`execution::plan_member_spawn` 的 `mcp_url`）只从这里取：拼装点唯一，
    /// 「端口对了但路径错了」这类错误就没有地方发生。
    pub fn team_endpoint_url(&self) -> Option<String> {
        self.team_server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(crate::agent::team::TeamServer::endpoint_url)
    }

    /// 团队端点的门面（URL + 凭证面 + 执行者）。端点没起来时 `None`。
    ///
    /// 一次锁内取出三样：它们是「端点起来了」的同一件事，拆成多个访问器只会让调用方
    /// 有能力拿到半个（有 URL 却没人签凭证）。见 `TeamSurface` 的文档。
    pub fn team_surface(&self) -> Option<crate::agent::team::TeamSurface> {
        self.team_server
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(crate::agent::team::TeamServer::surface)
    }

    /// 项目根路径 → 执行环境（v15 行团队执行层的**兼容**环境来源）。
    ///
    /// # 为什么 v16 起不再是主路径
    ///
    /// 团队行现在带 `project_id`（环境的归属），执行层按 id 精确查表
    /// （[`crate::agent::team::execution::environment_source`]）。路径反查只留给
    /// **v16 之前建的行**：它对 Neeko 自己的工作树（`~/.neeko/worktrees/<name>`，按设计在项目
    /// 目录**之外**）永远匹配不上 —— 那正是「从工作树开团队必失败」的根因。
    ///
    /// 仍然不能用「把环境复制进团队行」来绕：`ProjectEnvironment::Remote` 内含 SSH 认证，
    /// 复制就是给同一份秘密造第二个存放点。所以团队行只记 id，环境仍向项目库要
    /// （`Project.environment` 是权威）。
    ///
    /// # 为什么在组合根
    ///
    /// 它是**唯一**同时认识团队域与项目域的地方。放进任何一侧都会让那一侧反向依赖对方的
    /// 数据模型（团队域依赖 `ProjectManager`，或项目域依赖 `Team`）。
    ///
    /// # 阻塞（红线 3）
    ///
    /// `canonicalize` 是 I/O：项目快照在调用线程取（纯内存拷贝），归一化与匹配进阻塞池。
    pub async fn project_environment_for_path(
        &self,
        path: &std::path::Path,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        let projects: Vec<(std::path::PathBuf, crate::core::project::ProjectEnvironment)> = self
            .project_manager
            .lock()
            .map_err(AppError::from)?
            .list_projects()
            .into_iter()
            .map(|project| (project.path, project.environment))
            .collect();
        let target = path.to_path_buf();
        self.runtime
            .spawn_blocking(move || crate::core::project::environment_for_path(&projects, &target))
            .await
            .map_err(|err| {
                AppError::Unknown(format!(
                    "resolving the project of a team root failed: {err}"
                ))
            })?
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

    /// 执行地址 → **单元范围的归属判定器**（会话列表 / 搜索 / 后续域共用）。
    ///
    /// 放在组合根而不是某个域里：它只回答「这个地址对哪些路径负责」，与消费方语义无关。
    /// 单元根的校验与身份铸造仍只在 [`Self::resolve_workspace_target`] 之后的
    /// [`crate::common::git::UnitScope::resolve`] 里发生。
    pub async fn resolve_unit_scope(
        &self,
        workspace: &crate::common::git::WorkspaceSession,
    ) -> Result<crate::common::git::UnitScope, AppError> {
        let (target, repo) = self.resolve_workspace_target(workspace).await?;
        crate::common::git::UnitScope::resolve(&target, &repo)
            .await
            .map_err(AppError::from)
    }

    /// 项目身份 → **项目的归属范围**（History 列表 / 搜索 / 扫描的唯一解析入口）。
    ///
    /// 一个项目有 1+N 个工作区（主 checkout + linked worktree），而 Neeko 的工作树按设计落在
    /// 项目目录**之外**（`~/.neeko/worktrees/<name>`）。「整个项目的历史」因此不能用一条路径
    /// 表达：根集合 = 项目登记根 + `git worktree list` + **团队行记录过的工作区根**。
    ///
    /// # 为什么团队记录也算注册事实
    ///
    /// 成员会话的 cwd 是团队根，而团队根可能是一个已经 `git worktree remove` 掉的工作树
    /// （转录还在）。团队行记录的 `workspace_worktree` 是「这个目录属于本项目」的**登记事实**
    /// —— 不靠字符串反推（红线 12）。v16 之前的旧行（空 `project_id`）不属于任何项目，跳过。
    ///
    /// # Errors
    /// 未知 `project_id` ⇒ `NotFound`（与 [`Self::resolve_workspace_core`] 同一台阶：
    /// 「有没有这个项目」是能力前置，不是一次事后失败）。
    pub async fn project_scope(
        &self,
        project_id: &str,
    ) -> Result<crate::common::git::ProjectScope, AppError> {
        let (environment, project_root) = self.project_context(project_id)?;

        // 团队记录的工作区根（内存镜像的锁内无 I/O）。同一个路径可能被多个队记录，去重交给
        // `ProjectScope`（它按身份去重，不在这里再写一份判据）。
        let recorded: Vec<std::path::PathBuf> = self
            .team_manager
            .teams()
            .into_iter()
            .filter(|team| !team.project_id.is_empty() && team.project_id == project_id)
            .map(|team| {
                team.workspace_worktree
                    .clone()
                    .unwrap_or_else(|| team.project_path.clone())
            })
            .collect();

        crate::common::git::ProjectScope::resolve(
            &environment.to_exec_target(),
            std::path::Path::new(&project_root),
            &recorded,
        )
        .await
        .map_err(AppError::from)
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
        Self::assemble(storage_manager, library_store, WatcherManager::new())
    }

    /// 测试态组装：watcher 的**事件源**由调用方决定
    /// （`WatcherManager::without_real_fs` 关掉内核投递，只留 worker / 快照链路）。
    ///
    /// 为什么是构造参数而不是「装完再换字段」：`watcher_manager` 是组合根注入的**依赖**，
    /// 在装配那一刻就该定下来 —— 先建生产实例再替换，会让「这份 state 用哪种事件源」在
    /// 两次赋值之间不确定，且要求外部知道该字段可替换（把装配细节泄漏给测试）。
    /// 除事件源外与 [`Self::new_with_storage_and_library`] 走**同一条**装配路径。
    #[cfg(test)]
    #[must_use]
    pub fn new_with_watcher_manager_for_test(
        storage_manager: StorageManager,
        library_store: Arc<library::LibraryStore>,
        watcher_manager: WatcherManager,
    ) -> Self {
        Self::assemble(storage_manager, library_store, watcher_manager)
    }

    /// 组合根装配的**唯一实现**：生产入口与测试态入口只在 watcher 的事件源上不同。
    #[allow(clippy::expect_used)]
    fn assemble(
        storage_manager: StorageManager,
        library_store: Arc<library::LibraryStore>,
        watcher_manager: WatcherManager,
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

        // 纯 shell 终端历史日志的单一所有者。目录在这里解析一次，之后所有域都通过
        // 注入的 `Arc` 访问，不再各自调 `terminal_history_dir()`。
        let terminal_history =
            Arc::new(crate::common::terminal::history::HistoryStore::at_default_dir());

        // Live session registry：与 `AgentChatManager` 共用同一个 store 实例（同一张 cursor 表）。
        // 它在组合根组装、被两个生产者（chat 事件流 / 终端 PTY）与三条命令共享。
        // 团队共享区的根也在这里取一次（与成员隔离配置目录同一个来源）：结构体字面量里
        // `storage_manager` 会被 move 进字段，取晚了就是 borrow-after-move。
        let team_share_root = storage_manager.get_config_dir().to_path_buf();
        let live_sessions = Arc::new(
            crate::live_sessions::Registry::new(session_store.clone())
                .with_history(Arc::clone(&terminal_history)
                    as crate::common::terminal::history::SharedHistory),
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
        // 事件源（生产：真实 OS 流 / 测试态：Noop）在入参已定，这里只做排除接线。
        let watcher_manager = {
            let storage = storage_manager.clone();
            watcher_manager.with_watcher_excludes(move || storage.watcher_excludes())
        };

        // 通知设置只读一次（构造期），运行期由薄命令 update_settings 刷新快照 ——
        // 与 watcher_excludes 同源的「配置域读取、组合根注入」模式。
        let notification = Arc::new(crate::notification::NotificationCenter::new(
            storage_manager.notification_settings(),
        ));

        Self {
            runtime,
            project_manager: Mutex::new(ProjectManager::new(persist)),
            terminal_router: TerminalRouter::with_live_sessions(Arc::clone(&live_sessions))
                .with_history(Arc::clone(&terminal_history)),
            agent_manager: Mutex::new(agent_manager_with_overrides(&storage_manager)),
            agent_chat_manager: Arc::new(
                crate::agent::chat::manager::AgentChatManager::with_store(session_store.clone()),
            ),
            session_store,
            live_sessions,
            terminal_history,
            storage_manager,
            active_project_id: Mutex::new(None),
            project_clone: Mutex::new(None),
            git_sync: crate::common::git::transport::GitSyncSlots::default(),
            watcher_manager,
            cache_store: Arc::new(crate::common::cache::CacheStore::with_pool(
                library_store.pool().clone(),
            )),
            // 同上：池在 `library_store` 里已经跑过迁移链（含 v14 的团队建表），
            // 这里只借用同一个池（字段文档记着整条因果链；"借池不借迁移" = `no such table`）。
            //
            // `load` 而不是 `new`：它与 `new` 的唯一区别就是多一步 hydrate，而团队域
            // 的内存镜像就是库的缓存。用 `new` 会得到「库里有、内存里没有」的第二个真相源。
            // 共享区根与成员隔离配置目录同源（`get_config_dir`）：env、校验、磁盘三方一个字符串。
            team_manager: Arc::new(
                crate::agent::team::TeamManager::load(
                    crate::agent::team::TeamStore::with_pool(library_store.pool().clone()),
                    team_share_root,
                )
                .expect("Failed to hydrate the team manager from the library pool"),
            ),
            // 同上：池在 `library_store` 里已经跑过迁移链（含 v18 的工作项建表），
            // 这里只借用同一个池（字段文档记着整条因果链）。
            work_item_manager: Arc::new(crate::work_items::WorkItemManager::with_store(
                crate::work_items::WorkItemStore::with_pool(library_store.pool().clone()),
            )),
            library_store,
            lsp_manager,
            dap_manager,
            conversation_manager: ConversationManager::new(
                crate::conversation::adapters::all_adapters(),
            ),
            notification: Arc::clone(&notification),
            http_server: Arc::new(Mutex::new(None)),
            team_server: Arc::new(Mutex::new(None)),
            team_reaper: Arc::new(Mutex::new(None)),
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
    use crate::agent::team::fixtures::{fixture_member, fixture_team, TEAM, W1};
    use crate::agent::team::types::{MemberState, TeamState};
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

    /// 不变量：`isolated_state` 的池上**确实跑过** v14 的团队建表。
    ///
    /// [`crate::agent::team::TeamStore::with_pool`] 是 `const fn`，它**不跑迁移** ——
    /// 本用例是那条前置条件的机器判据：表若不在共享池上，第一次团队写就会以
    /// `no such table: team` 失败。“组合根借了池却没借到迁移后的池” 是这条的失败形态。
    #[test]
    fn team_manager_is_wired_on_a_v14_migrated_pool() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        state
            .team_manager
            .create_team(fixture_team(TEAM))
            .expect("create_team 必须成功：v14 表缺失时这里是 `no such table: team`");
        state
            .team_manager
            .add_member(fixture_member(W1, TEAM))
            .expect("add_member 必须成功：成员表同属 v14");
        assert_eq!(
            state.team_manager.member(W1).map(|m| m.state),
            Some(MemberState::Spawned),
            "写入必须落到同一个管理器镜像里（否则第二份真相源）"
        );
    }

    /// 不变量：`isolated_state` 的池上**确实跑过** v18 的工作项建表，且 `work_item_manager`
    /// 用的是**同一个池**（不是同一文件 / 同一 uuid 的第二个池）。
    ///
    /// [`crate::work_items::WorkItemStore::with_pool`] 同样是 `const fn`，不跑迁移 ——
    /// 本用例是那条前置条件的机器判据：表不在共享池上时，第一次工作项写就会以
    /// `no such table: work_item` 失败。“组合根借了池却没借到迁移后的池” 是这条的失败形态。
    ///
    /// # 为什么写完之后要去 `library_store` 的池读
    ///
    /// 「create 之后 list 得到 1 条」只证明 manager 自洽 —— 一个**自建池**的实现同样会绿
    /// （建表迁移在自建池上重跑一遍即可）。真正的契约是「借池」，所以证据必须来自**另一个
    /// 访问器**：`isolated_state` 的库是 `LibraryStore::open_in_memory()`，而
    /// `SqliteConnectionManager::memory()` 每次调用生成一个独立 uuid（见 `common/db/pool.rs`），
    /// 即「两个 in-memory 池 = 两个不同的数据库」。于是这条跨池读取只在共用池时成立
    /// （同 `team_manager_shares_the_library_pool` 的判据）。
    #[test]
    fn work_item_manager_is_wired_on_a_v18_migrated_pool() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        let item = state
            .work_item_manager
            .create(crate::work_items::CreateWorkItem {
                project_id: "p1".to_owned(),
                title: "下单".to_owned(),
                body: None,
                stage: None,
                priority: None,
                labels: None,
                assignee: None,
            })
            .expect("create 必须成功：v18 表缺失时这里是 `no such table: work_item`");
        assert_eq!(
            state.work_item_manager.list("p1").expect("list").len(),
            1,
            "写入必须落在同一个池上（否则列表恒空）"
        );

        // 走 **library 自己的池** 读同一张表（不用 work_item_manager 的访问器）。
        let conn = state.library_store.pool().get().expect("library pool conn");
        let title: String = conn
            .query_row(
                "SELECT title FROM work_item WHERE id = ?1",
                [&item.id],
                |row| row.get(0),
            )
            .expect("work_item_manager 写入的行必须能被 library_store 的池读到（同一个池）");
        assert_eq!(title, "下单");
    }

    /// 夹具：在**同一个库文件**上组一份 `AppStateWrapper`（= 模拟一次进程启动）。
    fn state_on_db(db: &std::path::Path, tmp: &tempfile::TempDir) -> AppStateWrapper {
        let storage =
            StorageManager::with_dir(tmp.path().join(".neeko")).expect("fixture: storage manager");
        let store =
            Arc::new(crate::library::LibraryStore::open(db).expect("fixture: library store"));
        AppStateWrapper::new_with_storage_and_library(storage, store)
    }

    /// **重启即恢复**：库是真相源、内存镜像是缓存，所以启动必须 hydrate（`load`，不是 `new`）。
    ///
    /// 这条用例是 `TeamManager::new` 的失败形态，三处会同时红：
    /// ① `team()` 恒 `None`（花名册空）；② `member()` 恒 `None`；
    /// ③ `issue_token()` 报 `member not found` —— 一个库里确实存在的成员。
    ///
    /// 断言止于「读得到」不够：第 ③ 条同时证明**写路径**也活了（`add_member` 的团队存在性
    /// 判据读的正是内存镜像，空镜像会让它 `NotFound(team …)`）。
    #[test]
    fn a_restart_hydrates_the_team_domain_from_the_database() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db = tmp.path().join("neeko.db");

        // 第一次启动：建团队 + 成员，随后整体丢弃（= 进程退出）。
        {
            let first = state_on_db(&db, &tmp);
            first
                .team_manager
                .create_team(fixture_team(TEAM))
                .expect("create_team");
            first
                .team_manager
                .add_member(fixture_member(W1, TEAM))
                .expect("add_member");
        }

        // 第二次启动：同一个库文件，全新的 `AppStateWrapper`。
        let second = state_on_db(&db, &tmp);
        assert_eq!(
            second.team_manager.team(TEAM).map(|t| t.state),
            Some(TeamState::Open),
            "重启后团队必须可见（`TeamManager::new` 会让这里是 None）"
        );
        assert_eq!(
            second.team_manager.member(W1).map(|m| m.state),
            Some(MemberState::Spawned),
            "重启后成员必须可见"
        );
        // 写路径同样是活的：空镜像下这里会以 `member not found` 失败。
        second
            .team_manager
            .issue_token(W1, 1_000)
            .expect("重启后签发必须找得到成员（= 内存镜像已 hydrate）");
    }

    /// 端点没起来时 `team_endpoint_url()` 是 `None` —— 执行层据此拒绝 spawn，
    /// 而不是拼一个空 URL 写进成员的 MCP 配置（那种成员起来后连不上任何东西）。
    #[test]
    fn team_endpoint_url_is_none_until_the_endpoint_boots() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        assert_eq!(state.team_endpoint_url(), None);
    }

    /// 门面同样是「端点起来了才有」—— 而且它是**一个** `Option`：
    /// 不存在「有 URL 却没人签凭证」这种半可用状态（见 `TeamSurface` 的文档）。
    #[test]
    fn the_team_surface_is_none_until_the_endpoint_boots() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        assert!(state.team_surface().is_none());
    }

    // ─────── 团队根 → 执行环境（执行层的环境来源） ───────

    /// 方法本身：已登记的项目根 → 它的环境（纯匹配规则在 `core::project` 的单测里）。
    #[tokio::test]
    async fn a_registered_project_root_resolves_to_its_environment() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        let root = tmp.path().join("proj");
        std::fs::create_dir_all(&root).expect("project dir");
        state
            .project_manager
            .lock()
            .expect("project manager")
            .add_project(root.clone(), None, None, None)
            .expect("add_project");

        assert!(matches!(
            state.project_environment_for_path(&root).await,
            Ok(crate::core::project::ProjectEnvironment::Local)
        ));
    }

    /// 项目范围 = 项目登记根 + **团队记录过的工作区根**（S3/AC-10 的组合根一半）。
    ///
    /// 团队根按设计可以落在项目目录**之外**（`~/.neeko/worktrees/<name>`），那时
    /// 「按路径前缀反推项目」结构上不可能成立。归属的唯一依据是登记事实：
    /// 项目自己的根、`git worktree list`、以及团队行记录的工作树。
    ///
    /// 反证面：不把团队记录的根收进范围时，工作树里的成员会话在 History 里会整批消失 ——
    /// 所以第一条断言必须成立（它读的正是 `recorded`）。
    #[tokio::test]
    async fn the_project_scope_covers_a_team_workspace_outside_the_project() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = crate::common::testing::plain_project_state(&tmp);
        let project_dir = tmp.path().join("proj");

        // 团队跑在项目目录**之外**的工作树上（Neeko 的默认布局）。
        let worktree = tmp.path().join("neeko-worktrees").join("wt");
        std::fs::create_dir_all(&worktree).expect("worktree dir");
        state
            .team_manager
            .create_team(crate::agent::team::types::Team {
                project_id: project_id.clone(),
                workspace_worktree: Some(worktree.clone()),
                ..fixture_team("tm_scope")
            })
            .expect("create_team");

        let scope = state
            .project_scope(&project_id)
            .await
            .expect("project scope");
        assert!(
            scope.owns(Some(&project_dir.to_string_lossy())),
            "项目登记根属于它自己"
        );
        assert!(
            scope.owns(Some(&worktree.to_string_lossy())),
            "团队记录过的工作树属于同一个项目（否则成员会话在 History 里消失）"
        );
        assert!(
            scope.roots().iter().any(|root| root == &worktree
                || std::fs::canonicalize(root).ok() == std::fs::canonicalize(&worktree).ok()),
            "记录的根同时进**发现**清单（否则路径编码的 CLI 根本扫不到它）：{:?}",
            scope.roots()
        );

        // 别的项目目录不属于它（分量边界，fail-closed）。
        let other = tmp.path().join("proj-other");
        std::fs::create_dir_all(&other).expect("other dir");
        assert!(!scope.owns(Some(&other.to_string_lossy())));

        // 未知项目 ⇒ NotFound（与 `project_context` 同一台阶）。
        let err = state.project_scope("nope").await.expect_err("未知项目");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// 不变量：`team_manager` 与 `library_store` 是**同一个池**（不是同一文件的两个池）。
    ///
    /// # 为什么不是指针比较
    ///
    /// `r2d2::Pool` 内部是 `Arc<SharedPool<_>>`，但它既**不暴露那个 `Arc`** 也没有池 id；
    /// 而 `&DbPool` 在这里是两个不同字段的引用，地址天然不同，`ptr::eq` 恒为假。
    ///
    /// # 可复现的证据形式：库身份
    ///
    /// `isolated_state` 的库是 `LibraryStore::open_in_memory()`，而
    /// `SqliteConnectionManager::memory()` **每次调用**生成一个新 uuid
    /// （`file:<uuid>?mode=memory&cache=shared`，见 `common/db/pool.rs`）——
    /// 即 “两个 in-memory 池 = 两个不同的数据库”。
    /// 所以 “`team_manager` 写的行能被 `library_store.pool()` 读到” 只在共用池时成立。
    /// 末尾的**反证**（另起一个 in-memory 库读不到这一行）证明本断言有判别力 ——
    /// 没有它，一个 “团队域自建库” 的实现也可能让前半段变绿。
    #[test]
    fn team_manager_shares_the_library_pool() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        state
            .team_manager
            .create_team(fixture_team(TEAM))
            .expect("create_team");

        // 走 **library 自己的池** 读同一张表（不用 team_manager 的访问器）。
        let conn = state.library_store.pool().get().expect("library pool conn");
        let name: String = conn
            .query_row("SELECT name FROM team WHERE id = ?1", [TEAM], |row| {
                row.get(0)
            })
            .expect("team_manager 写入的行必须能被 library_store 的池读到（同一个池）");
        assert_eq!(name, fixture_team(TEAM).name);

        // 反证：另一个 in-memory 库（= 另一个池）看不见这一行。
        let other = crate::library::LibraryStore::open_in_memory().expect("second store");
        let other_conn = other.pool().get().expect("second pool conn");
        let found = other_conn.query_row("SELECT name FROM team WHERE id = ?1", [TEAM], |row| {
            row.get::<_, String>(0)
        });
        assert!(
            found.is_err(),
            "独立的 in-memory 池必须看不见这个团队 —— 否则本用例没有判别力"
        );
    }
}
