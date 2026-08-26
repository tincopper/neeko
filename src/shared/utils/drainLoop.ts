/**
 * Credit-pull consumer protocol for terminal output (内存治理协议前端半场).
 *
 * 后端把输出写入有界 SessionDrain 并发送零载荷唤醒事件；消费侧通过
 * `terminal_drain` 命令拉取二进制块，直到后端报告为空。
 *
 * 背压闸门：xterm 仍在消化的在途 write 达到阈值时提前退出循环 —— 队列中
 * 的剩余数据由调度器的闩锁/续拉机制保证最终被拉取，字节永不丢失。
 *
 * 冻结故障回炉（任务 08-25-terminal-memory-governance §8）：旧实现存在三处
 * 不可恢复的唤醒吞噬点（draining 尾窗、门闸早退、竞态补发），导致
 * wake_in_flight 粘死、单 tab 永久冻结。createDrainScheduler 以
 * 「pendingWake 闩锁 + maybePending 残留证据 + digest 续拉」闭合全部丢失路径：
 * 只要后端队列仍有数据或未来有新 push，循环必然再次启动。
 */

/** xterm 在途 write 上限：超过则暂停拉取，等待消化回调。 */
export const MAX_IN_FLIGHT_WRITES = 8;

export interface DrainLoopResult {
  /** Total bytes handed to `write` during this run. */
  total: number;
  /**
   * true = 因后端报告队列已空而终止；false = 因背压门闸早退
   * （后端队列可能仍有积压）。
   */
  exhausted: boolean;
}

export interface DrainLoopDeps {
  /** Pulls one buffered chunk; empty ArrayBuffer means "queue drained". */
  drain: (sessionId: string) => Promise<ArrayBuffer>;
  /** Feeds a chunk into the terminal. */
  write: (chunk: ArrayBuffer) => void;
  /** Current number of writes xterm has not digested yet. */
  pendingWrites: () => number;
}

/**
 * Pulls buffered output until empty or backpressured.
 */
export async function runDrainLoop(
  sessionId: string,
  deps: DrainLoopDeps,
): Promise<DrainLoopResult> {
  let total = 0;
  for (;;) {
    if (deps.pendingWrites() >= MAX_IN_FLIGHT_WRITES) {
      return { total, exhausted: false };
    }
    const chunk = await deps.drain(sessionId);
    if (chunk.byteLength === 0) {
      return { total, exhausted: true };
    }
    total += chunk.byteLength;
    deps.write(chunk);
  }
}

export interface DrainSchedulerDeps extends DrainLoopDeps {
  sessionId: string;
}

export interface DrainScheduler {
  /** Wake event handler (`terminal-drain-{id}` listener body). */
  onWake(): void;
  /** Parse-callback hook: resumes pulling after xterm digests when residual data may exist. */
  onWriteDigested(): void;
}

/**
 * Wake-dispatch scheduler closing all lost-wakeup paths of the credit-pull
 * protocol:
 *
 * - draining 期间到达的 wake 记入 `pendingWake` 闩锁，循环退出后自动续跑一轮；
 * - 门闸早退置 `maybePending=true`；xterm 消化回调经 `onWriteDigested`
 *   在压力下降后续拉；
 * - 稳态（empty 终止且无闩锁）下 digest 回调零 invoke 空转。
 */
export function createDrainScheduler(deps: DrainSchedulerDeps): DrainScheduler {
  let draining = false;
  let pendingWake = false;
  let maybePending = false;

  const startLoop = (): void => {
    if (draining) return;
    draining = true;
    void runDrainLoop(deps.sessionId, deps)
      .then((result) => {
        maybePending = !result.exhausted;
      })
      .catch(() => {
        // 会话关闭竞态等场景：静默豁免（旧实现此处产生 unhandled rejection）。
        // draining 复位由 finally 保证，后续 wake 可重启循环。
      })
      .finally(() => {
        // 先复位再续跑：startLoop 的 draining 守卫会拦截重入，
        // 必须释放闸门后才能启动闩锁续拉。
        const rerun = pendingWake;
        pendingWake = false;
        draining = false;
        if (rerun) startLoop();
      });
  };

  return {
    onWake() {
      if (draining) {
        pendingWake = true;
        return;
      }
      startLoop();
    },
    onWriteDigested() {
      if (!maybePending) return;
      if (deps.pendingWrites() >= MAX_IN_FLIGHT_WRITES) return;
      startLoop();
    },
  };
}
