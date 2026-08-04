import { ChevronDown, ChevronRight } from 'lucide-react';
import React, { useCallback, useState } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/shared/store/projectStore';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';

/** Project group list inside the MCP navigation panel (selecting one opens the project view). */
const McpProjectGroupList: React.FC = React.memo(() => {
  const projects = useProjectStore((s) => s.projects);
  const mcpView = useMcpStore((s) => s.mcpView);
  const activeMcpProjectId = useMcpStore((s) => s.activeMcpProjectId);
  const setActiveMcpProjectId = useMcpStore((s) => s.setActiveMcpProjectId);
  const setActiveMcpTagGroup = useMcpStore((s) => s.setActiveMcpTagGroup);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const projectSkillCounts = useSkillStore((s) => s.projectSkillCounts);
  const projectSkillCountsLoading = useSkillStore((s) => s.projectSkillCountsLoading);
  const projectSkillCountsError = useSkillStore((s) => s.projectSkillCountsError);
  const projectTagGroupCounts = useSkillStore((s) => s.projectTagGroupCounts);
  const projectTagGroupCountsLoading = useSkillStore((s) => s.projectTagGroupCountsLoading);
  const projectTagGroupCountsError = useSkillStore((s) => s.projectTagGroupCountsError);

  const [expanded, setExpanded] = useState(false);

  const handleSelect = useCallback(
    (projectId: string) => {
      setActiveMcpProjectId(projectId);
      setActiveMcpTagGroup(null);
      setMcpView('project');
    },
    [setActiveMcpProjectId, setActiveMcpTagGroup, setMcpView],
  );

  return (
    <div className="border-t border-border mt-0.5 pt-1">
      <button
        type="button"
        className="flex items-center gap-1 px-3 py-1.5 w-full min-w-0 text-left select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
        )}
        <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
          Projects
        </span>
      </button>
      {expanded && (
        <div className="pb-1 px-1.5">
          {projects.length === 0 ? (
            <p className="px-2.5 py-1 text-[11px] text-text-muted leading-relaxed">
              No projects loaded.
            </p>
          ) : (
            projects.map((project) => {
              const avatarStyle = getAvatarStyle({
                name: project.name,
                color: (project as any).avatar_color,
              });
              const initials = getProjectInitials(project.name);
              const diskCount = projectSkillCounts.get(project.id);
              const groupCount = projectTagGroupCounts.get(project.id);
              const diskLabel = projectSkillCountsError
                ? '?'
                : projectSkillCountsLoading && diskCount === undefined
                  ? '...'
                  : (diskCount ?? 0);
              const groupLabel = projectTagGroupCountsError
                ? '?'
                : projectTagGroupCountsLoading && groupCount === undefined
                  ? '...'
                  : (groupCount ?? 0);
              const isActive = mcpView === 'project' && project.id === activeMcpProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => handleSelect(project.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
                    'text-[var(--font-size)]',
                    isActive
                      ? 'bg-bg-selected text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  <span
                    className="flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-bold shrink-0"
                    style={avatarStyle}
                  >
                    {initials}
                  </span>
                  <span className="truncate flex-1 font-medium">{project.name}</span>
                  <span className="text-[11px] tabular-nums text-text-muted min-w-[1.25rem] text-right">
                    {diskLabel}·{groupLabel}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

McpProjectGroupList.displayName = 'McpProjectGroupList';

export default McpProjectGroupList;
