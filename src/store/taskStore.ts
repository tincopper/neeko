import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "./appStore";
import { destroyTerminalCache } from "../components/terminal/terminalCache";
import type { Tab } from "../types/tab";
import type { TaskConfig, TaskState } from "../types/task";

interface TaskStoreState {
  configs: TaskConfig[];
  taskState: TaskState;
  selectedConfigId: string | null;

  loadConfigs: (projectPath?: string) => Promise<void>;
  addConfig: (config: TaskConfig, projectPath?: string) => Promise<void>;
  updateConfig: (config: TaskConfig, projectPath?: string) => Promise<void>;
  deleteConfig: (id: string, scope: string, projectPath?: string) => Promise<void>;
  /** Create a terminal tab and run the task command inside it */
  runTask: (command: string, configId: string) => void;
  /** Kill the running task PTY session */
  stopTask: () => void;
  /** Called by terminalFactory once the PTY session ID is known */
  setPtySessionId: (ptySessionId: string) => void;
  /** Called by terminalFactory when the task process exits */
  markIdle: () => void;
  setSelectedConfig: (id: string | null) => void;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  configs: [],
  taskState: {
    status: "idle",
    activeConfigId: null,
    sessionId: null,
    ptySessionId: null,
  },
  selectedConfigId: null,

  loadConfigs: async (projectPath?: string) => {
    try {
      const configs = await invoke<TaskConfig[]>("get_task_configs", {
        projectPath: projectPath ?? null,
      });
      set({ configs });
      const state = get();
      if (!state.selectedConfigId && configs.length > 0) {
        set({ selectedConfigId: configs[0].id });
      }
    } catch (e) {
      console.error("Failed to load task configs:", e);
    }
  },

  addConfig: async (config: TaskConfig, projectPath?: string) => {
    try {
      await invoke("save_task_config", { config, projectPath: projectPath ?? null });
      await get().loadConfigs(projectPath);
      set({ selectedConfigId: config.id });
    } catch (e) {
      console.error("Failed to save task config:", e);
    }
  },

  updateConfig: async (config: TaskConfig, projectPath?: string) => {
    try {
      await invoke("save_task_config", { config, projectPath: projectPath ?? null });
      await get().loadConfigs(projectPath);
    } catch (e) {
      console.error("Failed to update task config:", e);
    }
  },

  deleteConfig: async (id: string, scope: string, projectPath?: string) => {
    try {
      await invoke("delete_task_config", { id, scope, projectPath: projectPath ?? null });
      await get().loadConfigs(projectPath);
      const state = get();
      if (state.selectedConfigId === id) {
        const remaining = state.configs;
        set({ selectedConfigId: remaining.length > 0 ? remaining[0].id : null });
      }
    } catch (e) {
      console.error("Failed to delete task config:", e);
    }
  },

  runTask: (command: string, configId: string) => {
    const appState = useAppStore.getState();
    const activeProject = appState.activeProject;
    if (!activeProject) {
      console.error("No active project to run task in");
      return;
    }

    const tabKey = activeProject.id;
    const existingTabs = appState.tabs[tabKey];

    // ── Guard 1: same task already Running → just jump to its tab ────────
    if (existingTabs) {
      const runningTab = existingTabs.tabs.find(
        (t) =>
          t.data.kind === "terminal" &&
          t.data.taskConfigId === configId &&
          t.data.status === "Running",
      );
      if (runningTab) {
        appState.activateTab(tabKey, runningTab.id);
        set({ selectedConfigId: configId });
        return;
      }
    }

    // ── Guard 2: same task finished (Failed / Idle) → reuse tab ──────────
    if (existingTabs) {
      const finishedTab = existingTabs.tabs.find(
        (t) =>
          t.data.kind === "terminal" &&
          t.data.taskConfigId === configId &&
          (t.data.status === "Failed" || t.data.status === "Idle"),
      );
      if (finishedTab) {
        // Destroy the stale terminal cache so TerminalView creates a fresh session.
        // Cache key format: "projectId:tabId:paneId" (paneId defaults to "p1").
        const staleCacheKey = `${tabKey}:${finishedTab.id}:p1`;
        destroyTerminalCache(staleCacheKey);

        // Bump rebuildKey so TerminalView's useEffect re-runs and creates a
        // clean terminal (empty output), then reset status to Running.
        const currentRebuildKey =
          finishedTab.data.kind === "terminal"
            ? (finishedTab.data.rebuildKey ?? 0)
            : 0;
        appState.updateTab(tabKey, finishedTab.id, {
          status: "Running",
          rebuildKey: currentRebuildKey + 1,
        });
        appState.activateTab(tabKey, finishedTab.id);

        set({
          taskState: {
            status: "running",
            activeConfigId: configId,
            sessionId: finishedTab.id,
            ptySessionId: null,
          },
          selectedConfigId: configId,
        });
        return;
      }
    }

    // ── Normal path: no existing tab → create a new one ──────────────────
    const taskName =
      get().configs.find((c) => c.id === configId)?.name ?? command;

    const tabId = `task_${crypto.randomUUID()}`;
    const order = existingTabs?.tabs.length ?? 0;

    const tab: Tab = {
      id: tabId,
      projectId: activeProject.id,
      title: taskName,
      order,
      data: {
        kind: "terminal",
        agentId: null,
        status: "Running",
        taskCommand: command,
        taskConfigId: configId,
        rebuildKey: 1,
      },
    };

    appState.addTab(tabKey, tab);
    appState.activateTab(tabKey, tabId);

    set({
      taskState: {
        status: "running",
        activeConfigId: configId,
        sessionId: tabId,
        ptySessionId: null,
      },
      selectedConfigId: configId,
    });
  },

  stopTask: () => {
    const { taskState } = get();
    if (taskState.ptySessionId) {
      invoke("close_terminal_session", {
        sessionId: taskState.ptySessionId,
      }).catch((e) => console.error("Failed to stop task:", e));
    }
    set({
      taskState: {
        status: "idle",
        activeConfigId: null,
        sessionId: null,
        ptySessionId: null,
      },
    });
  },

  setPtySessionId: (ptySessionId: string) => {
    set((state) => ({
      taskState: { ...state.taskState, ptySessionId },
    }));
  },

  markIdle: () => {
    set({
      taskState: {
        status: "idle",
        activeConfigId: null,
        sessionId: null,
        ptySessionId: null,
      },
    });
  },

  setSelectedConfig: (id: string | null) => {
    set({ selectedConfigId: id });
  },
}));
