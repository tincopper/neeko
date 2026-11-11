// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * **接回既有会话**（`TerminalTabData.attachSessionId`）的策略层回归。
 *
 * 背景：团队队长/成员的 PTY 由 Rust 侧建好（`start_team_session` 返回 `terminal_id`）并登记
 * 进 live-sessions 注册表，前端必须在**不新建** `create_terminal_session` 的前提下把它渲染
 * 出来。判据三条：
 *
 * 1. 带 `attachSessionId` 的 tab：**零次** `create_terminal_session`，drain 的目标就是该 id
 *    （会话还活着时不需要新握手 —— credit-pull 的缓冲按 session 存在后端）；
 * 2. 探针说「会话已经不在」（`detach_terminal_session` 回 `false`）：照常新建一条，不报错 ——
 *    后端那条已经结束了，接着用一个死 id 只会得到一个永远空的终端；
 * 3. 普通 tab：照旧新建（防回归）。
 *
 * 接回与「接管」的差别（为什么这里没有 wsl/remote 报错用例）：主线用注册表里的会话探活，
 * 传输维度不参与判断 —— 团队在 WSL/SSH 上起的会话同样能接回。
 */

// ── xterm 替身：只保留 TerminalViewBase 实际触碰的表面（惯例同 TaskConsoleOutput.test.tsx）
const xtermMocks = vi.hoisted(() => {
  const written: string[] = [];
  class MockTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: '' as string };
    buffer = { active: { viewportY: 0, baseY: 0 } };
    loadAddon() {}
    open() {}
    write(data: Uint8Array, cb?: () => void) {
      written.push(new TextDecoder().decode(data));
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
  return { written, MockTerminal, MockFitAddon, MockUnicode11Addon };
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

// 输入链路与文件链接：与本用例无关，替身掉（避免真实 xterm 事件面依赖）。
vi.mock('@/shared/utils/terminalInput', () => ({
  setupTerminalInput: () => ({ dispose: vi.fn() }),
}));
vi.mock('@/features/terminal/components/terminalLinks', () => ({
  setupTerminalLinks: vi.fn(),
}));

import { terminalCache } from '@/features/terminal/components/terminalCache';
import { useTerminalStrategy } from '@/features/terminal/strategies';
import { AppProvider, EditorProvider } from '@/shared/contexts';
import type { EditorContextValue } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { TerminalTabData } from '@/shared/types/tab';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import TerminalViewBase from '../../components/TerminalViewBase';

const invokeMock = vi.mocked(invoke);

const TAKEN_OVER_SESSION = 'team-lead-session-1';
const FRESH_SESSION = 'fresh-session-1';

const PROJECT_ID = 'p1' as ProjectId;
const LOCAL_PROJECT = createProject({ id: PROJECT_ID, environment: { type: 'Local' } });
const SPACE = WorkspaceSession.of(PROJECT_ID, null).key;
const TAB_ID = 'tab_takeover';

const appValue = {
  config: {
    terminalFontSize: 13,
    fontFamily: 'monospace',
    monoFontFamily: 'monospace',
    terminalGpuAcceleration: false,
    shell: null,
  } as never,
  customThemes: [],
  agents: [],
  agentInstalledMap: {},
  loading: false,
  ideCommandOverrides: {},
  showToast: vi.fn(),
  saveConfig: async () => {},
};

function editorValue(activeTabId: string): EditorContextValue {
  return {
    tabs: [],
    activeTabId,
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onAddTab: vi.fn(),
    agents: [],
    compactMode: false,
    showAgentBar: false,
    hiddenAgentIds: [],
    onToggleHiddenAgent: vi.fn(),
    onAgentClick: vi.fn(),
  };
}

/** 播种一个 terminal tab（可选接回既有会话），并把它设为该 tab 空间的前台。 */
function seedTerminalTab(data: Partial<TerminalTabData> = {}): void {
  useEditorStore.getState().addTab({
    id: TAB_ID,
    scope: { kind: 'workspace', session: WorkspaceSession.of(PROJECT_ID, null) },
    title: 'Team Lead',
    data: { kind: 'terminal', agentId: null, ...data },
  });
  useEditorStore.getState().activateTab(SPACE, TAB_ID);
}

/**
 * 组件级：真实策略 + TerminalViewBase（drain 循环只在这里才会真的发 invoke）。
 *
 * `attachSessionId` 从 tab data 里读出来再传下去 —— 与生产链一致：`TerminalView` 就是
 * 这么把 `tab.data.attachSessionId` 交给 `TerminalViewBase` 的（本文件不绕过那一层，
 * 否则用例会证明「prop 传对了」，而真实路径上没人传）。
 */
function Harness({ tabId }: { tabId: string }) {
  const strategy = useTerminalStrategy({ paneId: 'p1' });
  const tab = useEditorStore
    .getState()
    .tabs[SPACE]?.tabs.find((candidate) => candidate.id === tabId);
  const attachSessionId = tab?.data.kind === 'terminal' ? (tab.data.attachSessionId ?? null) : null;
  if (!strategy) return null;
  return (
    <TerminalViewBase
      strategy={strategy}
      tabAgentId={null}
      activeTabId={tabId}
      attachSessionId={attachSessionId}
    />
  );
}

function renderHarness(tabId: string) {
  return render(
    <AppProvider value={appValue}>
      <EditorProvider value={editorValue(tabId)}>
        <Harness tabId={tabId} />
      </EditorProvider>
    </AppProvider>,
  );
}

function createSessionCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === 'create_terminal_session');
}

