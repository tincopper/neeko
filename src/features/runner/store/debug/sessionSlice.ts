import { useTaskStore } from '@/shared/store/taskStore';

import {
  dapCheckAdapter,
  dapControl,
  dapStartSession,
  dapStartSessionConfig,
  dapStopSession,
} from '../../api/debugApi';
import { withStopLocation } from '../../stopLocation';
import type { DapSessionInfo, EntryPoint, LaunchConfig } from '../../types';
import { languageHooks } from '../languageHooks';

import { CLEAR_EXPANSION, endedSessionPatch, isLiveSession, notifyError } from './shared';
import type { DebugSessionSlice, DebugSliceCreator } from './types';

/**
 * 会话生命周期：启动 / 附加 / 停止 / 控制 / 复位 / 面板级错误。
 *
 * 「要不要起会话」的**语言差异**全部经 `languageHooks()` 中转（adapter 存在性门控、安装指引），
 * 本 slice 不含任何语言字面量。
 */
export const createSessionSlice: DebugSliceCreator<DebugSessionSlice> = (set, get) => {
  const resetSession = () => {
    set({
      error: null,
      errorProjectId: null,
      consoleLines: [],
      frames: [],
      variables: [],
      ...CLEAR_EXPANSION,
      // 复位也是一次位置事件（序号 +1）+ 无效代际：在途旧链必须整批判死。
      ...withStopLocation(get(), null),
      generation: null,
      selectedFrameId: null,
    });
  };

  /** Adapter check + session launch + panel/console wiring, shared by `start` (named config)
   *  and `startWithConfig` (synthetic config from editor test debug). Rethrows on failure. */
  const launchSession = async (
    projectId: string,
    config: LaunchConfig,
    start: () => Promise<DapSessionInfo>,
  ) => {
    try {
      // 语言差异经注册表中转：adapter 存在性门控与安装指引都归语言模块（未登记 type 走通用文案）。
      const languageHook = languageHooks()?.adapterHookFor(config.type) ?? null;
      const skipAdapterGate =
        (await languageHook?.debugHooks?.skipAdapterGate?.(config.type)) ?? false;
      const available = skipAdapterGate || (await dapCheckAdapter(projectId, config.type));
      if (!available) {
        const hint =
          languageHook?.debugHooks?.adapterHint() ??
          'Install lldb-dap (LLVM) or codelldb and ensure it is on PATH';
        const msg = `Debug adapter for type "${config.type}" not found. ${hint}`;
        set({ error: msg, errorProjectId: projectId, panelOpen: true, panelTab: 'console' });
        get().pushConsole('err', msg);
        notifyError(msg);
        throw new Error(msg);
      }
      if (config.preLaunchTask?.trim()) {
        get().pushConsole('sys', `preLaunchTask: ${config.preLaunchTask}`);
      }
      get().pushConsole('sys', `Starting: ${config.name}…`);
      set({ panelOpen: true, panelTab: 'console' });
      const session = await start();
      set({ session, panelOpen: true, panelTab: 'session' });
      get().pushConsole('sys', `Started: ${session.configName} (${session.status})`);
      // No toast — Debug panel / status bar icon already show session state.
      // Handshake waits for entry stop when possible — load stack/highlight immediately.
      if (session.status === 'stopped' || session.status === 'starting') {
        void get().refreshStackAndVars();
      }
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '');
      set({
        error: msg,
        errorProjectId: projectId,
        panelOpen: true,
        panelTab: 'console',
        // 启动失败 ⇒ 会话不存在 ⇒ 无有效停点：代际必须作废，否则在途旧链仍会被判为「当前」。
        generation: null,
        session: get().session
          ? { ...get().session!, status: 'terminated', statusMessage: msg }
          : {
              sessionId: '',
              projectId,
              projectPath: '',
              configName: config.name,
              status: 'terminated',
              statusMessage: msg,
            },
      });
      // Multi-line DAP build errors → console
      for (const line of msg.split('\n')) {
        if (line.trim()) get().pushConsole('err', line);
      }
      notifyError(msg.length > 200 ? `${msg.slice(0, 200)}…` : msg);
      throw e;
    }
  };

  return {
    session: null,
    error: null,
    errorProjectId: null,
    lastLaunch: null,
    isLaunching: false,

    clearError: () => set({ error: null, errorProjectId: null }),

    setLastLaunch: (intent) => set({ lastLaunch: intent }),

    /** Rerun：带相同意图再走现有启动链（thunk 自带 reset + 回显）。
     *  互斥位由重放的链（startWithConfig / Java 链）自行 check+set+finally；本函数只 check。 */
    rerun: async (projectId) => {
      const { lastLaunch, isLaunching } = get();
      if (!lastLaunch || lastLaunch.projectId !== projectId || isLaunching) return;
      await lastLaunch.replay();
    },

    setLaunching: (value) => set({ isLaunching: value }),

    resetSession,

    start: async (projectId, currentFile) => {
      // 互斥位 check 必须最先（resetSession 之前）：并发双链时不得误清在途链的会话状态。
      if (get().isLaunching) return;
      // Fresh session: clear previous console output (do not append across runs).
      resetSession();
      let name = get().selectedConfigName;
      let config = get().configs.find((c) => c.name === name);

      // Auto-pick / discover when nothing selected
      if (!config) {
        await get().loadConfigs(projectId);
        name = get().selectedConfigName;
        config = get().configs.find((c) => c.name === name);
      }
      if (!config) {
        const msg =
          'No launch configuration or entry point found. Add a config or ensure the project has a Go/Rust main.';
        set({ error: msg, errorProjectId: projectId, panelOpen: true, panelTab: 'console' });
        get().pushConsole('err', msg);
        notifyError(msg);
        throw new Error(msg);
      }

      // isLaunching 互斥覆盖全部启动入口（评审 P3）：start / startWithConfig / rerun 共用，
      // 防 config 区与工具栏并发启动双链。
      set({ isLaunching: true });
      try {
        await launchSession(projectId, config, () => dapStartSession(projectId, name, currentFile));
        // 仅成功启动后记录 intent（快照 config，避免引用漂移）；失败不覆盖（D6）。
        const configSnapshot = { ...config };
        set({
          lastLaunch: {
            projectId,
            label: config.name,
            replay: () => get().startWithConfig(projectId, configSnapshot),
          },
        });
      } finally {
        set({ isLaunching: false });
      }
    },

    startWithConfig: async (projectId, config, opts) => {
      // 单一 chokepoint：所有启动链（含 rerun 重放、Java attach 经此）在此 check+set。
      // check 在 resetSession 之前：并发时不得误清在途链的会话状态。
      if (get().isLaunching) return;
      if (opts?.reset !== false) resetSession();
      set({ isLaunching: true });
      try {
        await launchSession(
          projectId,
          config,
          opts?.starter ?? (() => dapStartSessionConfig(projectId, config)),
        );
        // 仅成功启动后记录 intent；starter 闭包透传（Java attach 重放一致，D7）。
        // replay 快照 config（与 `start` 的 configSnapshot 同构，架构审查 Minor）：
        // 调用方之后 mutate config 对象不影响重放。
        const starter = opts?.starter;
        const configSnapshot = { ...config };
        set({
          lastLaunch: {
            projectId,
            label: config.name,
            replay: () =>
              get().startWithConfig(
                projectId,
                configSnapshot,
                starter ? { starter, reset: true } : { reset: true },
              ),
          },
        });
      } finally {
        set({ isLaunching: false });
      }
    },

    attachSession: (session) => {
      // 面板互斥由 store 级中间件承担（`set` 里 panelOpen=true 即触发）。
      set({ session, panelOpen: true, panelTab: 'session', error: null, errorProjectId: null });
      // 握手会尽量等到入口停住；立即回填栈/高亮（与 startWithConfig 收尾一致）。
      void get().refreshStackAndVars();
    },

    setPanelError: (projectId, message) => {
      if (message === null) {
        set({ error: null, errorProjectId: null });
        return;
      }
      set({ error: message, errorProjectId: projectId, panelOpen: true, panelTab: 'console' });
    },

    debugEntry: async (projectId, entry: EntryPoint, currentFile) => {
      const existing = get().configs.find((c) => c.name === entry.configName);
      if (!existing) {
        const config: LaunchConfig = {
          name: entry.configName,
          type: entry.adapterType,
          request: 'launch',
          program: entry.programTemplate,
          cwd: '${workspaceFolder}',
          args: [],
          mode: entry.mode ?? null,
          preLaunchTask: entry.preLaunchTask ?? null,
          stopOnEntry: false,
        };
        try {
          await get().addConfig(projectId, config);
        } catch {
          // may already exist under race — reselect
          set({ selectedConfigName: entry.configName });
        }
      } else {
        set({ selectedConfigName: entry.configName });
      }
      await get().start(projectId, currentFile);
    },

    runEntry: (entry) => {
      get().pushConsole('sys', `Run: ${entry.runCommand}`);
      useTaskStore.getState().runTask(entry.runCommand, `entry-run:${entry.id}`);
    },

    stop: async () => {
      const sid = get().session?.sessionId;
      if (sid) {
        try {
          await dapStopSession(sid);
          get().pushConsole('sys', 'Session stopped');
        } catch (e) {
          get().pushConsole('err', String(e));
        }
      }
      set({
        ...endedSessionPatch(get().session, get(), 'Stopped'),
        panelOpen: true,
        panelTab: 'console',
      });
    },

    control: async (action) => {
      const sid = get().session?.sessionId;
      if (!sid || !isLiveSession(get().session)) return;
      try {
        await dapControl(sid, action);
      } catch (e) {
        const msg = String(e);
        set({
          error: msg,
          errorProjectId: get().session?.projectId ?? null,
          panelOpen: true,
          panelTab: 'console',
        });
        get().pushConsole('err', msg);
        notifyError(msg);
      }
    },

    /** 项目切换时静默释放旧项目会话：终止后端会话、标记 terminated，但不打开面板。 */
    stopSilent: async () => {
      const session = get().session;
      const sid = session?.sessionId;
      if (sid) {
        try {
          await dapStopSession(sid);
        } catch (e) {
          get().pushConsole('err', String(e));
        }
      }
      set({ ...endedSessionPatch(session, get(), 'Stopped') });
    },
  };
};
