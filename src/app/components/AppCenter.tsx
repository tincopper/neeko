import React, { lazy, Suspense } from 'react';

import ProjectWorkspace from '@/app/components/ProjectWorkspace';
import { SettingsView } from '@/features/settings';
import { SkillContent } from '@/features/skill';
import { cn } from '@/lib/utils';
import { useAppViewStore } from '@/shared/store/appViewStore';

/** Lazy LibraryPanelWrapper — same chunk-splitting as the dock registry. */
const LazyLibraryPanel = lazy(() => import('@/app/dock/wrappers/LibraryPanelWrapper'));

/** 中心内容统一的外层容器类。 */
const CENTER_WRAPPER_CLASS = 'flex-1 flex flex-col overflow-hidden';

/** 中心子视图（工作区 / SkillContent）面板容器类。 */
const CENTER_PANEL_CLASS =
  'flex flex-col flex-1 h-full min-h-0 overflow-hidden rounded-lg shadow-sm bg-bg-secondary';

/**
 * 中心视图路由（单一数据源：appViewStore）。
 * - settings / library：条件渲染（切走即卸载）
 * - skills：SkillContent 激活才挂载（消灭启动即取数）；ProjectWorkspace 保持挂载
 *   （hidden 切换，避免技能/工作区来回切换时工作区重挂载）
 * - normal：ProjectWorkspace（唯一常驻工作区视图）
 */
function AppCenter() {
  const appView = useAppViewStore((s) => s.appView);
  const skillsActive = appView === 'skills';

  let content: React.ReactNode;
  if (appView === 'settings') {
    content = <SettingsView />;
  } else if (appView === 'library') {
    content = (
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
            Loading Library…
          </div>
        }
      >
        <LazyLibraryPanel />
      </Suspense>
    );
  } else {
    // normal / skills：ProjectWorkspace 常驻（hidden 切换）；SkillContent 仅 skills 时挂载。
    // 两个面板容器同构，保证切换时 ProjectWorkspace 处于稳定 DOM 位置（不重挂载）。
    content = (
      <>
        <div className={cn(CENTER_PANEL_CLASS, skillsActive && 'hidden')}>
          <ProjectWorkspace />
        </div>
        {skillsActive ? (
          <div className={CENTER_PANEL_CLASS}>
            <SkillContent />
          </div>
        ) : null}
      </>
    );
  }

  return <div className={CENTER_WRAPPER_CLASS}>{content}</div>;
}

export default React.memo(AppCenter);
