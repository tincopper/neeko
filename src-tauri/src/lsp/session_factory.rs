//! Session assembly port: how a transport and a live session get built.
//!
//! 第一性原理：`LspManager` 的职责是**编排**会话生命周期（per-key gate →
//! 复用判定 → 装配 → 文档重放 → 登记 → 事件），而「transport 从哪来」「会话怎么
//! 造出来」是装配细节——两者被直接 `new` 在编排逻辑里，会让 manager 依赖具体实现
//! 且无法脱离 Tauri 运行时验证失败路径（`tauri::AppHandle` 无法在 `#[cfg(test)]`
//! 里常驻）。此端口把装配细节反转出去，manager 只依赖抽象。
//!
//! 可扩展性：transport.rs 已声明「WebSocket transport 可替换 IPC 而不改会话逻辑」
//! ——端口就是那个替换点（新增实现 + 构造期注入，零编排改动）。

use std::path::Path;
use std::sync::Arc;

use crate::common::executor::factory::ExecTarget;
use crate::lsp::diag_bus::DiagnosticBus;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::session::LspSession;
use crate::lsp::transport::{IpcTransport, LspTransport};
use crate::AppError;

/// 装配一个会话所需的全部输入。
pub(crate) struct SessionBuildRequest<'a> {
    /// Tauri 句柄：仅生产实现需要（装配 transport / 自动安装进度播报）。
    /// 为 `None` 时由实现决定是否报错——manager 自身不再强制要求它。
    pub(crate) app_handle: Option<tauri::AppHandle>,
    pub(crate) plugin: &'a LspPlugin,
    pub(crate) project_path: &'a str,
    pub(crate) workspace_root: &'a Path,
    pub(crate) diag_bus: Arc<DiagnosticBus>,
    /// 会话事件出口。装配失败时 manager 也用它发 `error`（见 `transport`）。
    pub(crate) transport: Arc<dyn LspTransport>,
    pub(crate) exec_target: ExecTarget,
}

/// 会话装配端口。生产实现见 [`IpcSessionFactory`]。
pub(crate) trait SessionFactory: Send + Sync {
    /// 该项目的会话事件通道。
    ///
    /// 独立于 `build` 存在：会话装配失败（spawn / install / initialize）时
    /// manager 仍需要一条通道把 `error` 生命周期事件送到前端（AC2 重试入口的
    /// 数据源），因此 transport 必须能在装配之前取得。
    fn transport(
        &self,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<Arc<dyn LspTransport>, AppError>;

    /// 装配会话（spawn + initialize 握手，阻塞）。
    fn build(&self, request: SessionBuildRequest<'_>) -> Result<LspSession, AppError>;
}

/// 生产实现：Tauri IPC transport + 真实子进程会话。
pub(crate) struct IpcSessionFactory;

impl IpcSessionFactory {
    /// AppHandle 缺失时的统一报错（manager 依赖注入后不再自行强制校验）。
    fn require_handle(
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<&tauri::AppHandle, AppError> {
        app_handle.ok_or_else(|| AppError::Lsp("AppHandle not set".to_string()))
    }
}

impl SessionFactory for IpcSessionFactory {
    fn transport(
        &self,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<Arc<dyn LspTransport>, AppError> {
        let handle = Self::require_handle(app_handle)?;
        Ok(Arc::new(IpcTransport::new(handle.clone())))
    }

    fn build(&self, request: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
        let app_handle = Self::require_handle(request.app_handle.as_ref())?.clone();
        LspSession::new(
            request.plugin,
            request.project_path,
            request.workspace_root,
            app_handle,
            request.diag_bus,
            request.transport,
            request.exec_target,
        )
        .map_err(|e| AppError::Lsp(e.to_string()))
    }
}
