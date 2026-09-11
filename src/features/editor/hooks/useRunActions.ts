/**
 * 测试 Run/Debug 动作的**装配层**：菜单浮层状态 + 稳定回调，绑定到 runner 动作入口。
 *
 * 分层（自下而上）：
 * - `utils/runLanguages`：语言**声明**（文件分类 / 用例解析 / 命令形态 / 能力 / 结果通道），纯函数。
 * - `runner/*`：语言**前置与执行**（探测、预检、通知、无头构建、DAP 启动），带副作用。
 * - 本文件：React 装配 —— gutter 图标点击 → 菜单（Rust/Go/Java）/ 直跑（TS），
 *   `handleRun`/`handleDebug` 转发给 `runner/launch` 的 `runTarget`/`debugTarget`。
 *
 * 跨 feature 边界：task 经 `@/shared/store/taskStore`；debug 经其 `store/` 直导白名单
 * + `api/` 门面（`debugBuildApi`）；报告读取经 `@/features/file/api/fileApi`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ContextMenuItem } from '@/shared/components/ContextMenu';
import { Bug, Play } from '@/shared/components/icons';
import { useOverlayStore } from '@/shared/store/overlayStore';

import { type RunTarget } from '../gutter/runTarget';
import { debugTarget, runTarget } from '../runner/launch';
import { subtestsForCase } from '../store/testResults';

/** 原型风格菜单文案：Run 项 `Test '<name>'`（JetBrains gutter 浮层首行）。 */
export function testRunLabel(name: string): string {
  return `Test '${name}'`;
}

/** 原型风格菜单文案：Debug 项 `Debug 'Test <name>'`（浮层次行）。 */
export function testDebugLabel(name: string): string {
  return `Debug 'Test ${name}'`;
}

/** 基准菜单文案：Run 项 `Benchmark '<name>'`（Go `-bench`，与单测 `Test '<name>'` 同构）。 */
export function benchmarkRunLabel(name: string): string {
  return `Benchmark '${name}'`;
}

/** 基准菜单文案：Debug 项 `Debug 'Benchmark <name>'`（浮层次行）。 */
export function benchmarkDebugLabel(name: string): string {
  return `Debug 'Benchmark ${name}'`;
}

/** main 菜单文案：Run 项 `Run 'main'`（对齐单测 `Test '<name>'` 惯例；main 函数名恒为 main）。 */
export function mainRunLabel(): string {
  return "Run 'main'";
}

/** main 菜单文案：Debug 项 `Debug 'main'`（浮层次行）。 */
export function mainDebugLabel(): string {
  return "Debug 'main'";
}

export type { TestActionContext } from '../runner/context';

/**
 * 动态发现的子测试 **减去**已有静态按钮的那些（设计 §7.8.4：同一目标不给两个入口）。
 *
 * 两条路线互补：静态（AST）只能覆盖字符串字面量表格，动态（test2json）补 `Sprintf` /
 * 变量 / 净化后重名的组。故只按**全名精确**剔除重叠项 —— 深层名（`T/a/b`）若自身没有
 * 静态按钮则保留，即便其祖先 `T/a` 有。
 */
function withoutStaticSubtests(dynamic: string[], staticSubtests?: string[]): string[] {
  if (!staticSubtests || staticSubtests.length === 0) return dynamic;
  const covered = new Set(staticSubtests);
  return dynamic.filter((name) => !covered.has(name));
}

/** 测试运行下拉菜单浮层 id（z-order 专项，惯例同 usePaneContextMenu）；main 复用同一浮层。 */
const TEST_MENU_OVERLAY_ID = 'editor-run-menu';
/** gutter 图标点击后的下拉菜单状态（Rust/Go/Java 用例与 main 共用；x/y 为图标 rect 旁锚点）。 */
export interface RunMenuState {
  target: RunTarget;
  x: number;
  y: number;
}

interface UseRunActionsParams {
  projectId: string;
  filePath: string;
  projectPath: string | null;
}

