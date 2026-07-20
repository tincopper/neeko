import { create } from "zustand";
import {
  getTaskConfigs,
  saveTaskConfig as saveTaskConfigApi,
  deleteTaskConfig as deleteTaskConfigApi,
  discoverTaskConfigs,
  importDiscoveredTask as importDiscoveredTaskApi,
} from "./api/taskApi";
import { closeTerminalSession } from "../terminal/api/terminalApi";
import { useProjectStore } from "@/features/project/store";
import { destroyTerminalCache } from "../terminal/components/terminalCache";
import {
  exclusiveOpenTaskConsole,
  registerTaskConsoleCloser,
} from "@/shared/utils/bottomPanelExclusive";
import type { DiscoveredTask, TaskConfig, TaskConsoleSession } from "@/shared/types/task";

export function taskConsoleCacheKey(sessionId: string): string {
  return `task-console:${sessionId}`;
}

interface TaskStoreState {
  configs: TaskConfig[];
  discovered: DiscoveredTask[];
  discovering: boolean;
  selectedConfigId: string | null;

  /** Bottom Console panel. */
  consolePanelOpen: boolean;
  consoleSessions: TaskConsoleSession[];
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

  /** Run a task in the bottom Console (does not create editor tabs). */
  runTask: (command: string, configId: string) => void;
  stopTask: (consoleSessionId?: string) => void;
  setPtySessionId: (consoleSessionId: string, ptySessionId: string) => void;
  markConsoleExit: (consoleSessionId: string, exitCode: number) => void;

  setSelectedConfig: (id: string | null) => void;
  setConsolePanelOpen: (open: boolean) => void;
  toggleConsolePanel: () => void;
  setActiveConsoleId: (id: string | null) => void;
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

    // Same task already running → focus its console tab
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

    // Finished session for same config → rebuild (re-run)
    const finished = sessions.find(
      (s) =>
        s.projectId === projectId &&
        s.configId === configId &&
        (s.status === "idle" || s.status === "failed"),
    );
    if (finished) {
      destroyTerminalCache(taskConsoleCacheKey(finished.id));
      set({
        consolePanelOpen: true,
        activeConsoleId: finished.id,
        selectedConfigId: configId,
        consoleSessions: sessions.map((s) =>
          s.id === finished.id
            ? {
                ...s,
                command,
                name,
                status: "running" as const,
                ptySessionId: null,
                rebuildKey: s.rebuildKey + 1,
              }
            : s,
        ),
      });
      return;
    }

    // New console session
    const id = `task_${crypto.randomUUID()}`;
    const session: TaskConsoleSession = {
      id,
      projectId,
      projectPath,
      configId,
      name,
      command,
      status: "running",
      ptySessionId: null,
      rebuildKey: 1,
    };

    set({
      consolePanelOpen: true,
      activeConsoleId: id,
      selectedConfigId: configId,
      consoleSessions: [...sessions, session],
    });
  },

  stopTask: (consoleSessionId?: string) => {
    const state = get();
    const id =
      consoleSessionId ??
      state.activeConsoleId ??
      state.consoleSessions.find((s) => s.status === "running")?.id;
    if (!id) {
      console.warn("[TaskStore] stopTask: no console session");
      return;
    }

    const session = state.consoleSessions.find((s) => s.id === id);
    if (!session || session.status !== "running") {
      console.warn("[TaskStore] stopTask: session not running", id);
      return;
    }

    const pty = session.ptySessionId;
    if (pty) {
      closeTerminalSession(pty).catch((e) =>
        console.error("Failed to stop task:", e),
      );
    }

    set({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === id
          ? { ...s, status: "idle" as const, ptySessionId: null }
          : s,
      ),
    });
  },

  setPtySessionId: (consoleSessionId, ptySessionId) => {
    set((state) => ({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === consoleSessionId ? { ...s, ptySessionId } : s,
      ),
    }));
  },

  markConsoleExit: (consoleSessionId, exitCode) => {
    set((state) => ({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === consoleSessionId
          ? {
              ...s,
              status: exitCode === 0 ? ("idle" as const) : ("failed" as const),
              ptySessionId: null,
            }
          : s,
      ),
    }));
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
    if (session?.ptySessionId) {
      closeTerminalSession(session.ptySessionId).catch(() => {});
    }
    destroyTerminalCache(taskConsoleCacheKey(id));
    set((state) => {
      const next = state.consoleSessions.filter((s) => s.id !== id);
      let active = state.activeConsoleId;
      if (active === id) {
        active = next.length > 0 ? next[next.length - 1].id : null;
      }
      return {
        consoleSessions: next,
        activeConsoleId: active,
        consolePanelOpen: next.length > 0 ? state.consolePanelOpen : false,
      };
    });
  },
  };
});

registerTaskConsoleCloser(() => {
  useTaskStore.setState({ consolePanelOpen: false });
});
