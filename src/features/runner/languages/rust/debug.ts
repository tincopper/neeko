/**
 * Rust 调试启动配置（lldb-dap / codelldb 形态；命令与产物解析在 `./commands.ts`）。
 *
 * 从 `utils/testCommands.ts` 的 `buildDebugLaunchConfig` / `buildMainDebugLaunchConfig` 按语言拆出
 * （方案 B 阶段 2）：Rust 侧走 lldb 的 `program + args` 形态（测试：libtest 子串过滤；main：无参）。
 */
import { resolveRunCwd } from '../../exec/context';
import type { NativeDebugLaunchConfig } from '../../exec/nativeBuild';
import { runNativeBuild, type NativeDebugHooks } from '../../exec/nativeDebug';
import type { RunTarget } from '../../runTarget';
import type { TestCaseInfo } from '../../syntax/contract';
import { langIo } from '../io';

import {
  buildDebugBuildCommand,
  buildRustMainDebugBuildCommand,
  parseCargoBinaryPath,
  parseTestBinaryPath,
  resolveTestTargetFlag,
} from './commands';
import { resolveCargoManifestDirForFile } from './manifest';
import type { RustOverlay } from './runnables';

/** 合成 main Debug launch 配置：program = 构建产物，args = []（无测试过滤）。 */
export function rustMainDebugLaunchConfig(
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  return {
    name: 'Debug main',
    type: 'lldb',
    request: 'launch',
    program,
    cwd: workspaceRoot,
    args: [],
    stopOnEntry: false,
  };
}

/** 合成用例 Debug launch 配置：program = 测试二进制，args = [name]（libtest 子串过滤）。 */
export function rustTestDebugLaunchConfig(
  testCase: TestCaseInfo,
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  return {
    name: `Debug test: ${testCase.name}`,
    type: 'lldb',
    request: 'launch',
    program,
    cwd: workspaceRoot,
    args: [testCase.name],
    stopOnEntry: false,
  };
}

/**
 * Rust 的 native debug 三件事（**编排在 `exec/nativeDebug.ts`**，此处只给语言差异）。
 *
 * 构建：测试用 `cargo test --no-run --message-format=json`（compiler-artifact 定位产物），
 * main 用 `cargo build --message-format=json`；清单目录从被编辑文件向上探测（多 crate 工作区
 * 必须 `--manifest-path` 指到具体 crate，否则产物多候选无法消歧）。
 */
export const RUST_DEBUG_HOOKS: NativeDebugHooks = {
  async build(target, ctx) {
    const cwd = resolveRunCwd(ctx);
    const manifestDir = await resolveCargoManifestDirForFile(cwd, ctx.filePath, langIo.fileExists);
    if (target.kind === 'test') {
      // lib+bin 共享 src/ 时 artifact 的 src_path 是 crate root、与源文件行永不匹配，故构建期锁定 target。
      const relPath = manifestDir ? ctx.filePath.replace(`${manifestDir}/`, '') : ctx.filePath;
      const targetFlag = resolveTestTargetFlag(relPath, await hasLibTarget(cwd, manifestDir));
      const command = buildDebugBuildCommand(
        target.testCase,
        manifestDir,
        targetFlag,
        rustOverlayOf(target),
      );
      return runNativeBuild(ctx, command, cwd);
    }
    const command = buildRustMainDebugBuildCommand({
      manifestDir,
      lsp: rustOverlayOf(target),
    });
    return runNativeBuild(ctx, command, cwd);
  },

  // 测试/main 各用其 artifact 解析器；sourceHint = 被编辑文件（多产物消歧）。
  parse: (target, build, ctx) =>
    target.kind === 'test'
      ? parseTestBinaryPath(build.stdout, ctx.filePath)
      : parseCargoBinaryPath(build.stdout, ctx.filePath),

  launchConfig: (target, program, cwd) =>
    target.kind === 'test'
      ? rustTestDebugLaunchConfig(target.testCase, program, cwd)
      : rustMainDebugLaunchConfig(program, cwd),
};

/** 项目是否有 lib target（`src/lib.rs` 存在，标准布局）；探测失败按无 lib 兜底。 */
async function hasLibTarget(projectRoot: string, memberDir: string | null): Promise<boolean> {
  const base = memberDir ? `${projectRoot}/${memberDir}` : projectRoot;
  if (!base) return false;
  return langIo.fileExists(`${base}/src/lib.rs`);
}

/** overlay 载荷收窄到本语言类型（通用层只透传不透明值，解释权在本模块）。 */
function rustOverlayOf(target: RunTarget): RustOverlay | null {
  return (target.overlay as RustOverlay) ?? null;
}
