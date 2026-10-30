//! 租约计算 —— **纯函数**，100% 分支覆盖（design §2.1 / 不变量 4）。
//!
//! 为什么单开一个文件：租约是「没有它就会死锁」的那条规则的唯一实现点
//! （业界坑：无租约的 claim 会让一个被杀掉的成员永久占着任务）。把它做成纯函数，
//! 才能在毫秒/秒单位、时钟回拨、计数饱和这些边界上逐条断言，而不用起线程或库。
//!
//! 单位约定：`claimed_at` / `now` 是 **epoch 毫秒**，`lease_ttl` 是**秒**。
//! 两者单位不同是刻意保留的 —— 库里存秒是给用户看（「租约 30 分钟」），
//! 存毫秒是给机器比。换算只发生在本文件，别处不得重复换算。

/// 回收次数上限（design 不变量 4）。
///
/// `reclaim_count > MAX` 的任务进 `blocked`，不再自动回收 —— 防「杀掉成员 → 任务回
/// pending → 又派给同一个坏 agent」的无限重试。
pub const MAX_RECLAIM_COUNT: u32 = 3;

/// 租约是否已到期。
///
/// - 到期判定用 `>=`：租约 1800s 的任务在第 1800.000s 就到期，不是第 1800.001s。
/// - `ttl_secs <= 0` 视为「立即到期」（配置写错的可见后果是任务被立刻回收，而不是永不回收）。
/// - 时钟回拨（`now < claimed_at`）返回 `false`：宁可多次回收也不要在时钟抖动时抢走一个
///   正在干活的成员的任务。
/// - 乘法用 `saturating_mul`：`ttl_secs` 来自外部输入，溢出不得变成负数导致「永不到期」。
#[must_use]
pub const fn lease_expired(claimed_at: i64, ttl_secs: i64, now: i64) -> bool {
    // 先换算再比较：`ttl_secs` 是秒、另两个是毫秒，把换算留在这里是刻意的
    // （单位写反的后果是租约 1000 倍偏差，测试里一断言就红）。
    now.saturating_sub(claimed_at) >= ttl_secs.saturating_mul(1000)
}

/// 回收次数 +1（饱和）。
///
/// 饱和而不是回绕：`u32::MAX + 1` 回绕成 0 会让一个已经报废的任务重新获得
/// `MAX_RECLAIM_COUNT + 1` 次自动回收机会。
#[must_use]
pub const fn next_reclaim_count(current: u32) -> u32 {
    current.saturating_add(1)
}

/// 这一次回收之后，任务是否还允许自动回到 `pending`。
///
/// 判据是**回收之后的计数**（`reclaim_count > 3 → blocked`）：传 4 即返回 `false`，
/// 调用方据此把任务冻结为 `blocked`。
#[must_use]
pub const fn should_auto_release(reclaim_count: u32) -> bool {
    reclaim_count <= MAX_RECLAIM_COUNT
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 引擎的最小单位是毫秒：`claimed_at` 也必须是毫秒，
    /// 否则 1800s 的租约会在一毫秒后到期（整个团队的活瞬间被回收）。
    #[test]
    fn lease_not_expired_one_millisecond_before_ttl() {
        let claimed = 1_000_000;
        assert!(!lease_expired(claimed, 1800, claimed + 1_800_000 - 1));
    }

    /// 边界取闭区间：正好到 ttl 就到期，否则「永不回收」会以 1ms 的窗口存在。
    #[test]
    fn lease_expires_exactly_at_ttl_boundary() {
        let claimed = 1_000_000;
        assert!(lease_expired(claimed, 1800, claimed + 1_800_000));
    }

    /// 时钟回拨不得导致误回收（AC3 的反面：不能把还在干活的成员踢掉）。
    #[test]
    fn clock_skew_backwards_keeps_lease_alive() {
        assert!(!lease_expired(5_000_000, 1800, 4_000_000));
    }

    /// 非正 ttl 是配置错误，必须立即到期（可见的回收 > 静默的永久占用）。
    #[test]
    fn non_positive_ttl_expires_immediately() {
        assert!(lease_expired(1_000, 0, 1_000));
        assert!(lease_expired(1_000, -60, 1_000));
    }

    /// 极大 ttl 不得因乘法溢出变成负数而「永不到期」或「立即到期」——
    /// 饱和后仍是一个巨大的正数阈值。
    #[test]
    fn huge_ttl_saturates_instead_of_overflowing() {
        assert!(!lease_expired(1, i64::MAX, 1_000_000_000));
    }

    /// 回收计数饱和在 `u32::MAX`，不回绕成 0。
    #[test]
    fn reclaim_count_saturates_at_u32_max() {
        assert_eq!(next_reclaim_count(0), 1);
        assert_eq!(next_reclaim_count(3), 4);
        assert_eq!(next_reclaim_count(u32::MAX), u32::MAX);
    }

    /// 不变量 4：回收次数 ≤ 3 时仍可自动回收，> 3 一律冻结。
    /// 「> 3」而不是「>= 3」：第 3 次回收之后任务还有一次机会（共 4 次尝试）。
    #[test]
    fn auto_release_allowed_up_to_third_reclaim_only() {
        assert!(should_auto_release(0));
        assert!(should_auto_release(1));
        assert!(should_auto_release(2));
        assert!(should_auto_release(MAX_RECLAIM_COUNT));
        assert!(!should_auto_release(MAX_RECLAIM_COUNT + 1));
        assert!(!should_auto_release(u32::MAX));
    }
}
