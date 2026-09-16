import type { UnlistenFn } from '@tauri-apps/api/event';
import type { StateCreator } from 'zustand';

import type { StopLocation } from '../../stackFrames';
import type {
  BreakpointSpec,
  ConsoleLine,
  DapSessionInfo,
  DebugPanelTab,
  EntryPoint,
  LaunchConfig,
  StackFrameDto,
  VariableDto,
} from '../../types';

import type { StopGeneration } from './stopGeneration';

/**
 * Debug store 的**能力切片**：每个 slice 只声明自己的 state 与动作。
 *
 * 依赖方向（单向）：`types.ts` 是叶子（纯类型），slice 只依赖它 + `shared.ts`；
 * **slice 之间不互相 import** —— 跨 slice 调用一律经 `get()` 上的组合类型 `DebugStore`。
 */

/** 面板可见性与页签（纯 UI 状态）。 */
export interface DebugPanelSlice {
  panelOpen: boolean;
  panelTab: DebugPanelTab;
  setPanelOpen: (open: boolean) => void;
  openPanel: (tab?: DebugPanelTab) => void;
  /** Toggle debug UI panel open/closed. */
  togglePanel: () => void;
  setPanelTab: (tab: DebugPanelTab) => void;
}

/** 控制台行缓冲（含「相邻 sys 去重 + 200 行上限」不变式）。 */
export interface DebugConsoleSlice {
  consoleLines: ConsoleLine[];
  pushConsole: (kind: ConsoleLine['kind'], text: string) => void;
}

/** 启动配置与入口点。 */
export interface DebugConfigSlice {
  configs: LaunchConfig[];
  entries: EntryPoint[];
  selectedConfigName: string | null;
  loadConfigs: (projectId: string) => Promise<void>;
  loadEntries: (projectId: string) => Promise<void>;
  selectConfig: (name: string | null) => void;
  saveConfigs: (projectId: string, configurations: LaunchConfig[]) => Promise<void>;
  addConfig: (projectId: string, config: LaunchConfig) => Promise<void>;
  updateConfig: (projectId: string, originalName: string, config: LaunchConfig) => Promise<void>;
  deleteConfig: (projectId: string, name: string) => Promise<void>;
}

/** 会话生命周期（启动 / 附加 / 停止 / 控制 / 复位 / 面板级错误）。 */
export interface DebugSessionSlice {
  session: DapSessionInfo | null;
  error: string | null;
  /** error 所属项目（跨项目切换时按此屏蔽旧项目错误，见 DebugPanel #14）。 */
  errorProjectId: string | null;
  start: (projectId: string, currentFile?: string | null) => Promise<void>;
  /**
   * Start a session from a fully-specified synthetic config (editor test debug).
   *
   * `opts.starter`：自定义会话启动（如 Java attach 的单条后端命令）；缺省按 config 起会话。
   * `opts.reset`（默认 true）：调用前是否复位会话状态 —— 调用方若已自行复位（需在复位后
   * 回显命令）传 false，避免再次清空。
   */
  startWithConfig: (
    projectId: string,
    config: LaunchConfig,
    opts?: { starter?: () => Promise<DapSessionInfo>; reset?: boolean },
  ) => Promise<void>;
  /**
   * 语言侧建立会话后落库（attach / 直连外部端点类会话走这条）：打开面板、互斥、回填栈。
   * 与 `startWithConfig` 的会话收尾语义一致，故语言 store 无需直接改本 store 的 state。
   */
  attachSession: (session: DapSessionInfo) => void;
  /** 面板级错误（置位时打开 Console 并走面板互斥）；`projectId` = 错误所属项目，`null` = 清除。 */
  setPanelError: (projectId: string | null, message: string | null) => void;
  /** 项目切换时静默释放旧项目会话：终止后端会话、标记 terminated，但不打开面板。 */
  stopSilent: () => Promise<void>;
  /** 新会话开始前的状态复位（语言侧入口自行控制顺序时使用，如先复位再回显命令）。 */
  resetSession: () => void;
  /** Debug a discovered entry (ensures matching launch config). */
  debugEntry: (projectId: string, entry: EntryPoint, currentFile?: string | null) => Promise<void>;
  /** Run entry without debugger (terminal task). */
  runEntry: (entry: EntryPoint) => void;
  stop: () => Promise<void>;
  control: (action: string) => Promise<void>;
  clearError: () => void;
}

