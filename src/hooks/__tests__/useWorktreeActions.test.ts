import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorktreeActions } from "../useWorktreeActions";
import { useAppStore } from "../../store/appStore";
import { createProject } from "../../testing/factories";

const mockInvoke = vi.mocked(invoke);

function seedStore(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    projects: [createProject({ id: "p-wt" })],
    activeProjectId: null,
    activeProject: null,
    isTerminalView: false,
    wslEntries: [],
    activeWslKey: null,
    activeWslProject: null,
    remoteEntries: [],
    activeRemoteKey: null,
    activeRemoteProject: null,
    remoteAuthStore: new Map(),
    pendingAuthEntry: null,
    activeWorktreePath: null,
    openedWorktrees: [],
    wslOpenedWt: [],
    activeWslWorktreePath: null,
    remoteOpenedWt: [],
    activeRemoteWorktreePath: null,
    worktreeState: {},
    selectProject: vi.fn(),
    selectWslProject: vi.fn(),
    selectRemoteProject: vi.fn(),
    openIde: vi.fn(),
    ...overrides,
  });
}

function createDeps() {
  return {
    setActiveWorktreePath: vi.fn(),
    setActiveWorktreeBranch: vi.fn(),
    setOpenedWorktrees: vi.fn(),
    setWorktreeDiffState: vi.fn(),
    saveWorktreeState: vi.fn(),
  };
}

describe("useWorktreeActions", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    seedStore();
  });

  it("项目未激活时先激活项目再切换 worktree 终端", async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useWorktreeActions(deps));

    await act(async () => {
      await result.current.handleOpenWorktreeTerminal(
        "p-wt",
        "/path/to/worktree",
        "feature/test",
      );
    });

    expect(useAppStore.getState().activeProjectId).toBe("p-wt");
    expect(mockInvoke).toHaveBeenCalledWith("set_active_project", { projectId: "p-wt" });
    expect(mockInvoke).toHaveBeenCalledWith("set_view_terminal", { projectId: "p-wt" });
    expect(deps.setActiveWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
    expect(deps.setActiveWorktreeBranch).toHaveBeenCalledWith("feature/test");
    expect(deps.saveWorktreeState).toHaveBeenCalledWith("p-wt", "/path/to/worktree");
  });

  it("项目已激活时不会重复调用 set_active_project", async () => {
    seedStore({
      activeProjectId: "p-wt",
      activeProject: createProject({ id: "p-wt" }),
    });
    const deps = createDeps();
    const { result } = renderHook(() => useWorktreeActions(deps));

    await act(async () => {
      await result.current.handleOpenWorktreeTerminal(
        "p-wt",
        "/path/to/worktree",
        "feature/test",
      );
    });

    expect(mockInvoke).not.toHaveBeenCalledWith("set_active_project", expect.anything());
    expect(mockInvoke).toHaveBeenCalledWith("set_view_terminal", { projectId: "p-wt" });
  });
});