/** 稳定回调（gutter marker 的 eq 依赖回调引用），供 runCodelens 扩展注入。 */
export function useRunActions({ projectId, filePath, projectPath }: UseRunActionsParams) {
  const handleRun = useCallback(
    (target: RunTarget) => runTarget(target, { projectId, filePath, projectPath }),
    [projectId, filePath, projectPath],
  );
  const handleDebug = useCallback(
    (target: RunTarget) => debugTarget(target, { projectId, filePath, projectPath }),
    [projectId, filePath, projectPath],
  );

  // 菜单（Rust/Go/Java 用例与 main 共用同一浮层；TS 直跑不进菜单）：按 kind 分流文案与动作
  // —— test 用例 `Test '<name>'` / `Debug 'Test <name>'`（沿用原型），main 入口 Run / Debug。
  // shared ContextMenu 点击 item 后自动 onClose（closeMenu 释放 overlay）。
  const [menu, setMenu] = useState<RunMenuState | null>(null);
  const openMenu = useCallback((target: RunTarget, x: number, y: number) => {
    // 浮层上报：菜单打开期间占用 overlay 计数（z-order 专项，惯例同 usePaneContextMenu）
    useOverlayStore.getState().setOverlayOpen(TEST_MENU_OVERLAY_ID, true);
    setMenu({ target, x, y });
  }, []);

  const closeMenu = useCallback(() => {
    useOverlayStore.getState().setOverlayOpen(TEST_MENU_OVERLAY_ID, false);
    setMenu(null);
  }, []);

  // 兜底：菜单打开状态下卸载（切项目/关 tab）时清除 overlay id，
  // 避免 overlayStore.count 永久 >0 导致 Browser webview 一直隐藏。
  useEffect(() => () => useOverlayStore.getState().setOverlayOpen(TEST_MENU_OVERLAY_ID, false), []);

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const { target } = menu;
    if (target.kind === 'main') {
      return [
        { label: mainRunLabel(), icon: Play, action: () => handleRun(target) },
        { label: mainDebugLabel(), icon: Bug, action: () => handleDebug(target) },
      ];
    }
    const { testCase } = target;
    // 基准与用例命令形态不同（`-bench` + `-run '^$'`）→ 文案区分，避免 `Test 'BenchmarkAdd'` 的误导。
    const isBenchmark = testCase.kind === 'benchmark';
    const items: ContextMenuItem[] = [
      {
        label: isBenchmark ? benchmarkRunLabel(testCase.name) : testRunLabel(testCase.name),
        icon: Play,
        action: () => handleRun(target),
      },
      {
        label: isBenchmark ? benchmarkDebugLabel(testCase.name) : testDebugLabel(testCase.name),
        icon: Bug,
        action: () => handleDebug(target),
      },
    ];
    // Go 动态子测试（P3）：上次运行由 test2json 真实发现的 `<父>/<层级>` 全名，每个给
    // Run + Debug 两条（与父用例同构：Run 在前、Debug 在后）。名字来自运行时而非静态猜测
    // → 无 `t.Run` 形态约束、零 LSP 依赖；未发现 / 全部已有静态按钮则整段省略（不出现空分隔条）。
    // 已有**静态**按钮的子测试在此剔除（§7.8.4 去重：同一目标不给两个入口）。
    // Debug 走同一 `goTestRunPattern` 模式（dlv `-test.run` 层级锚定，真机实证只跑该子测试），
    // 产物名经 `goDebugBinaryRelPath` 消毒（子测试名含 `/` 等非法字符）。
    if (!isBenchmark && testCase.lang === 'go') {
      const subtests = withoutStaticSubtests(
        subtestsForCase(projectId, filePath, testCase.name),
        target.staticSubtests,
      );
      if (subtests.length > 0) {
        items.push({ separator: true });
        for (const name of subtests) {
          const subTarget: RunTarget = {
            kind: 'test',
            testCase: { name, line: testCase.line, lang: 'go' },
          };
          items.push({ label: testRunLabel(name), icon: Play, action: () => handleRun(subTarget) });
          items.push({
            label: testDebugLabel(name),
            icon: Bug,
            action: () => handleDebug(subTarget),
          });
        }
      }
    }
    return items;
  }, [menu, handleRun, handleDebug, projectId, filePath]);
  return {
    handleRun,
    handleDebug,
    menu,
    menuItems,
    openMenu,
    closeMenu,
  };
}
