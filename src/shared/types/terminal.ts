import type { ProjectId } from '@/shared/utils/workspaceRef';
export interface TerminalTab {
  id: string;
  projectId: ProjectId;
  agentId: string | null;
  title: string;
  status: 'Idle' | 'Running' | 'Failed';
  order: number;
}
