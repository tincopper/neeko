/**
 * 会话生命周期 hook 的关键行为（`renderHook` 直测）。
 *
 * 此前只有静态源码扫描护栏，测的是「代码里有这行字符串」而不是行为 ——
 * 那类断言在重构（改名、抽函数）时误报，在真缺陷（顺序、漏清理）上不报。
 *
 * 三条都是**真机缺陷**的钉子：
 * 1. 切 agent 必须先把旧会话交还后端（否则每切一次泄漏一个 agent 子进程）。
 * 2. 静默会话必须带上已选模型（否则 ACP 的 `create()` 预切分支拿不到 model_id）。
 * 3. 首次落定 agent 也要开会话（否则选择器直到发第一条消息才出现）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/agentChatApi', () => ({
  openAgentChat: vi.fn(() => Promise.resolve('sid-new')),
  cancelAgentStream: vi.fn(() => Promise.resolve()),
}));

import { cancelAgentStream, openAgentChat } from '../../api/agentChatApi';
import { useAgentSessionLifecycle } from '../useAgentSessionLifecycle';

const baseParams = {
  tabKey: 'tab-key',
  tabId: 'tab-1',
  initialSessionId: undefined as string | undefined,
  modelId: undefined as string | undefined,
};

describe('useAgentSessionLifecycle', () => {
  beforeEach(() => {
    vi.mocked(openAgentChat).mockClear();
    vi.mocked(cancelAgentStream).mockClear();
  });

  /** 首次落定 agent（空 → 有值）就必须开会话，否则选择器要到发消息才出现。 */
  it('opens a silent session when the agent first settles', async () => {
    renderHook(() => useAgentSessionLifecycle({ ...baseParams, agentId: 'pi' }));

    await waitFor(() => expect(openAgentChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openAgentChat).mock.calls[0][0]).toMatchObject({ agentId: 'pi' });
  });

  /** `agentId` 仍为空（用户还没选）→ 不建会话。 */
  it('does nothing while the agent is still unset', async () => {
    renderHook(() => useAgentSessionLifecycle({ ...baseParams, agentId: undefined }));
    await Promise.resolve();
    expect(openAgentChat).not.toHaveBeenCalled();
  });

  /**
   * **切 agent 必须先 cancel 旧会话**。
   *
   * 只把 sessionId 置空不会让后端知道会话已废弃：它仍注册在
   * `AgentChatManager`，子进程继续存活，而前端永远拿不回那个 id 去取消。
   */
  it('cancels the previous session before opening a new one', async () => {
    const { rerender } = renderHook(
      (props: { agentId: string }) =>
        useAgentSessionLifecycle({ ...baseParams, agentId: props.agentId }),
      { initialProps: { agentId: 'pi' } },
    );

    // 等首个静默会话建好（此时 sessionIdRef = sid-new）
    await waitFor(() => expect(openAgentChat).toHaveBeenCalledTimes(1));

    act(() => {
      rerender({ agentId: 'opencode' });
    });

    await waitFor(() => expect(cancelAgentStream).toHaveBeenCalledWith('sid-new'));
    // 取消与新会话各发生一次，顺序由 discardSession 的结构保证
    await waitFor(() => expect(openAgentChat).toHaveBeenCalledTimes(2));
  });

  /** 值没变（重复渲染）→ 不重复开会话、不误取消。 */
  it('does not churn when the agent value is unchanged', async () => {
    const { rerender } = renderHook(
      (props: { agentId: string }) =>
        useAgentSessionLifecycle({ ...baseParams, agentId: props.agentId }),
      { initialProps: { agentId: 'pi' } },
    );
    await waitFor(() => expect(openAgentChat).toHaveBeenCalledTimes(1));

    act(() => {
      rerender({ agentId: 'pi' });
    });

    expect(cancelAgentStream).not.toHaveBeenCalled();
    expect(openAgentChat).toHaveBeenCalledTimes(1);
  });

  /**
   * **静默会话必须带上已选模型**。
   *
   * ACP 在 `create()` 里按 `ctx.model_id` 预切模型（那是「新会话最容易漏掉
   * 的一条路径」）。不带 `modelId` 就等于白建一个会话，随后真实 Turn 还得再切
   * 一次，中途 UI 显示与实际不一致。
   */
  it('passes the selected model into the silent session', async () => {
    renderHook(() =>
      useAgentSessionLifecycle({ ...baseParams, agentId: 'pi', modelId: 'deepseek-flash' }),
    );

    await waitFor(() => expect(openAgentChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openAgentChat).mock.calls[0][0]).toMatchObject({
      modelId: 'deepseek-flash',
    });
  });

  /** 未选模型 → 不传 `modelId`（让 agent 用默认，而不是传 `undefined` 字符串）。 */
  it('omits modelId when no model is selected', async () => {
    renderHook(() => useAgentSessionLifecycle({ ...baseParams, agentId: 'pi' }));
    await waitFor(() => expect(openAgentChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(openAgentChat).mock.calls[0][0].modelId).toBeUndefined();
  });

  /** 静默会话失败只记日志，不打断用户（真正的错误留给发消息那一轮）。 */
  it('swallows silent-session failures', async () => {
    vi.mocked(openAgentChat).mockRejectedValueOnce(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderHook(() => useAgentSessionLifecycle({ ...baseParams, agentId: 'pi' }));

    await waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
