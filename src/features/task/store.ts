import { create } from "zustand";
import {
  getTaskConfigs,
  saveTaskConfig as saveTaskConfigApi,
  deleteTaskConfig as deleteTaskConfigApi,
  discoverTaskConfigs,
  importDiscoveredTask as importDiscoveredTaskApi,
} from "./api/taskApi";
import { useProjectStore } from "@/features/project/store";
import {
  exclusiveOpenTaskConsole,
  registerTaskConsoleCloser,
} from "@/shared/utils/bottomPanelExclusive";
import type { DiscoveredTask, TaskConfig, TaskRun } from "@/shared/types/task";
import {
  formatTaskExit,
  formatTaskHeader,
  startTaskProcess,
  stopTaskProcess,
  type TaskProcessHandle,
} from "./taskRunner";

/** Active process handles keyed by run id — outside React so hide/show never touches them. */
const processHandles = new Map<string, TaskProcessHandle>();

interface TaskStoreState {
  configs: TaskConfig[];
  discovered: DiscoveredTask[];
  discovering: boolean;
  selectedConfigId: string | null;

  /** Bottom Console panel visibility (does not own process lifecycle). */
  consolePanelOpen: boolean;
  /** Task runs (output sessions) shown as Console tabs. */
  consoleSessions: TaskRun[];
  activeConsoleId: string | null;

  loadConfigs: (projectPath?: string) => Promise<void>;
  loadDiscovered: (projectPath?: string | null) => Promise<void>;
  importDiscovered: (
    task: DiscoveredTask,
    projectPath: string,
    projectId?: string,
  ) => Promise<void>;
  importAllDiscovered: (projectPath: string, projectId?: string) => Promise<void>;
  addConfig: (config: TaskConfig, projectPath?: string) => Promise<void>;
  updateConfig: (config: TaskConfig, projectPath?: string) => Promise<void>;
  deleteConfig: (id: string, scope: string, projectPath?: string) => Promise<void>;

  /** Start (or re-run) a task; process + buffer live independent of panel mount. */
  runTask: (command: string, configId: string) => void;
  stopTask: (runId?: string) => void;

  setSelectedConfig: (id: string | null) => void;
  setConsolePanelOpen: (open: boolean) => void;
  toggleConsolePanel: () => void;
  setActiveConsoleId: (id: string | null) => void;
  /** Close a Console tab; stops process if still running and drops the buffer. */
  closeConsoleSession: (id: string) => void;
}

function filterDiscovered(
  discovered: DiscoveredTask[],
  configs: TaskConfig[],
): DiscoveredTask[] {
  const saved = new Set(configs.map((c) => c.id));
  return discovered.filter((d) => !saved.has(d.id));
}

function resolveTaskName(get: () => TaskStoreState, configId: string, command: string): string {
  return (
    get().configs.find((c) => c.id === configId)?.name ??
    get().discovered.find((d) => d.id === configId)?.name ??
    command
  );
}

function appendOutput(runId: string, chunk: string) {
  useTaskStore.setState((state) => ({
    consoleSessions: state.consoleSessions.map((s) =>
      s.id === runId ? { ...s, output: s.output + chunk } : s,
    ),
  }));
}

function finalizeRun(runId: string, exitCode: number) {
  processHandles.delete(runId);
  useTaskStore.setState((state) => ({
    consoleSessions: state.consoleSessions.map((s) => {
      if (s.id !== runId) return s;
      // Already finalized (e.g. user Stop) — keep buffer, only fill exit metadata
      if (s.status !== "running") {
        return {
          ...s,
          processId: null,
          exitCode: s.exitCode ?? exitCode,
          endedAt: s.endedAt ?? Date.now(),
        };
      }
      return {
        ...s,
        status: exitCode === 0 ? ("idle" as const) : ("failed" as const),
        processId: null,
        exitCode,
        endedAt: Date.now(),
        output: s.output + formatTaskExit(exitCode),
      };
    }),
  }));
}

