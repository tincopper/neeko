import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import type { StreamEvent } from '@/shared/types/agentChat';

import type {
  ChatMessage,
  ContextWindow,
  CtxInfo,
  PendingUserInput,
} from '../components/messageModel';
import { contextWindowOf, nextBlockId, nextMsgId } from '../components/messageModel';

/**
 * **会话级**状态（非话轮）：上下文、用户输入请求、计划、用量、错误。
 *
 * # 为什么与 `useTurnStream` 分家
 *
 * `useTurnStream` 管的是**话轮账本**：`turn_start` 开账，`turn_end` 平账，
 * 中间的文本/工具/审批都记在这一轮里，换一轮就清零。
 *
 * 本 hook 管的是**跨话轮存活**的东西：
 *
 * | 状态 | 生命周期 |
 * | --- | --- |
 * | 上下文（项目名 / env / cwd） | 整个会话 |
 * | 用量表 | 整个会话（每次 `meta` 覆盖） |
 * | 待回答的用户输入 / 计划卡片 | 直到用户处理 |
 *
 * 把它们塞进话轮账本会在 `turn_end` 时被误清 —— 用量表消失、计划卡片不见。
 *
 * # 接缝判据
 *
 * 「加一个新工具类别只动 `useTurnStream`，加一个会话级状态只动本文件。」
 *
 * # 与本 hook 无关的事件
 *
 * `session_start` / `config_option_update` 留在 `useAgentChat`：它们改的是
 * **能力位与配置项**（`useSessionConfigOptions` 的所有者），不属本 hook 的
 * 「对话过程状态」。
 */
/**
 * 两句**稳定性不同**的返回：调用方必须分开取。
 *
 * | 成员 | 身份 | 能进 `applyEvent` 的依赖数组？ |
 * | --- | --- | --- |
 * | `handle` | 稳定（只依赖 props 回调） | 能 |
 * | `state` | 每次状态变化都换 | **不能** —— 只能解构取值 |
 *
 * 拆成两个字段而不是拉平成一个对象，是因为后者让人看不见这个区别：
 * 曾经的实现把 `handle` 与 state 混在同一个 `useMemo` 里、并把 state 写进
 * 依赖数组，结果是「每次会话级状态变化都换新对象」：
 *
 * ```
 * meta 事件（每个话轮都发）→ contextWindow 变 → 返回对象新身份
 *   → applyEvent 身份失效 → listen 的 effect 依赖它 → unlisten + listen
 *   → 最早到达的事件落进拆装窗口 → 前端收不到握手
 * ```
 *
 * 正是 `quality-guidelines.md` §15 的事故链，只换了文件重现。
 */
export interface SessionLevelEvents {
  /** 稳定：可以放进任何依赖数组。 */
  handle: (ev: StreamEvent) => boolean;
  /** 易变：每次状态变化都是新对象，**禁止**整个进依赖数组。 */
  state: {
    /** 当前会话的待回答用户输入（`user_input` 事件）。 */
    pendingUserInput: PendingUserInput | null;
    setPendingUserInput: (next: PendingUserInput | null) => void;
    /** agent 提出的计划（`proposed_plan` 事件）。 */
    proposedPlan: string | null;
    setProposedPlan: (next: string | null) => void;
    /** 上下文用量（`meta` 事件）。 */
    contextWindow: ContextWindow | null;
  };
}

export function useSessionLevelEvents(params: {
  /** 工作目录等会话元信息（`context_init` 事件）。 */
  onContextInit: (info: CtxInfo) => void;
  /** 出错时把已排队的流式增量先冲出去（否则最后一段文本会丢）。 */
  flushDeltas: () => void;
  setStreaming: (value: boolean) => void;
  /** 消息流 state setter（系统消息在这里追加 —— 本 hook 是唯一消费者）。 */
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}): SessionLevelEvents {
  const { onContextInit, flushDeltas, setStreaming, setMessages } = params;
  /** 往消息流里追加一条系统消息（错误提示等）。`setMessages` 身份稳定，无依赖负担。 */
  const appendSystemMessage = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: 'system', blocks: [{ kind: 'text', id: nextBlockId(), text }] },
      ]);
    },
    [setMessages],
  );
  const [pendingUserInput, setPendingUserInput] = useState<PendingUserInput | null>(null);
  const [proposedPlan, setProposedPlan] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState<ContextWindow | null>(null);

  const handle = useCallback(
    (ev: StreamEvent): boolean => {
      switch (ev.type) {
        case 'context_init':
          onContextInit({
            projectName: ev.project_name,
            env: ev.env,
            cwd: ev.cwd,
            workspaceKey: ev.workspace_key,
          });
          return true;
        case 'user_input':
          setPendingUserInput({ turnId: ev.turn_id, prompt: ev.prompt, options: ev.options });
          return true;
        case 'proposed_plan':
          setProposedPlan(ev.plan);
          return true;
        case 'meta': {
          const meter = contextWindowOf(ev);
          if (meter) setContextWindow(meter);
          return true;
        }
        case 'error':
          flushDeltas();
          setStreaming(false);
          appendSystemMessage(`⚠ ${ev.message} (${ev.code})`);
          return true;
        default:
          // **必须返回 false**：调用方 `if (sub.handle(ev)) return;` 会把返回
          // true 的事件当成「已处理」而不再往下走 —— 对未识别事件也返回 true
          // 会静默吞掉 `session_start` / `config_option_update` / 话轮事件。
          return false;
      }
    },
    [onContextInit, flushDeltas, setStreaming, appendSystemMessage],
  );

  // 两句返回的稳定性不同（见 `SessionLevelEvents` 的表格）：
  //
  // - `handle` 只依赖 props 回调 → 稳定；
  // - `state` 每次状态变化都是新对象 → **禁止**整个进依赖数组。
  //
  // 外层也 memo，但只为让调用方拿到的容器身份稳定；**真正的事故根因不是
  // 容器，而是把 `state` 塞进了依赖数组** —— 那会让容器随每次状态变化重建。
  const state = useMemo(
    () => ({
      pendingUserInput,
      setPendingUserInput,
      proposedPlan,
      setProposedPlan,
      contextWindow,
    }),
    [pendingUserInput, proposedPlan, contextWindow],
  );

  return useMemo(() => ({ handle, state }), [handle, state]);
}
