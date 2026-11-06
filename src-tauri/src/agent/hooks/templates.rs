//! 受管 hook 模板的 Rust 侧门面。
//!
//! 每个模板是 `include_str!` 嵌入的独立文件（编译期进二进制，无运行时读盘）。
//! 本文件只做**声明**（红线 9 精神），不承载业务逻辑。
//!
//! # 为什么所有模板都集中在此
//!
//! 两个理由，都要求「同一份正文只有一个 `include_str!`」：
//!
//! 1. **共享**：`neeko-report.mjs` 被 4 个 `HookTarget` 行共用（claude / codebuddy /
//!    qoder / codex）。集中后「多源共用同一份」是**类型系统可见的事实**（同一个常量），
//!    而不是四处 `include_str!` 的巧合 —— 后者内容相同但无法用指针相等断言（父任务 AC3）。
//! 2. **单一源**：即使只有一行使用的模板（opencode / pi / omp）也放这里 ——
//!    2026-10-16 复审发现它们曾散在 `targets/data.rs` 里 `include_str!`，
//!    与本文件的声明自相矛盾（同一件事两个嵌入点）。现在**全仓模板正文只在 `templates/`
//!    目录有物理文件，且只在本文件被 `include_str!` 一次**。

/// stdin 形态的上报 shim（Claude 兼容面共用）。
///
/// 契约（Rust 与 JS 是同一契约的两端，改一端必须同步另一端）：
/// - `argv`: `<source> <event_key>` —— 语义键由 argv 传入，shim 零 per-CLI 事件名知识；
/// - `stdin`: CLI 的 hook input JSON（Claude Code 规范）；
/// - 出站: `POST http://127.0.0.1:{port}/hook/{source}` + `x-neeko-agent-hook-token` 头；
/// - 退出: **永远 0**（非零退出会被 CLI 当作阻断/失败，违反「绝不阻塞用户 agent」）。
///
/// 为什么用 command hook + shim 而非 `type:"http"` hook（父任务 design T8）：
/// http hook 的 URL 是**静态字符串**，而 Neeko 的 ingest 端口是每次启动随机（`bind :0`）
/// 且要求多实例共存（`10-12` R6.8）—— 静态配置无法表达动态坐标，二者不可调和。
pub const REPORT_SHIM: &str = include_str!("templates/neeko-report.mjs");

/// opencode 插件模板（2.x）。
///
/// V1 模板（`templates/neeko-opencode-status.js`，1.19.0 事件面）冻结存档，不再安装。
pub const OPENCODE_TEMPLATE: &str = include_str!("templates/neeko-opencode-status-v2.js");

/// pi 扩展模板（1.5.0 实测事件面：agent_settled（旧版回落 agent_end）/ tool_call(ask 类工具)
/// / ui_prompt_start）。
///
/// 两条判据各由一次实测事故定义：会话来源门（in-process 子 agent 会话复用本扩展，
/// `NEEKO_SESSION_ID` 是进程级 env ⇒ 子会话完成事件会带着父会话 id 上报）与完成腿判据
/// （`agent_end` 在重试 / 压缩 / 队列续跑时会先发一次）。
pub const PI_TEMPLATE: &str = include_str!("templates/neeko-pi-status.ts");

/// OMP 扩展模板 —— pi 模板的**派生变体**。
///
/// **为什么必须变体而非复用同一常量**（2026-10-16 spike，U1）：OMP 与 pi 同扩展 API，
/// 但 OMP 二进制**不含** `ui_prompt_start`（`withUIPrompt` / `emitUIPromptEvent` /
/// `UIPromptStartEvent` 均 0 命中），而 pi 的 `ExtensionEvent` union 含
/// `UIPromptStartEvent` / `UIPromptEndEvent`。OMP 有 `tool_call`（等待审批腿）与
/// `agent_end`（完成腿），故变体 = pi 模板 **减去** `ui_prompt_start` 段。
/// 变体是独立文件而非运行时 `if (isOmp)` 分支 —— 模板保持零 CLI 分支（红线 15 精神）。
///
/// 完成腿的**判据也不同**（omp 18.14.1 二进制实测：`agent_settled` 0 命中、`willContinue`
/// 38 命中）：OMP 用 `agent_end.willContinue` 标非终态，pi 用 `agent_settled` 标稳定终点。
pub const OMP_TEMPLATE: &str = include_str!("templates/neeko-omp-status.ts");

#[cfg(test)]
mod tests;
