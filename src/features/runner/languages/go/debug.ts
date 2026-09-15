/**
 * Go 调试启动配置（`dlv exec` 形态；命令与产物解析在 `./commands.ts`）。
 *
 * 从 `utils/testCommands.ts` 的 `buildDebugLaunchConfig` / `buildMainDebugLaunchConfig` 按语言拆出
 * （方案 B 阶段 2）：两个函数原先用 `lang === 'go'` 分支服务两门语言，拆开后各自只描述本语言的
 * 适配器载荷形态（Go：`type: 'go'` + `mode: 'exec'`）。
 */
import { resolveRunCwd } from '../../exec/context';
import type { NativeDebugLaunchConfig } from '../../exec/nativeBuild';
import { resolveBinaryPath } from '../../exec/nativeBuild';
import { runNativeBuild, type NativeDebugHooks } from '../../exec/nativeDebug';
import type { TestCaseInfo } from '../../syntax/contract';
import { langIo } from '../io';

import {
  buildGoDebugBuildCommand,
  buildGoMainDebugBuildCommand,
  goDebugBinaryRelPath,
  goTestRunPattern,
} from './commands';
import { goPkgDir } from './pkg';

/** 合成 main Debug launch 配置：program = 预编译 main 二进制，args = []。 */
export function goMainDebugLaunchConfig(
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  return {
    name: 'Debug main',
    type: 'go',
    request: 'launch',
    program,
    cwd: workspaceRoot,
    mode: 'exec',
    args: [],
    stopOnEntry: false,
  };
}

/**
 * 合成用例 Debug launch 配置：program = 预编译测试二进制，args 传 `-test.run` 过滤。
 *
 * 基准：显式传全量 delve flag（首参以 `-` 开头 → GoAdapter 原样透传，不再拼 `-test.run`），
 * 否则会退化成「跑用例」而非「跑基准」。用例：裸锚定模式，adapter 负责拼 `-test.run`。
 */
export function goTestDebugLaunchConfig(
  testCase: TestCaseInfo,
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  const isBenchmark = testCase.variant === 'benchmark';
  return {
    name: `${isBenchmark ? 'Debug benchmark' : 'Debug test'}: ${testCase.name}`,
    type: 'go',
    request: 'launch',
    program,
    cwd: workspaceRoot,
    mode: 'exec',
    args: isBenchmark
      ? ['-test.run', '^$', '-test.bench', goTestRunPattern(testCase.name)]
      : [goTestRunPattern(testCase.name)],
    stopOnEntry: false,
  };
}

/**
 * Go 的 native debug 三件事（**编排在 `exec/nativeDebug.ts`**，此处只给语言差异）。
 *
 * 构建走 `-o` 显式产物路径（比 Rust 的 compiler-artifact 解析更简单：产物即 `.neeko/test-bin/<名>`，
 * `programPath` 直接确定，无需解析 stdout）；包目录从被编辑文件向上找 `go.mod`（嵌套 module 取相对
 * module 根的包目录）。
 */
export const GO_DEBUG_HOOKS: NativeDebugHooks = {
  async build(target, ctx) {
    const cwd = resolveRunCwd(ctx);
    const goPkg = await goPkgDir(ctx.filePath, cwd, langIo.fileExists);
    if (target.kind === 'test') {
      const outRelPath = goDebugBinaryRelPath(target.testCase.name);
      const command = buildGoDebugBuildCommand(goPkg, outRelPath);
      const build = await runNativeBuild(ctx, command, cwd);
      return { ...build, programPath: resolveBinaryPath(outRelPath, cwd) };
    }
    const command = buildGoMainDebugBuildCommand(goPkg);
    const build = await runNativeBuild(ctx, command, cwd);
    return { ...build, programPath: resolveBinaryPath(goDebugBinaryRelPath('main'), cwd) };
  },

  // 产物路径在 build 阶段已确定（`-o` 显式），parse 直取。
  parse: (_target, build) =>
    build.programPath
      ? { ok: true as const, path: build.programPath }
      : { ok: false, error: 'binary_not_found' },

  launchConfig: (target, program, cwd) =>
    target.kind === 'test'
      ? goTestDebugLaunchConfig(target.testCase, program, cwd)
      : goMainDebugLaunchConfig(program, cwd),
};
