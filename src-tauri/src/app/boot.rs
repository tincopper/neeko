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
    // 消费者表在本层装配（不是 agent 域里硬编码引用）：通知域 + live-sessions 注册表 +
    // 团队观察者。新增消费者 = 在自己的域里写投影 + 在这里加一行 —— ingest 层不知道谁在消费。
    //
    // 团队观察者是这条广播的第三个 sink，**不是**一个单独的注入槽：`deliver::observe` 的签名
    // `(&AppHandle, &str, &HookEvent)` 与 `HookSink` 天然对齐，函数指针直接进表即可。
    // 三条 sink 由 `via_blocking_pool` 在**同一次**阻塞任务里按序投递（红线 3）。
    // 排最后 = 通知与 live-sessions 的既有投递顺序不变。
    let hook_sinks = vec![
        crate::agent::hooks::ingest::dispatch::notification_sink(),
        crate::live_sessions::wiring::hooks::sink(),
        std::sync::Arc::new(crate::agent::team::deliver::observe),
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

    // 团队域的前端事件端口（失效脉冲）：**在端点 boot 之前**绑定。
    //
    // 顺序不是风格问题：端点一起，成员进程就可能开始写团队状态，而写路径靠 `WriteGuard::drop`
    // 里的端口发脉冲 —— 晚绑定一次，那段时间内的变化就永远不会被面板看到（面板没有别的
    // 自愈机制，只有「下一次写」）。晚绑定本身存在的理由是 hydrate：启动期从库重建内存镜像时
    // 还没有窗口在听，那一刻的写不该发事件（见 `TeamManager::set_notifier` 的文档）。
    state
        .team_manager
        .set_notifier(Arc::new(super::team_notifier::TauriTeamNotifier::new(
            app.handle().clone(),
        )));

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

    // 租约回收器：**时间推移本身就是输入**（AC3）。与端点分开启动 —— 端点可能起不来，
    // 而租约与 MCP 面无关：成员进程死了，任务该回收就回收。
    // 不依赖端点还有第二个理由：`team_wait` 的阻塞发生在 MCP 工具调用里，而它等的那个
    // 「成员死了」信号正是由这里产生的（惰性 sweep 在没人调命令时永远不会触发）。
    let reaper = crate::agent::team::TeamReaper::start(
        state.runtime.clone(),
        state.team_manager.clone(),
        crate::agent::team::REAP_INTERVAL,
    );
    state.set_team_reaper(reaper);
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

#[cfg(test)]
mod tests {
    use crate::common::testing::{enclosed_body, strip_line_comments};

    /// **接线判据**：团队观察者是 hook 端点的**第三个 sink**。
    ///
    /// # 为什么只能读源码
    ///
    /// 这条边就是「谁接到谁」本身。把它换成 no-op 之后，两端的行为测试**全绿**：
    /// hooks 侧证明「sink 被调用」（它注入自己的闭包）、团队侧证明「喂一条事件就
    /// 推进成员」（它直接调 `observe_in`）—— 各自的接缝都写着 observe，唯独**组合根**
    /// 那几行没人看。2026-11-03 的独立审计正是这样做的：把闭包体换成 `{}`，
    /// 2761 条测试一条不红。
    ///
    /// 所以判据落在两处，缺一不可：
    ///
    /// 1. `hook_sinks` 表里出现 `crate::agent::team::deliver::observe`
    ///    （空壳、别的 `observe`、被注释掉的调用都过不去 —— 注释先被剥掉）；
    /// 2. 同一个值出现在 `hooks::boot::boot(…)` 的**实参表**里 —— 表写得再对，
    ///    没交给端点等于没接。
    ///
    /// `concat!` 是必需的：`include_str!` 会把本用例自己也读进来，裸字面量会匹配到断言本身。
    #[test]
    fn the_team_observer_is_a_hook_sink() {
        let source = strip_line_comments(include_str!("boot.rs"));

        // ① 消费者表必须真的包含团队投递入口（函数指针与 `HookSink` 签名天然对齐）。
        let anchor = concat!("let hook_", "sinks = vec![");
        let at = source
            .find(anchor)
            .unwrap_or_else(|| panic!("boot.rs 里找不到 `{anchor}`：消费者表没了"));
        let open = at
            + source[at..]
                .find('[')
                .unwrap_or_else(|| panic!("`{anchor}` 后面没有表字面量"));
        let table = enclosed_body(&source, open);
        let call = concat!("crate::agent::team::deliver::", "observe");
        assert!(
            table.contains(call),
            "`{anchor}` 里没有 `{call}` —— 团队观察者没被挂上去：成员状态只会停在 \
             `spawned`，`team_wait` 只能超时，而两端的行为测试仍然全绿（这正是本判据存在的理由）"
        );

        // ② 同一张表必须被交给 hooks 端点。
        let boot = concat!("crate::agent::hooks::boot::", "boot(");
        let boot_at = source
            .find(boot)
            .unwrap_or_else(|| panic!("boot.rs 里找不到 `{boot}`：hooks 端点入口没了"));
        let args_open = boot_at + source[boot_at..].find('(').expect("`{boot}` 后面是实参表");
        let args = enclosed_body(&source, args_open);
        assert!(
            args.contains("hook_sinks"),
            "`{boot}` 的实参表里没有 `hook_sinks` —— 团队观察者没接到 hook 端点（表本身\
             写得对也没用：没有任何一条上报会走到它）"
        );
    }

    /// **端到端骨架（`#[ignore]`）**：从 `/hook/{source}` 的 HTTP 入口发一条
    /// `turn_completed`，断言成员从 `Spawned` 走到 `Idle`。
    ///
    /// # 为什么 `cargo test` 里跑不了
    ///
    /// 入口是 `handlers::route_group(app: AppHandle, …)`，第一个实参是**真实** `AppHandle`；
    /// 本仓 `tauri` 未开 `test` feature（全仓无 `tauri::test` 先例），单测/集成测试都造不出
    /// `AppHandle`。可达的那一段（模板形状的 envelope → `validation::validate` → 团队观察者
    /// → 成员 `Idle`）已由 `agent::team::deliver::tests::a_template_shaped_envelope_advances_the_member`
    /// 真跑；不可达的那一跳（`AppHandle` → `try_state` → `observe_in`，共三行）由上面那条
    /// 源码级判据盯着。
    ///
    /// 骨架保留的目的：等 `tauri::test` / e2e harness 可用时，把 `panic!` 换成下面四步即可 ——
    /// 判据内容已经写在 panic 消息里（不接受「先写个空壳再补」：空体会静默通过，那正是要防的）。
    #[test]
    #[ignore = "需要真实 `tauri::AppHandle`（本仓未开 tauri 的 `test` feature）；请在 e2e harness 里启用"]
    fn the_hook_endpoint_advances_a_member_through_the_team_observer() {
        // `todo!` / `unimplemented!` 在本 crate 是 deny（`clippy::todo`）：骨架用 `panic!`
        // 表达「跑起来就必须失败」，语义同样是「绝不由空体冒充通过」。
        panic!(
            "e2e 骨架：① `isolated_state(&tmp)` + `create_team` / `add_member`（成员初始 Spawned）\
             ② 用 boot.rs 的同一段接线构造 ExtraConsumer（`app.handle()` 换成 harness 给的真实 \
             AppHandle）③ `handlers::route_group(handle, runtime, team_consumer)` 起真端点，POST \
             `{{\"agent_session_id\":\"agent-1\",\"event\":\"turn_completed\",\
             \"hints\":{{\"team_id\":…,\"team_member_id\":…}}}}`（不写 `seq`：模板不发它）④ 断言 \
             `state.team_manager.member(W1).state == MemberState::Idle`"
        )
    }
}
