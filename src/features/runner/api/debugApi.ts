import { invoke } from '@tauri-apps/api/core';

import type { FileContent } from '@/shared/types';

import type {
  BreakpointEntry,
  BreakpointSpec,
  DapSessionInfo,
  EntryPoint,
  JavaDebugStartResult,
  JavaJdtlsTarget,
  LaunchConfig,
  StackFrameDto,
  VariableDto,
} from '../types';

export function dapListConfigs(
  projectId: string,
  worktreePath: string | null,
): Promise<LaunchConfig[]> {
  return invoke<LaunchConfig[]>('dap_list_configs', { projectId, worktreePath });
}

export function dapSaveConfigs(
  projectId: string,
  worktreePath: string | null,
  configurations: LaunchConfig[],
): Promise<void> {
  return invoke('dap_save_configs', { projectId, worktreePath, configurations });
}

export function dapDiscoverEntries(
  projectId: string,
  worktreePath: string | null,
): Promise<EntryPoint[]> {
  return invoke<EntryPoint[]>('dap_discover_entries', { projectId, worktreePath });
}

/** `worktreePath` = 执行单元根（激活 worktree / 项目根；无 worktree 传 null）。
 *  后端据此派生 cwd 校验基准、适配器 workspace、`${workspaceFolder}` 与 launch.json 读取根。 */
export function dapStartSession(
  projectId: string,
  worktreePath: string | null,
  configName?: string | null,
  currentFile?: string | null,
): Promise<DapSessionInfo> {
  return invoke<DapSessionInfo>('dap_start_session', {
    projectId,
    worktreePath,
    configName: configName ?? null,
    currentFile: currentFile ?? null,
  });
}

export function dapStartSessionConfig(
  projectId: string,
  worktreePath: string | null,
  config: LaunchConfig,
): Promise<DapSessionInfo> {
  return invoke<DapSessionInfo>('dap_start_session_config', { projectId, worktreePath, config });
}

/** `debug_java_attach` 的 nested target（Rust `JavaDebugTarget`；IPC 契约为 camelCase）。 */
export interface JavaAttachTarget {
  /** 已就绪的 debuggee shell 命令（前端 `buildJavaDebugCommand` 产物）。 */
  command: string;
  /** 运行目录（模块根）。 */
  cwd: string;
  /** 会话显示名中的用例名。 */
  testName: string;
  /** debuggee 运行时 classpath 条目。 */
  classpath: string[];
}

/** Java attach-first（J3）：后端 spawn 测试 JVM（jdwp suspend=y）→ 解析端口 → attach 会话。
 *  `classpath` 为 debuggee 运行时 classpath 条目：随 attach 载荷的 `sourcePaths`
 *  送达 host，供其解析第三方库 / JDK 源码。
 *  `worktreePath` = 执行单元根（激活 worktree / 项目根）；后端用它做 cwd 校验基准
 *  与适配器 workspace（worktree 可在项目根之外）。 */
export function debugJavaAttach(
  projectId: string,
  worktreePath: string | null,
  target: JavaAttachTarget,
): Promise<DapSessionInfo> {
  return invoke<DapSessionInfo>('debug_java_attach', { projectId, worktreePath, target });
}

export function dapStopSession(sessionId: string): Promise<void> {
  return invoke('dap_stop_session', { sessionId });
}

export function dapGetSession(projectId: string): Promise<DapSessionInfo | null> {
  return invoke<DapSessionInfo | null>('dap_get_session', { projectId });
}

export function dapSetBreakpoints(
  projectId: string,
  filePath: string,
  breakpoints: BreakpointEntry[],
  sessionId?: string | null,
): Promise<BreakpointSpec[]> {
  return invoke<BreakpointSpec[]>('dap_set_breakpoints', {
    projectId,
    filePath,
    breakpoints,
    sessionId: sessionId ?? null,
  });
}

export function dapGetBreakpoints(projectId: string): Promise<BreakpointSpec[]> {
  return invoke<BreakpointSpec[]>('dap_get_breakpoints', { projectId });
}

/** 全局静音开关（per-project 单 bool；后端持久化进 breakpoints.json）。 */
export function dapSetBreakpointsMuted(projectId: string, muted: boolean): Promise<void> {
  return invoke('dap_set_breakpoints_muted', { projectId, muted });
}

/** 读全局静音（loadBreakpoints 时与列表同取）。 */
export function dapGetBreakpointsMuted(projectId: string): Promise<boolean> {
  return invoke<boolean>('dap_get_breakpoints_muted', { projectId });
}

export function dapControl(sessionId: string, action: string): Promise<void> {
  return invoke('dap_control', { sessionId, action });
}

export function dapStackTrace(sessionId: string): Promise<StackFrameDto[]> {
  return invoke<StackFrameDto[]>('dap_stack_trace', { sessionId });
}

/**
 * Fetch the source content behind a DAP `sourceReference` — adapters that keep
 * sources off-disk (remote debuggees, debuggee-provided sources).
 */
export function dapSourceContent(sessionId: string, sourceReference: number): Promise<string> {
  return invoke<string>('dap_source_content', { sessionId, sourceReference });
}

/**
 * Read the source of a stack frame that lives outside the project root
 * (third-party / stdlib code), read-only. Authorized only while the session is
 * stopped at that exact frame path.
 */
export function dapReadExternalSource(
  projectId: string,
  sessionId: string,
  path: string,
): Promise<FileContent> {
  return invoke<FileContent>('dap_read_external_source', { projectId, sessionId, path });
}

export function dapVariables(sessionId: string, frameId: number): Promise<VariableDto[]> {
  return invoke<VariableDto[]>('dap_variables', { sessionId, frameId });
}

export function dapVariablesByReference(
  sessionId: string,
  variablesReference: number,
): Promise<VariableDto[]> {
  return invoke<VariableDto[]>('dap_variables_by_reference', {
    sessionId,
    variablesReference,
  });
}

export function dapEvaluate(
  sessionId: string,
  expression: string,
  frameId?: number | null,
): Promise<string> {
  return invoke<string>('dap_evaluate', {
    sessionId,
    expression,
    frameId: frameId ?? null,
  });
}

export function dapCheckAdapter(projectId: string, adapterType: string): Promise<boolean> {
  return invoke<boolean>('dap_check_adapter', { projectId, adapterType });
}

/** B'（JDTLS 后端）：能力探测 → 直连 JDTLS 内 DAP 端口 → launch。
 *
 *  结果三态（session / warming / unavailable）**不含自动换引擎**：不可用时由调用方
 *  按 `staticallyDetectable` 决定"一次性询问改用 Host"还是"报错 + 显式入口"。 */
export function debugJavaStart(
  projectId: string,
  worktreePath: string | null,
  target: JavaJdtlsTarget,
): Promise<JavaDebugStartResult> {
  return invoke<JavaDebugStartResult>('debug_java_start', { projectId, worktreePath, target });
}
