import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

import { DAP_EVENT, DAP_SESSION_STATUS_EVENT } from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useTaskStore } from '@/shared/store/taskStore';
import {
  exclusiveOpenDebugPanel,
  registerDebugPanelCloser,
} from '@/shared/utils/bottomPanelExclusive';
import { sourceIdentityOf } from '@/shared/utils/fileRef';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';
import { stripAnsi } from '@/shared/utils/stripAnsi';

import {
  dapCheckAdapter,
  dapControl,
  dapDiscoverEntries,
  dapEvaluate,
  dapGetBreakpoints,
  dapGetSession,
  dapListConfigs,
  dapSaveConfigs,
  dapSetBreakpoints,
  dapStackTrace,
  dapStartSession,
  dapStartSessionConfig,
  dapStopSession,
  dapVariables,
  dapVariablesByReference,
  debugJavaAttach,
} from '../api/debugApi';
import { openSourceAtLine, openVirtualSourceAtLine } from '../navigate';
import { virtualSourceIdentity } from '../sourceContent';
import { pickStopFrame } from '../stackFrames';
import type {
  BreakpointSpec,
  ConsoleLine,
  DapEventPayload,
  DapSessionInfo,
  DebugPanelTab,
  EntryPoint,
  LaunchConfig,
  StackFrameDto,
  VariableDto,
} from '../types';
import { isCodelldbNoise } from '../utils/consoleFilter';

/** Stable empty list — never return a fresh `[]` from selectors (avoids re-render loops). */
export const EMPTY_BP_LINES: readonly number[] = Object.freeze([]);

/**
 * Clear lazy variable-expansion state. DAP `variablesReference` values are only
 * valid for the current paused context — stale caches would silently show data
 * from a previous stop (Delve may even reuse references), so every context
 * switch (stopped → new stop / continued / frame switch / session end) resets.
 */
const CLEAR_EXPANSION = {
  childrenByRef: {},
  expandedRefs: {},
  loadingRefs: {},
  varErrors: {},
} as const;

interface DebugState {
  configs: LaunchConfig[];
  entries: EntryPoint[];
  selectedConfigName: string | null;
  session: DapSessionInfo | null;
  /** projectId → filePath → lines */
  breakpoints: Record<string, Record<string, number[]>>;
  frames: StackFrameDto[];
  variables: VariableDto[];
  /** Lazy-expanded child variables keyed by `variablesReference`. */
  childrenByRef: Record<number, VariableDto[]>;
  /** Which references are currently expanded in the variables tree. */
  expandedRefs: Record<number, boolean>;
  /** In-flight child fetches keyed by `variablesReference`. */
  loadingRefs: Record<number, boolean>;
  /** Last expansion error keyed by `variablesReference`. */
  varErrors: Record<number, string>;
  selectedFrameId: number | null;
  consoleLines: ConsoleLine[];
  panelOpen: boolean;
  panelTab: DebugPanelTab;
  /** Current stopped location for editor highlight */
  stoppedAt: { filePath: string; line: number; column?: number } | null;
  error: string | null;
  loadConfigs: (projectId: string) => Promise<void>;
  loadEntries: (projectId: string) => Promise<void>;
  selectConfig: (name: string | null) => void;
  saveConfigs: (projectId: string, configurations: LaunchConfig[]) => Promise<void>;
  addConfig: (projectId: string, config: LaunchConfig) => Promise<void>;
  updateConfig: (projectId: string, originalName: string, config: LaunchConfig) => Promise<void>;
  deleteConfig: (projectId: string, name: string) => Promise<void>;
  start: (projectId: string, currentFile?: string | null) => Promise<void>;
  /** Start a session from a fully-specified synthetic config (editor test debug). */
  startWithConfig: (projectId: string, config: LaunchConfig) => Promise<void>;
  /**
   * Java attach-first（J3）：后端单条命令 spawn 测试 JVM（jdwp suspend=y）→
   * 解析端口 → JavaAdapter attach 会话。command 为 buildJavaDebugCommand 产物；
   * classpath 为 debuggee 运行时 classpath 条目（供 host 解析库源码）。
   */
  startJavaAttach: (
    projectId: string,
    command: string,
    cwd: string,
    testName: string,
    classpath: string[],
  ) => Promise<void>;
  /** Debug a discovered entry (ensures matching launch config). */
  debugEntry: (projectId: string, entry: EntryPoint, currentFile?: string | null) => Promise<void>;
  /** Run entry without debugger (terminal task). */
  runEntry: (entry: EntryPoint) => void;
  stop: () => Promise<void>;
  control: (action: string) => Promise<void>;
  toggleBreakpoint: (projectId: string, filePath: string, line: number) => Promise<void>;
  removeBreakpoint: (projectId: string, filePath: string, line: number) => Promise<void>;
  loadBreakpoints: (projectId: string) => Promise<void>;
  getFileBreakpoints: (projectId: string, filePath: string) => readonly number[];
  listAllBreakpoints: (projectId: string) => BreakpointSpec[];
  refreshStackAndVars: () => Promise<void>;
  selectFrame: (frameId: number) => Promise<void>;
  /** Expand / collapse a variable node (lazy-fetches children via DAP). */
  toggleVariableExpand: (variablesReference: number) => Promise<void>;
  evaluate: (expression: string) => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  openPanel: (tab?: DebugPanelTab) => void;
  /** Toggle debug UI panel open/closed. */
  togglePanel: () => void;
  setPanelTab: (tab: DebugPanelTab) => void;
  pushConsole: (kind: ConsoleLine['kind'], text: string) => void;
  subscribeEvents: () => Promise<UnlistenFn>;
  clearError: () => void;
  breakpointCount: (projectId: string | null) => number;
}

