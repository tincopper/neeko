import React, { useCallback } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import CountLabel from '@/shared/components/nav/CountLabel';
import NavEmpty from '@/shared/components/nav/NavEmpty';
import NavRow from '@/shared/components/nav/NavRow';
import NavSection from '@/shared/components/nav/NavSection';
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

  const handleSelect = useCallback(
    (projectId: string) => {
      setActiveMcpProjectId(projectId);
      setActiveMcpTagGroup(null);
      setMcpView('project');
    },
    [setActiveMcpProjectId, setActiveMcpTagGroup, setMcpView],
  );

  return (
    <NavSection title="Projects">
      {projects.length === 0 ? (
        <NavEmpty>No projects loaded.</NavEmpty>
      ) : (
        projects.map((project) => {
          const avatarStyle = getAvatarStyle({
            name: project.name,
            color: project.avatar_color,
          });
          const initials = getProjectInitials(project.name);
          return (
            <NavRow
              key={project.id}
              active={mcpView === 'project' && project.id === activeMcpProjectId}
              onSelect={() => handleSelect(project.id)}
              testId={`mcp-project-row-${project.id}`}
              leading={
                <span
                  className="flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-bold shrink-0"
                  style={avatarStyle}
                >
                  {initials}
                </span>
              }
            >
              <span className="truncate flex-1 font-medium">{project.name}</span>
              <span className="inline-flex items-baseline gap-1 text-[11px] tabular-nums shrink-0">
                <CountLabel
                  loading={projectSkillCountsLoading}
                  error={projectSkillCountsError}
                  count={projectSkillCounts.get(project.id)}
                  testId={`mcp-project-disk-count-${project.id}`}
                />
                <span className="opacity-40" aria-hidden>
                  ·
                </span>
                <CountLabel
                  loading={projectTagGroupCountsLoading}
                  error={projectTagGroupCountsError}
                  count={projectTagGroupCounts.get(project.id)}
                  testId={`mcp-project-group-count-${project.id}`}
                />
              </span>
            </NavRow>
          );
        })
      )}
    </NavSection>
  );
});

McpProjectGroupList.displayName = 'McpProjectGroupList';

export default McpProjectGroupList;