async function launchProcessForRun(run: TaskRun) {
  // Tear down any previous handle for this run id (re-run case)
  const prev = processHandles.get(run.id);
  if (prev) {
    prev.dispose();
    processHandles.delete(run.id);
    if (prev.processId) {
      void stopTaskProcess(prev.processId).catch(() => {});
    }
  }

  try {
    const handle = await startTaskProcess({
      command: run.command,
      cwd: run.projectPath,
      projectId: run.projectId,
      onOutput: (chunk) => appendOutput(run.id, chunk),
      onExit: (code) => finalizeRun(run.id, code),
    });
    processHandles.set(run.id, handle);
    useTaskStore.setState((state) => ({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === run.id ? { ...s, processId: handle.processId } : s,
      ),
    }));
  } catch (e) {
    console.error("[TaskStore] failed to start task process:", e);
    const msg = `\x1b[31m[Failed to start task: ${String(e)}]\x1b[0m\r\n`;
    useTaskStore.setState((state) => ({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === run.id
          ? {
              ...s,
              status: "failed" as const,
              processId: null,
              exitCode: 1,
              endedAt: Date.now(),
              output: s.output + msg,
            }
          : s,
      ),
    }));
  }
}

export const useTaskStore = create<TaskStoreState>((rawSet, get) => {
  /** Wrap set: opening Task Console always closes Debug panel. */
  const set = ((partial: Parameters<typeof rawSet>[0], replace?: boolean) => {
    const next =
      typeof partial === "function"
        ? (partial as (s: TaskStoreState) => Partial<TaskStoreState>)(get())
        : partial;
    if (
      next &&
      typeof next === "object" &&
      (next as Partial<TaskStoreState>).consolePanelOpen === true
    ) {
      exclusiveOpenTaskConsole();
    }
    return (rawSet as (p: unknown, r?: boolean) => void)(partial, replace);
  }) as typeof rawSet;

  return {
    configs: [],
    discovered: [],
    discovering: false,
    selectedConfigId: null,

    consolePanelOpen: false,
    consoleSessions: [],
    activeConsoleId: null,

    loadConfigs: async (projectPath?: string) => {
      try {
        const configs = await getTaskConfigs(projectPath);
        set((state) => ({
          configs,
          discovered: filterDiscovered(state.discovered, configs),
        }));
        const state = get();
        if (!state.selectedConfigId) {
          const first = configs[0] ?? state.discovered[0];
          if (first) set({ selectedConfigId: first.id });
        }
      } catch (e) {
        console.error("Failed to load task configs:", e);
      }
    },

    loadDiscovered: async (projectPath?: string | null) => {
      if (!projectPath) {
        set({ discovered: [], discovering: false });
        return;
      }
      set({ discovering: true });
      try {
        const raw = await discoverTaskConfigs(projectPath);
        set({
          discovered: filterDiscovered(raw, get().configs),
          discovering: false,
        });
        const state = get();
        if (!state.selectedConfigId) {
          const first = state.configs[0] ?? state.discovered[0];
          if (first) set({ selectedConfigId: first.id });
        }
      } catch (e) {
        console.error("Failed to discover tasks:", e);
        set({ discovered: [], discovering: false });
      }
    },

    importDiscovered: async (task, projectPath, projectId) => {
      try {
        await importDiscoveredTaskApi(task, projectPath, projectId);
        await get().loadConfigs(projectPath);
        await get().loadDiscovered(projectPath);
        set({ selectedConfigId: task.id });
      } catch (e) {
        console.error("Failed to import discovered task:", e);
      }
    },

    importAllDiscovered: async (projectPath, projectId) => {
      const list = [...get().discovered];
      for (const task of list) {
        try {
          await importDiscoveredTaskApi(task, projectPath, projectId);
        } catch (e) {
          console.error("Failed to import", task.id, e);
        }
      }
      await get().loadConfigs(projectPath);
      await get().loadDiscovered(projectPath);
      if (list[0]) set({ selectedConfigId: list[0].id });
    },

    addConfig: async (config: TaskConfig, projectPath?: string) => {
      try {
        await saveTaskConfigApi(config, projectPath ?? null);
        await get().loadConfigs(projectPath);
        set({ selectedConfigId: config.id });
      } catch (e) {
        console.error("Failed to save task config:", e);
      }
    },

    updateConfig: async (config: TaskConfig, projectPath?: string) => {
      try {
        await saveTaskConfigApi(config, projectPath ?? null);
        await get().loadConfigs(projectPath);
      } catch (e) {
        console.error("Failed to update task config:", e);
      }
    },

    deleteConfig: async (id: string, scope: string, projectPath?: string) => {
      try {
        await deleteTaskConfigApi(id, scope, projectPath ?? null);
        await get().loadConfigs(projectPath);
        await get().loadDiscovered(projectPath ?? null);
        const state = get();
        if (state.selectedConfigId === id) {
          const next = state.configs[0] ?? state.discovered[0];
          set({ selectedConfigId: next?.id ?? null });
        }
      } catch (e) {
        console.error("Failed to delete task config:", e);
      }
    },

    runTask: (command: string, configId: string) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) {
        console.error("No active project to run task in");
        return;
      }

      const projectId = activeProject.id;
      const projectPath = activeProject.path ?? "";
      const name = resolveTaskName(get, configId, command);
      const sessions = get().consoleSessions;

      // Same task already running → focus its console tab (do not spawn a second process)
      const running = sessions.find(
        (s) =>
          s.projectId === projectId &&
          s.configId === configId &&
          s.status === "running",
      );
      if (running) {
        set({
          consolePanelOpen: true,
          activeConsoleId: running.id,
          selectedConfigId: configId,
        });
        return;
      }

      // Finished run for same config → re-run in-place (clear buffer, new process)
      const finished = sessions.find(
        (s) =>
          s.projectId === projectId &&
          s.configId === configId &&
          (s.status === "idle" || s.status === "failed"),
      );
      if (finished) {
        const header = formatTaskHeader(command, projectPath);
        const updated: TaskRun = {
          ...finished,
          command,
          name,
          status: "running",
          processId: null,
          output: header,
          exitCode: null,
          startedAt: Date.now(),
          endedAt: null,
        };
        set({
          consolePanelOpen: true,
          activeConsoleId: finished.id,
          selectedConfigId: configId,
          consoleSessions: sessions.map((s) => (s.id === finished.id ? updated : s)),
        });
        void launchProcessForRun(updated);
        return;
      }

      // New run / new tab
      const id = `task_${crypto.randomUUID()}`;
      const header = formatTaskHeader(command, projectPath);
      const run: TaskRun = {
        id,
        projectId,
        projectPath,
        configId,
        name,
        command,
        status: "running",
        processId: null,
        output: header,
        exitCode: null,
        startedAt: Date.now(),
        endedAt: null,
      };

      set({
        consolePanelOpen: true,
        activeConsoleId: id,
        selectedConfigId: configId,
        consoleSessions: [...sessions, run],
      });
      void launchProcessForRun(run);
    },

    stopTask: (runId?: string) => {
      const state = get();
      const id =
        runId ??
        state.activeConsoleId ??
        state.consoleSessions.find((s) => s.status === "running")?.id;
      if (!id) {
        console.warn("[TaskStore] stopTask: no run");
        return;
      }

      const session = state.consoleSessions.find((s) => s.id === id);
      if (!session || session.status !== "running") {
        console.warn("[TaskStore] stopTask: run not running", id);
        return;
      }

      const handle = processHandles.get(id);
      const processId = session.processId ?? handle?.processId ?? null;
      handle?.dispose();
      processHandles.delete(id);

      if (processId) {
        void stopTaskProcess(processId).catch((e) =>
          console.error("Failed to stop task:", e),
        );
      }

      // Optimistic UI: mark stopped (exit event may still fire once)
      set({
        consoleSessions: state.consoleSessions.map((s) =>
          s.id === id
            ? {
                ...s,
                status: "idle" as const,
                processId: null,
                exitCode: s.exitCode ?? -1,
                endedAt: Date.now(),
                output: s.output + `\r\n\x1b[90m[Stopped]\x1b[0m\r\n`,
              }
            : s,
        ),
      });
    },

    setSelectedConfig: (id) => set({ selectedConfigId: id }),

    setConsolePanelOpen: (open) => set({ consolePanelOpen: open }),

    toggleConsolePanel: () => {
      const next = !get().consolePanelOpen;
      set({ consolePanelOpen: next });
    },

    setActiveConsoleId: (id) => set({ activeConsoleId: id }),

    closeConsoleSession: (id) => {
      const session = get().consoleSessions.find((s) => s.id === id);
      const handle = processHandles.get(id);
      handle?.dispose();
      processHandles.delete(id);
      const processId = session?.processId ?? handle?.processId ?? null;
      if (processId) {
        void stopTaskProcess(processId).catch(() => {});
      }
      set((state) => {
        const next = state.consoleSessions.filter((s) => s.id !== id);
        let active = state.activeConsoleId;
        if (active === id) {
          active = next.length > 0 ? next[next.length - 1].id : null;
        }
        return {
          consoleSessions: next,
          activeConsoleId: active,
          // Closing last tab hides panel; process already stopped above
          consolePanelOpen: next.length > 0 ? state.consolePanelOpen : false,
        };
      });
    },
  };
});

registerTaskConsoleCloser(() => {
  // Only hide the panel — never kill runs or clear buffers
  useTaskStore.setState({ consolePanelOpen: false });
});
