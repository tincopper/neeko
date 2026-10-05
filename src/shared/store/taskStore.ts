import { create } from 'zustand';

/* eslint-disable import/no-restricted-paths -- taskStore depends on task/lsp feature APIs (inherent dependency) */
import { cancelGitSync } from '@/features/git/api/gitApi';
import { lspGetServerLogs } from '@/features/lsp/api/lspApi';
import {
  getTaskConfigs,
  saveTaskConfig as saveTaskConfigApi,
  deleteTaskConfig as deleteTaskConfigApi,
  discoverTaskConfigs,
  importDiscoveredTask as importDiscoveredTaskApi,
} from '@/features/task/api/taskApi';
import {
  formatTaskExit,
  formatTaskHeader,
  startTaskProcess,
  stopTaskProcess,
  type TaskProcessHandle,
} from '@/features/task/taskRunner';
/* eslint-enable import/no-restricted-paths */
import { useProjectStore } from '@/shared/store/projectStore';
import type { DiscoveredTask, TaskConfig, TaskRun } from '@/shared/types/task';
import {
  exclusiveOpenTaskConsole,
  registerTaskConsoleCloser,
} from '@/shared/utils/bottomPanelExclusive';
import { reportFrontendError } from '@/shared/utils/errorReporting';

/** Optional cwd override + output/exit observers for programmatic runs (editor test Run/Debug). */
export interface RunTaskOptions {
  /** Working directory override; defaults to the active project path. */
  cwd?: string;
  onOutput?: (chunk: string) => void;
  onExit?: (exitCode: number) => void;
}

/** Per-run observers for programmatic runs, keyed by run id (cleaned up on exit). */
const runObservers = new Map<string, Pick<RunTaskOptions, 'onOutput' | 'onExit'>>();

/** Active process handles keyed by run id — outside React so hide/show never touches them. */
const processHandles = new Map<string, TaskProcessHandle>();

/** Stable console session id for an LSP server log tab. */
export function lspConsoleSessionId(projectPath: string, languageId: string): string {
  return `lsp:${projectPath}:${languageId}`;
}

/** Stable console session id for a repo's git output tab (one tab per repo). */
export function gitConsoleSessionId(projectPath: string): string {
  return `git:${projectPath}`;
}

/** Tab label for the git console: last path segment of the repo path. */
function repoDisplayName(projectPath: string): string {
  const trimmed = projectPath.replace(/[/\\]+$/, '');
  return trimmed.split(/[/\\]/).filter(Boolean).pop() ?? 'repo';
}

