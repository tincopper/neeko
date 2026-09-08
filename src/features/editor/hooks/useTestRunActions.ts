/**
 * 测试 Run/Debug 动作与下拉菜单状态（editor → task/debug 跨 feature 接线）。
 *
 * - Run：构造命令 → `useTaskStore.runTask`（Task Console 会话，cwd 取 worktree 根或项目根）。
 *   P1 结构化结果流：beginRun 标记用例进行中 → onOutput 累积（Rust libtest JSON 行）/
 *   onExit 后经 file api 读取 vitest JSON 报告（TS）→ parse → matchCaseName 对齐源码用例名
 *   → testResults store 落库（gutter test-status 贡献消费）。Run 路径零改动。
 * - Debug（仅 Rust，§4/§5 描述统一载体分离）：点击瞬间 `debugStore.openPanel`
 *   （pending 态"正在构建测试二进制…"，静态路由）→ 无头构建
 *  （`debugBuildApi.buildTestBinaryRemote` → 后端管道进程，无会话/无复用/
 *   无 observer；二次点击 = 第二次独立构建）→ `parseTestBinaryPath` 解析产物
 *   → 成功 `useDebugStore.startWithConfig` 启动 lldb 会话（切 session tab）；
 *   构建失败/产物缺失/歧义/spawn 失败落 DebugPanel console tab（附构建日志尾部
 *   ≤50 行）+ notification；DAP 启动失败走 launchSession 既有错误路径（不重复通知）。
 *   Task Console 永不参与 debug。Debug 不做用例状态流（DAP 会话，超出 P1 范围）。
 * - Menu（gutter 图标点击 → 原型风格浮层）：openMenu 记录用例与图标 rect 锚点并上报 overlay 浮层，
 *   FileEditor 条件渲染 shared ContextMenu（深色双行、hover 高亮、Esc/外点关闭由组件内建；
 *   Rust 两项 Run/Debug，文案携带测试名；TS 直跑不进菜单 —— 分流在 testCodelens 扩展内按 lang 判定）。
 *
 * 跨 feature 边界：task 经 `@/shared/store/taskStore`（与编辑器其他 hooks 一致）；
 * debug 经其 `store/` 直导白名单（与 useEditorBreakpoints 既有先例一致）+ `api/` 门面
 * （`debugBuildApi`，前端不直导 tauri api）；
 * 报告读取经 `@/features/file/api/fileApi`（cargoManifest 既有先例）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildTestBinaryRemote } from '@/features/debug/api/debugBuildApi';
import { useDebugStore } from '@/features/debug/store/debugStore';
import { readFileContent, fileExists } from '@/features/file/api/fileApi';
import type { ContextMenuItem } from '@/shared/components/ContextMenu';
import { Bug, Play } from '@/shared/components/icons';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import { useTaskStore } from '@/shared/store/taskStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';

import { useTestResultsStore, type AlignedCaseResult } from '../store/testResults';
import { resolveCargoManifestDir, resolveCargoManifestDirForFile } from '../utils/cargoManifest';
import type { TestCaseInfo } from '../utils/testCases';
import {
  buildDebugBuildCommand,
  buildDebugLaunchConfig,
  buildRunCommand,
  buildTestConfigId,
  parseTestBinaryPath,
  resolveBinaryPath,
  resolveTestTargetFlag,
  VITEST_REPORT_REL_PATH,
} from '../utils/testCommands';
import {
  matchCaseName,
  parseLibtestJsonLines,
  parseVitestJsonReport,
} from '../utils/testResultParsers';

/** 原型风格菜单文案：Run 项 `Test '<name>'`（JetBrains gutter 浮层首行）。 */
export function testRunLabel(name: string): string {
  return `Test '${name}'`;
}

/** 原型风格菜单文案：Debug 项 `Debug 'Test <name>'`（浮层次行）。 */
export function testDebugLabel(name: string): string {
  return `Debug 'Test ${name}'`;
}

