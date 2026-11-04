import { memo } from 'react';

import { QuickOpenPalette } from '@/features/quick-open';
import { StatusBar } from '@/features/status-bar';
import { ReferencesPeekDialog, SymbolNavPalette } from '@/features/symbol-nav';
import { DockLayout, TitleBar } from '@/layout';
import type { DockBarEntry, MoveViewHandler } from '@/layout';

import AppModals from '../AppModals';
import AppCenter from '../components/AppCenter';
import ToolbarFooter from '../components/ToolbarFooter';
import type { ToolbarFooterProps } from '../components/ToolbarFooter';
import { useDockTabHostContent } from '../hooks/useDockTabHostContent';
import { useDockTabHostReveal } from '../hooks/useDockTabHostReveal';
import PanelHost from '../panels/PanelHost';
import TitleBarActions from '../panels/TitleBarActions';

interface AppShellProps {
  /** 左 DockBar 底部按钮簇回调（Add Project / Settings，useToolbarFooterProps 装配）。 */
  toolbarProps: ToolbarFooterProps;
  appModalsProps: React.ComponentProps<typeof AppModals>;
  leftBarItems?: DockBarEntry[];
  rightBarItems?: DockBarEntry[];
  /** 图标跨栏 / 排序入口（拖拽与键盘等价共用，app 层注入） */
  onMoveView?: MoveViewHandler;
}

/**
 * 窗口骨架单一来源（AppShell）：TitleBar + 主工作区（DockLayout）+ StatusBar + 浮层。
 *
 * 组合根（App.tsx）只装配 Provider + 渲染 <AppShell/>，不持有 store 订阅；
 * 本组件只做结构组合与 props 穿线（视图状态由叶子组件自订阅，如 ToolbarFooter /
 * AppCenter），对面板清单零感知（固定面板经 PanelHost 消费 registry，dock 面板经
 * DockLayout + DockRegistryProvider 注入的 registry）。岛屿视觉（海 + 浮岛）由
 * 各区域样式提供，本层只定义骨架分区。
 *
 * **内容事实的注入端口**：zone 可见性从内容派生（空宿主不占位），而「宿主里有多少内容」
 * 属于 tab 域 —— 由本层算好交给布局层（`tabHostTabCounts`，计数而非布尔：布局层内部做
 * `> 0`，本层不做映射），与 `onMoveView` 同一规矩：`layout/` 不得 import tab 域。同一个
 * 计数也驱动「内容到达即前置」的揭示（`useDockTabHostReveal`，P6 —— 到达 = 条数增加）——
 * 写在骨架层而不是宿主组件里，因为收起的槽不会挂载宿主。
 */
function AppShell({
  toolbarProps,
  appModalsProps,
  leftBarItems,
  rightBarItems,
  onMoveView,
}: AppShellProps) {
  const tabHostCounts = useDockTabHostContent();
  // 揭示与可见性共用同一个内容事实（同一个计数驱动两件事 ⇒ 不会漂移）
  useDockTabHostReveal(tabHostCounts);

  return (
    <div
      className="w-screen h-screen flex flex-col"
      style={{
        background: `linear-gradient(to bottom, var(--bg-gradient-start), var(--bg-gradient-end))`,
      }}
    >
      {/* ── 窗口框架 · 顶 ───────────────────────────── */}
      <TitleBar actions={<TitleBarActions />} />

      {/* ── 工作区（海）：三栏可调区 + 底部固定面板宿主 ── */}
      <div className="flex-1 flex flex-col min-h-0 bg-bg-primary">
        <DockLayout
          toolbarFooterLeft={<ToolbarFooter {...toolbarProps} />}
          leftBarItems={leftBarItems}
          rightBarItems={rightBarItems}
          onMoveView={onMoveView}
          tabHostTabCounts={tabHostCounts}
        >
          <AppCenter />
        </DockLayout>
        <PanelHost placement="bottom" />
      </div>

      {/* ── 浮层（依赖 Provider context，非骨架分区） ───── */}
      <AppModals {...appModalsProps} />
      <QuickOpenPalette />
      <SymbolNavPalette />
      <ReferencesPeekDialog />

      {/* ── 窗口框架 · 底（必须在 AppProvider 内：NotificationDetail
          经 useCopyToClipboard 调用 useAppContext()，Provider 外会抛错） ── */}
      <StatusBar />
    </div>
  );
}

export default memo(AppShell);
