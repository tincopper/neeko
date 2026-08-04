import React, { useEffect } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import { useNotify } from '@/shared/hooks/useNotify';
import { useProjectStore } from '@/shared/store/projectStore';

import McpAgentGroupList from './McpAgentGroupList';
import McpProjectGroupList from './McpProjectGroupList';
import McpTagGroupTree from './McpTagGroupTree';
import McpViewSwitcher from './McpViewSwitcher';

/**
 * MCP navigation panel — composes the view switcher, tag group tree,
 * agent group list, and project group list. Owns the data refresh effects.
 */
const McpNavPanel: React.FC = React.memo(() => {
  const refreshMcpTagGroups = useMcpStore((s) => s.refreshMcpTagGroups);
  const refreshAgentSkills = useSkillStore((s) => s.refreshAgentSkills);
  const refreshProjectSkillCounts = useSkillStore((s) => s.refreshProjectSkillCounts);
  const refreshProjectTagGroupCounts = useSkillStore((s) => s.refreshProjectTagGroupCounts);
  const projects = useProjectStore((s) => s.projects);
  const projectsKey = React.useMemo(
    () => projects.map((p) => `${p.id}:${p.path}`).join('\n'),
    [projects],
  );

  const { notify } = useNotify();

  useEffect(() => {
    void refreshMcpTagGroups();
  }, [refreshMcpTagGroups]);

  useEffect(() => {
    void refreshAgentSkills().catch((e) => {
      notify(`Failed to load agent data: ${String(e)}`, 'error');
    });
  }, [refreshAgentSkills, notify]);

  useEffect(() => {
    void refreshProjectSkillCounts().catch((e) => {
      notify(`Failed to load project counts: ${String(e)}`, 'error');
    });
    void refreshProjectTagGroupCounts().catch((e) => {
      notify(`Failed to load project tag group counts: ${String(e)}`, 'error');
    });
  }, [projectsKey, refreshProjectSkillCounts, refreshProjectTagGroupCounts, notify]);

  return (
    <nav className="py-2 px-1.5" aria-label="MCP views">
      <McpViewSwitcher />
      <McpTagGroupTree />
      <McpAgentGroupList />
      <McpProjectGroupList />
    </nav>
  );
});

McpNavPanel.displayName = 'McpNavPanel';

export default McpNavPanel;