function formatLspLogs(
  serverName: string,
  entries: Array<{ timestamp: string; level: string; message: string }>,
): string {
  const header = `\x1b[90m[LSP logs · ${serverName}]\x1b[0m\r\n`;
  if (entries.length === 0) {
    return `${header}\x1b[90m(no log output yet)\x1b[0m\r\n`;
  }
  const body = entries
    .map((e) => {
      const levelColor =
        e.level === 'error' ? '31' : e.level === 'warn' ? '33' : e.level === 'info' ? '36' : '90';
      return `\x1b[90m${e.timestamp}\x1b[0m \x1b[${levelColor}m${e.level}\x1b[0m ${e.message}`;
    })
    .join('\r\n');
  return `${header}${body}\r\n`;
}

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
  runTask: (command: string, configId: string, options?: RunTaskOptions) => string | null;
  stopTask: (runId?: string) => void;

  setSelectedConfig: (id: string | null) => void;
  setConsolePanelOpen: (open: boolean) => void;
  toggleConsolePanel: () => void;
  setActiveConsoleId: (id: string | null) => void;
  /** Close a Console tab; stops process if still running and drops the buffer. */
  closeConsoleSession: (id: string) => void;
  /**
   * Open/focus a Console tab for LSP server logs (does not stop the LSP process).
   * Fetches initial logs; caller/panel may poll while the tab stays active.
   */
  openLspLogConsole: (args: {
    projectId: string;
    projectPath: string;
    languageId: string;
    serverName: string;
  }) => Promise<void>;
  /** Refresh output for an LSP log tab (used by Console poll). */
  refreshLspLogConsole: (sessionId: string) => Promise<void>;
  /**
   * Open/focus the per-repo Git Console tab and return its run id.
   *
   * One stable tab per repo — every git op appends there (`header` is written as
   * the `$ …` command line). Backend output arrives via `git-operation-output`
   * events routed by `useGitConsoleBridge`.
   */
  openGitConsole: (args: { projectId: string; projectPath: string; header: string }) => string;
  /** Append a streamed chunk to a git Console run (no-op when the tab was closed). */
  appendGitConsoleOutput: (runId: string, chunk: string) => void;
  /** Mark a git Console run finished (`ok=false` → failed, buffer kept). */
  finishGitConsole: (runId: string, ok: boolean) => void;
  /**
   * 失败收尾：错误行落进 Console 再标 failed（缓冲区保留，便于回看现场）。
   * 返回 true 表示这次是**用户取消**（已按 `[Stopped]` 收尾，调用方不应再弹错误 toast）。
   */
  failGitConsole: (runId: string, error: unknown) => boolean;
  /** AuthRequired 收尾：标注等待认证并按非失败结束本次运行（凭据对话接管）。 */
  awaitAuthGitConsole: (runId: string) => void;
  /**
   * 请求取消进行中的 git 同步操作；`runId` 透传给后端做目标限定（单飞槽里 run id 匹配才取消），
   * 避免陈旧的仓库 tab 误取消另一个仓库的操作。
   * 状态先置 `stopping`；后端进程树被杀后由命令的 reject 路径按 [Stopped] 收尾。
   */
  cancelGitConsole: (runId: string) => Promise<void>;
}

