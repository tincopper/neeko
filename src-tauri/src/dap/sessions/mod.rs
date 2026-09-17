//! 会话领域：会话注册表（所有权 + 生命周期）。

mod registry;

pub(crate) use registry::SessionRegistry;
