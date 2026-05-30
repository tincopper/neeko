import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRemoteActions } from "@/features/connection/hooks/useRemoteActions";
import { useConnectionStore } from "@/features/connection/store";
import { useProjectStore } from "@/features/project/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from "@/app/editor/store";
import type { RemoteEntrySession } from "@/types";
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
    selected_agent: null as string | null,
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
  activeRemoteProject?: { entry: RemoteEntrySession; project: ReturnType<typeof makeRemoteProject> };
} = {}) {
  const entry = makeRemoteEntry();
  const project = makeRemoteProject("rp1");
  useProjectStore.setState({
    activeProjectId: null,
    activeProject: null,
    isTerminalView: false,
  });
  useConnectionStore.setState({
    remoteEntries: overrides.remoteEntries ?? [entry],
    activeRemoteProject: overrides.activeRemoteProject ?? { entry, project },
    wslEntries: [],
    activeWslKey: null,
    activeWslProject: null,
    activeRemoteKey: { host: "192.168.1.1", projectId: "rp1" },
    remoteAuthStore: new Map(),
    pendingAuthEntry: null,
  });
  useWorktreeStore.setState({
    activeWorktreePath: null,
    openedWorktrees: [],
    wslOpenedWt: [],
    activeWslWorktreePath: null,
    remoteOpenedWt: [],
    activeRemoteWorktreePath: null,
    worktreeState: {},
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

  describe("updateRemoteProjectAgent", () => {
    it("更新 remoteEntries 中的 selected_agent", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      act(() => {
        result.current.updateRemoteProjectAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.remoteEntries[0].projects[0].selected_agent).toBe("claude-code");
    });

    it("更新 activeRemoteProject 的 selected_agent", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      act(() => {
        result.current.updateRemoteProjectAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.activeRemoteProject?.project.selected_agent).toBe("claude-code");
    });

    it("传入 null 时清空 selected_agent", () => {
      const entry = makeRemoteEntry();
      const project = makeRemoteProject("rp1", { selected_agent: "old-agent" });
      seedStore({ activeRemoteProject: { entry, project } });

      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateRemoteProjectAgent(null);
      });

      const state = useConnectionStore.getState();
      expect(state.activeRemoteProject?.project.selected_agent).toBeNull();
    });

    it("调用 saveSession 持久化", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateRemoteProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
      const passedEntries = mockSaveSession.mock.calls[0][1];
      expect(passedEntries[0].projects[0].selected_agent).toBe("claude-code");
    });

    it("不调用 switchAgentInRemoteTerminal", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateRemoteProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it("不调用 refreshRemoteTerminal", () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateRemoteProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(mockRefreshTerminal).not.toHaveBeenCalled();
    });
  });

  describe("handleSelectRemoteAgent", () => {
    it("传入 agent 时调用 switchAgentInRemoteTerminal", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      await act(async () => {
        result.current.handleSelectRemoteAgent(agent);
      });

      expect(mockSwitchAgent).toHaveBeenCalledWith(
        "remote:entry-1:rp1",  // cacheKey
        "claude-code",         // agentId
        {},                    // agentCommandOverrides
      );
    });

    it("传入 agent 时同时更新 selected_agent 状态", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      await act(async () => {
        result.current.handleSelectRemoteAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.activeRemoteProject?.project.selected_agent).toBe("claude-code");
      expect(state.remoteEntries[0].projects[0].selected_agent).toBe("claude-code");
    });

    it("传入 null 时不调用 switchAgentInRemoteTerminal", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectRemoteAgent(null);
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it("传入 null 时通过 setTimeout 调用 refreshRemoteTerminal", async () => {
      const { result } = renderHook(() =>
        useRemoteActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectRemoteAgent(null);
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(mockRefreshTerminal).toHaveBeenCalledWith("remote:entry-1:rp1");
    });
  });
});
