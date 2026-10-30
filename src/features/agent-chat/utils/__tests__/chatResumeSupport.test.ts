import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/shared/types/agent';
import { createAgent } from '@/testing/factories';

/**
 * `supportsChatResume` 是前端**唯一**的「能不能恢复为 Agent Chat」判据门面。
 *
 * 这里钉五件事：
 * 1. 同一个 agent 在**同一份配置**下只发一次 IPC（列表每行都会问，不缓存就是每行一次）；
 * 2. 并发调用合并到同一次查询；
 * 3. **失败不缓存**：`false`（后端真的说不支持）是答案，查询失败不是 —— 后者一律重问；
 * 4. 空 agentId 短路，不发 IPC；
 * 5. **配置一变就失效**：能力是 `(agent, 传输)` 的属性，用户改完 chat 命令后
 *    同一个 agentId 的答案会变 —— 只按 id 缓存会让入口显隐失真到重启。
 */

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  convertFileSrc: (p: string) => p,
}));

type AgentStore = (typeof import('@/shared/store/agentStore'))['useAgentStore'];

/**
 * 缓存与 agent 快照都是模块级状态：每个用例重新加载**同一代**的 store + 门面。
 *
 * 必须一起动态 import：`vi.resetModules()` 之后 `chatResumeSupport` 拿到的是一个
 * **新的** `agentStore` 实例；若测试写的是顶层 import 的那份，两边看到的快照不同
 * （签名永远不变，失效逻辑根本测不到）。
 */
async function load(): Promise<{
  supportsChatResume: (agentId: string) => Promise<boolean>;
  store: AgentStore;
  setAgents: (...agents: AgentConfig[]) => void;
}> {
  vi.resetModules();
  const { useAgentStore } = await import('@/shared/store/agentStore');
  const { supportsChatResume } = await import('../chatResumeSupport');

  return {
    supportsChatResume,
    store: useAgentStore,
    setAgents: (...agents: AgentConfig[]) => useAgentStore.setState({ agents, loading: false }),
  };
}

const PI_RPC = { args: ['--mode', 'rpc'] };
const PI_ACP = { args: ['acp'] };

describe('supportsChatResume', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the backend once per agent and reuses the answer', async () => {
    const { supportsChatResume, setAgents } = await load();
    setAgents(createAgent({ id: 'pi', chat: PI_RPC }));
    invoke.mockResolvedValue(true);

    await expect(supportsChatResume('pi')).resolves.toBe(true);
    await expect(supportsChatResume('pi')).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('agent_chat_supports_resume', { agentId: 'pi' });
  });

  it('caches a negative answer too', async () => {
    const { supportsChatResume, setAgents } = await load();
    setAgents(createAgent({ id: 'claude-code', chat: PI_ACP }));
    invoke.mockResolvedValue(false);

    await expect(supportsChatResume('claude-code')).resolves.toBe(false);
    await expect(supportsChatResume('claude-code')).resolves.toBe(false);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  /**
   * **配置变更必须失效**：同一个 agentId 从 `--mode rpc` 改成 `acp` 后，旧的答案
   * 已经不成立（后端会解析出另一个适配器）。
   *
   * 变异验证：缓存键退回「只有 agentId」→ 本用例红（第二次仍返回缓存的 `true`）。
   */
  it('re-queries after the agent chat launch changes', async () => {
    const { supportsChatResume, setAgents, store } = await load();
    // 答案由当前快照里的 chat 命令决定（模拟后端的传输分派）。
    invoke.mockImplementation(async (_cmd: string, args?: unknown) => {
      const { agentId } = args as { agentId: string };
      const agent = store.getState().byId(agentId);
      return agent?.chat?.args?.includes('rpc') === true;
    });

    setAgents(createAgent({ id: 'pi', chat: PI_RPC }));
    await expect(supportsChatResume('pi')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);

    // 用户在设置里把 chat 命令改成 ACP —— 同一个 id，能力变了。
    setAgents(createAgent({ id: 'pi', chat: PI_ACP }));
    await expect(supportsChatResume('pi')).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);

    // 每个 agent 只留一条缓存：来回切一次就再查一次（不会拿回更早的答案）。
    setAgents(createAgent({ id: 'pi', chat: PI_RPC }));
    await expect(supportsChatResume('pi')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  /** 用户关掉 chat 能力（`chat_enabled: false`）同样是一次答案变化。 */
  it('re-queries after the agent chat capability is toggled off', async () => {
    const { supportsChatResume, setAgents } = await load();
    invoke.mockResolvedValue(true);

    setAgents(createAgent({ id: 'pi', chat: PI_RPC }));
    await expect(supportsChatResume('pi')).resolves.toBe(true);

    setAgents(createAgent({ id: 'pi', chat: PI_RPC, chat_enabled: false }));
    await expect(supportsChatResume('pi')).resolves.toBe(true); // 答案由 mock 决定
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('short-circuits on an empty agent id without IPC', async () => {
    const { supportsChatResume } = await load();

    await expect(supportsChatResume('')).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('queries different agents independently', async () => {
    const { supportsChatResume } = await load();
    invoke.mockImplementation(async (_cmd: string, args?: unknown) => {
      const { agentId } = args as { agentId: string };
      return agentId === 'pi';
    });

    await expect(supportsChatResume('pi')).resolves.toBe(true);
    await expect(supportsChatResume('codex')).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  /**
   * **答不出 ≠ 答 false**：查询失败（IPC 层问题）不得被缓存成「不支持」。
   *
   * `agent_chat_supports_resume` 自己从不返回 Err，所以 reject 只可能是 bridge 未就绪 /
   * 命令未注册。旧实现把这种失败缓存成 false，于是一次抖动把入口隐藏到下次配置变更
   * —— 实际就是重启。现在失败只删本次条目，下一次调用重新问。
   *
   * 变异验证：把 catch 里的 `cache.delete` 去掉 → 本用例红（invoke 只被调用 1 次）。
   */
  it('does not cache a failed query', async () => {
    const { supportsChatResume, setAgents } = await load();
    setAgents(createAgent({ id: 'pi', chat: PI_RPC }));

    invoke.mockRejectedValueOnce(new Error('ipc bridge not ready'));
    await expect(supportsChatResume('pi')).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);

    // 第二次必须重新问，而不是命中刚才那个 false。
    invoke.mockResolvedValueOnce(true);
    await expect(supportsChatResume('pi')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  /** 并发调用合并到同一次查询（列表首屏会同时问多个 agent，不能重复打）。 */
  it('dedupes concurrent queries for the same agent', async () => {
    const { supportsChatResume, setAgents } = await load();
    setAgents(createAgent({ id: 'pi', chat: PI_RPC }));
    invoke.mockResolvedValue(true);

    const [a, b] = await Promise.all([supportsChatResume('pi'), supportsChatResume('pi')]);

    expect([a, b]).toEqual([true, true]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
