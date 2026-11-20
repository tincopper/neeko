import React, { lazy, Suspense, useState } from 'react';

import ProjectView from '@/app/components/ProjectView';
import { SettingsView } from '@/features/settings';
import { cn } from '@/lib/utils';
import { VisibilityScope } from '@/shared/contexts';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { Island } from '@/ui/Island';

/** Lazy LibraryPanelWrapper — same chunk-splitting as the dock registry. */
const LazyLibraryPanel = lazy(() => import('@/app/dock/wrappers/LibraryPanelWrapper'));

/** Lazy TasksPanelWrapper —— 同一分块策略：不打开工作项就不加载那个域的代码。 */
const LazyTasksPanel = lazy(() => import('@/app/dock/wrappers/TasksPanelWrapper'));

/** 中心内容统一的外层容器类。自带底色：任何空帧都不露出 WebView 暗底。 */
const CENTER_WRAPPER_CLASS = 'flex-1 flex flex-col overflow-hidden bg-bg-primary';

/**
 * 中心视图路由（单一数据源：appViewStore）。
 * - settings：条件渲染（切走即卸载）
 * - normal：ProjectView（常驻）
 * - library：**启动即常驻**（hidden 切换）。首进不再经过 React.lazy 挂载间隙，
 *   而此时 enterCenterView 正在折叠左栏触发 ResizablePanel 重排 —— 二者叠加会留下
 *   一帧没有任何内容绘制的中心区（闪黑）
 * - tasks：**首进后常驻**（hidden 切换）。与 library 的差别只在启动那一步：看板没有
 *   「启动即拉起」的理由（工作项列表按需读），所以它的 lazy chunk 等用户点第一次才解析
 * - Skills/Prompts/MCP 统一收敛到 Library（activeKind 切换）
 *
 * 常驻的代价是「挂载 ≠ 可见」：子树的 mount 拉取必须按可见性门控，否则从不打开
 * Library 的用户也在启动期付 IPC。故 Library 子树包在 `VisibilityScope` 里，
 * 「再次激活时后台刷新」由子树自己按 `useVisible()` 完成（单一机制，不再有第二处）。
 */
function AppCenter() {
  const appView = useAppViewStore((s) => s.appView);
  const libraryActive = appView === 'library';
  const tasksActive = appView === 'tasks';
  // 首进后常驻：render 期派生（不在 effect 里同步 setState —— 那会白跑一帧）。
  const [tasksMounted, setTasksMounted] = useState(tasksActive);
  if (tasksActive && !tasksMounted) setTasksMounted(true);

  let content: React.ReactNode;
  if (appView === 'settings') {
    content = <SettingsView />;
  } else {
    content = (
      <>
        <Island className={cn('flex-1 h-full', (libraryActive || tasksActive) && 'hidden')}>
          <ProjectView />
        </Island>
        {/* Library 自带双岛 + 海面：裸挂（仅 hidden 切换的透明包装），禁止再套岛屿。
            启动即在隐藏态挂载 ⇒ chunk 提前解析完，点击只改 display，不产生首帧空绘制。 */}
        <VisibilityScope visible={libraryActive}>
          <div
            className={cn(
              'flex-1 flex flex-col min-h-0 overflow-hidden',
              !libraryActive && 'hidden',
            )}
          >
            <Suspense fallback={null}>
              <LazyLibraryPanel />
            </Suspense>
          </div>
        </VisibilityScope>
        {/* Tasks 与 Library 同构：裸挂 + `hidden` 切换，禁止再套岛屿（几何只有一个所有者）。 */}
        {tasksMounted ? (
          <VisibilityScope visible={tasksActive}>
            <div
              className={cn(
                'flex-1 flex flex-col min-h-0 overflow-hidden',
                !tasksActive && 'hidden',
              )}
            >
              <Suspense fallback={null}>
                <LazyTasksPanel />
              </Suspense>
            </div>
          </VisibilityScope>
        ) : null}
      </>
    );
  }

  return <div className={CENTER_WRAPPER_CLASS}>{content}</div>;
}

export default React.memo(AppCenter);
