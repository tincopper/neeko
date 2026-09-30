/**
 * 有界重试预算（纯策略，无 React / 无定时器依赖）。
 *
 * **为什么需要它**：异步收敛型副作用（「让某个 key 拥有权威数据」）失败后如果不再尝试，
 * 界面会永久停在加载态；如果无条件重试，就会变成打后端的自激环。本模块把这条取舍收敛成
 * 一个可单测的纯策略：**同一意图最多尝试 N 次，间隔指数退避且有上限**。
 *
 * **意图（intent）即预算的作用域**：调用方用「当前要收敛的那个身份」当 intent（例如仓库单元
 * 的 `RepoKey`）。intent 变化 ⇒ 预算自动归零，因此不需要调用方记得清理，也不会随身份数量
 * 累积状态（同一时刻只有一个「当前意图」需要收敛）。
 *
 * **`acquire` 与 `release` 是非对称的一对**：
 * - `acquire` 表示「我要发一次请求」，成功即消耗一次预算；
 * - `release` 表示「这次尝试没有作废的必要了」—— 只应在两种情况下调用：**已收敛**，或
 *   **请求根本没发出去**（例如定时器登记后被依赖变化取消）。它把同一意图的计数归零。
 *
 * **预算只回答「还能不能再试」**，不回答「这个意图是不是根本不该存在」：耗尽时调用方必须
 * 保持现状（渲染「未知」），判死交给唯一的判死点。
 */

export interface RetryPolicy {
  /** 允许的尝试总次数（含首次）。`1` = 不重试。 */
  maxAttempts: number;
  /** 第 2 次尝试前的等待；此后每次翻倍。首次尝试恒为 0（立即执行）。 */
  baseDelayMs: number;
  /** 退避上限，防止长尾等待把「自愈」拖成「看起来坏了」。 */
  maxDelayMs: number;
}

export interface RetryTicket {
  /** 1-based 尝试序号。 */
  attempt: number;
  /** 本次尝试前应等待的毫秒数（首次恒为 0）。 */
  delayMs: number;
}

export interface RetryBudget {
  /**
   * 为某个意图取一次尝试许可。
   *
   * - 意图与上次不同 ⇒ 先归零再计数（新意图理应有完整预算）；
   * - 预算耗尽 ⇒ 返回 `null`。
   */
  acquire(intent: string): RetryTicket | null;
  /** 归还预算：断言「该意图无需再消耗尝试」。传其它意图是无操作。 */
  release(intent: string): void;
}

/** 第 n 次尝试前的等待：首次立即，其后 `base × 2^(n-2)`，封顶 `maxDelayMs`。 */
function delayFor(attempt: number, policy: RetryPolicy): number {
  if (attempt <= 1) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 2));
}

export function createRetryBudget(policy: RetryPolicy): RetryBudget {
  let intent: string | null = null;
  let attempts = 0;

  return {
    acquire(next) {
      if (next !== intent) {
        intent = next;
        attempts = 0;
      }
      if (attempts >= policy.maxAttempts) return null;
      attempts += 1;
      return { attempt: attempts, delayMs: delayFor(attempts, policy) };
    },
    release(current) {
      if (current !== intent) return;
      intent = null;
      attempts = 0;
    },
  };
}
