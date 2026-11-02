//! 原生信号 → `Signal` 的适配层。
//!
//! 每个生产者一个文件：`chat`（agent 事件流）、`pty`（终端进程生命周期）、
//! `hooks`（外部 CLI 的 hook 上报 —— 目前最权威的会话标题来源）。
//! `status_mailbox` 不是生产者，而是「逐字节事实 → 跨线程状态」的移交件，
//! 由 `pty` 的活动探针独占消费。
//! 生产者**只**把原生事实翻译成信号 —— 状态怎么变由 `state::reduce` 决定，
//! 视图层没有写入口。

pub(crate) mod chat;
pub(crate) mod hooks;
pub(crate) mod pty;
pub(crate) mod status_mailbox;
