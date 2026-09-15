import { invoke } from '@tauri-apps/api/core';

/**
 * 无头测试构建门面（§4：`debug_build_test_binary` 薄命令，前端不直导 tauri api
 * 由调用方经此门面；cargo 语义解析留 `editor/utils/testCommands` 纯函数）。
 */

/** 无头构建请求（与后端 `debug_build_test_binary(project_id, command, cwd)` 对齐）。 */
export interface DebugBuildSpec {
  projectId: string;
  command: string;
  cwd: string;
}

/** 无头构建产物（后端 snake_case → 门面内转驼峰）。 */
export interface DebugBuildResult {
  exitCode: number;
  /**
   * 构建 stdout：**产物解析通道**（cargo `--message-format=json` 行 / vitest 报告
   * 路径解析），保持干净不与 stderr 混流。
   */
  stdout: string;
  /** 构建 stderr：go/cargo 的报错流（构建失败诊断展示用，不参与产物解析）。 */
  stderr: string;
}

export function buildTestBinaryRemote(spec: DebugBuildSpec): Promise<DebugBuildResult> {
  return invoke<{ exit_code: number; stdout: string; stderr: string }>('debug_build_test_binary', {
    projectId: spec.projectId,
    command: spec.command,
    cwd: spec.cwd,
  }).then((r) => ({ exitCode: r.exit_code, stdout: r.stdout, stderr: r.stderr }));
}
