import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRemoteActions } from "@/features/connection/hooks/useRemoteActions";
import { useConnectionStore } from "@/features/connection/store";
import { useProjectStore } from "@/features/project/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from '@/shared/store';
import type { RemoteEntrySession } from '@/shared/types';
import {
  switchAgentInRemoteTerminal,
  refreshRemoteTerminal,
} from "@/features/terminal/components/terminalCache";

vi.mock("@/features/terminal/components/terminalCache", () => ({
  remoteCacheKey: (entryId: string, projectId: string) => `remote:${entryId}:${projectId}`,
  switchAgentInRemoteTerminal: vi.fn().mockResolvedValue(undefined),
  refreshRemoteTerminal: vi.fn(),
}));

const mockSwitchAgent = vi.mocked(switchAgentInRemoteTerminal);
const mockRefreshTerminal = vi.mocked(refreshRemoteTerminal);

function makeRemoteProject(id = "rp1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `proj-${id}`,
    path: `/home/user/${id}`,
    entry_id: "entry-1",
    selected_agents: [] as string[],
    selected_ide: null,
    ...overrides,
  };
}

function makeRemoteEntry(overrides: Partial<RemoteEntrySession> = {}): RemoteEntrySession {
  return {
    id: "entry-1",
    host: "192.168.1.1",
    port: 22,
    username: "user",
    projects: [makeRemoteProject("rp1")],
    saved_auth: null,
    ...overrides,
  };
}

const DEFAULT_CONFIG = {
  terminalFontSize: 14,
  fontFamily: "",
  agentCommandOverrides: {},
} as never;

function seedStore(overrides: {
  remoteEntries?: RemoteEntrySession[];
} = {}) {
  const entry = makeRemoteEntry();
  const project = makeRemoteProject("rp1");
  const unifiedProject = {
    id: "rp1",
    name: "proj-rp1",
    path: "/home/user/rp1",
    environment: { type: "Remote" as const, host: "192.168.1.1", port: 22, username: "user", auth: { Password: "pass" } },
    git_info: null,
    terminal: { id: "t1", pid: null, status: "Idle" as const, history: [], agent: null },
    selected_agents: [] as string[],
    selected_ide: null as string | null,
    active_view: "Terminal" as const,
    collapsed: false,
    avatar_color: null,
  };
  useProjectStore.setState({
    projects: [unifiedProject],
    activeProjectId: "rp1",
    activeProject: unifiedProject,
    isTerminalView: false,
  });
  useConnectionStore.setState({
    remoteEntries: overrides.remoteEntries ?? [entry],
    wslEntries: [],
    remoteAuthStore: new Map(),
    pendingAuthEntry: null,
  });
  useWorktreeStore.setState({
    activeWorktreePath: null,
    openedWorktrees: [],
    worktreeStateMap: {},
  });
  useEditorStore.setState({
    tabs: {},
  });
}

describe("useRemoteActions", () => {
  const mockSaveSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSaveSession.mockResolvedValue(undefined);
    mockSwitchAgent.mockResolvedValue(undefined);
    seedStore();
  });

  describe("updateProjectAgent", () => {
    it("更新 remoteEntries 中的 selected_agent", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      act(() => {
        result.current.updateProjectAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.remoteEntries[0].projects[0].selected_agents).toEqual(["claude-code"]);
    });

    it("更新 useProjectStore 中 activeProject 的 selected_agent", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      act(() => {
        result.current.updateProjectAgent(agent);
      });

      const state = useProjectStore.getState();
      expect(state.activeProject?.selected_agents).toEqual(["claude-code"]);
    });

    it("传入 null 时清空 selected_agent", () => {
      const entry = makeRemoteEntry();
      const unifiedProject = {
        id: "rp1",
        name: "proj-rp1",
        path: "/home/user/rp1",
        environment: { type: "Remote" as const, host: "192.168.1.1", port: 22, username: "user", auth: { Password: "[redacted]" } },
        git_info: null,
        terminal: { id: "t1", pid: null, status: "Idle" as const, history: [], agent: null },
        selected_agents: ["old-agent"] as string[],
        selected_ide: null as string | null,
        active_view: "Terminal" as const,
        collapsed: false,
        avatar_color: null,
      };
      useProjectStore.setState({ projects: [unifiedProject], activeProjectId: "rp1", activeProject: unifiedProject });
      useConnectionStore.setState({ remoteEntries: [entry] });

      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent(null);
      });

      const connectionState = useConnectionStore.getState();
      expect(connectionState.remoteEntries[0].projects[0].selected_agents).toEqual([]);
      const projectState = useProjectStore.getState();
      expect(projectState.activeProject?.selected_agents).toEqual([]);
    });

    it("调用 saveSession 持久化", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
    });

    it("不调用 switchAgentInRemoteTerminal", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it("不调用 refreshRemoteTerminal", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(mockRefreshTerminal).not.toHaveBeenCalled();
    });
  });

  describe("handleSelectAgent", () => {
    it("传入 agent 时调用 switchAgentInRemoteTerminal", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      await act(async () => {
        result.current.handleSelectAgent(agent);
      });

      expect(mockSwitchAgent).toHaveBeenCalledWith(
        "remote:entry-1:rp1",
        "claude-code",
        {},
      );
    });

    it("传入 agent 时同时更新 selected_agent 状态", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      await act(async () => {
        result.current.handleSelectAgent(agent);
      });

      const connectionState = useConnectionStore.getState();
      expect(connectionState.remoteEntries[0].projects[0].selected_agents).toEqual(["claude-code"]);
      const projectState = useProjectStore.getState();
      expect(projectState.activeProject?.selected_agents).toEqual(["claude-code"]);
    });

    it("传入 null 时不调用 switchAgentInRemoteTerminal", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectAgent(null);
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it("传入 null 时通过 setTimeout 调用 refreshRemoteTerminal", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectAgent(null);
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(mockRefreshTerminal).toHaveBeenCalledWith("remote:entry-1:rp1");
    });
  });
});
