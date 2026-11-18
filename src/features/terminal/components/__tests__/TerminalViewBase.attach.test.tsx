// @vitest-environment jsdom
import { emit } from '@tauri-apps/api/event';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import type { AgentConfig } from '@/shared/types';
import { invoke } from '@/testing/tauriCore';

import type { CacheEntry, TerminalStrategy } from '../../strategies/types';
import TerminalViewBase from '../TerminalViewBase';

/**
 * **接回失败不得静默降级成新建**（`attachSessionId` 的 attach-only 契约）。
 *
 * 调用方给出 `attachSessionId` 的语义是「只要那一条还活着的 PTY，不要替代品」。
 * 探针（`detach_terminal_session(id, false)`）回 `false` 时旧实现落到
 * `createSessionVal(...)` 并因 `attached === null` 自动拉起 agent —— 对团队成员的会话
 * 那是一条**没有团队 MCP 端点 / 凭证 / 隔离配置目录**的裸 CLI：它带着队长 preamble 起来，
 * 却调不到任何 `team_*` 工具，而用户以为「打开的就是那个队长的会话」。
 *
 * 判据（缺一条即失效）：
 * 1. 探针 false ⇒ `strategy.createSession` **零调用**、失效提示可见；
 * 2. 探针 false ⇒ 不启动写管线（零 `terminal_drain*` invoke）、不自动拉起 agent（零
 *    `terminal-input-*` emit）；
 * 3. 探针 true ⇒ 不新建、无提示、正常 ready（既有接回路径零回归）；
 * 4. 无 `attachSessionId` ⇒ 照常新建（既有行为不变）。
 *
 * 策略是注入的端口（`TerminalStrategy`），所以这一层脱离 PTY 直测：不碰后端。
 */

// ── xterm 替身：只保留 TerminalViewBase 实际触碰的表面（惯例同 TerminalAttach.test.tsx）
const xtermMocks = vi.hoisted(() => {
  class MockTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: '' as string };
    buffer = { active: { viewportY: 0, baseY: 0 } };
    loadAddon() {}
    open() {}
    write(_data: Uint8Array, cb?: () => void) {
      cb?.();
    }
    onScroll() {
      return { dispose: () => {} };
    }
    focus() {}
    scrollToBottom() {}
    dispose() {}
  }
  class MockFitAddon {
    fit() {}
  }
  class MockUnicode11Addon {
    dispose() {}
  }
  return { MockTerminal, MockFitAddon, MockUnicode11Addon };
});

vi.mock('@xterm/xterm', () => ({ Terminal: xtermMocks.MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xtermMocks.MockFitAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: xtermMocks.MockUnicode11Addon }));

// 渲染器 / 终端销毁：jsdom 无 GPU/字体测量，走既有终端测试的替身面。
vi.mock('@/shared/utils/terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils/terminal')>()),
  applyRenderer: vi.fn().mockResolvedValue(undefined),
  resumeWebglRenderer: vi.fn().mockResolvedValue(undefined),
  suspendWebglRenderer: vi.fn(),
  healWebglRenderer: vi.fn(),
  safeDisposeTerminal: vi.fn(),
}));

// 输入链路：与本用例无关（自动拉起走 `emit` 直写，不经过输入控制器）。
vi.mock('@/shared/utils/terminalInput', () => ({
  setupTerminalInput: () => ({ dispose: vi.fn() }),
}));

const invokeMock = vi.mocked(invoke);
const emitMock = vi.mocked(emit);

const ATTACH_ID = 'team-lead-session-1';
const FRESH_ID = 'fresh-session-1';
const CACHE_KEY = 'keyA';
const AGENT_ID = 'agent-1';

const createSessionMock = vi.fn<TerminalStrategy['createSession']>();

function makeStrategy(cache: Map<string, CacheEntry>): TerminalStrategy {
  return {
    kind: 'local',
    cacheKey: CACHE_KEY,
    cache,
    rebuildCallbacks: new Map(),
    wrapperRefs: new Map(),
    createSession: createSessionMock,
    resize: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    agentDelayMs: 0,
    fontSize: 13,
    fontFamily: 'Mono',
    gpuAccel: false,
  };
}

