import { useCallback, useEffect, useRef } from 'react';

import { ensureTeamPulseListener, useTeamStore } from '../store/teamStore';

/**
 * 脉冲合并窗口（毫秒）。
 *
 * 一个用户可见的动作会产生**多条**脉冲（后端每个写路径都发一条：`task_claim` 一条、
 * `task_update` 两条…）。若每条都立刻拉一次，一次「派活」就会把板拉三遍，而且三份响应会
 * 乱序落地（后到的旧数据盖回新数据）。窗口内只排一次刷新即可：载荷是**全量自愈**的
 * （每次都是后端重新推导的完整快照 / 完整列表），合并**永远不会丢状态**。
 */
export const PULSE_COALESCE_MS = 100;

export interface PulseRefreshOptions {
  /**
   * 是否参与刷新（默认 `true`）。
   *
   * 读面在「没有目标」时必须关掉它：成员详情抽屉关着、面板没打开任何队时，脉冲不该唤醒
   * 一次注定被丢弃的请求。
   */
  enabled?: boolean;
}

/**
 * 一次脉冲引擎的状态。放在一个可变对象里而不是多个 `useRef`：它们是**一起**成立的四件事
 * （窗口 / 在飞 / 待办 / 卸载闩），拆成四个 ref 只会让「谁和谁是一套」变得靠注释维系。
 */
interface PulseEngine {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  /** 在飞期间又来了新脉冲 —— 落地后补一次（合并，但**不能**丢最后一条）。 */
  queued: boolean;
  /** 卸载闩：`unlisten` 是一次跨进程往返，注销请求发出后已上路的事件仍会落达。 */
  cancelled: boolean;
  /** 最新的刷新函数（每个渲染都可能换引用，引擎只认它）。 */
  refresh: () => unknown;
}

function schedule(engine: PulseEngine): void {
  if (engine.cancelled) return;
  if (engine.timer !== null) return; // 已在窗口内 → 本批脉冲被合并
  engine.timer = setTimeout(() => {
    engine.timer = null;
    if (engine.inFlight) {
      engine.queued = true;
      return;
    }
    void run(engine);
  }, PULSE_COALESCE_MS);
}

async function run(engine: PulseEngine): Promise<void> {
  engine.inFlight = true;
  try {
    // 刷新函数返回 Promise 时，窗口内不会并发发起第二次（在飞期间只记一个待办）。
    await engine.refresh();
  } finally {
    engine.inFlight = false;
    if (engine.queued) {
      engine.queued = false;
      // 卸载后不得再排任何刷新（面板没了，invoke 还在跑）。
      if (!engine.cancelled) schedule(engine);
    }
  }
}

function cancel(engine: PulseEngine): void {
  engine.cancelled = true;
  engine.queued = false;
  if (engine.timer !== null) {
    clearTimeout(engine.timer);
    engine.timer = null;
  }
}

/**
 * 「团队有变化 → 把我这块数据重取一遍」的**唯一**实现。
 *
 * # 为什么收成一个 hook
 *
 * 一次拉数要做对四件事：**订阅**（`listen`）→ **`rev` 去重** → **合并窗口** → **卸载闩**。
 * 曾经三个读面（团队快照 / 团队列表 / 成员详情）各写一遍，其中一块漏掉「订阅」时，
 * 表现是「建了队、关过队、别人在另一窗口改了，列表页永远看不见」—— 而每块单独看都很对、
 * 测试也全绿。**失败是静默的**，所以「怎么失效」必须只有一个所有者。
 *
 * | 责任 | 归属 |
 * | --- | --- |
 * | `listen(AGENT_TEAM_EVENT)`（全局唯一订阅）| `store/teamStore` |
 * | `rev` 去重（陈旧脉冲不改状态）| `store/teamStore::applyPulse` |
 * | 合并窗口 / 在飞排队 / 卸载闩 | **本 hook** |
 * | 「我要刷新什么」| 调用方（传进来的 `refresh`）|
 *
 * 读面因此只声明一件事：**我要刷新什么**。它们不再各自 `listen`、不再各写一个时间窗。
 *
 * # 为什么不直接用 `lastRev` 作为「要不要拉」的判据
 *
 * 代数只回答「有没有新事实」，不回答「现在该不该拉」。合并窗口与在飞排队都是**时间**
 * 问题，混进同一个 `useEffect` 的依赖里就会退化成「每条脉冲一次拉取」（这正是修之前的样子）。
 */
export function usePulseRefresh(refresh: () => unknown, opts: PulseRefreshOptions = {}): void {
  const enabled = opts.enabled ?? true;
  /** 已应用的脉冲代数（store 只在**更新**的代数上推它，所以这里不需要再判重）。 */
  const rev = useTeamStore((s) => s.lastRev);

  /**
   * 引擎实例（**每个 hook 实例一个**，惰性创建）。
   *
   * 惰性发生在 effect / 回调里（`getEngine()`），不在渲染期：ref 的 `current` 只在渲染之外
   * 读写（`react-hooks/refs`），而 `useState` 的对象又不许在 effect 里改（`immutability`）。
   * 这是一个「每实例一份的可变盒子」，ref 正是它该待的地方。
   */
  const engineRef = useRef<PulseEngine | null>(null);
  const getEngine = useCallback((): PulseEngine => {
    let engine = engineRef.current;
    if (engine === null) {
      // `refresh` 先放一个会抛的占位：真正的值由下面的同步 effect 立刻写入 —— 若哪天顺序被
      // 破坏（比如有人在 effect 之前就排了窗口），这里会立刻炸而不是静默不刷新。
      engine = {
        timer: null,
        inFlight: false,
        queued: false,
        cancelled: false,
        refresh: () => {
          throw new Error('usePulseRefresh: refresh called before the engine was initialised');
        },
      };
      engineRef.current = engine;
    }
    return engine;
  }, []);

  /** 已排过刷新的代数（`enabled` 从关到开时，不拿一条旧代数补一次拉取）。 */
  const seenRev = useRef(rev);

  // ① 全局订阅由本 hook 的第一批挂载者建立（幂等，见 `ensureTeamPulseListener`）。
  useEffect(() => {
    ensureTeamPulseListener();
  }, []);

  // ② 最新刷新函数：每个渲染可能换引用，引擎只认这一个（所有 ref 同步集中在本 effect）。
  useEffect(() => {
    getEngine().refresh = refresh;
  }, [getEngine, refresh]);

  // ③ 卸载闩：清掉排队中的窗口，之后的脉冲不再唤醒任何请求。
  useEffect(() => {
    const engine = getEngine();
    engine.cancelled = false;
    return () => {
      cancel(engine);
    };
  }, [getEngine]);

  // ④ 新代数 → 排一次（窗口内合并）。`enabled === false` 时只推进水位线、不排。
  useEffect(() => {
    const engine = getEngine();
    if (!enabled) {
      seenRev.current = Math.max(seenRev.current, rev);
      return;
    }
    if (rev <= seenRev.current) return;
    seenRev.current = rev;
    schedule(engine);
  }, [getEngine, rev, enabled]);
}