export interface TestActionContext {
  projectId: string;
  /** Editor tab file path（项目/worktree 根的相对路径）。 */
  filePath: string;
  /** 项目根绝对路径（worktree 未激活时的 cwd 兜底）。 */
  projectPath: string | null;
}

/** 测试运行下拉菜单浮层 id（z-order 专项，惯例同 usePaneContextMenu）。 */
const TEST_MENU_OVERLAY_ID = 'editor-test-run-menu';
/** gutter 图标点击后的下拉菜单状态（仅 Rust 用例进入菜单路径；x/y 为图标 rect 旁锚点）。 */
export interface TestMenuState {
  testCase: TestCaseInfo;
  x: number;
  y: number;
}

/** 运行输出累计上限（libtest JSON 行与 vitest 报告体量有限，防极端无界拼接）。 */
const MAX_CAPTURED_OUTPUT_CHARS = 2_000_000;

/** 运行当前生效的工作目录：激活 worktree 优先，否则项目根。 */
function resolveRunCwd(ctx: TestActionContext): string {
  return useWorktreeStore.getState().activeWorktreePath ?? ctx.projectPath ?? '';
}

/**
 * 解析 + 对齐 → store 落库（Run 链路终点）。
 * 空结果（编译失败 / 报告缺失）= 本次运行无状态可落，仅结束 running（不猜状态）。
 */
async function finalizeRunResults(
  output: string,
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
): Promise<void> {
  const results =
    testCase.lang === 'rust'
      ? alignLibtestResults(output, testCase)
      : await readVitestResults(testCase, ctx, runRoot);
  useTestResultsStore.getState().applyResults(ctx.projectId, ctx.filePath, results);
}

/** libtest JSON 行 → 对齐到源码用例名的结果（matchCaseName 拒绝无边界/参数化名）。 */
function alignLibtestResults(output: string, testCase: TestCaseInfo): AlignedCaseResult[] {
  const results: AlignedCaseResult[] = [];
  for (const event of parseLibtestJsonLines(output)) {
    if (!matchCaseName(event.name, testCase.name)) continue;
    results.push({
      caseName: testCase.name,
      status: event.status,
      ...(event.duration !== undefined ? { duration: event.duration } : {}),
      ...(event.stdout !== undefined ? { message: event.stdout } : {}),
    });
  }
  return results;
}

/**
 * vitest JSON 报告读取 + 对齐。报告位于 run 根下 `node_modules/.neeko/vitest-report.json`
 * （与命令侧 `--outputFile.json` 同根：命令用绝对路径、读取用「run 根 + 相对路径」，
 * 本地 join 与 WSL/SSH shell 拼接两通道均成立）。读取失败静默跳过（空结果语义）。
 */
async function readVitestResults(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  runRoot: string,
): Promise<AlignedCaseResult[]> {
  try {
    const report = await readFileContent(ctx.projectId, VITEST_REPORT_REL_PATH, runRoot || null);
    return parseVitestJsonReport(report.content)
      .filter((r) => matchCaseName(r.fullName, testCase.name))
      .map((r) => ({
        caseName: testCase.name,
        status: r.status,
        ...(r.duration !== undefined ? { duration: r.duration } : {}),
        ...(r.message !== undefined ? { message: r.message } : {}),
      }));
  } catch {
    return []; // 报告缺失 / IPC 失败：不阻塞，仅清 running 态（Task Console 有原始输出）
  }
}

/**
 * Phase 2（run 分叉）：直跑用例命令，输出进 Task Console；结果流回填 gutter 状态。
 * Run 路径行为不变（Task Console + ✓/✗ 状态流，不新增通知）。
 */
function launchRun(
  testCase: TestCaseInfo,
  ctx: TestActionContext,
  manifestDir: string | null,
  runRoot: string,
): void {
  let output = '';
  const runId = useTaskStore
    .getState()
    .runTask(
      buildRunCommand(testCase, ctx.filePath, manifestDir, runRoot),
      buildTestConfigId('run', testCase, ctx.filePath),
      {
        cwd: runRoot,
        onOutput: (chunk) => {
          if (output.length < MAX_CAPTURED_OUTPUT_CHARS) output += chunk;
        },
        onExit: () => {
          void finalizeRunResults(output, testCase, ctx, runRoot);
        },
      },
    );
  if (!runId) {
    // 会话未能创建（如无活动项目）：结束 running 占位，避免图标永久卡在进行中
    useTestResultsStore.getState().invalidateFile(ctx.projectId, ctx.filePath);
    console.error('[TestRun] failed to start test task');
  }
}

