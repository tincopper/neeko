import { SplashScreen } from '@/app/components/SplashScreen';
import { useAppShell, useDockBarButtons, useDockBarMove, useDockBarOpenTab } from '@/app/hooks';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';

import AppProviders from './AppProviders';
import { installDebugBridge } from './debugBridge';
import AppShell from './shell/AppShell';

// DEV-only：纯浏览器调试/自动化注入 store 数据的入口（生产 tree-shake）
installDebugBridge({
  projectStore: useProjectStore,
  editorStore: useEditorStore,
  workspaceStore: useWorkspaceStore,
});

/**
 * 组合根：Provider 装配 + <AppShell/>（AGENTS.md「组合层」）。
 * 应用级副作用（paste 监听、quick-open 跟踪）在 useAppShell 内；
 * 全部 Provider（业务 Context + 终端插入 + dock registry）收口在 AppProviders；
 * 窗口骨架（TitleBar/工作区/StatusBar）与面板组织收敛在 src/app/shell/ +
 * src/app/panels/（registry 单一事实源）。本文件只做装配，不做任何布局/面板编排，
 * 也不持有 store 订阅（中心路由等派生状态由 AppShell 内部读取）。
 */
function App() {
  const { initializing, appProvidersProps, toolbarProps, appModalsProps } = useAppShell();

  // 图标落位的唯一写入口：拖拽（DockLayout 的 DndContext）与键盘（DockBarButton）共用
  const onMoveView = useDockBarMove();
  // 种类级入口（openTab）的落地端口：依赖从组合根传入（此时仍在 Provider 之外）
  const onOpenTab = useDockBarOpenTab({
    agents: appProvidersProps.appValue.agents,
    onAgentClick: appProvidersProps.editorValue.onAgentClick,
  });
  const leftBarItems = useDockBarButtons('left', { onMove: onMoveView, onOpenTab });
  const rightBarItems = useDockBarButtons('right', { onMove: onMoveView, onOpenTab });

  if (initializing) {
    return <SplashScreen />;
  }

  return (
    <AppProviders {...appProvidersProps}>
      <AppShell
        toolbarProps={toolbarProps}
        appModalsProps={appModalsProps}
        leftBarItems={leftBarItems}
        rightBarItems={rightBarItems}
        onMoveView={onMoveView}
      />
    </AppProviders>
  );
}

export default App;
