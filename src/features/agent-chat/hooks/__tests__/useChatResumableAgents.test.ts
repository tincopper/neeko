import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '@/testing/factories';

import { useChatResumableAgents } from '../useChatResumableAgents';

/**
 * 入口显隐的派生 hook：把「哪些 agent 支持 chat 恢复」一次算成 Set。
 *
 * 容器层（ConversationsPanelWrapper）用它算一次、按 `Set` 下传给整张列表 ——
 * 组件不得自行发起 IPC。
 *
 * 用 `importOriginal` 保留真实的 `chatLaunchSignature`：依赖签名正是被测的派生逻辑，
 * 换成 mock 里的副本就测不到「配置一变就重查」了。
 */

const { supportsMock } = vi.hoisted(() => ({
  supportsMock: vi.fn<(agentId: string) => Promise<boolean>>(),
}));

vi.mock('../../utils/chatResumeSupport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/chatResumeSupport')>();
  return { ...actual, supportsChatResume: supportsMock };
});

const PI_RPC = { args: ['--mode', 'rpc'] };
const OPENCODE_SERVE = { args: ['serve'] };
const CLAUDE_ACP = { args: ['acp'] };

function agents(chatArgs = 'default') {
  return [
    createAgent({ id: 'pi', chat: chatArgs === 'acp' ? CLAUDE_ACP : PI_RPC }),
    createAgent({ id: 'opencode', chat: OPENCODE_SERVE }),
    createAgent({ id: 'claude-code', chat: CLAUDE_ACP }),
  ];
}

describe('useChatResumableAgents', () => {
  beforeEach(() => {
    supportsMock.mockReset();
    supportsMock.mockImplementation(async (id: string) => id === 'pi' || id === 'opencode');
  });

  it('collects the agents that support chat resume', async () => {
    const { result } = renderHook(() => useChatResumableAgents(agents()));

    await waitFor(() => expect(result.current.size).toBe(2));
    expect([...result.current].sort()).toEqual(['opencode', 'pi']);
    expect(result.current.has('claude-code')).toBe(false);
  });

  it('queries every agent exactly once, in parallel', async () => {
    const { result } = renderHook(() => useChatResumableAgents(agents()));

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(supportsMock.mock.calls.map(([id]) => id).sort()).toEqual([
      'claude-code',
      'opencode',
      'pi',
    ]);
  });

  /**
   * `agents` 每次渲染都是新数组（来自 context）时**不得重新查询** ——
   * 依赖必须是内容的序列化投影，不是数组身份。
   */
  it('does not re-query when the agents array identity changes but ids do not', async () => {
    const { result, rerender } = renderHook(({ list }) => useChatResumableAgents(list), {
      initialProps: { list: agents() },
    });
    await waitFor(() => expect(result.current.size).toBe(2));

    rerender({ list: agents() });
    rerender({ list: agents() });

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(supportsMock).toHaveBeenCalledTimes(3);
  });

  /**
   * **反向**：用户改完某 agent 的 chat 命令（`pi: --mode rpc → acp`）后必须重查 ——
   * 只投影 agentId 会让入口显隐失真到重启。
   *
   * 变异验证：依赖退回 `agents.map((a) => a.id)` → 本用例红。
   */
  it('re-queries when an agent chat launch changes', async () => {
    const { result, rerender } = renderHook(({ list }) => useChatResumableAgents(list), {
      initialProps: { list: agents() },
    });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(supportsMock).toHaveBeenCalledTimes(3);

    // 同一个 pi，chat 命令换成 ACP（能力因此变化）。
    supportsMock.mockImplementation(async (id: string) => id === 'opencode');
    rerender({ list: agents('acp') });

    await waitFor(() => expect(result.current.size).toBe(1));
    expect([...result.current]).toEqual(['opencode']);
  });

  /** 卸载后到达的查询结果不得写 state（否则会报错 / 警告）。 */
  it('is unmount-safe', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release: (v: boolean) => void = () => {};
    supportsMock.mockImplementation(() => new Promise<boolean>((resolve) => (release = resolve)));

    const { unmount } = renderHook(() => useChatResumableAgents(agents()));
    unmount();

    release(true);
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
