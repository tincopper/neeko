import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useProjectActionsContext } from '@/features/project';
import { useProjectStore } from '@/shared/store/projectStore';
import { getAvatarStyle } from '@/shared/utils/projectAvatar';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import ProjectSwitcherPanel from '../ProjectSwitcherPanel';

/**
 * 左簇常驻项：项目切换器（分支名左侧，registry order 5 < 10）。
 *
 * 点击弹出**上拉**面板列出全部项目，点选即切换 —— 切换序列（清各项目激活单元 /
 * 设 activeProject / 按环境类型刷新）的唯一实现在 `useCrossTypeSelection.handleSelectProject`，
 * 经 `ProjectActionsContext.onSelectProject` 借道，这里不写第二份（那是「点了没反应」
 * 类 bug 的成因：漏掉 setViewTerminal / markWorkspaceOpened 一步就是白切）。
 *
 * 定位与背板照搬 `BranchStatusBarWidget` 的上拉模式（fixed + portal + 全屏背板；
 * z-[999]/z-[1000] 与它同层，两面板不会同时打开但即使同开也同一层级不打架）。
 * 位置直接写到 portal 节点的 style（不进 React state）：DOM 几何同步进 state 会触发
 * react-hooks/set-state-in-effect，且 layoutEffect 在首帧绘制前就位，无位置跳变。
 */
export function ProjectSwitcherItem() {
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const { onSelectProject } = useProjectActionsContext();

  const [panelOpen, setPanelOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc 关闭：面板本体无输入焦点宿主（没有搜索框），监听挂 document、关闭即摘除。
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  // 上拉定位：面板底边贴按钮顶边下 4px（与分支面板同一公式）。
  // resize 期间按钮会随状态栏 / 侧栏宽度漂移，打开状态下的面板必须跟着重测 ——
  // 只测一次的话，拖窗口后面板会留在旧坐标上（fixed 定位不随布局流动）。
  useLayoutEffect(() => {
    if (!panelOpen) return;
    const measure = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!rect || !panel) return;
      panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      panel.style.left = `${rect.left}px`;
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [panelOpen]);

  const handleSelect = useCallback(
    (projectId: ProjectId) => {
      setPanelOpen(false);
      onSelectProject(projectId);
    },
    [onSelectProject],
  );

  // 无项目 / 无激活项目时不渲染（与 BranchItem 同一门）
  if (projects.length === 0 || !activeProject) return null;

  const avatar = getAvatarStyle({ name: activeProject.name, color: activeProject.avatar_color });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="project-switcher-button"
        className="flex items-center gap-1.5 hover:text-text-primary cursor-pointer transition-colors shrink-0"
        title={`Switch project (current: ${activeProject.name})`}
        onClick={() => setPanelOpen((v) => !v)}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: avatar.color }} />
        <span className="truncate max-w-[120px] text-[12px]">{activeProject.name}</span>
      </button>

      {panelOpen &&
        createPortal(
          <>
            <button
              className="fixed inset-0 z-[999] w-full h-full cursor-default"
              onClick={() => setPanelOpen(false)}
              aria-label="Close panel"
              type="button"
            />
            <div ref={panelRef} className="fixed z-[1000]">
              <ProjectSwitcherPanel
                projects={projects}
                activeProjectId={activeProject.id}
                onSelect={handleSelect}
              />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
