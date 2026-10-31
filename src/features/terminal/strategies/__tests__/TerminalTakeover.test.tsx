// @vitest-environment jsdom
import { render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 接管既有后端会话（`TerminalTabData.existingSessionId`）的策略层回归。
 *
 * 背景：团队队长/成员的 PTY 由 Rust 侧建好（`start_team_session` 返回 `terminal_id`），
 * 前端必须在**不新建** `create_terminal_session` 的前提下把那个会话渲染出来。三条不变式：
 *
 * 1. 带 `existingSessionId` 的 local tab：**零次** `create_terminal_session`，且 drain 的
 *    目标就是该 id（接管不需要新握手 —— credit-pull 的缓冲按 session 存在后端）；
 * 2. 普通 tab：照旧新建（防回归）；
 * 3. wsl / remote + `existingSessionId`：**显式报错**，不静默新建 —— 否则用户看到两个终端，
 *    其中一个永远空着，而团队 PTY 明明在跑。
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
import type { Project } from '@/shared/types';
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
const WSL_PROJECT = createProject({
  id: PROJECT_ID,
  environment: { type: 'Wsl', distro: 'Ubuntu' } as Project['environment'],
});

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

function wrapper(activeTabId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider value={appValue}>
        <EditorProvider value={editorValue(activeTabId)}>{children}</EditorProvider>
      </AppProvider>
    );
  };
}

/** 播种一个 terminal tab（可选接管既有会话），并把它设为该 tab 空间的前台。 */
function seedTerminalTab(data: Partial<TerminalTabData> = {}): void {
  useEditorStore.getState().addTab({
    id: TAB_ID,
    scope: { kind: 'workspace', session: WorkspaceSession.of(PROJECT_ID, null) },
    title: 'Team Lead',
    data: { kind: 'terminal', agentId: null, status: 'Idle', ...data },
  });
  useEditorStore.getState().activateTab(SPACE, TAB_ID);
}

/** 组件级：真实策略 + TerminalViewBase（drain 循环只在这里才会真的发 invoke）。 */
function Harness({ tabId }: { tabId: string }) {
  const strategy = useTerminalStrategy({ paneId: 'p1' });
  if (!strategy) return null;
  return <TerminalViewBase strategy={strategy} tabAgentId={null} activeTabId={tabId} />;
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

describe('接管既有后端会话（existingSessionId）', () => {
  it('local 接管：零次 create_terminal_session，drain 目标 = 既有会话 id', async () => {
    seedTerminalTab({ existingSessionId: TAKEN_OVER_SESSION });

    renderHarness(TAB_ID);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'terminal_drain_wait',
        expect.objectContaining({ sessionId: TAKEN_OVER_SESSION }),
      );
    });

    // 关键判据：接管**不新建** PTY（否则后端多一个没人消费的会话，团队那个仍然看不见）。
    expect(createSessionCalls()).toHaveLength(0);
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

  it('wsl + existingSessionId：显式报错，不静默新建（也不发 create_terminal_session）', async () => {
    useProjectStore.setState({ projects: [WSL_PROJECT], activeProject: WSL_PROJECT });
    seedTerminalTab({ existingSessionId: TAKEN_OVER_SESSION });

    const { result } = renderHook(() => useTerminalStrategy({ paneId: 'p1' }), {
      wrapper: wrapper(TAB_ID),
    });

    expect(result.current?.kind).toBe('wsl');
    await expect(result.current!.createSession(80, 24)).rejects.toThrow(/cannot attach/i);

    expect(createSessionCalls()).toHaveLength(0);
  });

  it('remote + existingSessionId：显式报错，不静默新建', async () => {
    const remoteProject = createProject({
      id: PROJECT_ID,
      environment: {
        type: 'Remote',
        host: 'example.com',
        port: 22,
        username: 'me',
        auth: { Password: 'x' },
      },
    });
    useProjectStore.setState({ projects: [remoteProject], activeProject: remoteProject });
    seedTerminalTab({ existingSessionId: TAKEN_OVER_SESSION });

    const { result } = renderHook(
      () =>
        useTerminalStrategy({
          paneId: 'p1',
          remoteConfig: {
            entryId: 'entry-1',
            host: 'example.com',
            port: 22,
            username: 'me',
            auth: { Password: 'x' },
          },
        }),
      { wrapper: wrapper(TAB_ID) },
    );

    expect(result.current?.kind).toBe('remote');
    await expect(result.current!.createSession(80, 24)).rejects.toThrow(/cannot attach/i);

    expect(createSessionCalls()).toHaveLength(0);
  });

  it('local 接管：不再新建时，终端不会以「连接失败」收场', async () => {
    seedTerminalTab({ existingSessionId: TAKEN_OVER_SESSION });

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
