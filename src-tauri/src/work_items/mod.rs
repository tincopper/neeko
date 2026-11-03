//! 工作项域（统一任务中心的 Local Provider + 执行记录）。
//!
//! 分工：数据与纯函数在 [`types`]，持久化在 [`store`]（v17→v18 建表），业务判据在
//! [`manager`]（唯一的写入口），IPC 契约在 [`commands`]（**极薄**，红线 6）。
//!
//! # 与执行域的边界（design §3.4）
//!
//! 本域只存**指针 + 轻量快照**（`WorkItemRun.ref` / `.snapshot`）：真相源在执行域
//! （团队板 / 会话 / flow run），所以本目录**不 import** `agent::team` —— 反向依赖会让
//! 「团队被删掉后 hub 仍能渲染」变成一句空话。这条单向性是刻意留出来的，加代码前先看一眼。

pub mod commands;
pub mod manager;
pub mod store;
pub mod types;

pub use manager::WorkItemManager;
pub use store::WorkItemStore;
pub use types::{
    CreateWorkItem, NewRun, Priority, RunMode, RunRef, RunRefKind, RunSnapshot, RunState,
    StagePlan, StageTransition, UpdateWorkItem, WorkItem, WorkItemRun, DEFAULT_STAGES,
    RUN_LABEL_MAX_CHARS,
};
