/**
 * Rust / Go 无头 Debug 构建与 DAP 启动（lldb / dlv mode:exec）。
 */
import { buildTestBinaryRemote } from '@/features/debug/api/debugBuildApi';
import { useDebugStore } from '@/features/debug/store/debugStore';
import { fileExists } from '@/features/file/api/fileApi';

import type { RunTarget } from '../gutter/runTarget';
import type { LspRunnable } from '../runnables/runnable';
import { resolveCargoManifestDirForFile } from '../utils/cargoManifest';
import { buildMainDebugBuildCommand, resolveRunContext } from '../utils/runLanguages';
import type { TestCaseInfo } from '../utils/testCases';
import {
  buildDebugBuildCommand,
  buildDebugLaunchConfig,
  buildGoDebugBuildCommand,
  buildMainDebugLaunchConfig,
  defaultRunContext,
  goDebugBinaryRelPath,
  parseCargoBinaryPath,
  parseTestBinaryPath,
  resolveBinaryPath,
  resolveTestTargetFlag,
  type NativeDebugLaunchConfig,
  type TestBinaryResult,
} from '../utils/testCommands';

import { resolveRunCwd, type TestActionContext } from './context';
import { notifyDebugError, pushBuildLogTail } from './debugConsole';

/** Phase 1 无头构建的产物（退出码 + 双流管道输出，与后端 DTO 对齐）。 */
interface TestBinaryBuild {
  exitCode: number;
  /** stdout：产物解析通道（cargo `--message-format=json` 行）。 */
  stdout: string;
  /** stderr：go/cargo 报错流（构建失败诊断展示用）。 */
  stderr: string;
  /**
   * go：`go test -c -o` 的显式产物绝对路径（确定性，无需从 stdout 解析）；
   * rust：undefined（走 parseTestBinaryPath 的 compiler-artifact 解析）。
   */
  programPath?: string;
}

/**
 * Phase 1（无头构建，C1：构建描述与 run 共用同一 `buildDebugBuildCommand`，
 * 载体走后端管道进程）：一次独立 `debug_build_test_binary` 调用，无会话、
 * 无复用、无 observer；二次点击 = 第二次独立构建。
 * spawn 失败抛错（含命令与 cwd）—— 调用方按 §5 显式通知。
 */
