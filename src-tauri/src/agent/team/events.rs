//! 团队域的前端事件出口：**一个常量 + 一个失效脉冲 + 一个投递端口**。
//!
//! 前端镜像：`src/shared/events.ts` 的 `AGENT_TEAM_EVENT`（红线 5：事件名双端同源，
//! 漂移由 `tools/guards/checks/check_event_constants.py` 在 commit 门禁上判失败）。
//!
//! # 载荷是**失效脉冲**，不是增量
//!
//! 事件只回答一件事：**「有东西变了，去重取快照」**。它刻意**不描述变了什么** ——
//! 载荷只有 [`TeamPulse::rev`]（该次写之后的 [`crate::agent::team::TeamManager::epoch`]）。
//!
//! 裁决理由（本文件存在的全部原因）：
//!
//! 1. **增量事件 = 在 TS 里重建一份状态机**。任何「任务从 A 到 B」「成员进了 Idle」这类
//!    增量载荷，都会让前端持有一份与 Rust 侧平行的迁移逻辑。两份状态机必然漂移，且漂移
//!    是静默的（前端看起来一切正常，只是某个格子颜色错了三个月）。
//! 2. **面板无论如何都必须能靠一次快照自愈**。重连、webview 重载、错过事件、慢消费者
//!    丢弃 —— 这四种情形下增量事件的唯一补救还是「重取一次快照」。既然快照是必需的，
//!    它就该是**唯一真相**；事件降级为纯触发器，前端因此不需要「补播」逻辑。
//! 3. `rev` 存在的意义是**去重**：同一批写会产生多个脉冲（每个写路径一个），而一次快照
//!    覆盖全部。前端收到 `rev` 后只做「要不要再拉一次」的判断，不解释它。
//!
//! 反过来说清楚代价：脉冲**不保证每次状态变化都送达**（webview 关闭时 `emit` 失败只记
//! 日志），也**不保证顺序**。这两条都由「快照是唯一真相」兜住 —— 这正是接受这个代价的
//! 前提，不是遗漏。
//!
//! # 域不认识 `AppHandle`
//!
//! 本模块只声明端口 [`TeamNotifier`]；生产实现在组合根
//! `crate::app::team_notifier::TauriTeamNotifier`（唯一持有 `AppHandle` 的地方）。
//! 这与 [`crate::agent::team::execution::MemberExecutor`] 是同一个形态：域定义契约，
//! 组合根注入实现，因此 `agent/team/` 里没有一行 `tauri`（依赖倒置 + 域可单测）。
//!
//! # 未设置 notifier 时静默不发
//!
//! [`crate::agent::team::TeamManager::set_notifier`] 是晚绑定：启动期 hydrate 库里已有的
//! 团队时还没有前端窗口，那时的写不该发事件。`None` 不是错误状态，是「还没有前端在听」。

/// 团队变更事件通道：`agent-team://event`。
///
/// 载荷是 [`TeamPulse`]（失效脉冲，见模块文档）。前端镜像常量：
/// `src/shared/events.ts` → `AGENT_TEAM_EVENT`。
pub const TEAM_EVENT: &str = "agent-team://event";

/// 失效脉冲载荷：**只有代数**。
///
/// `rev` = 该次写之后的团队代数（[`crate::agent::team::TeamManager::epoch`]），单调递增。
/// 它不含团队 id：一个面板只关心「我盯着的这个域有没有变」，而团队 id 在快照里已经有了
/// —— 把 id 也放进脉冲会邀请前端按 id 过滤（那就等于在数据里表达「哪些变化与我有关」，
/// 又一次把语义塞进触发器）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPulse {
    /// 写之后的团队代数（单调递增）。
    pub rev: u64,
}

/// 事件投递端口（依赖倒置：域声明，组合根实现）。
///
/// 单一方法而非「每个事件一个方法」：本域只有一个事件、一种载荷（脉冲）。将来若真有第二类
/// 事件，那应该是**第二份裁决**（是不是又退回了增量语义？），不该靠加方法来绕过。
pub trait TeamNotifier: Send + Sync {
    /// 投递一次失效脉冲。实现方**不得**上抛错误：事件是尽力而为的通知，前端没开窗口
    /// 不该影响团队域的写路径。
    fn pulse(&self, rev: u64);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 与前端 `src/shared/events.ts` 镜像的线上名称（漂移 = 前端静默失联）。
    ///
    /// 这条断言是**编译期护栏的兜底**：真正的跨端判据在
    /// `tools/guards/checks/check_event_constants.py`（TS 没有编译期校验）。
    #[test]
    fn the_event_name_matches_the_frontend_mirror() {
        assert_eq!(TEAM_EVENT, "agent-team://event");
    }

    /// 载荷只有一个键：`rev`。多一个字段就是在触发器里塞语义（见模块文档）。
    #[test]
    fn the_pulse_payload_carries_only_the_revision() {
        let json = serde_json::to_value(TeamPulse { rev: 7 }).expect("serialize");
        assert_eq!(json, serde_json::json!({ "rev": 7 }));
    }
}
