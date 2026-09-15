export interface LaunchConfig {
  name: string;
  type: string;
  request: string;
  program?: string | null;
  cwd?: string | null;
  args?: string[];
  mode?: string | null;
  /** Shell command run before launch (e.g. cargo build). */
  preLaunchTask?: string | null;
  /** Pause at program entry (default false — only user breakpoints). */
  stopOnEntry?: boolean | null;
}

/** Discovered app entry (Go main package / Rust binary). */
export interface EntryPoint {
  id: string;
  name: string;
  language: string;
  program: string;
  programTemplate: string;
  runCommand: string;
  configName: string;
  adapterType: string;
  mode?: string | null;
  preLaunchTask?: string | null;
}

export interface DapSessionInfo {
  sessionId: string;
  projectId: string;
  projectPath: string;
  configName: string;
  status: string;
  statusMessage?: string | null;
}

export interface BreakpointSpec {
  filePath: string;
  line: number;
  verified?: boolean;
}

export interface StackFrameDto {
  id: number;
  name: string;
  sourcePath?: string | null;
  line: number;
  column: number;
  /** DAP `Source.name`（适配器给的类 / 文件名）；虚拟源码 tab 标题用。 */
  sourceName?: string | null;
  /**
   * DAP `Source.sourceReference`（>0 = 源码不在磁盘上，经 DAP `source` 请求按
   * 引用取内容）。缺失 / 0 = 无虚拟源码。
   */
  sourceReference?: number | null;
}

export interface VariableDto {
  name: string;
  value: string;
  type?: string | null;
  variablesReference: number;
}

export interface DapEventPayload {
  sessionId: string;
  projectId: string;
  kind: string;
  body: unknown;
}

export interface ConsoleLine {
  id: string;
  kind: 'in' | 'out' | 'err' | 'sys';
  text: string;
}

/** Which pane is focused in the bottom debug panel. */
export type DebugPanelTab = 'session' | 'console' | 'breakpoints';

/** `dap.javaBackend` 的取值：唯一定义在 `@/shared/types`，此处重导出以保持既有导入路径。 */
export type { JavaDebugBackend } from '@/shared/types';

/** Java 调试会话实际走的后端标注（`null` = 非 Java 会话）。 */
export type JavaBackendLabel = 'jdtls' | 'host' | 'host (fallback)';

/**
 * B'（JDTLS 后端）的调试目标。
 *
 * `mainClass` / `args` 由**唯一一份**用例身份 → 启动参数构造逻辑产出（Run/Debug 同源，
 * 与 `debugJavaAttach` 共用同一构造器），Rust 侧只补真机 classpath 与 Console Launcher jar。
 */
export interface JavaJdtlsTarget {
  /** 能力探测用的类（测试类或 main 类 FQCN）。 */
  probeClass: string;
  /** 运行目录（模块根）。 */
  cwd: string;
  /** 会话显示名中的用例名。 */
  testName: string;
  /** DAP `mainClass`。 */
  mainClass: string;
  /** DAP `args`。 */
  args: string[];
  /** 测试目标附带 Console Launcher jar（绝对路径）；应用调试省略。 */
  launcherJar?: string | null;
  /** 多模块消歧用；省略时后端按项目目录名推导。 */
  projectName?: string | null;
}

/**
 * `debugJavaStart` 的结果：**后端不自动换引擎**，三态由前端按配置语义处理。
 */
export type JavaDebugStartResult =
  | { kind: 'session'; session: DapSessionInfo }
  | { kind: 'warming'; detail: string }
  | { kind: 'unavailable'; message: string; staticallyDetectable: boolean };
