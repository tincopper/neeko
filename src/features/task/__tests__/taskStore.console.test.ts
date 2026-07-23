import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStart = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());

vi.mock("../taskRunner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../taskRunner")>();
  return {
    ...actual,
    startTaskProcess: (...args: unknown[]) => mockStart(...args),
    stopTaskProcess: (...args: unknown[]) => mockStop(...args),
  };
});

vi.mock("@/features/project/store", () => ({
  useProjectStore: {
    getState: () => ({
      activeProject: {
        id: "proj-1",
        path: "/tmp/proj",
        name: "proj",
      },
    }),
  },
}));

vi.mock("@/shared/utils/bottomPanelExclusive", () => ({
  exclusiveOpenTaskConsole: vi.fn(),
  registerTaskConsoleCloser: vi.fn(),
}));

vi.mock("../api/taskApi", () => ({
  getTaskConfigs: vi.fn().mockResolvedValue([]),
  saveTaskConfig: vi.fn(),
  deleteTaskConfig: vi.fn(),
  discoverTaskConfigs: vi.fn().mockResolvedValue([]),
  importDiscoveredTask: vi.fn(),
}));

import { useTaskStore } from "../store";

describe("task store console / run lifecycle", () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockStop.mockReset();
    mockStart.mockResolvedValue({
      processId: "pty-1",
      dispose: vi.fn(),
    });
    mockStop.mockResolvedValue(undefined);
    useTaskStore.setState({
      configs: [
        {
          id: "cfg-build",
          name: "build",
          command: "pnpm build",
          scope: "project",
        },
      ],
      discovered: [],
      discovering: false,
      selectedConfigId: "cfg-build",
      consolePanelOpen: false,
      consoleSessions: [],
      activeConsoleId: null,
    });
  });

  it("should_start_process_and_open_panel_when_running_task", async () => {
    useTaskStore.getState().runTask("pnpm build", "cfg-build");

    await vi.waitFor(() => {
      expect(mockStart).toHaveBeenCalledTimes(1);
    });

    const state = useTaskStore.getState();
    expect(state.consolePanelOpen).toBe(true);
    expect(state.consoleSessions).toHaveLength(1);
    expect(state.consoleSessions[0].status).toBe("running");
    expect(state.consoleSessions[0].command).toBe("pnpm build");
    expect(state.consoleSessions[0].output).toContain("pnpm build");
    expect(state.activeConsoleId).toBe(state.consoleSessions[0].id);

    const startOpts = mockStart.mock.calls[0][0];
    expect(startOpts.command).toBe("pnpm build");
    expect(startOpts.cwd).toBe("/tmp/proj");
  });

  it("should_not_restart_process_when_hiding_and_showing_panel", async () => {
    useTaskStore.getState().runTask("pnpm build", "cfg-build");
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

    const runId = useTaskStore.getState().consoleSessions[0].id;
    // Simulate process output arriving while panel is closed
    const onOutput = mockStart.mock.calls[0][0].onOutput as (c: string) => void;
    useTaskStore.getState().setConsolePanelOpen(false);
    expect(useTaskStore.getState().consolePanelOpen).toBe(false);

    onOutput("hello from build\r\n");
    expect(useTaskStore.getState().consoleSessions[0].output).toContain(
      "hello from build",
    );

    // Re-open panel — must not call start again
    useTaskStore.getState().setConsolePanelOpen(true);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(useTaskStore.getState().consoleSessions[0].id).toBe(runId);
    expect(useTaskStore.getState().consoleSessions[0].status).toBe("running");
  });

  it("should_focus_existing_running_tab_without_new_process", async () => {
    useTaskStore.getState().runTask("pnpm build", "cfg-build");
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

    useTaskStore.getState().setConsolePanelOpen(false);
    useTaskStore.getState().runTask("pnpm build", "cfg-build");

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(useTaskStore.getState().consolePanelOpen).toBe(true);
    expect(useTaskStore.getState().consoleSessions).toHaveLength(1);
  });

  it("should_rerun_finished_task_only_on_explicit_run", async () => {
    useTaskStore.getState().runTask("pnpm build", "cfg-build");
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

    const onExit = mockStart.mock.calls[0][0].onExit as (code: number) => void;
    onExit(0);

    expect(useTaskStore.getState().consoleSessions[0].status).toBe("idle");
    expect(useTaskStore.getState().consoleSessions[0].output).toContain("code 0");

    // Hide/show must not re-run
    useTaskStore.getState().setConsolePanelOpen(false);
    useTaskStore.getState().setConsolePanelOpen(true);
    expect(mockStart).toHaveBeenCalledTimes(1);

    // Explicit run restarts
    useTaskStore.getState().runTask("pnpm build", "cfg-build");
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2));
    expect(useTaskStore.getState().consoleSessions).toHaveLength(1);
    expect(useTaskStore.getState().consoleSessions[0].status).toBe("running");
  });

  it("should_stop_running_task_without_removing_buffer", async () => {
    useTaskStore.getState().runTask("pnpm build", "cfg-build");
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    const onOutput = mockStart.mock.calls[0][0].onOutput as (c: string) => void;
    onOutput("partial\r\n");

    useTaskStore.getState().stopTask();
    expect(mockStop).toHaveBeenCalled();
    const session = useTaskStore.getState().consoleSessions[0];
    expect(session.status).toBe("idle");
    expect(session.output).toContain("partial");
    expect(session.output).toContain("Stopped");
  });
});
