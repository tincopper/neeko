import { dapEvaluate, dapStackTrace, dapVariables } from '../../api/debugApi';
import { ensureStopSourceTab } from '../../navigate';
import { buildStopLocation, pickStopFrame } from '../../stackFrames';
import type { DapSessionInfo, StackFrameDto } from '../../types';

import {
  CLEAR_EXPANSION,
  isLiveSession,
  logDebugStackError,
  notifyError,
  withStopLocation,
} from './shared';
import { isSameGeneration, nextGeneration, stopContextUnchanged } from './stopGeneration';
import type { DebugSliceCreator, DebugStackSlice } from './types';

/** Delve 的栈 race 是瞬态的：失败后等一小会儿重取一次（仅一次）。 */
const STACK_RETRY_DELAY_MS = 150;

/**
 * 调用栈 / 当前帧 / 求值上下文。
 *
 * 不变式：
 * - **代际守卫**：每次刷新先取新代际（使在途旧链失效）；所有 `await` 之后落地前必须
 *   `isCurrent()`，否则整条链放弃 —— 慢链覆盖快链会让「黄线在新停点、编辑器停在旧停点」。
 * - **原子写**：`frames` / `selectedFrameId` / `location` / `locationSeq` 必须在**同一次 `set`**
 *   内落地，否则会出现「新位置 + 旧帧」的可观测中间态。
 * - **位置单写者**：位置一律由 `buildStopLocation` 构造（规范身份），停点与切帧共用。
 * - 每次刷新前清空变量展开缓存（新的暂停上下文 → 旧 `variablesReference` 全部失效）。
 * - 停止位置 = 栈顶第一个带源码的帧（**不**优先项目帧，否则「单步进入 JDK / 库」会跳回调用方）。
 */
