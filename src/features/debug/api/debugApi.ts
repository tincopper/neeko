import { invoke } from '@tauri-apps/api/core';

import type {
  BreakpointSpec,
  DapSessionInfo,
  EntryPoint,
  LaunchConfig,
  StackFrameDto,
  VariableDto,
} from '../types';

export function dapListConfigs(projectId: string): Promise<LaunchConfig[]> {
  return invoke<LaunchConfig[]>('dap_list_configs', { projectId });
}

export function dapSaveConfigs(
  projectId: string,
  configurations: LaunchConfig[],
): Promise<void> {
  return invoke('dap_save_configs', { projectId, configurations });
}

export function dapDiscoverEntries(projectId: string): Promise<EntryPoint[]> {
  return invoke<EntryPoint[]>('dap_discover_entries', { projectId });
}

export function dapStartSession(
  projectId: string,
  configName?: string | null,
  currentFile?: string | null,
): Promise<DapSessionInfo> {
  return invoke<DapSessionInfo>('dap_start_session', {
    projectId,
    configName: configName ?? null,
    currentFile: currentFile ?? null,
  });
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
  lines: number[],
  sessionId?: string | null,
): Promise<BreakpointSpec[]> {
  return invoke<BreakpointSpec[]>('dap_set_breakpoints', {
    projectId,
    filePath,
    lines,
    sessionId: sessionId ?? null,
  });
}

export function dapGetBreakpoints(projectId: string): Promise<BreakpointSpec[]> {
  return invoke<BreakpointSpec[]>('dap_get_breakpoints', { projectId });
}

export function dapControl(sessionId: string, action: string): Promise<void> {
  return invoke('dap_control', { sessionId, action });
}

export function dapStackTrace(sessionId: string): Promise<StackFrameDto[]> {
  return invoke<StackFrameDto[]>('dap_stack_trace', { sessionId });
}

export function dapVariables(sessionId: string, frameId: number): Promise<VariableDto[]> {
  return invoke<VariableDto[]>('dap_variables', { sessionId, frameId });
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
