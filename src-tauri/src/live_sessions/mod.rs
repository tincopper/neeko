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
//!   ├─ title.rs   纯优先级 pick / truncate / should_upgrade
//!   └─ wiring/{chat,pty}.rs  原生信号 → Signal
//!   │
//!   ▼
//! list_live_sessions / wait_live_sessions + SESSIONS_EVENT（只发版本号）
//! ```
//!
//! 视图层（tab 标题、侧栏图标、侧栏会话列表）只是同一快照的**纯投影**：不持有状态
//! 副本、不推断状态、不写标题。

pub(crate) mod commands;
mod cursor;
mod entry;
mod env;
mod events;
mod registry;
mod state;
mod title;
mod view;
pub(crate) mod wiring;

pub use entry::{SessionEntry, SessionKind, SessionState, TitleSource};
pub use env::SESSION_ID_ENV;
pub use events::{emit_changed, SESSIONS_EVENT};
pub use registry::Registry;
pub use state::{reduce, Signal};
pub use view::{LiveSessionsSnapshot, LiveSessionsWait, SessionView};
