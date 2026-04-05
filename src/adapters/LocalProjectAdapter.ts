import { invoke } from '@tauri-apps/api/core';
import type { ProjectAdapter } from './ProjectAdapter';
import type { UnifiedProject, GitInfo, AgentConfig, Project } from '../types';
import { launchAgentInTerminal } from '../components/terminal';

function projectToUnified(p: Project): UnifiedProject {
  return {
    type: 'local',
    id: p.id,
    name: p.name,
    path: p.path,
    gitInfo: p.git_info,
    selectedAgent: p.selected_agent,
    selectedIde: p.selected_ide,
    activeView: p.active_view,
    collapsed: p.collapsed,
  };
}

export class LocalProjectAdapter implements ProjectAdapter {
  readonly type = 'local' as const;
  
  private projects: Project[] = [];
  private activeProjectId: string | null = null;
  private onProjectsChange: (projects: Project[]) => void = () => {};
  private onActiveChange: (project: Project | null) => void = () => {};
  private agentCommandOverrides: Record<string, string> = {};
  
  constructor(
    projects: Project[],
    activeProjectId: string | null,
    onProjectsChange: (projects: Project[]) => void,
    onActiveChange: (project: Project | null) => void,
    agentCommandOverrides: Record<string, string> = {}
  ) {
    this.projects = projects;
    this.activeProjectId = activeProjectId;
    this.onProjectsChange = onProjectsChange;
    this.onActiveChange = onActiveChange;
    this.agentCommandOverrides = agentCommandOverrides;
  }
  
  updateState(projects: Project[], activeProjectId: string | null) {
    this.projects = projects;
    this.activeProjectId = activeProjectId;
  }
  
  updateConfig(overrides: Record<string, string>) {
    this.agentCommandOverrides = overrides;
  }
  
  getProjects(): UnifiedProject[] {
    return this.projects.map(projectToUnified);
  }
  
  getActiveProject(): UnifiedProject | null {
    const active = this.projects.find(p => p.id === this.activeProjectId);
    return active ? projectToUnified(active) : null;
  }
  
  selectProject(projectId: string): void {
    this.activeProjectId = projectId;
    const project = this.projects.find(p => p.id === projectId) ?? null;
    this.onActiveChange(project);
    invoke('set_active_project', { projectId }).catch(() => {});
  }
  
  async refreshGit(projectId: string): Promise<GitInfo | null> {
    try {
      const gitInfo = await invoke<GitInfo>('refresh_git_info', { projectId });
      this.onProjectsChange(this.projects.map(p => 
        p.id === projectId ? { ...p, git_info: gitInfo } : p
      ));
      return gitInfo;
    } catch {
      return null;
    }
  }
  
  async openIde(projectId: string, ide: string): Promise<void> {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;
    await invoke('open_ide', { ide, projectPath: project.path });
  }
  
  async getFileDiff(projectId: string, filePath: string): Promise<unknown> {
    return invoke('get_file_diff_command', { projectId, filePath });
  }
  
  async checkoutBranch(projectId: string, branchName: string): Promise<void> {
    await invoke('checkout_branch', { projectId, branchName });
  }
  
  async createBranch(projectId: string, branchName: string): Promise<void> {
    await invoke('create_branch', { projectId, branchName });
  }
  
  async createWorktree(projectId: string, worktreePath: string, branchName: string): Promise<void> {
    await invoke('create_worktree', { projectId, worktreePath, branchName, newBranch: false });
  }
  
  launchAgent(projectId: string, agent: AgentConfig): void {
    const cmd = this.agentCommandOverrides[agent.id] ?? agent.command;
    launchAgentInTerminal(projectId, cmd, agent.args);
  }
  
  async setAgent(projectId: string, agentId: string | null): Promise<void> {
    this.onProjectsChange(this.projects.map(p =>
      p.id === projectId ? { ...p, selected_agent: agentId } : p
    ));
  }
  
  async setIde(projectId: string, ide: string | null): Promise<void> {
    this.onProjectsChange(this.projects.map(p =>
      p.id === projectId ? { ...p, selected_ide: ide } : p
    ));
  }
  
  setCollapsed(projectId: string, collapsed: boolean): void {
    this.onProjectsChange(this.projects.map(p =>
      p.id === projectId ? { ...p, collapsed } : p
    ));
    invoke('set_project_collapsed', { projectId, collapsed }).catch(() => {});
  }
}