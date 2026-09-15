import { sourceIdentityOf } from '@/shared/utils/fileRef';

import { dapEvaluate, dapStackTrace, dapVariables } from '../../api/debugApi';
import { openSourceAtLine, openVirtualSourceAtLine } from '../../navigate';
import { virtualSourceIdentity } from '../../sourceContent';
import { pickStopFrame } from '../../stackFrames';
import type { DapSessionInfo, StackFrameDto } from '../../types';

import { CLEAR_EXPANSION, isLiveSession, logDebugStackError, notifyError } from './shared';
import type { DebugSliceCreator, DebugStackSlice } from './types';

/**
 * 调用栈 / 当前帧 / 求值上下文。
 *
 * 不变式：
 * - 每次刷新前清空变量展开缓存（新的暂停上下文 → 旧 `variablesReference` 全部失效）。
 * - 所有 await 之后必须用 `stillLive()` 重新确认会话身份：会话可能已结束或被替换，
 *   把过期结果写回会覆盖新会话的栈。
 * - 停止位置 = 栈顶第一个带源码的帧（**不**优先项目帧，否则「单步进入 JDK / 库」会跳回调用方）。
 */
export const createStackSlice: DebugSliceCreator<DebugStackSlice> = (set, get) => ({
  frames: [],
  variables: [],
  selectedFrameId: null,
  stoppedAt: null,

  refreshStackAndVars: async () => {
    const sid = get().session?.sessionId;
    const session = get().session;
    if (!sid || !session || !isLiveSession(session)) return;

    // New stopped context: previously fetched child variables are stale.
    set({ ...CLEAR_EXPANSION });

    /** Drop stale work if session ended or was replaced mid-await. */
    const stillLive = (): DapSessionInfo | null => {
      const s = get().session;
      if (!s || s.sessionId !== sid || !isLiveSession(s)) return null;
      return s;
    };

    const applyFrames = async (frames: StackFrameDto[], live: DapSessionInfo) => {
      if (!stillLive()) return;
      set({ frames });

      if (frames.length === 0) {
        set({ variables: [], selectedFrameId: null, stoppedAt: null });
        return;
      }

      // 停止位置 = 栈顶第一个带源码的帧（编辑器跟随栈顶帧，与 IDE 一致）。
      // 不再优先项目帧：那会把「单步进入 JDK / 库」跳回调用方文件。
      const nav = pickStopFrame(frames);
      const selected = nav ?? frames[0];
      set({ selectedFrameId: selected.id });

      const onOpenError = (message: string) => get().pushConsole('err', message);
      if (nav?.sourcePath) {
        // stoppedAt 与 tab 身份同一套规范（JDK 缓存路径收敛成 jdt 身份），
        // 黄线判定退化为精确相等，不需要任何别名归一。
        set({
          stoppedAt: {
            filePath: sourceIdentityOf(live.projectPath, nav.sourcePath),
            line: nav.line,
            column: nav.column,
          },
        });
        void openSourceAtLine(
          live.projectId,
          live.projectPath,
          nav.sourcePath,
          nav.line,
          nav.column,
          {
            sessionId: sid,
            onError: onOpenError,
          },
        );
      } else if (nav?.sourceReference) {
        const identity = virtualSourceIdentity(nav.sourceReference, nav.sourceName);
        set({
          stoppedAt: {
            filePath: identity,
            line: nav.line,
            column: nav.column,
          },
        });
        void openVirtualSourceAtLine(
          live.projectId,
          nav.sourceName,
          nav.sourceReference,
          nav.line,
          nav.column,
          {
            sessionId: sid,
            onError: onOpenError,
          },
        );
      } else {
        set({ stoppedAt: null });
      }

      if (!stillLive()) return;
      try {
        const variables = await dapVariables(sid, selected.id);
        if (!stillLive()) return;
        set({ variables });
      } catch (e) {
        if (!stillLive()) return;
        logDebugStackError(String(e));
      }
    };

    try {
      const frames = await dapStackTrace(sid);
      const live = stillLive();
      if (!live) return;
      await applyFrames(frames, live);
    } catch (e) {
      // Transient Delve races (Dummy thread) — retry once, avoid noisy toast.
      const msg = String(e);
      logDebugStackError(msg);
      try {
        await new Promise((r) => setTimeout(r, 150));
        if (!stillLive()) return;
        const frames = await dapStackTrace(sid);
        const live = stillLive();
        if (!live) return;
        await applyFrames(frames, live);
      } catch (e2) {
        if (!stillLive()) return;
        get().pushConsole('err', String(e2));
      }
    }
  },

  selectFrame: async (frameId) => {
    const sid = get().session?.sessionId;
    if (!sid || !isLiveSession(get().session)) return;
    set({ selectedFrameId: frameId, ...CLEAR_EXPANSION });
    const frame = get().frames.find((f) => f.id === frameId);
    if (frame?.sourcePath) {
      set({
        stoppedAt: {
          filePath: frame.sourcePath,
          line: frame.line,
          column: frame.column,
        },
      });
    } else if (frame?.sourceReference) {
      set({
        stoppedAt: {
          filePath: virtualSourceIdentity(frame.sourceReference, frame.sourceName),
          line: frame.line,
          column: frame.column,
        },
      });
    }
    try {
      const variables = await dapVariables(sid, frameId);
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
});