async function buildTestBinary(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  lsp: LspRunnable | null,
): Promise<TestBinaryBuild> {
  // crate/member 定位：从被编辑文件向上找最近 Cargo.toml。workspace 从根跑
  // `cargo test` 会编所有成员 → 多候选（artifact src_path 是各 crate root），
  // 必须 `--manifest-path` 指到具体 crate 再锁定 target 使产物唯一。
  // 基准 = 实际执行目录（激活 worktree 优先，projectPath 兜底）：探测必须与
  // cargo 实际 cwd 一致，否则 worktree 会话下探测的是主工作树清单（构建却在
  // worktree 里跑 → 无 manifest-path → exit 101）。
  const cwd = resolveRunCwd(ctx);
  if (testCase.lang === 'go') {
    // go 无 manifest 解析链：pkg = 测试文件所属包目录（cwd 相对，module 感知——
    // `goPkgDir` 向上找 go.mod，嵌套 module 取相对 module 根的包目录），产物走
    // `-o` 显式路径（`.neeko/test-bin/<name>`，gitignored；go 自建父目录），比 Rust
    // compiler-artifact 解析更简单——programPath 直接确定，无需解析 stdout。
    const outRelPath = goDebugBinaryRelPath(testCase.name);
    const { goPkg } = await resolveRunContext('go', ctx.filePath, cwd);
    const command = buildGoDebugBuildCommand(goPkg, outRelPath);
    try {
      const result = await buildTestBinaryRemote({ projectId: ctx.projectId, command, cwd });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        programPath: resolveBinaryPath(outRelPath, cwd),
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`Headless build failed: ${detail} (command: ${command}, cwd: ${cwd})`);
    }
  }
  const member = await resolveCargoManifestDirForFile(cwd, ctx.filePath);
  const relPath = member ? ctx.filePath.replace(`${member}/`, '') : ctx.filePath;
  const targetFlag = resolveTestTargetFlag(relPath, await hasLibTarget(cwd, member));
  // 有 LSP runnable（tier ①）时命令完全由 LS 的 target 选择决定，targetFlag 仅作兜底。
  const command = buildDebugBuildCommand(testCase, member, targetFlag, lsp);
  try {
    const result = await buildTestBinaryRemote({ projectId: ctx.projectId, command, cwd });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Headless build failed: ${detail} (command: ${command}, cwd: ${cwd})`);
  }
}

/** 项目是否有 lib target（`src/lib.rs` 存在，标准布局）；探测失败按无 lib 兜底。 */
async function hasLibTarget(projectRoot: string, memberDir: string | null): Promise<boolean> {
  const base = memberDir ? `${projectRoot}/${memberDir}` : projectRoot;
  if (!base) return false;
  try {
    return await fileExists(`${base}/src/lib.rs`);
  } catch {
    return false;
  }
}

/**
 * Go/Rust Debug（测试与 main 共用）：无头构建 → 产物解析 → DAP 启动。
 * 成功由 `startWithConfig` 切 session tab；构建失败/产物缺失/歧义落 console
 * tab（附构建日志尾部）+ notification；DAP 启动失败走 launchSession 既有错误
 * 路径（已落 console + 通知，此处不重复）。Task Console 永不参与，零静默 return。
 */
export async function launchNativeDebug(target: RunTarget, ctx: TestActionContext): Promise<void> {
  const debug = useDebugStore.getState();
  debug.pushConsole(
    'sys',
    target.kind === 'test' ? 'Building test binary…' : 'Building main binary…',
  );
  let build: TestBinaryBuild;
  try {
    build = await buildNativeDebugBinary(target, ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    debug.pushConsole('err', message);
    notifyDebugError(message);
    return;
  }
  if (build.exitCode !== 0) {
    pushBuildLogTail(build.stdout, build.stderr);
    notifyDebugError(
      target.kind === 'test'
        ? 'Build failed; debug not started (see the build log in the DebugPanel console)'
        : 'Main build failed; debug not started (see the build log in the DebugPanel console)',
    );
    return;
  }
  // go：`-o` 显式产物路径；rust：compiler-artifact 解析（测试/main 各用其解析器）。
  const parsed = parseNativeBinary(target, build, ctx.filePath);
  if (!parsed.ok) {
    pushBuildLogTail(build.stdout, build.stderr);
    notifyDebugError(
      parsed.error === 'binary_ambiguous'
        ? target.kind === 'test'
          ? 'Multiple test binaries found; cannot pick a debug target, debug not started'
          : 'Multiple main binaries found; cannot pick a debug target, debug not started'
        : target.kind === 'test'
          ? 'No unique test binary: the build produced no test artifact, debug not started'
          : 'Main binary not found: the build produced no executable, debug not started',
    );
    return;
  }
  const cwd = resolveRunCwd(ctx);
  try {
    await useDebugStore
      .getState()
      .startWithConfig(
        ctx.projectId,
        nativeLaunchConfig(target, resolveBinaryPath(parsed.path, cwd), cwd),
      );
  } catch {
    // DAP 启动失败：launchSession 错误路径已处理，此处不重复通知
  }
}

/** Go/Rust Debug 无头构建（测试与 main 共用）：命令构造 + 后端管道进程。 */
async function buildNativeDebugBinary(
  target: RunTarget,
  ctx: TestActionContext,
): Promise<TestBinaryBuild> {
  if (target.kind === 'test') return buildTestBinary(target.testCase, ctx, target.lsp ?? null);
  const cwd = resolveRunCwd(ctx);
  if (target.entry.language === 'go') {
    const outRel = goDebugBinaryRelPath('main');
    const runCtx = await resolveRunContext('go', ctx.filePath, cwd);
    const command = buildMainDebugBuildCommand('go', runCtx);
    const result = await buildTestBinaryRemote({ projectId: ctx.projectId, command, cwd });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      programPath: resolveBinaryPath(outRel, cwd),
    };
  }
  const member = await resolveCargoManifestDirForFile(cwd, ctx.filePath);
  // Rust 分支无 IO 事实（cargo 自解析清单）→ 默认上下文即可；LSP runnable 可给出 target。
  const command = buildMainDebugBuildCommand('rust', defaultRunContext(), {
    manifestDir: member,
    lsp: target.lsp ?? null,
  });
  const result = await buildTestBinaryRemote({ projectId: ctx.projectId, command, cwd });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

/** 产物解析（go 走 `-o` 显式路径；rust 测试/main 各用其 artifact 解析器）。 */
function parseNativeBinary(
  target: RunTarget,
  build: TestBinaryBuild,
  filePath: string,
): TestBinaryResult {
  if (build.programPath) return { ok: true as const, path: build.programPath };
  return target.kind === 'test'
    ? parseTestBinaryPath(build.stdout, filePath)
    : parseCargoBinaryPath(build.stdout, filePath);
}

/** Debug launch 配置（测试/main 共用 shape，仅参数源不同；Java 走 attach 路径不到此）。 */
function nativeLaunchConfig(
  target: RunTarget,
  program: string,
  workspaceRoot: string,
): NativeDebugLaunchConfig {
  if (target.kind === 'test') {
    return buildDebugLaunchConfig(target.testCase, program, workspaceRoot);
  }
  if (target.entry.language === 'java') {
    // debugTarget 已把 Java 路由到 debugJava（attach），此分支不可达。
    throw new Error('Java debug uses attach path');
  }
  return buildMainDebugLaunchConfig(target.entry.language, program, workspaceRoot);
}