beforeEach(() => {
  terminalCache.clear();
  xtermMocks.written.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      // long-poll 挂起式 drain：等价于后端「暂无数据」，挂住直到 dispose。
      case 'terminal_drain_wait':
        return new Promise<ArrayBuffer>(() => {});
      case 'terminal_drain':
        return Promise.resolve(new ArrayBuffer(0));
      // 存活探针：`attachLiveSession` 用 `detach(id, false)` 判会话还在不在。
      case 'detach_terminal_session':
        return Promise.resolve(true);
      case 'create_terminal_session':
        return Promise.resolve({
          id: FRESH_SESSION,
          pid: 1,
          status: 'Running',
          history: [],
          agent: null,
        });
      default:
        return Promise.resolve(undefined);
    }
  });

  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useProjectStore.setState({ projects: [LOCAL_PROJECT], activeProject: LOCAL_PROJECT });
});

afterEach(() => {
  terminalCache.clear();
});

describe('接回既有会话（attachSessionId）', () => {
  it('接回：零次 create_terminal_session，drain 目标 = 既有会话 id', async () => {
    seedTerminalTab({ attachSessionId: TAKEN_OVER_SESSION });

    renderHarness(TAB_ID);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'terminal_drain_wait',
        expect.objectContaining({ sessionId: TAKEN_OVER_SESSION }),
      );
    });

    // 关键判据：接回**不新建** PTY（否则后端多一个没人消费的会话，团队那个仍然看不见）。
    expect(createSessionCalls()).toHaveLength(0);
    // 探针走的是「关分离态 + 探活」那条命令，不是再开一条会话
    expect(invokeMock).toHaveBeenCalledWith('detach_terminal_session', {
      sessionId: TAKEN_OVER_SESSION,
      detached: false,
    });
  });

  it('探针说会话已不在：照常新建（不报错、也不留一个永远空的终端）', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case 'detach_terminal_session':
          return Promise.resolve(false);
        case 'terminal_drain_wait':
          return new Promise<ArrayBuffer>(() => {});
        case 'terminal_drain':
          return Promise.resolve(new ArrayBuffer(0));
        case 'create_terminal_session':
          return Promise.resolve({
            id: FRESH_SESSION,
            pid: 1,
            status: 'Running',
            history: [],
            agent: null,
          });
        default:
          return Promise.resolve(undefined);
      }
    });
    seedTerminalTab({ attachSessionId: TAKEN_OVER_SESSION });

    renderHarness(TAB_ID);

    await waitFor(() => {
      expect(createSessionCalls()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'terminal_drain_wait',
        expect.objectContaining({ sessionId: FRESH_SESSION }),
      );
    });
  });

  it('普通 tab 仍然新建会话（防回归），drain 目标 = 新建出来的 id', async () => {
    seedTerminalTab();

    renderHarness(TAB_ID);

    await waitFor(() => {
      expect(createSessionCalls()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'terminal_drain_wait',
        expect.objectContaining({ sessionId: FRESH_SESSION }),
      );
    });
  });

  it('接回：终端不会以「连接失败」收场', async () => {
    seedTerminalTab({ attachSessionId: TAKEN_OVER_SESSION });

    renderHarness(TAB_ID);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'terminal_drain_wait',
        expect.objectContaining({ sessionId: TAKEN_OVER_SESSION }),
      );
    });

    expect(xtermMocks.written.join('')).not.toContain('Failed to connect');
  });
});
