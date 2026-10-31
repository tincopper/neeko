//! 应用组合根：启动序列（进程前置 → 状态组装 → 各域引导 → Builder 接线）。
//!
//! 本模块只做**组装与顺序**，不持有规则 —— 规则的落点见 [`super`] 的归属表。
//! 新增一个启动步骤的扩展点：在对应领域加一个 `boot.rs` 函数（自带单测），
//! 然后在 [`on_setup`] 里按顺序加一行调用；本模块不因新域而长出第二套机制。

use std::sync::Arc;

use tauri::Manager;

use crate::app_state::AppStateWrapper;
use crate::library::{self, LibraryStore};
use crate::platform::close_tab::CloseTabFlag;

/// 运行 Tauri 应用。
#[allow(clippy::expect_used)] // 事件循环启动失败 = 无法继续（终端用户可见的最后一道 expect）
pub fn run() {
    let library_store = init_prerequisites();

    // 「关闭标签页」判别标志：菜单处理器置位、窗口关闭路径消费（平台差异在
    // `platform/close_tab` 内，本文件零 `#[cfg]`）。
    let close_tab = Arc::new(CloseTabFlag::new());
    let menu_close_tab = Arc::clone(&close_tab);
    let window_close_tab = Arc::clone(&close_tab);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .register_uri_scheme_protocol("neeko", crate::browser::uri_scheme::create_handler())
        .manage(Arc::clone(&library_store))
        .manage(AppStateWrapper::new_with_library_store(library_store))
        .setup(|app| {
            on_setup(app);
            Ok(())
        })
        .menu(crate::app_menu::build_menu)
        .on_menu_event(move |app, event| {
            crate::app_menu::handle_menu_event(app, event.id().0.as_str(), &menu_close_tab);
        })
        .on_window_event(move |window, event| {
            // 焦点态是通知抑制判定的输入（R2.1）：组合根在此一行转发给应用级通知中心，
            // 关闭协议本身（close.rs）不承载业务事实。
            if let tauri::WindowEvent::Focused(focused) = event {
                window
                    .state::<AppStateWrapper>()
                    .notification
                    .focus_tracker()
                    .set(*focused);
            }
            super::close::on_window_event(window, event, &window_close_tab);
        })
        .invoke_handler(crate::neeko_invoke_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 进程前置：日志、宿主 PATH、目录产物、library 库。
///
/// 失败策略分两档，**保持既有行为**：
/// - **fatal**（`expect`）：library 库是硬依赖，打不开就没有可用的应用；
/// - **best-effort**：目录 / 主题 / 会话产物缺失只降级不影响核心可用性。
#[allow(clippy::expect_used)] // library 库打开失败 = 无法继续
fn init_prerequisites() -> Arc<LibraryStore> {
    crate::common::logger::init_logger();
    log::info!("Neeko starting");

    // Resolve host user PATH once (login+interactive shell) so Local executor /
    // LSP / agent detection match the interactive terminal environment.
    crate::core::exec_env::init_host_user_path();

    best_effort(
        "ensure skill central repo",
        crate::library::skill::central_repo::ensure_central_repo(),
    );
    best_effort(
        "install global theme files",
        crate::theme::service::install_all_global_themes(),
    );

    library::db::ensure_db_ready().expect("Failed to prepare library database");
    // One pool for neeko.db, created here and shared by every domain that
    // needs the file. A second pool would mean two owners for the same
    // handle and no bound on the connection count.
    let pool = crate::common::db::open_pool(&library::db::db_path(), 8)
        .expect("Failed to open database pool");
    Arc::new(library::LibraryStore::with_pool(pool).expect("Failed to create library store"))
}

/// `setup` 阶段：把持久化状态投影回内存，并注入运行时句柄。
///
/// 全部步骤 best-effort —— Tauri 的 `setup` 返回 `Err` 会**终止进程**，而每一项
/// 失败都只该让对应功能降级（空工作区 / 无自定义 agent / 无默认分组）。因此本函数
/// 不返回 `Result`：启动失败的「fatal 档」只有 [`init_prerequisites`] 里的硬依赖。
fn on_setup(app: &tauri::App) {
    let state = app.handle().state::<AppStateWrapper>();

    inject_main_window(app, &state);

    if let Some(active_id) =
        crate::session::boot::restore_workspace(&state.storage_manager, &state.project_manager)
    {
        match state.active_project_id.lock() {
            Ok(mut active) => *active = Some(active_id),
            Err(e) => log::warn!("[boot] active project slot lock poisoned: {e}"),
        }
    }

    // 配置**只读一次**：LSP 设置、agent 迁移与 CLI hook 覆盖表**三者共享同一份快照** ——
    // 两次读盘之间配置可能变化，会让同一次启动的不同域看到不同版本（`None` = 读盘失败，
    // 各消费方只降级自己那部分）。`as_mut` 借出而非移出，使快照在本函数尾部仍可用。
    let mut config = best_effort("load config", state.storage_manager.load_config());
    crate::lsp::boot::attach(&state.lsp_manager, app.handle().clone(), config.as_ref());

    if let Some(config) = config.as_mut() {
        let agents = crate::agent::boot::load_custom_agents(config, &state.agent_manager);
        if agents.migrated {
            best_effort(
                "persist migrated config",
                state.storage_manager.save_config(config),
            );
        }
    }

    crate::library::boot::ensure_default_tag_group(&state.library_store);

    // 通知域启动接线（与四域对称）：注册点击回流通道，一次、长期有效。
    // 必须早于任何投递 —— 否则冷启动时用户点「上次运行遗留」的通知中心条目无处回流。
    crate::notification::boot::attach(&app.handle().clone());

    // 外部 Agent CLI hook（源 B，design §2.5）：本域启动只暴露一个入口，与四域对称。
    // 旁路能力 —— 域内自记日志，失败只降级 CLI hook 通知，绝不阻断启动。
    //
    // 逐 CLI 覆盖表（`agentHookSources`）取自**上面那份快照**（agent 域自有键，不经核心域，
    // 见 agent/hooks/install/config/settings.rs）。读盘失败时传 `Null` = 「无覆盖项」→ 各 CLI 跟随主开关，
    // 与「成功但无该键」的退化行为一致；失败本身已由 `best_effort` 记 warn。
    // 组合根是本文件唯一的职责之一：**只有它同时认识 hooks 与 team 两个域**。
    // 团队观察者因此作为"下游消费者"注入 hooks，而不是让 hooks 反向依赖团队
    // （那条边会成环，见 `handlers::ExtraConsumer` 的文档）。
    //
    // 不是 `Option`：hooks 域只声明"再挂一个消费者"，是否挂、挂谁是组合根的决定 ——
    // 而这里**总会**挂一个（团队域的观察者）。可选性会造出一个永不执行的分支。
    let team_consumer: crate::agent::hooks::ingest::handlers::ExtraConsumer = {
        let handle = app.handle().clone();
        std::sync::Arc::new(
            move |source: &str, event: crate::agent::hooks::ingest::event::HookEvent| {
                crate::agent::team::deliver::observe(&handle, source, &event);
            },
        )
    };
    let http_handle = crate::agent::hooks::boot::boot(
        app.handle().clone(),
        state.storage_manager.get_config_dir().to_path_buf(),
        state.notification.settings_snapshot().cli_hooks,
        config.as_ref().unwrap_or(&serde_json::Value::Null),
        state.runtime.clone(),
        team_consumer,
    );
    if let Some(handle) = http_handle {
        state.set_http_server(handle);
    }

    // 团队 MCP 端点：与 hooks 分开的**独立 loopback listener**（design §3.1b —— 共用一个
    // 端口会让成员 token 能 `POST /hook/{source}` 伪造队友上报）。起不来只记日志：
    // 团队功能不可用，但 hooks 那条常开路径与整个应用不该跟着受影响。
    // 执行者：`team_spawn` 的决策层回 `MemberCreated` 之后，由它起 PTY（两相位的执行一半）。
    let executor: Arc<dyn crate::agent::team::MemberExecutor> = Arc::new(
        super::team_executor::PtyMemberExecutor::new(app.handle().clone()),
    );
    match crate::agent::team::boot_endpoint(&state.runtime, &state.team_manager, executor) {
        Ok(server) => {
            log::info!("[agent-team] mcp endpoint at {}", server.endpoint_url());
            state.set_team_server(server);
        }
        Err(err) => log::warn!("[agent-team] boot mcp endpoint failed: {err}"),
    }
}

/// 注入主窗口句柄：菜单/事件统一从 AppState 取，避免运行时查找依赖 Tauri 内部
/// `is_webview_window` 判定（浏览器子 webview 会使其失效）。
fn inject_main_window(app: &tauri::App, state: &AppStateWrapper) {
    if let Some(main_win) = app.get_webview_window("main") {
        state.set_main_window(main_win);
        return;
    }
    log::warn!(
        "[boot] main webview window not found at setup; close-tab menu events will fall back to runtime lookup"
    );
}

/// 启动期「尽力而为」步骤：失败只记 warning 并继续（返回 `None` 便于链式消费）。
fn best_effort<T, E: std::fmt::Display>(step: &str, result: Result<T, E>) -> Option<T> {
    match result {
        Ok(value) => Some(value),
        Err(e) => {
            log::warn!("[boot] {step} failed: {e}");
            None
        }
    }
}
