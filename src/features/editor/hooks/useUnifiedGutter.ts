/**
 * 统一 gutter 列装配：有断点上下文（projectId + 文件路径）即启用单列，
 * 断点红点常驻；可运行标记（单测用例 + main 入口，同一 run 贡献）+ 用例状态
 * 回显仅可编辑的测试/main 语言文件叠加，非 file tab / 无上下文返回空数组（零列零开销）。
 *
 * 装配点职责（registry 架构的值层）：把各域贡献拼进注册表——
 * debug 的 breakpointContribution（经 `@/features/debug` 门面，只读消费其
 * 自备扩展；toggle/hover 行为经回调注入）+ editor 自家的 run / test-status
 * 贡献（P1：test-status 经 editor/store/testResults 回显 ✓/✗/进行中）。
 * run 贡献对测试用例与 main 入口共用同一套显示/菜单机制（见 runContribution）。
 * 合并器（gutter/registry）只见注册表接口，不见任何 StateField。
 * 回调经扩展工厂参数注入，不直连 store（断点 store 同步经 whitelist 直导）。
 */
import type { Extension } from '@codemirror/state';
import { useMemo } from 'react';

import {
  breakpointContribution,
  breakpointContributionExtensions,
  clearBreakpointHoverLine,
  setBreakpointHoverLine,
  toggleBreakpointAt,
} from '@/features/debug';
import { useDebugStore } from '@/features/debug/store/debugStore';

import type { GutterContribution } from '../gutter/contribution';
import { createUnifiedGutterExtension } from '../gutter/registry';
import {
  createRunCodelensCore,
  createRunContribution,
  type RunTarget,
} from '../gutter/runContribution';
import {
  createTestStatusContribution,
  createTestStatusCore,
} from '../gutter/testStatusContribution';
import { isRunnableFile } from '../utils/runLanguages';

interface UseUnifiedGutterExtensionParams {
  projectId: string | null;
  /** DAP 绝对路径（断点 store 同步用）。 */
  absFilePath: string | null;
  fileName: string;
  /** file tab 可编辑性门控（readOnly / binary / 超大文件 → 仅断点列，无运行标记）。 */
  enabled: boolean;
  /** TS/JS 用例点击直接运行（扩展内按 lang 分流，Rust/Go/Java 走 onMenuRequest）。 */
  onRun: (target: RunTarget) => void;
  /** Rust/Go/Java（测试与 main 皆然）点击 → 请求打开 Run/Debug 浮层（rect 锚点）。 */
  onMenuRequest: (target: RunTarget, x: number, y: number) => void;
}

/** 稳定的 Extension[]（无断点上下文返回空数组，不注册多余列）。 */
export function useUnifiedGutterExtension({
  projectId,
  absFilePath,
  fileName,
  enabled,
  onRun,
  onMenuRequest,
}: UseUnifiedGutterExtensionParams): Extension[] {
  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint);

  return useMemo(() => {
    if (!projectId || !absFilePath) return [];
    // 进列门控：可运行语言注册表（唯一事实源；markers 再按 docText 判定是否真有目标）。
    const withRuns = enabled && isRunnableFile(fileName);
    const testRun = withRuns ? createRunContribution({ onRun, onMenuRequest }) : null;
    const testStatus = withRuns
      ? createTestStatusContribution({ projectId, filePath: fileName })
      : null;
    // 注册序 = 同 priority 排序的稳定 tiebreak：断点(10) → play(20) → 状态(30)。
    const contributions: GutterContribution<unknown>[] = [breakpointContribution];
    if (testRun) contributions.push(testRun);
    if (testStatus) contributions.push(testStatus);
    // 单 bundle（嵌套数组 CM 自动展平）：装配语义"有上下文即一列"，调用方按
    // length 0/非 0 判断开关（既有 useUnifiedGutter.test.ts 契约）。
    const assembled: Extension[] = [
      ...breakpointContributionExtensions,
      ...(testRun
        ? [
            createRunCodelensCore({ fileName, onRun, onMenuRequest }),
            // P1：store 状态变更 → CM 刷新订阅 + 文件编辑失效（与检测 core 同生命周期）
            createTestStatusCore({ projectId, filePath: fileName }),
          ]
        : []),
      createUnifiedGutterExtension({
        fileName,
        editable: enabled,
        contributions,
        onColumnClick: (view, lineFrom) =>
          toggleBreakpointAt(view, lineFrom, (line) => {
            void toggleBreakpoint(projectId, absFilePath, line);
          }),
        onColumnHover: (view, lineFrom) => setBreakpointHoverLine(view, lineFrom),
        onColumnLeave: (view) => clearBreakpointHoverLine(view),
      }),
    ];
    return [assembled];
  }, [projectId, absFilePath, fileName, enabled, toggleBreakpoint, onRun, onMenuRequest]);
}
