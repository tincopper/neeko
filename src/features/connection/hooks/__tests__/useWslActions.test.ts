import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWslActions } from "@/features/connection/hooks/useWslActions";
import { useConnectionStore } from "@/features/connection/store";
import { useProjectStore } from "@/features/project/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from '@/shared/store';
import type { WSLEntrySession } from "@/types";
import {
  switchAgentInWslTerminal,
  refreshWslTerminal,
} from "@/features/terminal/components/terminalCache";

vi.mock("@/features/terminal/components/terminalCache", () => ({
  wslCacheKey: (distro: string, projectId: string) => `wsl:${distro}:${projectId}`,
  switchAgentInWslTerminal: vi.fn().mockResolvedValue(undefined),
  refreshWslTerminal: vi.fn(),
}));

const mockSwitchAgent = vi.mocked(switchAgentInWslTerminal);
const mockRefreshTerminal = vi.mocked(refreshWslTerminal);

function makeWslProject(id = "wp1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `proj-${id}`,
    path: `/home/user/${id}`,
    entry_id: "e1",
    selected_agent: null as string | null,
    selected_ide: null,
    ...overrides,
  };
}

const DEFAULT_CONFIG = {
  terminalFontSize: 14,
  fontFamily: "",
  agentCommandOverrides: {},
} as never; // cast to satisfy AppConfig (partial is enough)

function seedStore(overrides: {
  wslEntries?: WSLEntrySession[];
  activeWslProject?: { distro: string; project: ReturnType<typeof makeWslProject> };
} = {}) {
  const project = makeWslProject("wp1");
  useProjectStore.setState({
    activeProjectId: null,
    activeProject: null,
    isTerminalView: false,
  });
  useConnectionStore.setState({
    wslEntries: overrides.wslEntries ?? [
      { id: "e1", distro: "Ubuntu", projects: [project] },
    ],
    activeWslProject: overrides.activeWslProject ?? {
      distro: "Ubuntu",
      project,
    },
    remoteEntries: [],
    activeRemoteKey: null,
    activeRemoteProject: null,
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

describe("useWslActions", () => {
  const mockSaveSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSaveSession.mockResolvedValue(undefined);
    mockSwitchAgent.mockResolvedValue(undefined);
    seedStore();
  });

  describe("updateWslProjectAgent", () => {
    it("更新 wslEntries 中的 selected_agent", () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      act(() => {
        result.current.updateWslProjectAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.wslEntries[0].projects[0].selected_agent).toBe("claude-code");
    });

    it("更新 activeWslProject 的 selected_agent", () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      act(() => {
        result.current.updateWslProjectAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.activeWslProject?.project.selected_agent).toBe("claude-code");
    });

    it("传入 null 时清空 selected_agent", () => {
      // 先设置一个有 agent 的项目
      seedStore({
        activeWslProject: {
          distro: "Ubuntu",
          project: makeWslProject("wp1", { selected_agent: "old-agent" }),
        },
      });

      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateWslProjectAgent(null);
      });

      const state = useConnectionStore.getState();
      expect(state.activeWslProject?.project.selected_agent).toBeNull();
    });

    it("调用 saveSession 持久化", () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateWslProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
      const passedEntries = mockSaveSession.mock.calls[0][0];
      expect(passedEntries[0].projects[0].selected_agent).toBe("claude-code");
    });

    it("不调用 switchAgentInWslTerminal", () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateWslProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it("不调用 refreshWslTerminal", () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      act(() => {
        result.current.updateWslProjectAgent({ id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(mockRefreshTerminal).not.toHaveBeenCalled();
    });
  });

  describe("handleSelectWslAgent", () => {
    it("传入 agent 时调用 switchAgentInWslTerminal", async () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      await act(async () => {
        result.current.handleSelectWslAgent(agent);
      });

      expect(mockSwitchAgent).toHaveBeenCalledWith(
        "wsl:Ubuntu:wp1",  // cacheKey
        "Ubuntu",          // distro
        "/home/user/wp1",  // projectPath
        "proj-wp1",        // projectName
        "claude-code",     // agentId
        14,                // fontSize
        "",                // fontFamily
        {},                // agentCommandOverrides
      );
    });

    it("传入 agent 时同时更新 selected_agent 状态", async () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [], env: {}, icon: null, enabled: true };

      await act(async () => {
        result.current.handleSelectWslAgent(agent);
      });

      const state = useConnectionStore.getState();
      expect(state.activeWslProject?.project.selected_agent).toBe("claude-code");
      expect(state.wslEntries[0].projects[0].selected_agent).toBe("claude-code");
    });

    it("传入 null 时不调用 switchAgentInWslTerminal", async () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectWslAgent(null);
      });

      expect(mockSwitchAgent).not.toHaveBeenCalled();
    });

    it("传入 null 时通过 setTimeout 调用 refreshWslTerminal", async () => {
      const { result } = renderHook(() =>
        useWslActions({ config: DEFAULT_CONFIG, showToast: vi.fn(), saveSession: mockSaveSession }),
      );

      await act(async () => {
        result.current.handleSelectWslAgent(null);
      });

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(mockRefreshTerminal).toHaveBeenCalledWith("wsl:Ubuntu:wp1");
    });
  });
});
