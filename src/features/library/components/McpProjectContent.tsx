import React, { useMemo } from 'react';

import { useMcpStore } from '@/features/library/store/mcpStore';
import { useProjectStore } from '@/shared/store/projectStore';

import McpListSection from './McpListSection';

interface McpProjectContentProps {
  projectId: string;
}

const McpProjectContent: React.FC<McpProjectContentProps> = React.memo(({ projectId }) => {
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const mcpServers = useMcpStore((s) => s.mcpServers);
  const projects = useProjectStore((s) => s.projects);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const projectName = project?.name ?? projectId;

  const filteredServers = useMemo(
    () => mcpServers.filter((s) => s.scope === 'project' && s.projectId === projectId),
    [mcpServers, projectId],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-start gap-2.5 min-h-11 px-4 py-2 border-b border-border shrink-0">
        <svg
          className="h-4 w-4 text-text-secondary shrink-0 mt-1"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
        <h2 className="text-sm font-semibold text-text-primary truncate shrink-0 max-w-[10rem] mt-0.5">
          {projectName}
        </h2>
        <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border shrink-0 mt-0.5">
          {filteredServers.length}
        </span>
        <button
          type="button"
          onClick={() => setMcpView('installed')}
          className="ml-auto text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          ← Back to all
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <McpListSection onEdit={undefined} />
      </div>
    </div>
  );
});

McpProjectContent.displayName = 'McpProjectContent';

export default McpProjectContent;
