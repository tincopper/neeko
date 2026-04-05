import type { UnifiedProject, GitInfo, AgentConfig } from '../types';

export interface ProjectAdapter {
  readonly type: 'local' | 'wsl' | 'remote';
  
  getProjects(): UnifiedProject[];
  
  getActiveProject(): UnifiedProject | null;
  
  selectProject(projectId: string): void;
  
  refreshGit(projectId: string): Promise<GitInfo | null>;
  
  openIde(projectId: string, ide: string): Promise<void>;
  
  getFileDiff(projectId: string, filePath: string): Promise<unknown>;
  
  checkoutBranch(projectId: string, branchName: string): Promise<void>;
  
  createBranch(projectId: string, branchName: string): Promise<void>;
  
  createWorktree(projectId: string, worktreePath: string, branchName: string): Promise<void>;
  
  launchAgent(projectId: string, agent: AgentConfig): void;
  
  setAgent(projectId: string, agentId: string | null): Promise<void>;
  
  setIde(projectId: string, ide: string | null): Promise<void>;
  
  setCollapsed(projectId: string, collapsed: boolean): void;
}

export interface ProjectAdapterFactory {
  create(): ProjectAdapter;
}