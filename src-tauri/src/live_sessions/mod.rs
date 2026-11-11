//! Live session 注册表：**会话状态与标题的唯一事实源**。
//!
//! 分层（依赖单向，越往下越纯）：
//!
//! ```text
//! 真实（chat 事件流 / PTY 进程）+ 地址（WorkspaceSession）
//!   │  信号（唯一写者 = 事件层）
//!   ▼
//! Registry（内存唯一事实，写穿 SessionStore）
//!   ├─ state.rs   纯转移 reduce(state, Signal)
//!   ├─ (title)    纯判据已上移到 common::agent::title
//!   └─ wiring/{chat,pty}.rs  原生信号 → Signal
//!   │
//!   ▼
//! list_live_sessions / wait_live_sessions + SESSIONS_EVENT（只发版本号）
//! ```
//!
//! 生命周期转移（关 tab / 注销 / 删除）的入口在 [`lifecycle`]：它们只改注册表 +
//! 发版本号，**不含**任何进程控制 —— 进程怎么停是各生产者（终端路由 / chat 管理器）
//! 的知识，组合根按归属接起来。
//!
//! 视图层（tab 标题、侧栏图标、侧栏会话列表）只是同一快照的**纯投影**：不持有状态
//! 副本、不推断状态、不写标题。

pub(crate) mod boot;
pub(crate) mod commands;
mod cursor;
mod entry;
mod env;
mod events;
pub mod lifecycle;
mod registry;
mod state;
mod view;
pub(crate) mod wiring;

// 标题域已上移到 `common::agent::title`（`conversation` 也要用同一份判据，
// 而 conversation 不能反向依赖 live_sessions）；这里 re-export 保持既有调用路径。
pub use crate::common::agent::title;
pub use crate::common::agent::title::TitleSource;
pub use entry::{SessionEntry, SessionKind, SessionState};
pub use env::SESSION_ID_ENV;
pub use events::{emit_changed, notify_if_changed, SESSIONS_EVENT};
pub use registry::Registry;
pub use state::{reduce, Signal};
pub use view::{LiveSessionsSnapshot, LiveSessionsWait, SessionView};
