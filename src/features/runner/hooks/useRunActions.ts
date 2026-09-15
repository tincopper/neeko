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

import { debugTarget, runTarget } from '../exec/launch';
import { runnerFor } from '../languages';
import { targetLang } from '../runTarget';
import { type RunTarget } from '../runTarget';
import { subtestsForCase } from '../store/testResults';

export type { TestActionContext } from '../exec/context';

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

  // 菜单由**语言模块**声明（`ui.labels` 文案 + `ui.extraMenuItems` 附加项）——
  // 通用 hook 不再判断语言，也不再知道 benchmark / Go 子测试这类语言语义。
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const { target } = menu;
    const ui = runnerFor(targetLang(target)).ui;
    const labels = ui.labels(target);
    const items: ContextMenuItem[] = [
      { label: labels.run, icon: Play, action: () => handleRun(target) },
      { label: labels.debug, icon: Bug, action: () => handleDebug(target) },
    ];
    // 语言附加项（Go 的运行时子测试）：同名目标不给两个入口的「去重」也在语言模块内完成。
    const extra =
      ui.extraMenuItems?.(target, {
        subtestsFor: (name) => subtestsForCase(projectId, filePath, name),
      }) ?? [];
    if (extra.length > 0) {
      items.push({ separator: true });
      for (const entry of extra) {
        items.push({
          label: entry.label,
          icon: entry.action === 'run' ? Play : Bug,
          action: () => (entry.action === 'run' ? handleRun : handleDebug)(entry.target),
        });
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
