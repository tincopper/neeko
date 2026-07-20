import { create } from "zustand";
import {
  getTaskConfigs,
  saveTaskConfig as saveTaskConfigApi,
  deleteTaskConfig as deleteTaskConfigApi,
  discoverTaskConfigs,
  importDiscoveredTask as importDiscoveredTaskApi,
} from "./api/taskApi";
import { closeTerminalSession } from "../terminal/api/terminalApi";
import { useProjectStore } from '@/features/project/store';
import { useEditorStore } from '@/shared/store';
import { destroyTerminalCache, terminalCache } from "../terminal/components/terminalCache";
import type { Tab } from '@/shared/types/tab';
import type { DiscoveredTask, TaskConfig, TaskState } from '@/shared/types/task';

interface TaskStoreState {
  configs: TaskConfig[];
  /** Auto-discovered tasks not yet imported (filtered vs configs by id). */
  discovered: DiscoveredTask[];
  discovering: boolean;
  /** Task runtime state keyed by project ID */
  taskStates: Record<string, TaskState>;
  selectedConfigId: string | null;

  loadConfigs: (projectPath?: string) => Promise<void>;
  loadDiscovered: (projectPath?: string | null) => Promise<void>;
  importDiscovered: (task: DiscoveredTask, projectPath: string, projectId?: string) => Promise<void>;
  importAllDiscovered: (projectPath: string, projectId?: string) => Promise<void>;
  addConfig: (config: TaskConfig, projectPath?: string) => Promise<void>;
  updateConfig: (config: TaskConfig, projectPath?: string) => Promise<void>;
  deleteConfig: (id: string, scope: string, projectPath?: string) => Promise<void>;
  /** Create a terminal tab and run the task command inside it */
  runTask: (command: string, configId: string) => void;
  /** Kill the running task PTY session for the current active project */
  stopTask: () => void;
  /** Called by terminalFactory once the PTY session ID is known */
  setPtySessionId: (projectId: string, ptySessionId: string) => void;
  /** Called by terminalFactory when the task process exits */
  markIdle: (projectId: string) => void;
  setSelectedConfig: (id: string | null) => void;
}

function filterDiscovered(
  discovered: DiscoveredTask[],
  configs: TaskConfig[],
): DiscoveredTask[] {
  const saved = new Set(configs.map((c) => c.id));
  return discovered.filter((d) => !saved.has(d.id));
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  configs: [],
  discovered: [],
  discovering: false,
  taskStates: {},
  selectedConfigId: null,

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
      // Keep full discover list in sync (imported ids drop out)
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
      // Re-scan so a deleted imported task can reappear as discovered
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

    const tabKey = activeProject.id;
    const editorState = useEditorStore.getState();
    const existingTabs = editorState.tabs[tabKey];

    // ── Guard 1: same task already Running — just jump to its tab ────────
    if (existingTabs) {
      const runningTab = existingTabs.tabs.find(
        (t) =>
          t.data.kind === "terminal" &&
          t.data.taskConfigId === configId &&
          t.data.status === "Running",
      );
      if (runningTab) {
        editorState.activateTab(tabKey, runningTab.id);
        set({ selectedConfigId: configId });
        return;
      }
    }

    // ── Guard 2: same task finished (Failed / Idle) — reuse tab ──────────
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
        useEditorStore.getState().updateTab(tabKey, finishedTab.id, {
          status: "Running",
          rebuildKey: currentRebuildKey + 1,
        });
        useEditorStore.getState().activateTab(tabKey, finishedTab.id);

        set({
          taskStates: {
            ...get().taskStates,
            [activeProject.id]: {
              status: "running",
              activeConfigId: configId,
              sessionId: finishedTab.id,
              ptySessionId: null,
            },
          },
          selectedConfigId: configId,
        });
        return;
      }
    }

    // ── Normal path: no existing tab — create a new one ──────────────────
    const taskName =
      get().configs.find((c) => c.id === configId)?.name ??
      get().discovered.find((d) => d.id === configId)?.name ??
      command;

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

    useEditorStore.getState().addTab(tabKey, tab);
    useEditorStore.getState().activateTab(tabKey, tabId);

    set({
      taskStates: {
        ...get().taskStates,
        [activeProject.id]: {
          status: "running",
          activeConfigId: configId,
          sessionId: tabId,
          ptySessionId: null,
        },
      },
      selectedConfigId: configId,
    });
  },

  stopTask: () => {
    const activeProject = useProjectStore.getState().activeProject;
    if (!activeProject) return;

    const taskState = get().taskStates[activeProject.id];
    if (!taskState || taskState.status !== "running") {
      console.warn("[TaskStore] stopTask: no running task for current project");
      return;
    }

    // Mark the tab as Idle before killing the PTY. When close_terminal_session
    // is called the backend removes the handle, so the watcher thread exits via
    // the "Handle gone" path without emitting terminal-closed �?meaning the
    // terminalFactory callback never fires and the tab status would be stuck
    // at "Running" forever. Updating it here ensures runTask() can later
    // detect the tab as finished and reuse it.
    if (taskState.sessionId) {
      useEditorStore.getState().updateTab(activeProject.id, taskState.sessionId, {
        status: "Idle",
      });
    }

    // Resolve which backend PTY session ID to close.
    // `ptySessionId` is normally set by terminalFactory once the session is
    // established, but if the user clicks Stop before the async session
    // creation completes it may still be null.  In that case fall back to
    // scanning the terminalCache for an entry whose key contains the tab's
    // sessionId �?the cache key format is "projectId:tabId:paneId".
    const sessionIdToClose = taskState.ptySessionId ?? (() => {
      if (!taskState.sessionId) return null;
      for (const [key, entry] of terminalCache.entries()) {
        if (key.includes(taskState.sessionId) && entry.sessionId) {
          return entry.sessionId;
        }
      }
      return null;
    })();

    if (sessionIdToClose) {
      closeTerminalSession(sessionIdToClose).catch((e) => console.error("Failed to stop task:", e));
    } else {
      console.warn("[TaskStore] stopTask: no PTY session ID found �?process may not be killed");
    }
    set({
      taskStates: {
        ...get().taskStates,
        [activeProject.id]: {
          status: "idle",
          activeConfigId: null,
          sessionId: null,
          ptySessionId: null,
        },
      },
    });
  },

  setPtySessionId: (projectId: string, ptySessionId: string) => {
    set((state) => {
      const current = state.taskStates[projectId];
      if (!current || current.status !== "running") return state;
      return {
        taskStates: {
          ...state.taskStates,
          [projectId]: { ...current, ptySessionId },
        },
      };
    });
  },

  markIdle: (projectId: string) => {
    set((state) => {
      const current = state.taskStates[projectId];
      if (!current || current.status !== "running") return state;
      return {
        taskStates: {
          ...state.taskStates,
          [projectId]: {
            status: "idle",
            activeConfigId: null,
            sessionId: null,
            ptySessionId: null,
          },
        },
      };
    });
  },

  setSelectedConfig: (id: string | null) => {
    set({ selectedConfigId: id });
  },
}));
