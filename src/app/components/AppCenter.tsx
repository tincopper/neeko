import React, { lazy, Suspense, useEffect, useState } from 'react';

import ProjectWorkspace from '@/app/components/ProjectWorkspace';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { SettingsView } from '@/features/settings';
import { ISLAND_SPLIT_GROUP_CLASS } from '@/layout/islands';
import { cn } from '@/lib/utils';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { ISLAND_CLASS, Island } from '@/ui/Island';

/** Lazy LibraryPanelWrapper — same chunk-splitting as the dock registry. */
const LazyLibraryPanel = lazy(() => import('@/app/dock/wrappers/LibraryPanelWrapper'));

/** 中心内容统一的外层容器类。 */
const CENTER_WRAPPER_CLASS = 'flex-1 flex flex-col overflow-hidden';

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
 * 中心视图路由（单一数据源：appViewStore）。
 * - settings：条件渲染（切走即卸载）
 * - normal：ProjectWorkspace（常驻）
 * - library：首次进入后常驻（hidden 切换），消除重复挂载 + 数据回填的闪烁；
 *   再次激活时后台刷新（旧列表保持可见，新数据到达后更新）
 * - Skills/Prompts/MCP 统一收敛到 Library（activeKind 切换）
 */
function AppCenter() {
  const appView = useAppViewStore((s) => s.appView);
  const libraryActive = appView === 'library';
  const [libraryMounted, setLibraryMounted] = useState(
    () => useAppViewStore.getState().appView === 'library',
  );
  if (libraryActive && !libraryMounted) {
    // 首进后常驻（hidden 切换）：render 阶段派生，避免 effect 内同步 setState
    setLibraryMounted(true);
  }

  useEffect(() => {
    if (libraryActive) {
      void useLibraryStore.getState().refreshPrompts();
    }
  }, [libraryActive]);

  let content: React.ReactNode;
  if (appView === 'settings') {
    content = <SettingsView />;
  } else {
    content = (
      <>
        <Island className={cn('flex-1 h-full', libraryActive && 'hidden')}>
          <ProjectWorkspace />
        </Island>
        {libraryMounted ? (
          // Library 自带双岛 + 海面：裸挂（仅 hidden 切换的透明包装），禁止再套岛屿
          <div
            className={cn(
              'flex-1 flex flex-col min-h-0 overflow-hidden',
              !libraryActive && 'hidden',
            )}
          >
            <Suspense fallback={<LibrarySkeleton />}>
              <LazyLibraryPanel />
            </Suspense>
          </div>
        ) : null}
      </>
    );
  }

  return <div className={CENTER_WRAPPER_CLASS}>{content}</div>;
}

export default React.memo(AppCenter);
