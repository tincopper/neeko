/**
 * Credit-pull consumer protocol for terminal output (内存治理协议前端半场).
 *
 * 后端把输出写入有界 SessionDrain；消费侧通过 `terminal_drain` /
 * `terminal_drain_wait` 命令拉取二进制块，直到后端报告为空。默认触发源为
 * per-session long-poll 挂起式 drain（`createLongPollScheduler`，无数据挂起、
 * 有数据立即返回，空闲零空转）；`VITE_TERMINAL_DRAIN_POLL=1` 时回退全局共享
 * 轮询器（`createPollingDrainScheduler`，100ms tick，方案 B 去 eval 化）。
 * 历史 `terminal-drain-{id}` 唤醒事件已退役，`onWake` 语义保留供调度器复用。
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
  /** Long-poll pull: 有数据立即返回字节，无数据挂起至超时；NotFound 抛错。 */
  drainWait?: (sessionId: string, timeoutMs: number) => Promise<ArrayBuffer>;
}

export interface DrainScheduler {
  /** Wake trigger: schedules a drain run (poll tick or wake event). */
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

/**
 * 轮询驱动（方案 B：去 eval 化，内存治理根治）。
 *
 * 背景：macOS 上 Tauri 事件送达 = 每次 evaluateJavaScript；WebKit 无条件对
 * eval 完成值做「结构化克隆 + JSON.stringify」，高吞吐终端输出（agent 流式
 * CLI）下每秒数百次，JSC libpas mapped 内存只增不减 → WebContent RSS 暴涨
 * （实测 22GB+，JS live 堆却零增长——泄漏在引擎层/分配器层，不在对象图）。
 *
 * 本驱动以「前端全局共享轮询器」替代 `terminal-drain-{id}` 唤醒事件：
 * `terminal_drain` invoke 在 macOS 走 custom protocol fetch（二进制响应，
 * 零 eval、零克隆），从源头消灭引擎层序列化开销。轮询拉空为止的语义与
 * createDrainScheduler 的 pendingWake 闩锁 / maybePending 续拉完全兼容
 * （字节永不丢失）。
 *
 * 所有活跃 session 共用一个 interval；空闲 session 每次 tick 仅一次空
 * invoke（微秒级），远轻于原事件风暴。
 *
 * 并发安全：注册表为「sessionId → 订阅者集合」，同一 sessionId 可承载多个
 * 调度器实例（重建竞态），各自 dispose 只移除自己的 tick —— 不会误删
 * 同 key 的其他订阅者（旧实例 dispose 不会让新实例永久停摆）。
 */
export const DRAIN_POLL_INTERVAL_MS = 100;

const pollSubscribers = new Map<string, Set<() => void>>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function ensurePollTimer(): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => {
    for (const ticks of pollSubscribers.values()) {
      for (const tick of ticks) tick();
    }
  }, DRAIN_POLL_INTERVAL_MS);
}

function stopPollTimerIfIdle(): void {
  if (pollSubscribers.size === 0 && pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// HMR 卫生：dev 下模块重载会遗留孤儿 interval（生产无影响），重载时清表。
// 项目 tsconfig 未引入 vite/client 全局类型，故用内联类型断言访问 hot。
const hot = (import.meta as ImportMeta & { hot?: { dispose(cb: () => void): void } }).hot;
if (hot) {
  hot.dispose(() => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollSubscribers.clear();
    for (const disposeLongPoll of longPollDisposers) {
      disposeLongPoll();
    }
    longPollDisposers.clear();
  });
}

export interface PollingDrainScheduler extends DrainScheduler {
  /** Unregister from the shared poller. Idempotent — safe to call twice. */
  dispose(): void;
}

/**
 * 创建轮询驱动的 drain 调度器：注册到全局共享轮询器，tick 等价于一次
 * onWake（draining 期间置 pendingWake 闩锁，循环退出后自动续拉）。
 */
export function createPollingDrainScheduler(deps: DrainSchedulerDeps): PollingDrainScheduler {
  const inner = createDrainScheduler(deps);
  const tick = () => inner.onWake();
  let ticks = pollSubscribers.get(deps.sessionId);
  if (!ticks) {
    ticks = new Set();
    pollSubscribers.set(deps.sessionId, ticks);
  }
  ticks.add(tick);
  ensurePollTimer();
  return {
    ...inner,
    dispose() {
      const current = pollSubscribers.get(deps.sessionId);
      if (!current) return;
      current.delete(tick);
      if (current.size === 0) {
        pollSubscribers.delete(deps.sessionId);
        stopPollTimerIfIdle();
      }
    },
  };
}
/** Long-poll 挂起超时：后端钳制 1–30s，前端取 25s 自兜底后续挂。 */
export const DRAIN_WAIT_TIMEOUT_MS = 25_000;

export interface LongPollDrainScheduler extends DrainScheduler {
  /** 终止挂起循环并丢弃迟到结果。幂等，可调用多次。 */
  dispose(): void;
}
// HMR 卫生：dev 下模块重载会遗留孤儿 long-poll 循环（挂起 fetch 在后端
// 超时前仍存活），已登记循环在重载时统一终止（生产无影响）。
const longPollDisposers = new Set<() => void>();

/** `createDrainTransportScheduler` 的统一返回契约：两种传输都保证幂等 dispose。 */
export type DrainTransportScheduler = PollingDrainScheduler | LongPollDrainScheduler;

/**
 * Long-poll 驱动的 drain 调度器：每 session 一条挂起 fetch 循环，
 * 返回即 wake。复用 `createDrainScheduler` 的 pendingWake 闩锁 /
 * maybePending 续拉协议；`wait` 返回的数据块直接 `write`，不经
 * `runDrainLoop` 首次 pull（`onWake` 仅补拉竞态窗口新数据）。
 *
 * 终止语义：`drainWait` 抛错（NotFound=会话已关闭/移除）即停；
 * `dispose` 后循环即停、迟到结果丢弃（invoke 无 AbortSignal，
 * fetch 本体由后端 25s 超时回收，孤儿任务无害）。
 */
export function createLongPollScheduler(deps: DrainSchedulerDeps): LongPollDrainScheduler {
  const drainWait = deps.drainWait;
  if (!drainWait) {
    throw new Error('createLongPollScheduler requires deps.drainWait');
  }
  const inner = createDrainScheduler(deps);
  let disposed = false;
  const dispose = (): void => {
    disposed = true;
    longPollDisposers.delete(dispose);
  };
  longPollDisposers.add(dispose);
  void (async () => {
    while (!disposed) {
      try {
        const chunk = await drainWait(deps.sessionId, DRAIN_WAIT_TIMEOUT_MS);
        if (disposed) break;
        if (chunk.byteLength > 0) {
          deps.write(chunk);
          inner.onWake();
        }
      } catch (e) {
        console.debug('[Drain] long-poll stopped:', e);
        break;
      }
    }
  })();
  return {
    onWake: inner.onWake,
    onWriteDigested: inner.onWriteDigested,
    dispose,
  };
}

/**
 * 传输层统一入口：默认 long-poll，`VITE_TERMINAL_DRAIN_POLL=1` 时回退轮询。
 * Call site 一行不改即可整体回退。
 */
export function createDrainTransportScheduler(deps: DrainSchedulerDeps): DrainTransportScheduler {
  const usePollFallback = import.meta.env.VITE_TERMINAL_DRAIN_POLL === '1';
  if (usePollFallback) {
    return createPollingDrainScheduler(deps);
  }
  return createLongPollScheduler(deps);
}
