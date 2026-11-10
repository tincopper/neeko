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

    // 侧栏列表恢复：只把持久化行回填成 `Stopped` 条目 —— **不**建 tab、**不**起进程，
    // 进程恢复发生在用户点击那一行之后（`useActivateSession`）。不 emit：前端尚未挂载，
    // `useLiveSessionsBridge` 挂载即拉快照。失败只降级为「空列表」（注册表仍是本次运行的事实）。
    crate::live_sessions::boot::restore(&state.live_sessions);
    // 附属资源 GC 归组合根：`restore()` 是纯回填，磁盘清理在这里显式做一次。
    // 崩溃 / 强杀会留下没有 cursor 行的日志，按本次恢复出的活跃 id 集合收敛。
    state
        .terminal_history
        .prune(&state.live_sessions.live_ids());

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
    //
    // 消费者表在本层装配（不是 agent 域里硬编码引用）：通知域 + live-sessions 注册表。
    // 新增消费者 = 在自己的域里写投影 + 在这里加一行 —— ingest 层不知道谁在消费。
    let hook_sinks = vec![
        crate::agent::hooks::ingest::dispatch::notification_sink(),
        crate::live_sessions::wiring::hooks::sink(),
    ];
    let http_handle = crate::agent::hooks::boot::boot(
        app.handle().clone(),
        state.storage_manager.get_config_dir().to_path_buf(),
        state.notification.settings_snapshot().cli_hooks,
        config.as_ref().unwrap_or(&serde_json::Value::Null),
        state.runtime.clone(),
        hook_sinks,
    );
    if let Some(handle) = http_handle {
        state.set_http_server(handle);
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