/** 探针回 `alive`；drain long-poll 永久挂起（等价后端「暂无数据」）。 */
function mockBackend(alive: boolean): void {
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'detach_terminal_session':
        return Promise.resolve(alive);
      case 'terminal_drain_wait':
        return new Promise<ArrayBuffer>(() => {});
      case 'terminal_drain':
        return Promise.resolve(new ArrayBuffer(0));
      default:
        return Promise.resolve(undefined);
    }
  });
}

/** 自动拉起 agent 的唯一可观测出口（`emit(terminal-input-{id}, bytes)`）。 */
function terminalInputEmits(): unknown[][] {
  return emitMock.mock.calls.filter(([name]) => String(name).startsWith('terminal-input'));
}

/** 写管线的唯一可观测出口（credit-pull 的 `terminal_drain` / `terminal_drain_wait`）。 */
function drainInvokes(): unknown[][] {
  return invokeMock.mock.calls.filter(([cmd]) => String(cmd).startsWith('terminal_drain'));
}

beforeEach(() => {
  createSessionMock.mockReset();
  createSessionMock.mockResolvedValue(FRESH_ID);
  emitMock.mockClear();
  invokeMock.mockReset();
  // agent 缓存里**真的有**这个 agent：于是「不自动拉起」不是「查不到 agent 所以没拉起」
  // —— 否则断言会被一次静默的 miss 满足（假 GREEN）。
  useAgentStore
    .getState()
    .setAgents([
      { id: AGENT_ID, name: 'Agent One', command: 'agent-one', args: [] } as AgentConfig,
    ]);
});

afterEach(() => {
  useAgentStore.setState({ agents: null, loading: false });
});

describe('接回是 attach-only（探针失败不新建）', () => {
  it('探针 false：不新建会话、显示失效提示、不启写管线、不自动拉起 agent', async () => {
    mockBackend(false);
    const cache = new Map<string, CacheEntry>();

    render(
      <TerminalViewBase
        strategy={makeStrategy(cache)}
        tabAgentId={AGENT_ID}
        activeTabId="tA"
        attachSessionId={ATTACH_ID}
      />,
    );

    expect(await screen.findByTestId('terminal-attach-failed')).toHaveTextContent(
      'This session has ended.',
    );

    // 让「自动拉起」那条 setTimeout(agentDelayMs) 有机会跑 —— 否则「零 emit」可能只是没到点。
    await new Promise((resolve) => setTimeout(resolve, 20));

    // ① 关键判据：零新建（新建出来的是一条没有团队 MCP / 凭证的裸 CLI）
    expect(createSessionMock).not.toHaveBeenCalled();
    // ② 没有会话可投递 ⇒ 不启写管线、不拉起 agent
    expect(drainInvokes()).toHaveLength(0);
    expect(terminalInputEmits()).toHaveLength(0);
    // ③ 失效态替换掉「Connecting…」（不是叠在它上面）
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
    // ④ entry 不拥有会话 ⇒ 销毁路径不会去关一条不属于自己的会话
    expect(cache.get(CACHE_KEY)?.sessionId).toBeNull();
  });

  it('探针 true：接回既有会话，不新建也不提示（既有路径零回归）', async () => {
    mockBackend(true);
    const cache = new Map<string, CacheEntry>();

    render(
      <TerminalViewBase
        strategy={makeStrategy(cache)}
        tabAgentId={AGENT_ID}
        activeTabId="tA"
        attachSessionId={ATTACH_ID}
      />,
    );

    // drain 挂到**既有**会话 id 上 = 接回成功（ready 之后才会订阅）
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('terminal_drain_wait', {
        sessionId: ATTACH_ID,
        timeoutMs: expect.any(Number),
      }),
    );

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('terminal-attach-failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
  });

  it('没有 attachSessionId：照常新建（既有行为不变）', async () => {
    mockBackend(true);
    const cache = new Map<string, CacheEntry>();

    render(
      <TerminalViewBase strategy={makeStrategy(cache)} tabAgentId={AGENT_ID} activeTabId="tA" />,
    );

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('terminal_drain_wait', {
        sessionId: FRESH_ID,
        timeoutMs: expect.any(Number),
      }),
    );

    expect(screen.queryByTestId('terminal-attach-failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
  });
});
