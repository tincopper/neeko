import { useCallback, useEffect, useRef } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import { cancelAgentStream, openAgentChat } from '../api/agentChatApi';

/**
 * 会话生命周期：**agent 变了就换会话**，并为新 agent 预先开一个静默会话。
 *
 * # 为什么选中 agent 就要开会话
 *
 * 模型 / 推理档位 / 模式都只存在于会话的 `configOptions` 里。等用户发第一条
 * 消息才建会话，这几个选择器会先缺席、发完消息再突然出现 —— 体验割裂。
 * 先开一个静默会话（不发 prompt）就能让工具条在选中那一刻就是完整的；
 * 随后的 `agent_stream` 会走续聊分支复用同一个会话。
 *
 * # 为什么清空判据只看 agent
 *
 * 切模型有独立通道：`modelId` 随 `Turn` 传给后端，在**同一会话内**切换。
 * 把模型纳入判据会与「自动落位」形成死锁：`SessionStart` 带 `config_options`
 * → `useSelectedModelSync` 填成首个模型 → 判据命中 → 刚拿到的 `sessionId`
 * 被清空 → 后续 `text_delta` 全部因 sid 不匹配被丢弃，界面停在 thinking。
 * （ACP 侥幸没踩到：它的 `SessionStart` 早于 sid 赋值到达。）
 */
export interface AgentSessionLifecycle {
  /** 当前会话 id 的可变引用（事件过滤与续聊都用它）。 */
  sessionIdRef: React.MutableRefObject<string | undefined>;
  /** 为新 agent 开一个静默会话（选 agent 时自动调用）。 */
  openSilentSession: () => Promise<void>;
  /** 丢弃当前会话（通知后端停掉 + 清本地身份）。恢复外部目标会话前也用。 */
  discardSession: () => void;
  /**
   * 预置「当前 agent」基线，使紧接着的切换 effect **不要**清空会话。
   *
   * 恢复历史会话时用：先外部 `updateTab` 了 agentId，再拿到 resume 的 sessionId；
   * 若不清基线，effect 会把刚恢复的会话当成「旧 agent 的」清掉。
   */
  primeAgentBaseline: (agentId: string) => void;
}

export function useAgentSessionLifecycle(params: {
  agentId: string | undefined;
  projectId: ProjectId;
  /** 执行地址（tab 所属工作区单元）：静默会话的 cwd 由它决定。 */
  workspace: WorkspaceSession;
  tabKey: string;
  tabId: string;
  initialSessionId: string | undefined;
  /**
   * 当前用户选择的模型 id（`undefined` = 未选，用 agent 默认）。
   *
   * 由调用方**传入值**而不是 hook 自己读 store：静默会话需要它在 `create()` 时
   * 预切模型（ACP 在握手后就切），但会话生命周期不知道模型是怎么选出来的。
   */
  modelId: string | undefined;
  /** agent 变化时一并清空的东西（如会话配置项）。 */
  onAgentChanged?: () => void;
  /**
   * 把 `sid` 赋值**之前**到达、被暂存的事件应用到 state。
   *
   * 静默会话的 `SessionStart` 在 `await openAgentChat()` 返回之前就 emit 了
   * （后端 `create()` 里发），那时 `sessionIdRef` 还是空 → 事件被调用方暂存。
   * 赋值后不主动消费，它们永远躺在 pending 里 —— 表现是「会话建好了，但
   * 模型列表还是会话外那份（`--list-models`），档位/模式也不出现」。
   */
  flushPendingEvents?: (sid: string) => void;
}): AgentSessionLifecycle {
  const {
    agentId,
    projectId,
    workspace,
    tabKey,
    tabId,
    initialSessionId,
    modelId,
    onAgentChanged,
    flushPendingEvents,
  } = params;
  const sessionIdRef = useRef<string | undefined>(initialSessionId);

  /**
   * 为当前 agent 开一个静默会话（不发 prompt）。
   *
   * 失败静默：这只是「提前把选择器填好」的优化，不能因为它在后台报错就打断
   * 用户 —— 发消息时 `agent_stream` 会重新建会话并给出真正的错误。
   */
  const openSilentSession = useCallback(async () => {
    if (!agentId) return;
    try {
      const sid = await openAgentChat({
        agentId,
        workspace,
        prompt: '',
        mode: 'auto',
        // 模型必须带上：ACP 在 `create()` 里会按 `ctx.model_id` 预切（`acp.rs`
        // “新会话是容易被忽略的一条路径”）。不带就等于白建一个会话，
        // 随后真实 `Turn` 还得再切一次，且中途 UI 显示与实际不一致。
        modelId,
      });
      sessionIdRef.current = sid;
      useEditorStore.getState().updateTab(tabKey, tabId, { sessionId: sid });
      // 会话的 configOptions 就在暂存事件里 —— 不消费它们，模型列表会一直
      // 停留在会话外那份（`--list-models` 的 `provider/model` 复合串）。
      flushPendingEvents?.(sid);
    } catch (err) {
      console.warn('[session-lifecycle] silent session open failed', err);
    }
  }, [agentId, projectId, workspace, tabKey, tabId, modelId, flushPendingEvents]);

  /**
   * 丢弃当前会话：先通知后端收掉，再清本地身份。
   *
   * # 为什么必须 cancel
   *
   * 只把 `sessionId` 置空不会让后端知道这个会话已经废弃：它仍注册在
   * `AgentChatManager`，子进程（或 serve 的 SSE 连接）继续存活，而前端已经
   * 忘掉了 id —— 永远不会再发 `agent_stream_cancel`。反复切换 agent 就是
   * 每次都泄漏一个进程。
   *
   * 两条路径（切 agent / 开新静默会话前）共用它，避免只修一处。
   */
  const discardSession = useCallback(() => {
    const stale = sessionIdRef.current;
    sessionIdRef.current = undefined;
    useEditorStore.getState().updateTab(tabKey, tabId, { sessionId: undefined });
    if (stale) void cancelAgentStream(stale).catch(() => undefined);
  }, [tabKey, tabId]);

  const prevAgentRef = useRef<string>('');
  useEffect(() => {
    const key = agentId ?? '';
    const prevKey = prevAgentRef.current;
    prevAgentRef.current = key;

    // 两种情况都要（重新）建会话：
    // 1. **首次落定 agent**（`prevKey === ''` → 有值）：tab 新建时 `agentId`
    //    往往是空的，用户在 chat 里第一次选 agent 就属于这种 —— 若只处理
    //    「切换」，这一次永远不会建会话，模型列表于是停留在我会话外那份。
    // 2. **切换 agent**：清掉旧会话，为新 agent 重开。
    //
    // 不处理的是「首次仍是空」（还没选 agent）与「值没变」（重复渲染）。
    const firstSettle = prevKey === '' && key !== '';
    const switched = prevKey !== '' && prevKey !== key;
    if (!firstSettle && !switched) return;

    discardSession();
    onAgentChanged?.();
    void openSilentSession();
    // openSilentSession / onAgentChanged / discardSession 由调用方保证稳定，不参与触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, tabKey, tabId]);

  const primeAgentBaseline = useCallback((next: string) => {
    prevAgentRef.current = next;
  }, []);

  return { sessionIdRef, openSilentSession, primeAgentBaseline, discardSession };
}
