//! 下发给子进程的**会话身份**（唯一一行字面量 + 判定它为什么这样注入）。
//!
//! 与 `events.rs`（事件名常量）并列：跨栈 / 跨进程的字符串契约集中在本域的同级文件里，
//! `mod.rs` 保持纯声明（红线 9）。

/// 会话 id 的**环境变量名**（跨栈契约，改这里必须同步 `agent/hooks/templates/`）。
///
/// 注入点是 PTY 子进程的 env（本地 `CommandBuilder::env`）/ 同一条 shell 前缀里的
/// `export`（WSL / SSH）——每条会话一个独立子进程，**天然不共享槽位**；进程树内的后代
/// （agent CLI → hook shim）继承它，于是 hook 上报能精确归因到「哪个 PTY 会话」。
///
/// 禁止用 `std::env::set_var`：那是**本进程全局**的，多会话会互相覆盖，且会被拉起的
/// 所有子进程继承（`common/executor/env_defaults.rs` 已明文否决）。
///
/// 读取侧不在这里：模板正文由 `agent/hooks/templates/` 内嵌，二者的一致性由
/// `agent/hooks/templates/tests.rs::embedded_templates_read_the_session_id_env_key` 钉住。
pub const SESSION_ID_ENV: &str = "NEEKO_SESSION_ID";
