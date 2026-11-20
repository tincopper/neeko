//! Auto-install language servers in a project [`ExecTarget`].

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;

use crate::common::executor::factory::ExecTarget;
use crate::lsp::plugin::types::InstallOp;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::process::run_command_streaming;
use crate::lsp::spawn_spec::LspExecContext;
use crate::lsp::types::LSP_INSTALL_PROGRESS_EVENT;

/// 安装去重键：`(language_id, 执行目标判别式)`。
///
/// 判别式只区分**种类**（Local / WSL / SSH），不含主机与凭据：安装是幂等的，
/// 同类型目标视为同一次安装即可；把完整连接放进键会把「同一台机器换个跳板」判成两次，
/// 而凭据不应该进键、也不应该进日志。
type InstallKey = (String, std::mem::Discriminant<ExecTarget>);

/// Track in-progress installs: 同语言 + 同类型目标才视为同一次安装。
static INSTALL_IN_PROGRESS: LazyLock<Mutex<HashSet<InstallKey>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// 同键安装冲突时的轮询间隔（等待者在**阻塞线程**里睡，低频即可）。
const INSTALL_WAIT_POLL: Duration = Duration::from_millis(50);

/// 等待同键安装收口的上限。
///
/// 取值理由：安装是网络动作（jdtls 整包 ~100MB 下载 + 解压、rustup 组件下载），慢链路
/// 实测可达数分钟 ⇒ 上限必须明显大于「合理的安装时长」，否则等待者会把「前台仍在装」
/// 误报成失败；10 分钟又不至于无界（无界等待会把该语言的所有会话装配卡死）。
/// 真实挂死由安装命令自己的超时矩阵兜底，不由这个上限负责。
const INSTALL_WAIT_TIMEOUT: Duration = Duration::from_secs(600);

/// 去重键 =（语言，执行目标种类）。
#[must_use]
fn install_key(language_id: &str, target: &ExecTarget) -> InstallKey {
    (language_id.to_string(), std::mem::discriminant(target))
}

/// 抢占该键的安装权；已被占用则**有界等待**，而不是直接失败。
///
/// 为什么不是直接 `Err`：调用点把这个 `Err` 包装成「请手动安装」，而同键并发只是
/// 两个项目掰同一份产物 —— 用户意图是「装上就好」。等待结束后调用方照常跑安装
/// 路径（此时判据大概率为真，快速返回 true）。
///
/// 阻塞语义：`thread::sleep` 轮询，调用点已在会话装配的 blocking 任务里（红线 3）。
fn claim_install_slot(key: &InstallKey) -> Result<(), String> {
    let started = Instant::now();
    loop {
        {
            let mut in_progress = INSTALL_IN_PROGRESS.lock().map_err(|e| {
                log::warn!("[LSP] Install lock poisoned: {}", e);
                e.to_string()
            })?;
            // check-then-insert 必须在**同一**临界区：「先判后插」会让两个调用者
            // 同时认为自己拿到了安装权。`HashSet::insert` 的返回值就是这个原子判据。
            if in_progress.insert(key.clone()) {
                return Ok(());
            }
        }
        if started.elapsed() >= INSTALL_WAIT_TIMEOUT {
            return Err(format!(
                "Timed out after {}s waiting for a concurrent install of {}",
                INSTALL_WAIT_TIMEOUT.as_secs(),
                key.0
            ));
        }
        std::thread::sleep(INSTALL_WAIT_POLL);
    }
}

/// 交还该键的安装权（无论安装成败都必须交还，否则同键后续调用会白等到上限）。
fn release_install_slot(key: &InstallKey) {
    let mut in_progress = match INSTALL_IN_PROGRESS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("[LSP] Install lock poisoned on release: {}", poisoned);
            poisoned.into_inner()
        }
    };
    in_progress.remove(key);
}

#[derive(Debug, Clone, Serialize)]
struct LspInstallProgress {
    language_id: String,
    phase: String,
    message: String,
    /// 累计安装日志（stdout/stderr 行），前端可实时查看。
    log: String,
}

