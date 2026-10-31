import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useWslActions } from '@/features/connection/hooks/useWslActions';
import { switchAgentInTerminal } from '@/features/terminal';
/* eslint-disable import/no-restricted-paths -- test mocks terminal refresh for wsl actions */
import { refreshTerminalForSession } from '@/features/terminal/components/terminalCache';
/* eslint-enable import/no-restricted-paths */
import { useConnectionStore } from '@/shared/store/connectionStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { WSLEntrySession } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

vi.mock('@/features/terminal', () => ({
  switchAgentInTerminal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/terminal/components/terminalCache', () => ({
  refreshTerminalForSession: vi.fn(),
}));

const mockSwitchAgent = vi.mocked(switchAgentInTerminal);
const mockRefreshTerminal = vi.mocked(refreshTerminalForSession);

function makeWslProject(id = 'wp1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `proj-${id}`,
    path: `/home/user/${id}`,
    entry_id: 'e1',
    selected_agents: [] as string[],
    selected_ide: null,
    ...overrides,
  };
}

const DEFAULT_CONFIG = {
  terminalFontSize: 14,
  fontFamily: '',
  agentCommandOverrides: {},
} as never;

function createWslProject(id = 'wp1') {
  return {
    id,
    name: `proj-${id}`,
    path: `/home/user/${id}`,
    environment: { type: 'Wsl' as const, distro: 'Ubuntu' },
    git_info: null,
    terminal: { id: 't1', pid: null, status: 'Idle' as const, history: [], agent: null },
    selected_agents: [] as string[],
    selected_ide: null,
    active_view: 'Terminal' as const,
    collapsed: false,
  };
}

function seedStore(
  overrides: {
    wslEntries?: WSLEntrySession[];
    activeWslProject?: { distro: string; project: ReturnType<typeof makeWslProject> };
  } = {},
) {
  const project = makeWslProject('wp1');
  const coreProject = createWslProject('wp1');
  useProjectStore.setState({
    activeProjectId: 'wp1',
    activeProject: coreProject,
    isTerminalView: false,
  });
  useConnectionStore.setState({
    wslEntries: overrides.wslEntries ?? [{ id: 'e1', distro: 'Ubuntu', projects: [project] }],
    remoteEntries: [],
    remoteAuthStore: new Map(),
    pendingAuthEntry: null,
  });
  useWorkspaceStore.setState({ byProject: {} });
  useEditorStore.setState({
    tabs: {},
  });
}

/**
 * 在该项目的 tab 空间里放一个前台终端 tab。
 *
 * `handleSelectAgent` 现在必须先经 `foregroundTerminalTab` 仲裁拿到精确 tabId
 * （决议 R1/R3）；没有终端 tab 时它**什么都不做**（design T6）—— 所以本组用例
 * 需要一个真实可仲裁的目标，而不是指望旧的「Map 插入顺序首个」。
 */
function seedTerminalTab(activeTabId: string | null = 'wp1-term'): void {
  const session = WorkspaceSession.of('wp1', null);
  // 前台由布局派生（`selectActiveTabId`）：seed layout，缺失则前台恒 null。
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = ['wp1-term'];
  layout.groups.left.activeTabId = activeTabId;
  useEditorStore.setState((state) => ({
    tabs: {
      ...state.tabs,
      [session.key]: {
        tabs: [
          {
            id: 'wp1-term',
            scope: { kind: 'workspace', session },
            title: 'Terminal 1',
            data: { kind: 'terminal', agentId: null },
          } as never,
        ],
      },
    },
    editorLayout: { ...state.editorLayout, [session.key]: layout },
  }));
}

describe('useWslActions', () => {
  const mockSaveSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSaveSession.mockResolvedValue(undefined);
    mockSwitchAgent.mockResolvedValue(undefined);
    seedStore();
  });

  describe('updateProjectAgent', () => {
    it('更新 wslEntries 中的 selected_agent', () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = {
        id: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: {},
        icon: null,
        enabled: true,
      };

      act(() => {
        result.current.updateProjectAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.wslEntries[0].projects[0].selected_agents).toEqual(['claude-code']);
    });

    it('更新 activeProject 的 selected_agent', () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = {
        id: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: {},
        icon: null,
        enabled: true,
      };

      act(() => {
        result.current.updateProjectAgent(agent);
      });

      const state = useProjectStore.getState();
      expect(state.activeProject?.selected_agents).toEqual(['claude-code']);
    });

    it('传入 null 时清空 selected_agent', () => {
      useProjectStore.setState({
        activeProject: {
          id: 'wp1',
          name: 'proj-wp1',
          path: '/home/user/wp1',
          environment: { type: 'Wsl', distro: 'Ubuntu' },
          git_info: null,
          terminal: { id: 't1', pid: null, status: 'Idle', history: [], agent: null },
          selected_agents: ['old-agent'],
          selected_ide: null,
          active_view: 'Terminal',
          collapsed: false,
        },
      });

      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent(null);
      });

      const state = useProjectStore.getState();
      expect(state.activeProject?.selected_agents).toEqual([]);
    });

    it('调用 saveSession 持久化', () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent({
          id: 'claude-code',
          name: 'Claude Code',
          command: 'claude',
          args: [],
          env: {},
          icon: null,
          enabled: true,
        });
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
    });

    it('不调用 switchAgentInTerminal', () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent({
          id: 'claude-code',
          name: 'Claude Code',
          command: 'claude',
          args: [],
          env: {},
          icon: null,
          enabled: true,
        });
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it('不调用 refreshTerminalForSession', () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent({
          id: 'claude-code',
          name: 'Claude Code',
          command: 'claude',
          args: [],
          env: {},
          icon: null,
          enabled: true,
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(mockRefreshTerminal).not.toHaveBeenCalled();
    });
  });

  describe('handleSelectAgent', () => {
    it('传入 agent 时调用 switchAgentInTerminal', async () => {
      seedTerminalTab(); // 仲裁需要真实可命中的前台终端（R1/R3）
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = {
        id: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: {},
        icon: null,
        enabled: true,
      };

      await act(async () => {
        result.current.handleSelectAgent(agent);
      });

      expect(mockSwitchAgent).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'wp1', worktreePath: null }),
        'wp1-term',
        'claude-code',
      );
    });

    it('传入 agent 时同时更新 selected_agent 状态', async () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = {
        id: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: {},
        icon: null,
        enabled: true,
      };

      await act(async () => {
        result.current.handleSelectAgent(agent);
      });

      const state = useProjectStore.getState();
      expect(state.activeProject?.selected_agents).toEqual(['claude-code']);
      const connState = useConnectionStore.getState();
      expect(connState.wslEntries[0].projects[0].selected_agents).toEqual(['claude-code']);
    });

    it('传入 null 时不调用 switchAgentInTerminal', async () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectAgent(null);
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it('传入 null 时通过 setTimeout 刷新该 session 的前台终端', async () => {
      seedTerminalTab();
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectAgent(null);
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      // 旧断言传 null =「让内部去取 Map 插入顺序首个」，那条第二口径已按 R3 删除；
      // 现在 tabId 恒为 `foregroundTerminalTab` 仲裁出的精确值。
      expect(mockRefreshTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'wp1', worktreePath: null }),
        'wp1-term',
      );
    });
  });
});