export const createStackSlice: DebugSliceCreator<DebugStackSlice> = (set, get) => {
  /** 代际是否仍是当前有效代际（否则该链的一切落地都必须放弃）。 */
  const isCurrent = (generation: { sessionId: string; seq: number }): boolean =>
    isSameGeneration(get().generation, generation);

  /**
   * 确保「这一帧的源码」在编辑器里可见 —— **只做 tab 生命周期，不承载跳转语义**
   * （跳到哪一行由编辑器从 `location` 派生）。
   *
   * `isCurrent` 是落地许可：内容加载完成后若这次停点 / 这一帧已被取代，则放弃建 tab 与激活。
   */
  const ensureSourceVisible = (
    nav: StackFrameDto,
    live: DapSessionInfo,
    sessionId: string,
    isCurrent: () => boolean,
  ): void => {
    void ensureStopSourceTab(
      {
        projectId: live.projectId,
        projectPath: live.projectPath,
        frame: nav,
        sessionId,
        isCurrent,
      },
      (message) => get().pushConsole('err', message),
    );
  };

  return {
    frames: [],
    variables: [],
    selectedFrameId: null,
    location: null,
    locationSeq: 0,
    generation: null,

    beginStop: (sessionId) => {
      const generation = nextGeneration(sessionId);
      set({ generation });
      return generation;
    },

    refreshStackAndVars: async () => {
      const sid = get().session?.sessionId;
      const session = get().session;
      if (!sid || !session || !isLiveSession(session)) return;

      // 先占代际：此刻起，所有在途旧链的落地都会被 isCurrent 拦下。
      const generation = get().beginStop(sid);

      // New stopped context: previously fetched child variables are stale.
      set({ ...CLEAR_EXPANSION });

      /** 帧 / 选中帧 / 位置原子落地，随后确保源码可见并取变量。 */
      const applyStop = async (frames: StackFrameDto[]): Promise<void> => {
        if (!isCurrent(generation)) return;
        const live = get().session;
        if (!live) return;

        if (frames.length === 0) {
          set({
            frames: [],
            variables: [],
            selectedFrameId: null,
            ...withStopLocation(get(), null),
          });
          return;
        }

        // 停止位置 = 栈顶第一个带源码的帧（编辑器跟随栈顶帧，与 IDE 一致）。
        const nav = pickStopFrame(frames) ?? frames[0];
        set({
          frames,
          selectedFrameId: nav.id,
          ...withStopLocation(get(), buildStopLocation(nav, live.projectPath)),
        });

        ensureSourceVisible(nav, live, sid, () => isCurrent(generation));

        // 变量拉取失败**只记日志**（与栈刷新同一策略）：它不该让整条停点链的收尾被当成
        // 「栈刷新失败」而触发重试 / 弹错 —— 帧与位置已经落地，用户已经能看到停点。
        try {
          const variables = await dapVariables(sid, nav.id);
          // 变量属于「这一次停点的这一帧」：代际变了或已被切帧，结果就必须丢弃。
          if (!isCurrent(generation)) return;
          if (get().selectedFrameId !== nav.id) return;
          set({ variables });
        } catch (e) {
          if (!isCurrent(generation)) return;
          logDebugStackError(String(e));
        }
      };

      try {
        const frames = await dapStackTrace(sid);
        await applyStop(frames);
      } catch (e) {
        // Transient Delve races (Dummy thread) — retry once, avoid noisy toast.
        logDebugStackError(String(e));
        try {
          await new Promise((r) => setTimeout(r, STACK_RETRY_DELAY_MS));
          if (!isCurrent(generation)) return;
          const frames = await dapStackTrace(sid);
          await applyStop(frames);
        } catch (e2) {
          if (!isCurrent(generation)) return;
          get().pushConsole('err', String(e2));
        }
      }
    },

    selectFrame: async (frameId) => {
      const sid = get().session?.sessionId;
      const live = get().session;
      if (!sid || !live || !isLiveSession(live)) return;
      const frame = get().frames.find((f) => f.id === frameId);
      if (!frame) return;
      // 代际快照：切帧不新开代际，但新停点到达必须让这条链的后续落地失效
      //（DAP 数字帧 id 极易碰撞，单靠 selectedFrameId 会误判为「仍是这一帧」）。
      // 复查用 `stopContextUnchanged` 而非 `isSameGeneration`：切帧不 beginStop，
      // 「捕获时无代际、复查时仍无代际」是**未变**（否则未经过 beginStop 的停止态
      // ——attach 到已暂停进程 / 测试直接 seed——切帧会静默不写变量、不打开源码 tab）。
      const generationAtSelect = get().generation;

      // 切帧不是新的停点事件：**代际保持不变**（否则在途的变量请求会被整批判死），
      // 「位置变了」由 locationSeq 表达。位置同样经唯一构造点归一。
      set({
        selectedFrameId: frameId,
        ...CLEAR_EXPANSION,
        ...withStopLocation(get(), buildStopLocation(frame, live.projectPath)),
      });

      // 点栈帧同样要确保源码可见（组件不再自行打开 tab）；落地许可是「仍选中这一帧」：
      // 用户快速改选别的帧时，前一帧迟到的内容不得抢激活。新停点（代际变化）同样作废旧许可。
      ensureSourceVisible(
        frame,
        live,
        sid,
        () =>
          get().selectedFrameId === frameId &&
          stopContextUnchanged(get().generation, generationAtSelect),
      );

      try {
        const variables = await dapVariables(sid, frameId);
        if (!isLiveSession(get().session)) return;
        if (!stopContextUnchanged(get().generation, generationAtSelect)) return;
        if (get().selectedFrameId !== frameId) return;
        set({ variables });
      } catch (e) {
        notifyError(String(e));
      }
    },

    evaluate: async (expression) => {
      const sid = get().session?.sessionId;
      if (!sid || !isLiveSession(get().session)) {
        get().pushConsole('err', 'No active debug session');
        return;
      }
      get().pushConsole('in', expression);
      try {
        const result = await dapEvaluate(sid, expression, get().selectedFrameId);
        get().pushConsole('out', result || '(no result)');
      } catch (e) {
        get().pushConsole('err', String(e));
      }
    },
  };
};
