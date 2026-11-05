import React, { lazy, Suspense, useEffect, useState } from 'react';

import { CenterViewFrame } from '@/app/components/CenterViewFrame';
import ProjectView from '@/app/components/ProjectView';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { SettingsView } from '@/features/settings';
import { ISLAND_SPLIT_GROUP_CLASS } from '@/layout/islands';
import { cn } from '@/lib/utils';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { ISLAND_CLASS, Island } from '@/ui/Island';

/** Lazy LibraryPanelWrapper — same chunk-splitting as the dock registry. */
const LazyLibraryPanel = lazy(() => import('@/app/dock/wrappers/LibraryPanelWrapper'));

/** Lazy TasksPanelWrapper —— 与 registry 同一个 lazy chunk（开启看板才加载工作项域代码）。 */
const LazyTasksPanel = lazy(() => import('@/app/dock/wrappers/TasksPanelWrapper'));

/** 首载骨架：与 Library 双岛同构，避免 Suspense 文本闪烁（空闲预载后几乎不可见）。 */
function LibrarySkeleton() {
  return (
    <div className={`flex-1 min-h-0 flex ${ISLAND_SPLIT_GROUP_CLASS}`} aria-hidden>
      <div className={`${ISLAND_CLASS} w-60 shrink-0 animate-pulse`} />
      <div className={`${ISLAND_CLASS} flex-1 animate-pulse`} />
    </div>
  );
}

/**
 * Tasks 首载骨架：**一座岛**（与它就绪后的形状同构 —— 头部与内容在同一座岛里）。
 *
 * 与 Library 骨架同一个理由：裸填充块与真面板不同高，就绪那一帧会看到一次尺寸跳变。
 */
function TasksSkeleton() {
  return <div className={`${ISLAND_CLASS} flex-1 animate-pulse`} aria-hidden />;
}

/**
 * 中心视图路由（单一数据源：appViewStore）。
 * - settings：条件渲染（切走即卸载）
 * - normal：ProjectView（常驻）
 * - library / tasks：首次进入后常驻（hidden 切换），消除重复挂载 + 数据回填的闪烁；
 *   再次激活时后台刷新（旧列表保持可见，新数据到达后更新）
 * - Skills/Prompts/MCP 统一收敛到 Library（activeKind 切换）
 *
 * # 几何**只由 `CenterViewFrame` 决定**（2026-11-03 统一）
 *
 * 四个中心视图（ProjectView / Settings / Library / Tasks）都用同一个 `<CenterViewFrame>`：
 * 海面、尺寸链、裁切由框架给，视图**只填岛**。
 *
 * 曾经每个视图自己写外壳，几何三种写法（Tasks 多缩 6px + 双层圆角），于是「高度和宽度
 * 对其他中心区域对不齐」。那条路的根因是**外圈内缩有两个所有者** —— 而它在布局框架里
 * 本该唯一（`DockLayout` 的 `center-area`）。
 *
 * 所以这里四个分支的形状**必须一样**：`<CenterViewFrame hidden={…}>` + 岛。任何视图
 * 自带 padding / 圆角 / 背景，都会立刻让它与其余三个不齐。
 */
function AppCenter() {
  const appView = useAppViewStore((s) => s.appView);
  const libraryActive = appView === 'library';
  const tasksActive = appView === 'tasks';
  /** 中心区被某个 tab 视图占着：ProjectView 必须让位（仍挂载，仅 hidden）。 */
  const centerViewActive = libraryActive || tasksActive;
  const [libraryMounted, setLibraryMounted] = useState(
    () => useAppViewStore.getState().appView === 'library',
  );
  const [tasksMounted, setTasksMounted] = useState(
    () => useAppViewStore.getState().appView === 'tasks',
  );
  if (libraryActive && !libraryMounted) {
    // 首进后常驻（hidden 切换）：render 阶段派生，避免 effect 内同步 setState
    setLibraryMounted(true);
  }
  if (tasksActive && !tasksMounted) {
    setTasksMounted(true);
  }

  useEffect(() => {
    if (libraryActive) {
      void useLibraryStore.getState().refreshPrompts();
    }
  }, [libraryActive]);

  /**
   * **恰好一个** `CenterViewFrame`：它是中心区的唯一外壳，视图是它的子节点。
   *
   * 不是「每个视图各套一个框架」—— 那会得到 N 个几何所有者，而这个组件存在的全部意义
   * 就是让几何只有一个所有者。视图只决定「我这一格里放什么岛」。
   */
  if (appView === 'settings') {
    return (
      <CenterViewFrame data-testid="center-view-frame">
        <SettingsView />
      </CenterViewFrame>
    );
  }

  return (
    <CenterViewFrame data-testid="center-view-frame">
      {/* 三个常驻视图：`hidden` **类**切换（不卸载），几何全部由框架给。
          用类而不是原生 `hidden` 属性：后者被 `.flex`（author 样式）覆盖，根本不生效。 */}
      <div className={cn('flex min-h-0 flex-1 flex-col', centerViewActive && 'hidden')}>
        <Island className="flex-1">
          <ProjectView />
        </Island>
      </div>
      {libraryMounted ? (
        <div
          className={cn('flex min-h-0 flex-1 flex-col', !libraryActive && 'hidden')}
          data-view="library"
        >
          <Suspense fallback={<LibrarySkeleton />}>
            <LazyLibraryPanel />
          </Suspense>
        </div>
      ) : null}
      {tasksMounted ? (
        <div
          className={cn('flex min-h-0 flex-1 flex-col', !tasksActive && 'hidden')}
          data-view="tasks"
        >
          <Suspense fallback={<TasksSkeleton />}>
            <LazyTasksPanel />
          </Suspense>
        </div>
      ) : null}
    </CenterViewFrame>
  );
}

export default React.memo(AppCenter);