/** Run：构造命令并经任务会话启动（Phase 1 上下文准备 → Phase 2 run 分叉）。 */
export function runTestCase(testCase: TestCaseInfo, ctx: TestActionContext): void {
  void (async () => {
    const manifestDir =
      testCase.lang === 'rust' ? await resolveCargoManifestDir(ctx.projectPath ?? '') : null;
    const runRoot = resolveRunCwd(ctx);
    // Run 开始：清该文件旧状态并标记进行中（gutter 半透明占位）
    useTestResultsStore.getState().beginRun(ctx.projectId, ctx.filePath);
    launchRun(testCase, ctx, manifestDir, runRoot);
  })();
}
/** Phase 1 无头构建的产物（退出码 + 管道 stdout，与后端 DTO 对齐）。 */
interface TestBinaryBuild {
  exitCode: number;
  output: string;
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
): Promise<TestBinaryBuild> {
  // crate/member 定位：从被编辑文件向上找最近 Cargo.toml。workspace 从根跑
  // `cargo test` 会编所有成员 → 多候选（artifact src_path 是各 crate root），
  // 必须 `--manifest-path` 指到具体 crate 再锁定 target 使产物唯一。
  // 基准 = 实际执行目录（激活 worktree 优先，projectPath 兜底）：探测必须与
  // cargo 实际 cwd 一致，否则 worktree 会话下探测的是主工作树清单（构建却在
  // worktree 里跑 → 无 manifest-path → exit 101）。
  const cwd = resolveRunCwd(ctx);
  const member = await resolveCargoManifestDirForFile(cwd, ctx.filePath);
  const relPath = member ? ctx.filePath.replace(`${member}/`, '') : ctx.filePath;
  const targetFlag = resolveTestTargetFlag(relPath, await hasLibTarget(cwd, member));
  const command = buildDebugBuildCommand(testCase, member, targetFlag);
  try {
    const result = await buildTestBinaryRemote({ projectId: ctx.projectId, command, cwd });
    return { exitCode: result.exitCode, output: result.output };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`无头构建执行失败：${detail}（命令：${command}，目录：${cwd}）`);
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

/** 构建日志尾部行数（§5：失败时附进 DebugPanel console，≤50 行）。 */
const MAX_BUILD_LOG_TAIL_LINES = 50;

/** 构建日志尾部 → DebugPanel console（失败证据，失败分类 C2 的统一落点）。 */
function pushBuildLogTail(output: string): void {
  const push = useDebugStore.getState().pushConsole;
  for (const line of output.split('\n').slice(-MAX_BUILD_LOG_TAIL_LINES)) {
    if (line.trim()) push('err', line);
  }
}

function notifyDebugError(message: string): void {
  useNotificationStore.getState().addNotification({ type: 'error', title: 'Debug', message });
}

/**
 * Phase 2（debug 分叉）：产物解析 → lldb 启动（C2 构建失败短路，C3 面板静态归属）。
 * 成功由 `startWithConfig` 切 session tab；构建失败/产物缺失/歧义落 console
 * tab（附构建日志尾部）+ notification；DAP 启动失败走 launchSession 既有错误
 * 路径（已落 console + 通知，此处不重复）。Task Console 永不参与，零静默 return。
 */
async function launchDebug(
  build: TestBinaryBuild,
  testCase: TestCaseInfo,
  ctx: TestActionContext,
): Promise<void> {
  if (build.exitCode !== 0) {
    pushBuildLogTail(build.output);
    notifyDebugError('构建失败，未启动调试（构建日志见 DebugPanel console）');
    return;
  }
  const parsed = parseTestBinaryPath(build.output, ctx.filePath);
  if (!parsed.ok) {
    pushBuildLogTail(build.output);
    notifyDebugError(
      parsed.error === 'binary_ambiguous'
        ? '找到多个测试二进制，无法确定调试目标，未启动调试'
        : '找不到唯一测试二进制：构建输出中没有测试产物，未启动调试',
    );
    return;
  }
  const cwd = resolveRunCwd(ctx);
  try {
    await useDebugStore
      .getState()
      .startWithConfig(
        ctx.projectId,
        buildDebugLaunchConfig(testCase, resolveBinaryPath(parsed.path, cwd), cwd),
      );
  } catch {
    // DAP 启动失败：launchSession 错误路径已处理，此处不重复通知
  }
}

/** Debug（仅 Rust）：pending 开面板 → 无头构建 → 解析 → 启动/失败分类。 */
export function debugRustTestCase(testCase: TestCaseInfo, ctx: TestActionContext): void {
  if (testCase.lang !== 'rust') return; // UI 已隐藏 Debug 按钮，防御兜底（非失败路径）
  const debug = useDebugStore.getState();
  debug.openPanel('console');
  debug.pushConsole('sys', '正在构建测试二进制…');
  void (async () => {
    let build: TestBinaryBuild;
    try {
      build = await buildTestBinary(testCase, ctx);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      debug.pushConsole('err', message);
      notifyDebugError(message);
      return;
    }
    await launchDebug(build, testCase, ctx);
  })();
}
interface UseTestRunActionsParams {
  projectId: string;
  filePath: string;
  projectPath: string | null;
}

/** 稳定回调（gutter marker 的 eq 依赖回调引用），供 testCodelens 扩展注入。 */
export function useTestRunActions({ projectId, filePath, projectPath }: UseTestRunActionsParams) {
  const [menu, setMenu] = useState<TestMenuState | null>(null);

  const handleRunTest = useCallback(
    (testCase: TestCaseInfo) => runTestCase(testCase, { projectId, filePath, projectPath }),
    [projectId, filePath, projectPath],
  );
  const handleDebugTest = useCallback(
    (testCase: TestCaseInfo) => debugRustTestCase(testCase, { projectId, filePath, projectPath }),
    [projectId, filePath, projectPath],
  );

  const openMenu = useCallback((testCase: TestCaseInfo, x: number, y: number) => {
    // 浮层上报：菜单打开期间占用 overlay 计数（z-order 专项，惯例同 usePaneContextMenu）
    useOverlayStore.getState().setOverlayOpen(TEST_MENU_OVERLAY_ID, true);
    setMenu({ testCase, x, y });
  }, []);

  const closeMenu = useCallback(() => {
    useOverlayStore.getState().setOverlayOpen(TEST_MENU_OVERLAY_ID, false);
    setMenu(null);
  }, []);

  // 兜底：菜单打开状态下卸载（切项目/关 tab）时清除 overlay id，
  // 避免 overlayStore.count 永久 >0 导致 Browser webview 一直隐藏。
  useEffect(() => () => useOverlayStore.getState().setOverlayOpen(TEST_MENU_OVERLAY_ID, false), []);

  // 菜单仅在 Rust 用例打开（TS 直跑不进菜单），故固定 Run/Debug 两项，文案携带测试名
  // （原型：`Test '<name>'` / `Debug 'Test <name>'`，不硬编码 package 名——文件名后缀
  // 经 Task Console 命令可见，无需塞进标签）；
  // shared ContextMenu 点击 item 后自动 onClose（closeMenu 释放 overlay）。
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const { testCase } = menu;
    return [
      { label: testRunLabel(testCase.name), icon: Play, action: () => handleRunTest(testCase) },
      {
        label: testDebugLabel(testCase.name),
        icon: Bug,
        action: () => handleDebugTest(testCase),
      },
    ];
  }, [menu, handleRunTest, handleDebugTest]);
  return { handleRunTest, handleDebugTest, menu, menuItems, openMenu, closeMenu };
}