fn emit_progress(
    app_handle: &tauri::AppHandle,
    language_id: &str,
    phase: &str,
    message: &str,
    log: &str,
) {
    let payload = LspInstallProgress {
        language_id: language_id.to_string(),
        phase: phase.to_string(),
        message: message.to_string(),
        log: log.to_string(),
    };
    if let Err(e) = app_handle.emit(LSP_INSTALL_PROGRESS_EVENT, payload) {
        log::error!("[LSP] Failed to emit install progress: {}", e);
    }
}

/// 安装日志尾部保留上限（字节）。进度事件只携带尾部窗口：安装输出可能上万行，
/// 全量随每次事件传递会 O(n²) 拷贝并触碰单次 IPC 2MB 红线。
const INSTALL_LOG_TAIL_LIMIT: usize = 64 * 1024;

/// 进度事件节流间隔：`[stage]` 之外的工具输出可能逐行刷屏，逐行 emit 会灌爆 IPC。
const INSTALL_LOG_THROTTLE: Duration = Duration::from_millis(200);

/// 安装日志累加器：有界尾部缓冲 + 发射节流。作为安装日志的唯一来源，
/// `run_command_streaming` 不再自建第二份副本。
#[derive(Default)]
struct InstallLog {
    tail: String,
    last_emit: Option<Instant>,
}

impl InstallLog {
    /// 追加一行，并把缓冲裁剪到尾部窗口（切点回退到 UTF-8 字符边界）。
    fn push(&mut self, line: &str) {
        self.tail.push_str(line);
        self.tail.push('\n');
        if self.tail.len() > INSTALL_LOG_TAIL_LIMIT {
            let mut start = self.tail.len() - INSTALL_LOG_TAIL_LIMIT;
            while start < self.tail.len() && !self.tail.is_char_boundary(start) {
                start += 1;
            }
            self.tail.drain(..start);
        }
    }

    /// 是否到达下一次发射窗口（首行立即放行，其后按 [`INSTALL_LOG_THROTTLE`] 节流）。
    fn should_emit(&mut self) -> bool {
        let now = Instant::now();
        match self.last_emit {
            Some(prev) if now.duration_since(prev) < INSTALL_LOG_THROTTLE => false,
            _ => {
                self.last_emit = Some(now);
                true
            }
        }
    }

    fn snapshot(&self) -> &str {
        &self.tail
    }
}

/// Whether `binary` exists in the project execution environment.
#[must_use]
pub fn check_binary_installed(binary: &str, target: &ExecTarget) -> bool {
    check_binary_installed_with(binary, target, |name| {
        crate::core::exec::command_exists_blocking(target, name)
    })
}

/// 判据的**可注入内核**：`probe(name)` 回答「目标环境里 `name` 能否解析」。
///
/// 为什么把探测降成参数：真实探测在 WSL / SSH 上要起一次 exec（无法也无需在单测里
/// 复现），而本次修复的关键行为恰恰是**两次探测的结果序列**（PATH 未命中 → 绝对路径
/// 命中）。探测作为参数后，「判据与产物同环境」可以被直接断言而不起远端。
#[must_use]
fn check_binary_installed_with(
    binary: &str,
    target: &ExecTarget,
    probe: impl Fn(&str) -> bool,
) -> bool {
    let found = probe(binary);
    log::info!(
        "[LSP][installer] check binary={} target={:?} found={}",
        binary,
        std::mem::discriminant(target),
        found,
    );
    if found {
        return true;
    }
    // 下载式安装（jdtls 官方发行版包装脚本）把产物写在**目标环境**的 `$HOME/.neeko/bin`，
    // 而远端 PATH 通常不含该目录 —— 只看 PATH 会把「已装」判成「未装」，每轮会话创建
    // 重下 ~100MB。按绝对安装路径再判一次：`command_exists_blocking` 在 WSL/SSH 上本来就是
    // `command -v <name>` 的脚本形态，`$HOME` 由**目标 shell**展开。
    //
    // Local 不需要（`platform::host_path::prepend_neeko_bin` 已把该目录置顶到进程 PATH），
    // 且本地探测不展开 `$HOME`（会得到一个恒为假的字面量路径）。
    // 注：这是对**执行目标数据**的判断（非平台 `#[cfg]`），所以留在 installer。
    if matches!(target, ExecTarget::Local) {
        return false;
    }
    let absolute = format!("$HOME/.neeko/bin/{binary}");
    let probed = probe(&absolute);
    log::info!("[LSP][installer] absolute-path probe {absolute} on target: {probed}");
    probed
}

