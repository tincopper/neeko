import React, { useMemo } from 'react';

import { useActiveProject } from '@/features/project';
import { SearchPanel } from '@/features/search';
import { useProjectStore } from '@/shared/store/projectStore';

/**
 * Search dock 面板适配层：读取 active project 并传入其 id；
 * worktree 激活时仍以整个项目根为搜索目标（不依赖 worktreePath）。
 */
const SearchPanelWrapper: React.FC = React.memo(() => {
  const { project } = useActiveProject();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const projectId = useMemo(() => {
    if (!project) return null;
    // Local projects use the store's active id (worktree-aware tab keys);
    // WSL/Remote projects always use the unified project id.
    if (project.type === 'Local') {
      return activeProjectId ?? project.id;
    }
    return project.id;
  }, [project, activeProjectId]);

  return <SearchPanel projectId={projectId} />;
});
SearchPanelWrapper.displayName = 'SearchPanelWrapper';

export default SearchPanelWrapper;
export { SearchPanelWrapper };
