//! 组合根适配：把 live-sessions 注册表接到团队域的**读接口**上。
//!
//! # 为什么这层必须在这里
//!
//! 团队域需要回答「这名成员此刻有没有活进程」，但它**不许**持有那个事实（红线 17：
//! 进程句柄是进程期资源，而成员行跨重启）。它只声明一个端口：
//! [`crate::agent::team::view::MemberSessionLookup`]。
//!
//! 谁来实现：
//!
//! - 让 `live_sessions` 实现它会得到一个反向依赖（会话域认识团队语义）—— 不行；
//! - 让 `agent::team` 直接读 `Registry` 会把两个域焊在一起 —— 也不行；
//! - **组合根同时认识两边**，所以适配放这里。这与 `team_executor` / `team_notifier`
//!   同一条理由：跨域接线是组合根的职责，不是任何一方的业务规则。
//!
//! 适配器**不缓存**任何东西：每次询问都现场读注册表，于是「注册表说停了、适配器还说活着」
//! 这种影子副本状态在类型上不存在。

use std::sync::Arc;

use crate::agent::team::view::MemberSessionLookup;
use crate::live_sessions::Registry;

/// [`MemberSessionLookup`] 的生产实现。
pub struct RegistryMemberSessions {
    registry: Arc<Registry>,
}

impl RegistryMemberSessions {
    /// 由组合根构造。
    #[must_use]
    pub const fn new(registry: Arc<Registry>) -> Self {
        Self { registry }
    }
}

impl MemberSessionLookup for RegistryMemberSessions {
    fn live_terminal_of(&self, team_id: &str, member_id: &str) -> Option<String> {
        self.registry.live_session_for_member(team_id, member_id)
    }
}