/// Check whether the plugin's language server binary exists on `target`.
#[must_use]
pub fn check_plugin_installed(plugin: &LspPlugin, target: &ExecTarget) -> bool {
    if plugin.server_binary.is_empty() {
        return false;
    }
    check_binary_installed(&plugin.server_binary, target)
}

/// Try to auto-install the plugin's server **in the project's environment**.
///
/// 执行走 [`LspExecContext`]（cwd / env 与探测、启动同源 —— 安装同样属于
/// 「在项目环境里执行」：如 `rustup component add` 会按项目 `rust-toolchain.toml`
/// 选择 toolchain）。
///
/// Returns `Ok(true)` if install ran successfully, `Ok(false)` if the plugin
/// has no install recipe, `Err` on failure.
pub(crate) fn install_plugin_server(
    plugin: &LspPlugin,
    app_handle: &tauri::AppHandle,
    ctx: &LspExecContext,
) -> Result<bool, String> {
    let language_id = plugin.language_id.as_str();
    // 去重键含**执行目标**：同语言不同环境各自独立；同键则等待（不能硬失败 ——
    // 那个错误会被上层包装成「请手动安装」，但用户意图只是「装上就好」）。
    let key = install_key(language_id, &ctx.target);
    claim_install_slot(&key)?;

    let result = install_plugin_server_impl(plugin, app_handle, ctx);

    release_install_slot(&key);

    result
}

/// 失败消息里的「修法」提示：由插件 `install` 数据派生（数据驱动，**不按语言
/// 分支**，红线 15）。无安装配方 → `None`（不编造建议）。
#[must_use]
pub(crate) fn install_hint(plugin: &LspPlugin) -> Option<String> {
    let install = plugin.install.as_ref()?;
    let mut methods: Vec<&'static str> = vec![install.primary.describe()];
    methods.extend(install.fallbacks.iter().map(|op| op.describe()));
    let tools = methods
        .iter()
        .map(|tool| format!("`{tool}`"))
        .collect::<Vec<_>>()
        .join(" / ");
    Some(format!(
        " | install via {tools} (needs: {})",
        install.prerequisite
    ))
}

fn install_plugin_server_impl(
    plugin: &LspPlugin,
    app_handle: &tauri::AppHandle,
    ctx: &LspExecContext,
) -> Result<bool, String> {
    let language_id = plugin.language_id.as_str();
    let bin = plugin.server_binary.as_str();
    if bin.is_empty() {
        return Ok(false);
    }

    let Some(install) = plugin.install.as_ref() else {
        return Ok(false);
    };

    // 依次尝试 [primary, fallback…]：操作不可用（工具不可解析，如 fnm/nvm 管理的
    // npm 不在 GUI 默认 PATH）或安装失败时，走到下一个。全部失败才报错（含各步原因）。
    let mut methods: Vec<InstallOp> = vec![install.primary];
    methods.extend_from_slice(install.fallbacks);

    let mut reasons: Vec<String> = Vec::new();
    let mut remaining: &[InstallOp] = &methods;
    while !remaining.is_empty() {
        // 下一个可用（探测目标可解析）的安装操作；之前的不可用操作记录原因后跳过。
        let Some(idx) = first_available_method(remaining, &|op| {
            check_binary_installed(op.probe_tool(), &ctx.target)
        }) else {
            for op in remaining {
                reasons.push(format!(
                    "`{}` not found in the project environment",
                    op.describe()
                ));
            }
            break;
        };
        for op in &remaining[..idx] {
            reasons.push(format!(
                "`{}` not found in the project environment",
                op.describe()
            ));
        }
        let op = remaining[idx];
        remaining = &remaining[idx + 1..];
        // 展开为 (program, args)：Exec → `tool args…`；Script → `sh -c body`。
        let (program, args) = op.command();
        let method = op.describe();
        // 流式执行：日志行 → 有界尾部缓冲（节流 emit），message=当前 stage。
        let log = Arc::new(parking_lot::Mutex::new(InstallLog::default()));
        let on_line = {
            let app_handle = app_handle.clone();
            let language_id = language_id.to_string();
            let bin = bin.to_string();
            let method = method.to_string();
            let log = Arc::clone(&log);
            move |line: &str| {
                let mut log = log.lock();
                log.push(line);
                if !log.should_emit() {
                    return;
                }
                let message = match ProgressHint::parse(line) {
                    ProgressHint::Stage(stage) => format!("Installing {bin}: {stage}"),
                    ProgressHint::Output => format!("Installing {bin} (via {method})..."),
                };
                emit_progress(
                    &app_handle,
                    &language_id,
                    "installing",
                    &message,
                    log.snapshot(),
                );
            }
        };
        let code = run_command_streaming(ctx, program, &args, on_line)
            .map_err(|e| format!("Install command failed: {}", e))?;
        let log = log.lock().snapshot().to_string();
        if code == 0 {
            emit_progress(
                app_handle,
                language_id,
                "done",
                &format!("{} installed", bin),
                &log,
            );
            return Ok(true);
        }
        let tail = log.trim();
        reasons.push(format!(
            "`{method}` failed (exit {code}): {}",
            if tail.is_empty() { "no output" } else { tail }
        ));
        log::warn!("[LSP] install method {method} failed for {language_id}, trying fallback");
    }

    let detail = if reasons.is_empty() {
        "no install method available".to_string()
    } else {
        reasons.join("; ")
    };
    emit_progress(
        app_handle,
        language_id,
        "error",
        &format!("Install failed: {detail}"),
        &detail,
    );
    Err(format!("Install failed with code 1: {detail}"))
}

