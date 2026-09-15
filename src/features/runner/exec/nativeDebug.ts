/**
 * native Debug 通用编排（Rust / Go 的**同一套 5 步**：无头构建 → 产物解析 → DAP 启动，
 * 含各自的失败呈现）。语言差异由 [`NativeDebugHooks`] 注入，故本模块不认识任何语言。
 *
 * 方案 B 阶段 3：原 `exec/native.ts` 把 rust/go 两条分支写在同一文件里（`lang === 'go'` 判断 +
 * 各自命令构造），现按「通用编排 + 语言 hook」拆开 —— 新增一门 native 语言只需实现三个 hook，
 * 编排（提示文案、失败路径、会话启动）零改动。
 *
 * 编排层不做 IO：构建经 `languages/io` 的 [`langIo`]（唯一 IO 边界），语言 hook 也不直接触 Tauri。
 */
import { useDebugStore } from '@/features/runner/store/debugStore';

import { langIo } from '../languages/io';
import type { RunTarget } from '../runTarget';

import type { TestActionContext } from './context';
import { resolveRunCwd } from './context';
import { pushBuildLogTail, notifyDebugError } from './debugConsole';
import type { NativeDebugLaunchConfig, TestBinaryResult } from './nativeBuild';

/** Phase 1 无头构建的产物（退出码 + 双流管道输出，与后端 DTO 对齐）。 */
export interface NativeDebugBuild {
  exitCode: number;
  /** stdout：产物解析通道（如 cargo `--message-format=json` 行）。 */
  stdout: string;
  /** stderr：报错流（构建失败诊断展示用）。 */
  stderr: string;
  /**
   * 显式产物绝对路径（如 `go test -c -o` 的确定路径）；缺省 = 由语言 hook 从 stdout 解析。
   */
  programPath?: string;
}

/**
 * 一门语言的 native debug 三件事。
 *
 * `build` 抛错即视为「构建无法运行」（含命令与 cwd），编排层据此落 console + 通知；
 * `parse` 返回显式失败分类（`binary_not_found` / `binary_ambiguous`）而非静默 null。
 */
export interface NativeDebugHooks {
  /** 无头构建（命令构造 + 后端管道进程）。 */
  build(target: RunTarget, ctx: TestActionContext): Promise<NativeDebugBuild>;
  /** 从构建输出定位调试产物（`sourceHint` = 被编辑文件，用于多产物消歧）。 */
  parse(target: RunTarget, build: NativeDebugBuild, ctx: TestActionContext): TestBinaryResult;
  /** 把产物路径翻成该语言适配器的 launch 载荷。 */
  launchConfig(target: RunTarget, program: string, cwd: string): NativeDebugLaunchConfig;
}

/**
 * 执行一条构建命令并归一化结果；spawn 失败抛错（含命令与 cwd）—— 调用方按 §5 显式通知。
 */
export async function runNativeBuild(
  ctx: TestActionContext,
  command: string,
  cwd: string,
): Promise<NativeDebugBuild> {
  try {
    const result = await langIo.runBuild({ projectId: ctx.projectId, command, cwd });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Headless build failed: ${detail} (command: ${command}, cwd: ${cwd})`);
  }
}

/**
 * native Debug（测试与 main 共用）：无头构建 → 产物解析 → DAP 启动。
 * 成功由 `startWithConfig` 切 session tab；构建失败/产物缺失/歧义落 console tab
 * （附构建日志尾部）+ notification；DAP 启动失败走 launchSession 既有错误路径
 * （已落 console + 通知，此处不重复）。Task Console 永不参与，零静默 return。
 */
export async function runNativeDebug(
  hooks: NativeDebugHooks,
  target: RunTarget,
  ctx: TestActionContext,
): Promise<void> {
  const debug = useDebugStore.getState();
  debug.pushConsole(
    'sys',
    target.kind === 'test' ? 'Building test binary…' : 'Building main binary…',
  );
  let build: NativeDebugBuild;
  try {
    build = await hooks.build(target, ctx);
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
  const parsed = hooks.parse(target, build, ctx);
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
      .startWithConfig(ctx.projectId, hooks.launchConfig(target, parsed.path, cwd));
  } catch {
    // DAP 启动失败：launchSession 错误路径已处理，此处不重复通知
  }
}
