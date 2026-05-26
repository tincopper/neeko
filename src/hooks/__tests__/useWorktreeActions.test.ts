import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorktreeActions } from "../useWorktreeActions";
import { useProjectStore } from "../../store/projectStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useWorktreeStore } from "../../store/worktreeStore";
import { createProject } from "../../testing/factories";

const mockInvoke = vi.mocked(invoke);

function seedStore(overrides: Record<string, unknown> = {}) {
  const projectDefaults = {
    projects: [createProject({ id: "p-wt" })],
    activeProjectId: null as string | null,
    activeProject: null as unknown,
    isTerminalView: false,
    selectProject: vi.fn(),
    openIde: vi.fn(),
  };
  const connectionDefaults = {
    wslEntries: [] as unknown[],
    activeWslKey: null as string | null,
    activeWslProject: null as unknown,
    remoteEntries: [] as unknown[],
    activeRemoteKey: null as unknown,
    activeRemoteProject: null as unknown,
    remoteAuthStore: new Map(),
    pendingAuthEntry: null as unknown,
    selectWslProject: vi.fn(),
    selectRemoteProject: vi.fn(),
  };
  const worktreeDefaults = {
    activeWorktreePath: null as string | null,
    openedWorktrees: [] as unknown[],
    wslOpenedWt: [] as unknown[],
    activeWslWorktreePath: null as string | null,
    remoteOpenedWt: [] as unknown[],
    activeRemoteWorktreePath: null as string | null,
    worktreeState: {},
  };

  // Apply overrides to matching fields
  for (const [key, value] of Object.entries(overrides)) {
    if (key in projectDefaults) (projectDefaults as Record<string, unknown>)[key] = value;
    if (key in connectionDefaults) (connectionDefaults as Record<string, unknown>)[key] = value;
    if (key in worktreeDefaults) (worktreeDefaults as Record<string, unknown>)[key] = value;
  }

  useProjectStore.setState(projectDefaults);
  useConnectionStore.setState(connectionDefaults);
  useWorktreeStore.setState(worktreeDefaults);
}

function createDeps() {
  return {
    setActiveWorktreePath: vi.fn(),
    setActiveWorktreeBranch: vi.fn(),
    setOpenedWorktrees: vi.fn(),
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

    expect(useProjectStore.getState().activeProjectId).toBe("p-wt");
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