/// 顺序选择第一个可用的安装操作；`available(op)` 注入探测（由调用方取
/// [`InstallOp::probe_tool`]）。全不可用 → None。
fn first_available_method(
    methods: &[InstallOp],
    available: &impl Fn(InstallOp) -> bool,
) -> Option<usize> {
    methods.iter().position(|op| available(*op))
}

/// 安装输出行 → 结构化进度提示。
///
/// **协议唯一事实源**：安装脚本以 `[stage] <描述>` 上报阶段（见平台层的 jdtls
/// 下载脚本），其余行按普通输出处理。Rust 侧只在此处解释该前缀，不再散落
/// `strip_prefix` 魔法串。
enum ProgressHint {
    /// 阶段标记：进度 message 展示描述。
    Stage(String),
    /// 普通输出：只进日志。
    Output,
}

impl ProgressHint {
    /// 脚本阶段标记行前缀（脚本侧与解析侧共用的唯一事实源）。
    const STAGE_PREFIX: &'static str = "[stage]";

    /// 解析一行输出。
    fn parse(line: &str) -> Self {
        match line.trim_start().strip_prefix(Self::STAGE_PREFIX) {
            Some(rest) if !rest.trim().is_empty() => Self::Stage(rest.trim().to_string()),
            _ => Self::Output,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 远端目标（不真起 WSL/SSH）：探测由注入的闭包回答，执行目标只用来走
    /// 「非 Local ⇒ 允许绝对路径兜底」那条判据。
    fn remote_target() -> ExecTarget {
        ExecTarget::Remote {
            host: "build.invalid".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
        }
    }

    /// R1/AC1：PATH 未命中时按**目标环境的绝对安装路径**再判一次。
    ///
    /// 事故形态：jdtls 下载式安装把包装脚本写在**目标环境**的 `$HOME/.neeko/bin`，
    /// 而判据只看目标 PATH（Local 有 `prepend_neeko_bin` 置顶，WSL/SSH 没有）⇒
    /// 每次会话创建都判「未安装」、重下 ~100MB。
    ///
    /// 断言的是**两次探测的结果序列**（第一次 false、第二次 true），不真起远端。
    #[test]
    fn absolute_install_path_is_accepted_when_path_misses() {
        let probes = std::cell::RefCell::new(Vec::<String>::new());
        let found = check_binary_installed_with("jdtls", &remote_target(), |name| {
            probes.borrow_mut().push(name.to_string());
            // 只认绝对路径：目标 PATH 里没有 jdtls（正是文档记录的现场）。
            name.starts_with("$HOME/.neeko/bin/")
        });
        assert!(found, "PATH 未命中但 ~/.neeko/bin 命中 ⇒ 必须判为已安装");
        assert_eq!(
            probes.borrow().as_slice(),
            ["jdtls".to_string(), "$HOME/.neeko/bin/jdtls".to_string()],
            "探测顺序必须是：先 PATH 名，再目标环境的绝对安装路径"
        );
    }

    /// 两处都没有 ⇒ false（否则「装一次」的门永远关着，会话装配会假装可用）。
    #[test]
    fn absolute_probe_still_false_when_both_miss() {
        let probe_count = std::cell::Cell::new(0_u32);
        let found = check_binary_installed_with("jdtls", &remote_target(), |_| {
            probe_count.set(probe_count.get() + 1);
            false
        });
        assert!(!found, "两处都未命中必须判为未安装");
        assert_eq!(
            probe_count.get(),
            2,
            "非 Local 目标必须探两次（PATH + 绝对路径）后才判 false"
        );
    }

    /// Local 不走绝对路径兜底：`prepend_neeko_bin` 已把 `~/.neeko/bin` 置顶到进程
    /// PATH，而本地分支**不展开** `$HOME`（会探测一个字面量路径，恒为假）——
    /// 多这一次探测只会白费一次 fs 解析，且会把「本地没装」判成「本地装了」。
    #[test]
    fn local_target_skips_absolute_probe() {
        let probes = std::cell::RefCell::new(Vec::<String>::new());
        let found = check_binary_installed_with("jdtls", &ExecTarget::Local, |name| {
            probes.borrow_mut().push(name.to_string());
            name != "jdtls"
        });
        assert!(
            !found,
            "Local PATH 未命中不得回退绝对路径（本地不展开 $HOME）"
        );
        assert_eq!(
            probes.borrow().as_slice(),
            ["jdtls".to_string()],
            "Local 只探测一次 PATH 名"
        );
    }

    /// R2/AC2：去重键必须含**执行目标**。
    ///
    /// 事故形态：`INSTALL_IN_PROGRESS` 只按 `language_id` 去重 ⇒ 两个项目并发同语言
    /// 时后者直接失败（跳过的其实是不同环境的一次安装）。
    #[test]
    fn install_key_separates_targets() {
        let local = install_key("java", &ExecTarget::Local);
        let wsl = install_key(
            "java",
            &ExecTarget::Wsl {
                distro: "Ubuntu-22.04".to_string(),
            },
        );
        assert_ne!(
            local, wsl,
            "同语言不同执行目标必须各自独立（共键会让另一个环境白白等待）"
        );
        assert_eq!(
            local,
            install_key("java", &ExecTarget::Local),
            "同语言同类型目标必须同键（这才是真正的重复安装）"
        );
        assert_ne!(
            local,
            install_key("rust", &ExecTarget::Local),
            "不同语言必须不同键"
        );
    }

    /// R2/AC2：同键第二次调用**等待**第一次收口，而不是返回
    /// 直接返回错误（旧行为把「正在装」当失败上报，上层再包装成「请手动安装」）。
    #[test]
    fn concurrent_same_key_install_waits_instead_of_failing() {
        // 用专属 language_id，避免与其它用例共用静态表里的键而互相干扰。
        let key = install_key("wait-test", &ExecTarget::Local);
        claim_install_slot(&key).expect("首次抢占必须成功");

        let (tx, rx) = std::sync::mpsc::channel();
        let waiter_key = key.clone();
        let waiter = std::thread::spawn(move || {
            let claimed = claim_install_slot(&waiter_key).is_ok();
            // 模拟「前一次已装完」：先放报结果，再交还占位。
            let _ = tx.send(claimed);
            release_install_slot(&waiter_key);
        });

        // 占位未释放前：等待者必须仍在等待（不得变成一个错误返回值）。
        assert!(
            rx.recv_timeout(Duration::from_millis(250)).is_err(),
            "占位未释放时第二次调用必须等待，而不是立就返回"
        );

        release_install_slot(&key);
        assert!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap_or(false),
            "占位释放后等待者必须拿到安装权（不得把「正在装」当失败返回）"
        );
        waiter.join().expect("waiter thread 必须正常结束");
    }

    /// 顺序选择第一个可用操作；全不可用返回 None。`InstallOp` 的探测目标是其
    /// `probe_tool()`（Script 形态为 `sh`，不再靠 argv[0] 猜）。
    #[test]
    fn picks_first_available_method_in_order() {
        let methods: &[InstallOp] = &[
            InstallOp::exec("npm", &["install", "-g", "x"]),
            InstallOp::exec("brew", &["install", "x"]),
            InstallOp::script("echo hi"),
        ];
        // npm 不可用（fnm 管理的 npm 不在 GUI PATH）→ 跳到 brew
        let available = |op: InstallOp| op.probe_tool() != "npm";
        assert_eq!(
            first_available_method(methods, &available),
            Some(1),
            "npm 不可用时应回退到 brew"
        );
        // 全部可解析 → 首选
        assert_eq!(first_available_method(methods, &|_| true), Some(0));
        // 全部不可用 → None
        assert_eq!(first_available_method(methods, &|_| false), None);
        // Script 形态的探测目标是 sh（而非把它当成「名为 sh 的安装工具」）
        assert_eq!(methods[2].probe_tool(), "sh");
    }

    /// AC5 的「修法」提示：由插件 install 数据派生（数据驱动，不按语言分支）。
    #[test]
    fn install_hint_derives_from_plugin_data() {
        let registry = crate::lsp::plugin::LspPluginRegistry::with_defaults();
        let rust = registry
            .resolve_by_language("rust")
            .expect("rust plugin exists");
        let hint = install_hint(rust).expect("rust 插件有安装配方");
        assert!(hint.contains("`rustup`"), "提示必须点名安装工具: {hint}");
        assert!(hint.contains("needs:"), "提示必须带前置条件说明: {hint}");
    }

    /// 无安装配方 → 不编造建议。
    #[test]
    fn install_hint_is_none_without_recipe() {
        let plugin = LspPlugin::builtin(
            "no-install",
            &["ni"],
            "no-install-bin",
            &["no-install-bin"],
            None,
        );
        assert_eq!(install_hint(&plugin), None);
    }

    #[test]
    fn extracts_stage_markers_from_progress_hint() {
        match ProgressHint::parse("[stage] 下载 jdtls 1.61.0") {
            ProgressHint::Stage(s) => assert_eq!(s, "下载 jdtls 1.61.0"),
            ProgressHint::Output => panic!("应识别为 stage"),
        }
        match ProgressHint::parse("  [stage] 解压") {
            ProgressHint::Stage(s) => assert_eq!(s, "解压"),
            ProgressHint::Output => panic!("应识别为 stage"),
        }
    }

    /// 非 stage 行（含空前缀/纯工具输出）一律按普通输出处理，只进日志。
    #[test]
    fn non_stage_lines_are_plain_output() {
        for line in ["[stage]", "100% |##########| 42MB", "Downloading 100%", ""] {
            assert!(
                matches!(ProgressHint::parse(line), ProgressHint::Output),
                "{line:?} 应为普通输出"
            );
        }
    }

    /// 日志只保留尾部窗口：连续写入远超上限后总长不超上限（不再 O(n²) 增长）。
    #[test]
    fn install_log_keeps_bounded_tail() {
        let mut log = InstallLog::default();
        let line = "x".repeat(1024);
        for _ in 0..100 {
            log.push(&line);
        }
        assert!(
            log.snapshot().len() <= INSTALL_LOG_TAIL_LIMIT,
            "尾部缓冲必须被裁剪到上限内"
        );
        assert!(log.snapshot().ends_with("xxx\n"), "保留的是最新输出");
    }

    /// 截断切点回退到 UTF-8 字符边界：多字节行不得 panic / 撕裂字符。
    #[test]
    fn install_log_truncation_respects_char_boundary() {
        let mut log = InstallLog::default();
        let line = "é".repeat(600); // 1200 bytes / 行
        for _ in 0..80 {
            log.push(&line);
        }
        assert!(!log.snapshot().is_empty());
        assert!(log.snapshot().len() <= INSTALL_LOG_TAIL_LIMIT);
    }

    /// 节流：首行立即放行，节流窗口内的紧邻行被抑制（不逐行 emit）。
    #[test]
    fn install_log_throttles_burst_emits() {
        let mut log = InstallLog::default();
        assert!(log.should_emit(), "首行必须立即放行");
        log.last_emit = Some(Instant::now());
        assert!(!log.should_emit(), "节流窗口内的紧邻行必须被抑制");
    }
}