function notifyError(message: string) {
  useNotificationStore.getState().addNotification({
    type: 'error',
    title: 'Debug',
    message,
  });
}

function logDebugStackError(msg: string) {
  // Keep UI clean — stack races are common with Delve; only log.
  if (msg.includes('stackTrace') || msg.includes('goroutine')) {
    console.warn('[debug]', msg);
    return;
  }
  console.warn('[debug]', msg);
}

let consoleSeq = 0;

function isLiveSession(session: DapSessionInfo | null): boolean {
  return !!session?.sessionId && session.status !== 'terminated' && session.status !== 'ended';
}

/** Clear stack / vars / highlight when a session ends (idempotent). */
function endedSessionPatch(
  session: DapSessionInfo | null,
  statusMessage = 'Session terminated',
): Partial<DebugState> {
  return {
    session: session
      ? {
          ...session,
          status: 'terminated',
          statusMessage: session.statusMessage ?? statusMessage,
        }
      : null,
    frames: [],
    variables: [],
    ...CLEAR_EXPANSION,
    stoppedAt: null,
    selectedFrameId: null,
  };
}

export const useDebugStore = create<DebugState>((rawSet, get) => {
  /** Wrap set: opening the debug panel always closes Task Console. */
  const set = ((partial: Parameters<typeof rawSet>[0], replace?: boolean) => {
    const next =
      typeof partial === 'function'
        ? (partial as (s: DebugState) => Partial<DebugState>)(get())
        : partial;
    if (next && typeof next === 'object' && (next as Partial<DebugState>).panelOpen === true) {
      exclusiveOpenDebugPanel();
    }
    return (rawSet as (p: unknown, r?: boolean) => void)(partial, replace);
  }) as typeof rawSet;

  /** Adapter check + session launch + panel/console wiring, shared by `start` (named config)
   *  and `startWithConfig` (synthetic config from editor test debug). Rethrows on failure. */
  const launchSession = async (
    projectId: string,
    config: LaunchConfig,
    start: () => Promise<DapSessionInfo>,
  ) => {
    try {
      const available = await dapCheckAdapter(projectId, config.type);
      if (!available) {
        const hint =
          config.type === 'go'
            ? 'Install Delve: go install github.com/go-delve/delve/cmd/dlv@latest'
            : config.type === 'java'
              ? 'Run tools/java-host/build.sh to build the Java debug host (requires JDK >= 11), or point `dap.adapterBinaries.java` at a host jar'
              : 'Install lldb-dap (LLVM) or codelldb and ensure it is on PATH';
        const msg = `Debug adapter for type "${config.type}" not found. ${hint}`;
        set({ error: msg, panelOpen: true, panelTab: 'console' });
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
        panelOpen: true,
        panelTab: 'console',
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

  const resetSessionState = () => {
    set({
      error: null,
      consoleLines: [],
      frames: [],
      variables: [],
      ...CLEAR_EXPANSION,
      stoppedAt: null,
      selectedFrameId: null,
    });
  };

  return {
    configs: [],
    entries: [],
    selectedConfigName: null,
    session: null,
    breakpoints: {},
    frames: [],
    variables: [],
    childrenByRef: {},
    expandedRefs: {},
    loadingRefs: {},
    varErrors: {},
    selectedFrameId: null,
    consoleLines: [],
    panelOpen: false,
    panelTab: 'console',
    stoppedAt: null,
    error: null,

    clearError: () => set({ error: null }),
    setPanelOpen: (open) => set({ panelOpen: open }),
    setPanelTab: (tab) => set({ panelTab: tab }),
    openPanel: (tab) =>
      set({
        panelOpen: true,
        ...(tab ? { panelTab: tab } : {}),
      }),
    togglePanel: () => {
      const next = !get().panelOpen;
      set({ panelOpen: next });
    },

    pushConsole: (kind, text) => {
      const lines = get().consoleLines;
      // Drop consecutive identical *system* lines only (our own Starting/Started/
      // status lines can double-fire from re-renders). Program output ('out'/'err')
      // must stay verbatim — loops legitimately print identical lines (e.g. two
      // `println("0:2")` in one test), deduping them hides real output.
      const last = lines[lines.length - 1];
      if (kind === 'sys' && last && last.kind === 'sys' && last.text === text) {
        return;
      }
      const line: ConsoleLine = {
        id: `c-${++consoleSeq}`,
        kind,
        text,
      };
      set({ consoleLines: [...lines.slice(-200), line] });
    },

    loadConfigs: async (projectId) => {
      try {
        const configs = await dapListConfigs(projectId);
        const selected =
          get().selectedConfigName && configs.some((c) => c.name === get().selectedConfigName)
            ? get().selectedConfigName
            : (configs[0]?.name ?? null);
        set({ configs, selectedConfigName: selected });
        const session = await dapGetSession(projectId);
        if (session) set({ session });
        // Load persisted breakpoints whenever configs load
        await get().loadBreakpoints(projectId);
        void get().loadEntries(projectId);
      } catch (e) {
        set({ error: String(e), configs: [] });
      }
    },

    loadEntries: async (projectId) => {
      try {
        const entries = await dapDiscoverEntries(projectId);
        set({ entries });
      } catch {
        set({ entries: [] });
      }
    },

    selectConfig: (name) => set({ selectedConfigName: name }),

    saveConfigs: async (projectId, configurations) => {
      set({ error: null });
      try {
        await dapSaveConfigs(projectId, configurations);
        set({
          configs: configurations,
          selectedConfigName:
            get().selectedConfigName &&
            configurations.some((c) => c.name === get().selectedConfigName)
              ? get().selectedConfigName
              : (configurations[0]?.name ?? null),
        });
      } catch (e) {
        const msg = String(e);
        set({ error: msg });
        notifyError(msg);
        throw e;
      }
    },

    addConfig: async (projectId, config) => {
      const existing = get().configs;
      if (existing.some((c) => c.name === config.name)) {
        const msg = `Config "${config.name}" already exists`;
        set({ error: msg });
        notifyError(msg);
        throw new Error(msg);
      }
      const next = [...existing, config];
      await get().saveConfigs(projectId, next);
      set({ selectedConfigName: config.name });
    },

    updateConfig: async (projectId, originalName, config) => {
      const existing = get().configs;
      if (config.name !== originalName && existing.some((c) => c.name === config.name)) {
        const msg = `Config "${config.name}" already exists`;
        set({ error: msg });
        notifyError(msg);
        throw new Error(msg);
      }
      const next = existing.map((c) => (c.name === originalName ? config : c));
      await get().saveConfigs(projectId, next);
      set({ selectedConfigName: config.name });
    },

    deleteConfig: async (projectId, name) => {
      const next = get().configs.filter((c) => c.name !== name);
      await get().saveConfigs(projectId, next);
    },

    start: async (projectId, currentFile) => {
      // Fresh session: clear previous console output (do not append across runs).
      resetSessionState();
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
        set({ error: msg, panelOpen: true, panelTab: 'console' });
        get().pushConsole('err', msg);
        notifyError(msg);
        throw new Error(msg);
      }

      await launchSession(projectId, config, () => dapStartSession(projectId, name, currentFile));
    },

    startWithConfig: async (projectId, config) => {
      resetSessionState();
      await launchSession(projectId, config, () => dapStartSessionConfig(projectId, config));
    },

    /** Java attach-first（J3）：spawn 测试 JVM + attach 全流程在单条后端命令内完成，
     *  返回的 DapSessionInfo 与 startWithConfig 同构。config 仅用于 adapter 可用性
     *  检查（type:'java'）；port 由后端解析 jdwp 端口后填充进 attach 请求。
     *  classpath 供 host 解析第三方库 / JDK 源码（经 attach 载荷 sourcePaths 送达）。 */
    startJavaAttach: async (projectId, command, cwd, testName, classpath) => {
      resetSessionState();
      // 回显真实执行命令（reset 之后推，否则被清空；用户可复制复现排查）。
      get().pushConsole('sys', `$ ${command}`);
      const config: LaunchConfig = {
        name: `Debug test: ${testName}`,
        type: 'java',
        request: 'attach',
        cwd,
        stopOnEntry: false,
      };
      await launchSession(projectId, config, () =>
        debugJavaAttach(projectId, command, cwd, testName, classpath),
      );
    },

    debugEntry: async (projectId, entry, currentFile) => {
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
        ...endedSessionPatch(get().session, 'Stopped'),
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
        set({ error: msg, panelOpen: true, panelTab: 'console' });
        get().pushConsole('err', msg);
        notifyError(msg);
      }
    },

    toggleBreakpoint: async (projectId, filePath, line) => {
      const current = get().getFileBreakpoints(projectId, filePath);
      const next = current.includes(line)
        ? current.filter((l) => l !== line)
        : [...current, line].sort((a, b) => a - b);

      const projectBps = { ...(get().breakpoints[projectId] ?? {}) };
      if (next.length === 0) delete projectBps[filePath];
      else projectBps[filePath] = next;
      set({
        breakpoints: { ...get().breakpoints, [projectId]: projectBps },
      });

      try {
        const live = isLiveSession(get().session) ? get().session?.sessionId : null;
        const returned = await dapSetBreakpoints(projectId, filePath, next, live);
        // Offline/no-session: backend echoes lines with verified=false — still keep them.
        // Live session: adapter may remap to a nearby executable line.
        if (next.length === 0) {
          // already cleared optimistically
          return;
        }
        const returnedLines = [...new Set(returned.map((b) => b.line).filter((l) => l > 0))].sort(
          (a, b) => a - b,
        );
        // Prefer verified locations when the adapter confirmed any; otherwise keep all returned.
        const confirmed = returned
          .filter((b) => b.verified === true && b.line > 0)
          .map((b) => b.line);
        const finalLines =
          confirmed.length > 0
            ? [...new Set(confirmed)].sort((a, b) => a - b)
            : returnedLines.length > 0
              ? returnedLines
              : next;
        const projectBps2 = { ...(get().breakpoints[projectId] ?? {}) };
        projectBps2[filePath] = finalLines;
        set({
          breakpoints: { ...get().breakpoints, [projectId]: projectBps2 },
        });
      } catch (e) {
        const msg = String(e);
        set({ error: msg });
        notifyError(msg);
      }
    },

    removeBreakpoint: async (projectId, filePath, line) => {
      const current = get().getFileBreakpoints(projectId, filePath);
      if (!current.includes(line)) return;
      await get().toggleBreakpoint(projectId, filePath, line);
    },

    loadBreakpoints: async (projectId) => {
      try {
        const list = await dapGetBreakpoints(projectId);
        const remote: Record<string, number[]> = {};
        for (const b of list) {
          (remote[b.filePath] ??= []).push(b.line);
        }
        for (const lines of Object.values(remote)) {
          lines.sort((a, b) => a - b);
        }
        // Disk is source of truth on load (survives restart)
        set({
          breakpoints: { ...get().breakpoints, [projectId]: remote },
        });
      } catch {
        // keep local
      }
    },

    getFileBreakpoints: (projectId, filePath) => {
      return get().breakpoints[projectId]?.[filePath] ?? EMPTY_BP_LINES;
    },

    listAllBreakpoints: (projectId) => {
      const map = get().breakpoints[projectId] ?? {};
      const out: BreakpointSpec[] = [];
      for (const [filePath, lines] of Object.entries(map)) {
        for (const line of lines) {
          out.push({ filePath, line });
        }
      }
      out.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
      return out;
    },

    breakpointCount: (projectId) => {
      if (!projectId) return 0;
      const map = get().breakpoints[projectId] ?? {};
      let n = 0;
      for (const lines of Object.values(map)) n += lines.length;
      return n;
    },

    refreshStackAndVars: async () => {
      const sid = get().session?.sessionId;
      const session = get().session;
      if (!sid || !session || !isLiveSession(session)) return;

      // New stopped context: previously fetched child variables are stale.
      set({ ...CLEAR_EXPANSION });

      /** Drop stale work if session ended or was replaced mid-await. */
      const stillLive = (): DapSessionInfo | null => {
        const s = get().session;
        if (!s || s.sessionId !== sid || !isLiveSession(s)) return null;
        return s;
      };

      const applyFrames = async (frames: StackFrameDto[], live: DapSessionInfo) => {
        if (!stillLive()) return;
        set({ frames });

        if (frames.length === 0) {
          set({ variables: [], selectedFrameId: null, stoppedAt: null });
          return;
        }

        // 停止位置 = 栈顶第一个带源码的帧（编辑器跟随栈顶帧，与 IDE 一致）。
        // 不再优先项目帧：那会把「单步进入 JDK / 库」跳回调用方文件。
        const nav = pickStopFrame(frames);
        const selected = nav ?? frames[0];
        set({ selectedFrameId: selected.id });

        const onOpenError = (message: string) => get().pushConsole('err', message);
        if (nav?.sourcePath) {
          // stoppedAt 与 tab 身份同一套规范（JDK 缓存路径收敛成 jdt 身份），
          // 黄线判定退化为精确相等，不需要任何别名归一。
          set({
            stoppedAt: {
              filePath: sourceIdentityOf(live.projectPath, nav.sourcePath),
              line: nav.line,
              column: nav.column,
            },
          });
          void openSourceAtLine(
            live.projectId,
            live.projectPath,
            nav.sourcePath,
            nav.line,
            nav.column,
            {
              sessionId: sid,
              onError: onOpenError,
            },
          );
        } else if (nav?.sourceReference) {
          const identity = virtualSourceIdentity(nav.sourceReference, nav.sourceName);
          set({
            stoppedAt: {
              filePath: identity,
              line: nav.line,
              column: nav.column,
            },
          });
          void openVirtualSourceAtLine(
            live.projectId,
            nav.sourceName,
            nav.sourceReference,
            nav.line,
            nav.column,
            { sessionId: sid, onError: onOpenError },
          );
        } else {
          set({ stoppedAt: null });
        }

        if (!stillLive()) return;
        try {
          const variables = await dapVariables(sid, selected.id);
          if (!stillLive()) return;
          set({ variables });
        } catch (e) {
          if (!stillLive()) return;
          logDebugStackError(String(e));
        }
      };

      try {
        const frames = await dapStackTrace(sid);
        const live = stillLive();
        if (!live) return;
        await applyFrames(frames, live);
      } catch (e) {
        // Transient Delve races (Dummy thread) — retry once, avoid noisy toast.
        const msg = String(e);
        logDebugStackError(msg);
        try {
          await new Promise((r) => setTimeout(r, 150));
          if (!stillLive()) return;
          const frames = await dapStackTrace(sid);
          const live = stillLive();
          if (!live) return;
          await applyFrames(frames, live);
        } catch (e2) {
          if (!stillLive()) return;
          get().pushConsole('err', String(e2));
        }
      }
    },

    selectFrame: async (frameId) => {
      const sid = get().session?.sessionId;
      if (!sid || !isLiveSession(get().session)) return;
      set({ selectedFrameId: frameId, ...CLEAR_EXPANSION });
      const frame = get().frames.find((f) => f.id === frameId);
      if (frame?.sourcePath) {
        set({
          stoppedAt: {
            filePath: frame.sourcePath,
            line: frame.line,
            column: frame.column,
          },
        });
      } else if (frame?.sourceReference) {
        set({
          stoppedAt: {
            filePath: virtualSourceIdentity(frame.sourceReference, frame.sourceName),
            line: frame.line,
            column: frame.column,
          },
        });
      }
      try {
        const variables = await dapVariables(sid, frameId);
        set({ variables });
      } catch (e) {
        notifyError(String(e));
      }
    },

    toggleVariableExpand: async (ref) => {
      const sid = get().session?.sessionId;
      if (!sid || !isLiveSession(get().session) || ref <= 0) return;

      // Collapse.
      if (get().expandedRefs[ref]) {
        set({ expandedRefs: { ...get().expandedRefs, [ref]: false } });
        return;
      }
      // Re-expand from cache.
      if (get().childrenByRef[ref]) {
        set({ expandedRefs: { ...get().expandedRefs, [ref]: true } });
        return;
      }
      // First expand: fetch children lazily.
      const varErrors = { ...get().varErrors };
      delete varErrors[ref];
      set({
        expandedRefs: { ...get().expandedRefs, [ref]: true },
        loadingRefs: { ...get().loadingRefs, [ref]: true },
        varErrors,
      });
      try {
        const children = await dapVariablesByReference(sid, ref);
        set({
          childrenByRef: { ...get().childrenByRef, [ref]: children },
          loadingRefs: { ...get().loadingRefs, [ref]: false },
        });
      } catch (e) {
        const msg = String(e).replace(/^Error:\s*/, '');
        set({
          expandedRefs: { ...get().expandedRefs, [ref]: false },
          loadingRefs: { ...get().loadingRefs, [ref]: false },
          varErrors: { ...get().varErrors, [ref]: msg },
        });
      }
    },

    evaluate: async (expression) => {
      const sid = get().session?.sessionId;
      if (!sid || !isLiveSession(get().session)) {
        get().pushConsole('err', 'No active debug session');
        return;
      }
      get().pushConsole('in', expression);
      try {
        const result = await dapEvaluate(sid, expression, get().selectedFrameId);
        get().pushConsole('out', result || '(no result)');
      } catch (e) {
        get().pushConsole('err', String(e));
      }
    },

    subscribeEvents: async () => {
      const unsubs: UnlistenFn[] = [];
      unsubs.push(
        await listen<DapEventPayload>(DAP_EVENT, (event) => {
          const { kind, body, sessionId } = event.payload;
          const session = get().session;
          if (session && session.sessionId && session.sessionId !== sessionId) return;

          if (kind === 'stopped') {
            if (session?.sessionId && session.sessionId !== sessionId) return;
            // Merge status even if start() hasn't set session yet (use payload ids).
            const base =
              session?.sessionId === sessionId
                ? session
                : (session ?? {
                    sessionId,
                    projectId: event.payload.projectId,
                    projectPath: '',
                    configName: '',
                    status: 'stopped',
                  });
            set({
              session: { ...base, sessionId, status: 'stopped' },
              panelOpen: true,
              panelTab: 'session',
            });
            // No Debug Console spam for stop/step — toolbar + Call Stack already show state.
            void get().refreshStackAndVars();
          } else if (kind === 'continued') {
            set({
              session: session ? { ...session, status: 'running' } : session,
              stoppedAt: null, // clear yellow line while running
              ...CLEAR_EXPANSION, // references from the previous stop are stale
            });
          } else if (kind === 'terminated') {
            // Always clear stack/vars (status may already be terminated via dap-session-status).
            const alreadyEnded = session?.status === 'terminated';
            set({
              ...endedSessionPatch(session),
              panelOpen: true,
              panelTab: 'console',
            });
            if (!alreadyEnded) {
              get().pushConsole('sys', 'Session terminated');
            }
          } else if (kind === 'output') {
            const output = body as { output?: string; category?: string };
            const raw = output.output ?? '';
            let text = raw.replace(/\n$/, '');
            // codelldb / libtest 输出带 ANSI 颜色（`\x1b[32m`…`\x1b[0m`、字符集
            // `\x1b(B`）——DebugPanel console 是纯文本，原样显示即乱码，先剥。
            text = stripAnsi(text);
            // 过滤调试台的纯提示噪音（codelldb 启动 banner；VSCode DEBUG CONSOLE
            // 也有，但对普通用户无信息量）。`Starting:`/`Launched process` 保留。
            if (isCodelldbNoise(text)) {
              return;
            }
            if (text) {
              const cat = output.category ?? 'stdout';
              const lineKind: ConsoleLine['kind'] =
                cat === 'stderr' ? 'err' : cat === 'console' ? 'sys' : 'out';
              for (const part of text.split('\n')) {
                get().pushConsole(lineKind, part);
              }
              // Program prints (and errors) should be visible in Debug Console.
              if (cat === 'stdout' || cat === 'stderr') {
                set({ panelOpen: true, panelTab: 'console' });
              }
            }
          } else if (kind === 'session' && session) {
            const status = (body as { status?: string })?.status;
            if (status) {
              set({ session: { ...session, status } });
            }
          }
        }),
      );
      unsubs.push(
        await listen<DapSessionInfo>(DAP_SESSION_STATUS_EVENT, (event) => {
          const info = event.payload;
          const cur = get().session;
          if (info.status === 'terminated' || info.status === 'ended') {
            set({
              ...endedSessionPatch(
                cur?.sessionId === info.sessionId ? { ...cur, ...info } : info,
                info.statusMessage ?? 'Session terminated',
              ),
              panelOpen: true,
              panelTab: 'console',
            });
            return;
          }
          if (cur && cur.sessionId === info.sessionId) {
            set({ session: info });
          } else if (!cur) {
            set({ session: info, panelOpen: true, panelTab: 'session' });
          }
        }),
      );
      return () => {
        for (const u of unsubs) safeUnlisten(u)();
      };
    },
  };
});

registerDebugPanelCloser(() => {
  useDebugStore.setState({ panelOpen: false });
});

export function breakpointsForFile(
  state: DebugState,
  projectId: string,
  filePath: string,
): BreakpointSpec[] {
  return state.getFileBreakpoints(projectId, filePath).map((line) => ({
    filePath,
    line,
  }));
}

export function sameBreakpointMap(
  a: Record<string, number[]>,
  b: Record<string, number[]>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const al = a[k] ?? [];
    const bl = b[k] ?? [];
    if (al.length !== bl.length) return false;
    for (let i = 0; i < al.length; i++) {
      if (al[i] !== bl[i]) return false;
    }
  }
  return true;
}