function filterDiscovered(discovered: DiscoveredTask[], configs: TaskConfig[]): DiscoveredTask[] {
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

/** Task 输出字符上限：超过后保留尾部窗口，杜绝无界拼接与巨型 DOM 渲染。 */
const MAX_TASK_OUTPUT_CHARS = 512 * 1024;
/** 截断标记（仅首次截断时注入一次）。 */
const OUTPUT_TRUNCATED_MARK = '\r\n\x1b[33m[output truncated - showing tail]\x1b[0m\r\n';

function appendOutput(runId: string, chunk: string) {
  useTaskStore.setState((state) => ({
    consoleSessions: state.consoleSessions.map((s) => {
      if (s.id !== runId) return s;
      const next = s.output + chunk;
      if (next.length <= MAX_TASK_OUTPUT_CHARS) {
        return { ...s, output: next };
      }
      // 超限：保留尾部窗口，标记只注入一次
      const alreadyMarked = s.output.startsWith(OUTPUT_TRUNCATED_MARK);
      return {
        ...s,
        output: (alreadyMarked ? '' : OUTPUT_TRUNCATED_MARK) + next.slice(-MAX_TASK_OUTPUT_CHARS),
      };
    }),
  }));
}

function finalizeRun(runId: string, exitCode: number) {
  processHandles.delete(runId);
  useTaskStore.setState((state) => ({
    consoleSessions: state.consoleSessions.map((s) => {
      if (s.id !== runId) return s;
      // User already requested stop — finalize to idle (stopped is a graceful end).
      if (s.status === 'stopping') {
        return {
          ...s,
          status: 'idle' as const,
          processId: null,
          exitCode: s.exitCode ?? exitCode,
          endedAt: s.endedAt ?? Date.now(),
          output: s.output + `\r\n\x1b[90m[Stopped]\x1b[0m\r\n`,
        };
      }
      // Already finalized by other path — keep buffer, only fill exit metadata.
      if (s.status !== 'running') {
        return {
          ...s,
          processId: null,
          exitCode: s.exitCode ?? exitCode,
          endedAt: s.endedAt ?? Date.now(),
        };
      }
      return {
        ...s,
        status: exitCode === 0 ? ('idle' as const) : ('failed' as const),
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
      void stopTaskProcess(prev.processId).catch((err) =>
        reportFrontendError('task.stopProcess', err),
      );
    }
  }

  try {
    const handle = await startTaskProcess({
      command: run.command,
      cwd: run.projectPath,
      projectId: run.projectId,
      onOutput: (chunk) => {
        appendOutput(run.id, chunk);
        runObservers.get(run.id)?.onOutput?.(chunk);
      },
      onExit: (code) => {
        finalizeRun(run.id, code);
        const observers = runObservers.get(run.id);
        runObservers.delete(run.id);
        observers?.onExit?.(code);
      },
    });
    processHandles.set(run.id, handle);
    useTaskStore.setState((state) => ({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === run.id ? { ...s, processId: handle.processId } : s,
      ),
    }));
  } catch (e) {
    console.error('[TaskStore] failed to start task process:', e);
    const observers = runObservers.get(run.id);
    runObservers.delete(run.id);
    observers?.onExit?.(1);
    const msg = `\x1b[31m[Failed to start task: ${String(e)}]\x1b[0m\r\n`;
    useTaskStore.setState((state) => ({
      consoleSessions: state.consoleSessions.map((s) =>
        s.id === run.id
          ? {
              ...s,
              status: 'failed' as const,
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
      typeof partial === 'function'
        ? (partial as (s: TaskStoreState) => Partial<TaskStoreState>)(get())
        : partial;
    if (
      next &&
      typeof next === 'object' &&
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
        console.error('Failed to load task configs:', e);
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
        console.error('Failed to discover tasks:', e);
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
        console.error('Failed to import discovered task:', e);
      }
    },

    importAllDiscovered: async (projectPath, projectId) => {
      const list = [...get().discovered];
      for (const task of list) {
        try {
          await importDiscoveredTaskApi(task, projectPath, projectId);
        } catch (e) {
          console.error('Failed to import', task.id, e);
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
        console.error('Failed to save task config:', e);
      }
    },

    updateConfig: async (config: TaskConfig, projectPath?: string) => {
      try {
        await saveTaskConfigApi(config, projectPath ?? null);
        await get().loadConfigs(projectPath);
      } catch (e) {
        console.error('Failed to update task config:', e);
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
        console.error('Failed to delete task config:', e);
      }
    },

    runTask: (command: string, configId: string, options?: RunTaskOptions) => {
      const activeProject = useProjectStore.getState().activeProject;
      if (!activeProject) {
        console.error('No active project to run task in');
        return null;
      }

      const projectId = activeProject.id;
      const projectPath = options?.cwd || activeProject.path || '';

      const name = resolveTaskName(get, configId, command);
      const sessions = get().consoleSessions;

      // Same task already running → focus its console tab (do not spawn a second process)
      const running = sessions.find(
        (s) => s.projectId === projectId && s.configId === configId && s.status === 'running',
      );
      if (running) {
        set({
          consolePanelOpen: true,
          activeConsoleId: running.id,
          selectedConfigId: configId,
        });
        return running.id;
      }

      // Finished run for same config → re-run in-place (clear buffer, new process)
      const finished = sessions.find(
        (s) =>
          s.projectId === projectId &&
          s.configId === configId &&
          (s.status === 'idle' || s.status === 'failed'),
      );
      if (finished) {
        if (options?.onOutput || options?.onExit) {
          runObservers.set(finished.id, { onOutput: options.onOutput, onExit: options.onExit });
        }
        const header = formatTaskHeader(command, projectPath);
        const updated: TaskRun = {
          ...finished,
          command,
          name,
          status: 'running',
          processId: null,
          output: header,
          exitCode: null,
          startedAt: Date.now(),
          endedAt: null,
          projectPath,
        };
        set({
          consolePanelOpen: true,
          activeConsoleId: finished.id,
          selectedConfigId: configId,
          consoleSessions: sessions.map((s) => (s.id === finished.id ? updated : s)),
        });
        void launchProcessForRun(updated);
        return finished.id;
      }

      // New run / new tab
      const id = `task_${crypto.randomUUID()}`;
      if (options?.onOutput || options?.onExit) {
        runObservers.set(id, { onOutput: options.onOutput, onExit: options.onExit });
      }
      const header = formatTaskHeader(command, projectPath);
      const run: TaskRun = {
        id,
        projectId,
        projectPath,
        configId,
        name,
        command,
        status: 'running',
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
      return id;
    },

    stopTask: (runId?: string) => {
      const state = get();
      const id =
        runId ??
        state.activeConsoleId ??
        state.consoleSessions.find(
          (s) => (s.status === 'running' || s.status === 'stopping') && s.source !== 'lsp',
        )?.id;
      if (!id) {
        console.warn('[TaskStore] stopTask: no run');
        return;
      }

      const session = state.consoleSessions.find((s) => s.id === id);
      // LSP log tabs / git output tabs have no task process to stop — ignore.
      if (!session || (session.source ?? 'task') !== 'task') {
        console.warn('[TaskStore] stopTask: not a task run', id);
        return;
      }
      // Idempotent: already stopping — do nothing.
      if (session.status === 'stopping') return;
      if (session.status !== 'running') {
        console.warn('[TaskStore] stopTask: run not running', id);
        return;
      }

      const handle = processHandles.get(id);
      const processId = session.processId ?? handle?.processId ?? null;
      // Do NOT dispose the handle: the terminal-closed listener must stay active
      // to fire finalizeRun (stopping → idle) when the process actually exits.
      processHandles.delete(id);

      if (processId) {
        void stopTaskProcess(processId).catch((e) => console.error('Failed to stop task:', e));
      }

      // Mark stopping: process exit event will finalize to idle via finalizeRun.
      set({
        consoleSessions: state.consoleSessions.map((s) =>
          s.id === id
            ? {
                ...s,
                status: 'stopping' as const,
                processId: null,
                endedAt: Date.now(),
                output: s.output + `\r\n\x1b[90m[Stopping…]\x1b[0m\r\n`,
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
      // LSP tabs: drop buffer only — never stop the language server process.
      if (session?.source !== 'lsp') {
        const handle = processHandles.get(id);
        handle?.dispose();
        processHandles.delete(id);
        const processId = session?.processId ?? handle?.processId ?? null;
        if (processId) {
          void stopTaskProcess(processId).catch((err) =>
            reportFrontendError('task.stopProcess', err),
          );
        }
        // dispose() detaches the exit listener, so an observed run would never
        // report exit — end it here (process killed → non-zero) to release the
        // runObservers entry instead of leaking it.
        const observers = runObservers.get(id);
        runObservers.delete(id);
        observers?.onExit?.(1);
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

    openLspLogConsole: async ({ projectId, projectPath, languageId, serverName }) => {
      const id = lspConsoleSessionId(projectPath, languageId);
      const sessions = get().consoleSessions;
      const existing = sessions.find((s) => s.id === id);

      if (existing) {
        set({
          consolePanelOpen: true,
          activeConsoleId: id,
        });
      } else {
        const run: TaskRun = {
          id,
          projectId,
          projectPath,
          configId: `lsp:${languageId}`,
          name: serverName,
          command: `lsp logs · ${serverName}`,
          status: 'running',
          processId: null,
          output: `\x1b[90m[LSP logs · ${serverName}]\x1b[0m\r\n\x1b[90mLoading…\x1b[0m\r\n`,
          exitCode: null,
          startedAt: Date.now(),
          endedAt: null,
          source: 'lsp',
          languageId,
        };
        set({
          consolePanelOpen: true,
          activeConsoleId: id,
          consoleSessions: [...sessions, run],
        });
      }

      try {
        const entries = await lspGetServerLogs(projectPath, languageId, 500);
        const output = formatLspLogs(serverName, entries);
        useTaskStore.setState((state) => ({
          consoleSessions: state.consoleSessions.map((s) =>
            s.id === id
              ? {
                  ...s,
                  name: serverName,
                  status: 'running' as const,
                  output,
                }
              : s,
          ),
        }));
      } catch (e) {
        console.error('[TaskStore] openLspLogConsole failed:', e);
        const msg = `\x1b[31m[Failed to load LSP logs: ${String(e)}]\x1b[0m\r\n`;
        useTaskStore.setState((state) => ({
          consoleSessions: state.consoleSessions.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: 'failed' as const,
                  output: (s.output || '') + msg,
                }
              : s,
          ),
        }));
      }
    },

    refreshLspLogConsole: async (sessionId: string) => {
      const session = get().consoleSessions.find((s) => s.id === sessionId);
      if (!session || session.source !== 'lsp' || !session.languageId) return;
      try {
        const entries = await lspGetServerLogs(session.projectPath, session.languageId, 500);
        const output = formatLspLogs(session.name, entries);
        useTaskStore.setState((state) => ({
          consoleSessions: state.consoleSessions.map((s) =>
            s.id === sessionId ? { ...s, status: 'running' as const, output } : s,
          ),
        }));
      } catch (e) {
        console.warn('[TaskStore] refreshLspLogConsole failed:', e);
      }
    },

    openGitConsole: ({ projectId, projectPath, header }) => {
      const id = gitConsoleSessionId(projectPath);
      const sessions = get().consoleSessions;
      const existing = sessions.find((s) => s.id === id);
      const headerLine = `\x1b[36m$ ${header}\x1b[0m\r\n`;

      if (existing) {
        useTaskStore.setState((state) => ({
          consoleSessions: state.consoleSessions.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: 'running' as const,
                  processId: null,
                  endedAt: null,
                  output: (s.output ? `${s.output}\r\n` : '') + headerLine,
                }
              : s,
          ),
          consolePanelOpen: true,
          activeConsoleId: id,
        }));
      } else {
        const run: TaskRun = {
          id,
          projectId,
          projectPath,
          configId: id,
          name: `Git · ${repoDisplayName(projectPath)}`,
          command: header,
          status: 'running',
          processId: null,
          output: headerLine,
          exitCode: null,
          startedAt: Date.now(),
          endedAt: null,
          source: 'git',
        };
        set({
          consolePanelOpen: true,
          activeConsoleId: id,
          consoleSessions: [...sessions, run],
        });
      }
      return id;
    },

    appendGitConsoleOutput: (runId, chunk) => {
      appendOutput(runId, chunk);
    },

    finishGitConsole: (runId, ok) => {
      finalizeRun(runId, ok ? 0 : 1);
    },

    failGitConsole: (runId, error) => {
      const run = get().consoleSessions.find((s) => s.id === runId);
      if (run?.status === 'stopping') {
        // 用户已请求取消：按 [Stopped] 优雅收尾，不计失败。
        finalizeRun(runId, 1);
        return true;
      }
      appendOutput(runId, `\x1b[31m${String(error)}\x1b[0m\r\n`);
      finalizeRun(runId, 1);
      return false;
    },

    awaitAuthGitConsole: (runId) => {
      appendOutput(runId, '\x1b[33m[authentication required]\x1b[0m\r\n');
      finalizeRun(runId, 0);
    },

    cancelGitConsole: async (runId) => {
      useTaskStore.setState((state) => ({
        consoleSessions: state.consoleSessions.map((s) =>
          s.id === runId && s.status === 'running' ? { ...s, status: 'stopping' as const } : s,
        ),
      }));
      try {
        await cancelGitSync(runId);
      } catch (e) {
        console.warn('[TaskStore] cancelGitConsole failed:', e);
      }
    },
  };
});

registerTaskConsoleCloser(() => {
  // Only hide the panel — never kill runs or clear buffers
  useTaskStore.setState({ consolePanelOpen: false });
});
