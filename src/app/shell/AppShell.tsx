import { memo } from 'react';

import { QuickOpenPalette } from '@/features/quick-open';
import { StatusBar } from '@/features/status-bar';
import { SymbolNavPalette } from '@/features/symbol-nav';
import { DockLayout, TitleBar } from '@/layout';

import AppModals from '../AppModals';
import AppCenter from '../components/AppCenter';
import ToolbarFooter from '../components/ToolbarFooter';
import type { ToolbarFooterProps } from '../components/ToolbarFooter';
import PanelHost from '../panels/PanelHost';
import TitleBarActions from '../panels/TitleBarActions';

interface AppShellProps {
  /** 左 DockBar 底部按钮簇回调（Add Project / Settings，useToolbarFooterProps 装配）。 */
  toolbarProps: ToolbarFooterProps;
  appModalsProps: React.ComponentProps<typeof AppModals>;
  leftButtons?: React.ReactNode[];
  rightButtons?: React.ReactNode[];
}

/**
 * 窗口骨架单一来源（AppShell）：TitleBar + 主工作区（DockLayout）+ StatusBar + 浮层。
 *
 * 组合根（App.tsx）只装配 Provider + 渲染 <AppShell/>，不持有 store 订阅；
 * 本组件只做结构组合与 props 穿线（视图状态由叶子组件自订阅，如 ToolbarFooter /
 * AppCenter），对面板清单零感知（固定面板经 PanelHost 消费 registry，dock 面板经
 * DockLayout + DockRegistryProvider 注入的 registry）。岛屿视觉（海 + 浮岛）由
 * 各区域样式提供，本层只定义骨架分区。
 */
function AppShell({ toolbarProps, appModalsProps, leftButtons, rightButtons }: AppShellProps) {
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
          leftButtons={leftButtons}
          rightButtons={rightButtons}
        >
          <AppCenter />
        </DockLayout>
        <PanelHost placement="bottom" />
      </div>

      {/* ── 浮层（依赖 Provider context，非骨架分区） ───── */}
      <AppModals {...appModalsProps} />
      <QuickOpenPalette />
      <SymbolNavPalette />

      {/* ── 窗口框架 · 底（必须在 AppProvider 内：NotificationDetail
          经 useCopyToClipboard 调用 useAppContext()，Provider 外会抛错） ── */}
      <StatusBar />
    </div>
  );
}

export default memo(AppShell);