/** 调用栈、当前帧与求值上下文（停止位置供编辑器画黄线并跟随）。 */
export interface DebugStackSlice {
  frames: StackFrameDto[];
  variables: VariableDto[];
  selectedFrameId: number | null;
  /**
   * 当前停点位置（**规范源身份**，见 `stackFrames.buildStopLocation`）。
   *
   * **唯一位置真相**：黄线与「编辑器跟随停点」都由它派生，不允许有第二个写入口径
   * （旧实现另有写裸 `Source.path` 的路径，会让两处判定分叉）。
   */
  location: StopLocation | null;
  /**
   * 位置变化序号，**严格单调**（停点 / 切帧 / 清空都 +1）。
   *
   * 编辑器侧「跟随停点」以它为事件键：位置值相同也可能是新事件（循环里连续命中同一行），
   * 值相等无法表达「又停了一次」，故不能用位置值当依赖。
   */
  locationSeq: number;
  /**
   * 当前有效停点代际；`null` ⟺ 无有效停点（运行中 / 已结束 / 已复位）。
   *
   * 所有停点异步链在落地前必须校验它（`isSameGeneration(get().generation, gen)`），
   * 否则旧停点的迟到结果会覆盖新停点。
   */
  generation: StopGeneration | null;
  /** 取新代际（使在途旧链全部失效）。`refreshStackAndVars` 入口唯一调用点。 */
  beginStop: (sessionId: string) => StopGeneration;
  refreshStackAndVars: () => Promise<void>;
  selectFrame: (frameId: number) => Promise<void>;
  evaluate: (expression: string) => Promise<void>;
}

/** 变量树的惰性展开（缓存键为 DAP `variablesReference`，随停止上下文失效）。 */
export interface DebugVariableSlice {
  /** Lazy-expanded child variables keyed by `variablesReference`. */
  childrenByRef: Record<number, VariableDto[]>;
  /** Which references are currently expanded in the variables tree. */
  expandedRefs: Record<number, boolean>;
  /** In-flight child fetches keyed by `variablesReference`. */
  loadingRefs: Record<number, boolean>;
  /** Last expansion error keyed by `variablesReference`. */
  varErrors: Record<number, string>;
  /** Expand / collapse a variable node (lazy-fetches children via DAP). */
  toggleVariableExpand: (variablesReference: number) => Promise<void>;
}

/** 断点（projectId → filePath → lines）。 */
export interface DebugBreakpointSlice {
  /** projectId → filePath → lines */
  breakpoints: Record<string, Record<string, number[]>>;
  toggleBreakpoint: (projectId: string, filePath: string, line: number) => Promise<void>;
  removeBreakpoint: (projectId: string, filePath: string, line: number) => Promise<void>;
  loadBreakpoints: (projectId: string) => Promise<void>;
  getFileBreakpoints: (projectId: string, filePath: string) => readonly number[];
  listAllBreakpoints: (projectId: string) => BreakpointSpec[];
  breakpointCount: (projectId: string | null) => number;
}

/** DAP 事件订阅（无自身 state，只把事件投影到各 slice）。 */
export interface DebugEventsSlice {
  subscribeEvents: () => Promise<UnlistenFn>;
}

export type DebugStore = DebugPanelSlice &
  DebugConsoleSlice &
  DebugConfigSlice &
  DebugSessionSlice &
  DebugStackSlice &
  DebugVariableSlice &
  DebugBreakpointSlice &
  DebugEventsSlice;

/** slice 工厂签名：拿到组合后的 `set`/`get`，只产出自己那一片。 */
export type DebugSliceCreator<T> = StateCreator<DebugStore, [], [], T>;
