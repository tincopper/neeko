import React from 'react';

import { cn } from '@/lib/utils';
import type { Project } from '@/shared/types';
import { getAvatarStyle } from '@/shared/utils/projectAvatar';
import type { ProjectId } from '@/shared/utils/workspaceRef';

export interface ProjectSwitcherPanelProps {
  projects: Project[];
  activeProjectId: ProjectId | null;
  onSelect: (projectId: ProjectId) => void;
}

/** 环境标注（`· WSL · distro` / `· SSH · host`；本地不标注），与侧栏 SectionHeader 同一语汇。 */
function envLabel(project: Project): string | null {
  if (project.environment.type === 'Wsl') {
    return `· WSL · ${project.environment.distro}`;
  }
  if (project.environment.type === 'Remote') {
    return `· SSH · ${project.environment.host}`;
  }
  return null;
}

/**
 * 项目切换上拉面板（状态栏左下角）。
 *
 * 视觉跟随 `BranchSwitcherPanel` 的容器语言（bg-secondary 圆角 + 阴影 + 纵向滚动），
 * 但不内置搜索：项目数量级与分支不同，侧栏列表本身也没有搜索 —— 需要时再补。
 * 定位与背板由宿主（`ProjectSwitcherItem`）负责，面板只画列表。
 */
const ProjectSwitcherPanel: React.FC<ProjectSwitcherPanelProps> = ({
  projects,
  activeProjectId,
  onSelect,
}) => (
  <div
    data-testid="project-switcher-panel"
    className="bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[360px] shadow-xl overflow-hidden flex flex-col"
  >
    <div className="max-h-[320px] overflow-y-auto py-1">
      {projects.map((project) => {
        const avatar = getAvatarStyle({ name: project.name, color: project.avatar_color });
        const env = envLabel(project);
        const active = project.id === activeProjectId;
        return (
          <button
            key={project.id}
            type="button"
            data-testid={`project-switcher-option-${project.id}`}
            aria-current={active}
            title={project.path}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors duration-75',
              active ? 'bg-bg-hover' : 'hover:bg-bg-hover',
            )}
            onClick={() => onSelect(project.id)}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: avatar.color }}
            />
            <span
              className={cn(
                'flex-1 min-w-0 truncate text-[var(--font-size)]',
                active ? 'font-medium text-text-primary' : 'text-text-secondary',
              )}
            >
              {project.name}
            </span>
            {env && <span className="shrink-0 text-[10px] text-text-muted">{env}</span>}
          </button>
        );
      })}
    </div>
  </div>
);

export default ProjectSwitcherPanel;
