//! 语言编排后端注册表（§9.4 方案 C）。
//!
//! 键是 [`AdapterKind`] 而非字符串：`config.type_` 存在 `junit` / `delve` / `rust` 等
//! 别名，用字符串当键会让"启动路径查不到、实时路径（按 `session.kind()`）查得到"，
//! 同一份断点随操作路径分叉（`jdt:` 伪路径静默进适配器 ⇒ 断点永不命中）。
//!
//! 数据与它的锁同住：锁只服务这一份表，`lock_warn` 语义（容忍中毒 + 留 warn）不再
//! 散落在调用点。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use super::adapter::{plugin_for, LanguageBackend};
use super::types::{AdapterKind, LaunchConfig};
use crate::AppError;

/// `AdapterKind → 编排后端` 注册表。
///
/// 用同步 `std::sync::Mutex`：组合根装配与 kind 查询都是短临界区同步操作
/// （不涉及 IO，也不跨 await）。
#[derive(Default)]
pub struct BackendRegistry {
    backends: Mutex<HashMap<AdapterKind, Arc<dyn LanguageBackend>>>,
}

impl BackendRegistry {
    /// Create an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册某个语言的编排后端（组合根装配时调用；仅编排差异的语言需要）。
    pub fn register(&self, kind: AdapterKind, backend: Arc<dyn LanguageBackend>) {
        self.lock().insert(kind, backend);
    }

    /// 按语言 kind 查编排后端；未注册 → `None`（走通用 spawn 路径）。
    #[must_use]
    pub fn get(&self, kind: AdapterKind) -> Option<Arc<dyn LanguageBackend>> {
        self.lock().get(&kind).cloned()
    }

    /// **启动路径**的后端解析：`config.type_`（可能带别名）→ 协议层插件 → [`AdapterKind`]
    /// → 编排后端。kind 一并返回（adapter 二进制覆盖也按 kind 取配置键）。
    ///
    /// 与实时路径（`get(session.kind())`）同源 —— 两条路径必须落在同一个 kind 上。
    /// `Err` 仅表示 `type_` 不在已支持的语言族内（与 `plugin_for` 同口径）。
    pub fn for_config(
        &self,
        config: &LaunchConfig,
    ) -> Result<(AdapterKind, Option<Arc<dyn LanguageBackend>>), AppError> {
        let kind = plugin_for(&config.type_)?.kind();
        Ok((kind, self.get(kind)))
    }

    /// 短临界区锁：毒化只意味着"某持锁线程 panic"，表数据仍可用 —— 容忍继续并留 warn。
    ///
    /// **不允许静默吞**：静默吞锁会让"注册后端失败"变成无迹可寻的行为漂移
    /// （`common/terminal/locks.rs::lock_warn` 的同款语义）。
    fn lock(&self) -> MutexGuard<'_, HashMap<AdapterKind, Arc<dyn LanguageBackend>>> {
        self.backends.lock().unwrap_or_else(|poisoned| {
            log::warn!("[DAP] backend registry lock poisoned, continuing");
            poisoned.into_inner()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dap::adapter::DebugRequest;
    use crate::dap::testing::go_launch_config;

    /// 只回答"身份翻译"的最小后端：断言"查到的是哪个后端"用可观测前缀。
    struct StubBackend;

    static STUB_PLUGIN: crate::dap::adapter::GoAdapter = crate::dap::adapter::GoAdapter;

    #[async_trait::async_trait]
    impl LanguageBackend for StubBackend {
        fn plugin(&self) -> &dyn crate::dap::adapter::DebugAdapterPlugin {
            &STUB_PLUGIN
        }
        async fn plan(
            &self,
            _state: &crate::AppStateWrapper,
            _request: &DebugRequest,
        ) -> Result<crate::dap::adapter::SessionPlan, AppError> {
            Err(AppError::Dap("not exercised".into()))
        }
        async fn adapter_source_path(
            &self,
            _state: &crate::AppStateWrapper,
            _target: &crate::common::executor::factory::ExecTarget,
            _classpath: &[String],
            identity: &str,
        ) -> crate::dap::adapter::SourcePathResolution {
            crate::dap::adapter::SourcePathResolution::Adapter(std::path::PathBuf::from(format!(
                "/translated{identity}"
            )))
        }
    }

    /// 别名（`junit` / `java`）必须归一到同一个 kind，并查到同一个后端。
    ///
    /// 回归背景：旧实现用 `config.type_` 字符串当键，`type: "junit"` 查不到后端 ⇒
    /// 启动路径跳过断点身份翻译、`jdt:` 伪路径静默进适配器。
    #[test]
    fn config_type_alias_resolves_the_same_backend_kind() {
        let registry = BackendRegistry::new();
        registry.register(AdapterKind::Java, Arc::new(StubBackend));

        for type_ in ["java", "junit"] {
            let config = LaunchConfig {
                type_: type_.into(),
                ..go_launch_config("alias")
            };
            let (kind, backend) = registry.for_config(&config).expect("plugin resolves");
            assert_eq!(kind, AdapterKind::Java, "type `{type_}` 必须归一到 Java");
            assert!(backend.is_some(), "`{type_}` 必须查到已注册的 Java 后端");
        }
    }

    /// 无编排后端的语言 → kind 正确、后端为 `None`（Go/Lldb 原样透传，行为不变）。
    #[test]
    fn unregistered_language_has_kind_but_no_backend() {
        let registry = BackendRegistry::new();
        let config = go_launch_config("go");

        let (kind, backend) = registry.for_config(&config).expect("go plugin");
        assert_eq!(kind, AdapterKind::Go);
        assert!(backend.is_none());
        assert!(registry.get(AdapterKind::Go).is_none());
    }

    /// 未支持的类型与 `plugin_for` 同口径报错（不静默回落成"无后端"）。
    #[test]
    fn unsupported_type_is_an_error() {
        let registry = BackendRegistry::new();
        let config = LaunchConfig {
            type_: "python".into(),
            ..go_launch_config("x")
        };

        assert!(registry.for_config(&config).is_err());
    }

    /// 后注册替换前值 —— 组合根重复装配、以及测试用 fake 替换真实后端都依赖此语义。
    #[test]
    fn register_replaces_previous_backend() {
        let registry = BackendRegistry::new();
        registry.register(AdapterKind::Java, Arc::new(StubBackend));
        let before = registry.get(AdapterKind::Java).expect("registered");

        registry.register(AdapterKind::Java, Arc::new(StubBackend));
        let after = registry.get(AdapterKind::Java).expect("re-registered");

        assert_eq!(registry.lock().len(), 1, "同一 kind 只保留一个后端");
        assert!(
            !Arc::ptr_eq(&before, &after),
            "重新注册必须是新实例（否则 fake 替换真实后端会静默失效）"
        );
    }
}
