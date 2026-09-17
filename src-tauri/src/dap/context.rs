//! 编排上下文：DAP 各类用例共同需要的协作者集合。
//!
//! ## 为什么需要它
//!
//! 「启动调试」「改断点」「读外部源码」这三类用例都需要同样四样东西：项目上下文
//! （`AppStateWrapper`）、会话所有权（`SessionRegistry`）、断点仓储
//! （`BreakpointStore`）、语言后端（`BackendRegistry`）。
//!
//! 把它们显式打包成借用结构，用例实现就能搬进各自的模块，而不是全部堆在
//! `DapManager` 上；同时避免了两个反模式：
//!
//! - **4 个独立参数**：撞 clippy `too_many_arguments`，且调用点噪音大；
//! - **传 `&DapManager`**：用例模块会反向依赖门面，形成环。
//!
//! `DapManager` 只负责按需组装它（`DapManager::context`），并保持对外 API 不变。

use super::backends::BackendRegistry;
use super::breakpoints::BreakpointStore;
use super::sessions::SessionRegistry;
use crate::AppStateWrapper;

/// 一次用例调用所需的协作者（全部借用，零拷贝）。
pub(crate) struct DapContext<'a> {
    /// 项目上下文（项目根 / 执行环境 / 配置读取）。
    pub(crate) state: &'a AppStateWrapper,
    /// 会话注册表（所有权 + debuggee 生命周期）。
    pub(crate) sessions: &'a SessionRegistry,
    /// 断点仓储（per-project 状态，单锁）。
    pub(crate) breakpoints: &'a BreakpointStore,
    /// 语言编排后端注册表。
    pub(crate) backends: &'a BackendRegistry,
}
