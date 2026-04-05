import { invoke } from '@tauri-apps/api/core';
import type { ProjectAdapter } from './ProjectAdapter';
import type { UnifiedProject, GitInfo, AgentConfig, WSLEntrySession, WSLProject } from '../types';
import { launchAgentInWslTerminal, wslCacheKey } from '../components/terminal';

function wslProjectToUnified(p: WSLProject): UnifiedProject {
  return {
    type: 'wsl',
    id: p.id,
    name: p.name,
    path: p.path,
    gitInfo: p.git_info,
    selectedAgent: p.selected_agent,
    selectedIde: p.selected_ide,
    activeView: 'Terminal',
    collapsed: false,
  };
}

export class WslProjectAdapter implements ProjectAdapter {
  readonly type = 'wsl' as const;
  
  private wslEntries: WSLEntrySession[] = [];
  private activeWslKey: { distro: string; projectId: string } | null = null;
  private onEntriesChange: (entries: WSLEntrySession[]) => void = () => {};
  private onActiveChange: (entry: WSLEntrySession | null, project: WSLProject | null) => void = () => {};
  private agentCommandOverrides: Record<string, string> = {};
  
  constructor(
    wslEntries: WSLEntrySession[],
    activeWslKey: { distro: string; projectId: string } | null,
    onEntriesChange: (entries: WSLEntrySession[]) => void,
    onActiveChange: (entry: WSLEntrySession | null, project: WSLProject | null) => void,
    agentCommandOverrides: Record<string, string> = {}
  ) {
    this.wslEntries = wslEntries;
    this.activeWslKey = activeWslKey;
    this.onEntriesChange = onEntriesChange;
    this.onActiveChange = onActiveChange;
    this.agentCommandOverrides = agentCommandOverrides;
  }
  
  updateState(wslEntries: WSLEntrySession[], activeWslKey: { distro: string; projectId: string } | null) {
    this.wslEntries = wslEntries;
    this.activeWslKey = activeWslKey;
  }
  
  updateConfig(overrides: Record<string, string>) {
    this.agentCommandOverrides = overrides;
  }
  
  getProjects(): UnifiedProject[] {
    return this.wslEntries.flatMap(entry =>
      entry.projects.map(p => ({ ...wslProjectToUnified(p), _distro: entry.distro } as UnifiedProject & { _distro: string }))
    );
  }
  
  getActiveProject(): UnifiedProject | null {
    if (!this.activeWslKey) return null;
    const entry = this.wslEntries.find(e => e.distro === this.activeWslKey!.distro);
    const project = entry?.projects.find(p => p.id === this.activeWslKey!.projectId);
    if (!entry || !project) return null;
    return { ...wslProjectToUnified(project), _distro: entry.distro } as UnifiedProject & { _distro: string };
  }
  
  selectProject(projectId: string): void {
    const entry = this.wslEntries.find(e => 
      e.projects.some(p => p.id === projectId)
    );
    if (!entry) return;
    const project = entry.projects.find(p => p.id === projectId)!;
    this.activeWslKey = { distro: entry.distro, projectId };
    this.onActiveChange(entry, project);
    invoke<GitInfo>('refresh_wsl_git_info', { distro: entry.distro, projectPath: project.path })
      .then(gitInfo => {
        this.onEntriesChange(this.wslEntries.map(e => ({
          ...e,
          projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } : p)
        })));
      })
      .catch(() => {});
  }
  
  async refreshGit(projectId: string): Promise<GitInfo | null> {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return null;
    const project = entry.projects.find(p => p.id === projectId);
    if (!project) return null;
    try {
      const gitInfo = await invoke<GitInfo>('refresh_wsl_git_info', { distro: entry.distro, projectPath: project.path });
      this.onEntriesChange(this.wslEntries.map(e => ({
        ...e,
        projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } : p)
      })));
      return gitInfo;
    } catch {
      return null;
    }
  }
  
  async openIde(projectId: string, ide: string): Promise<void> {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return;
    const project = entry.projects.find(p => p.id === projectId);
    if (!project) return;
    await invoke('open_wsl_ide', { distro: entry.distro, projectPath: project.path, ide });
  }
  
  async getFileDiff(projectId: string, filePath: string): Promise<unknown> {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return null;
    const project = entry.projects.find(p => p.id === projectId);
    if (!project) return null;
    return invoke('get_wsl_file_diff_command', { distro: entry.distro, projectPath: project.path, filePath });
  }
  
  async checkoutBranch(projectId: string, branchName: string): Promise<void> {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return;
    const project = entry.projects.find(p => p.id === projectId);
    if (!project) return;
    await invoke('wsl_checkout_branch', { distro: entry.distro, projectPath: project.path, branchName });
  }
  
  async createBranch(projectId: string, branchName: string): Promise<void> {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return;
    const project = entry.projects.find(p => p.id === projectId);
    if (!project) return;
    await invoke('wsl_create_branch', { distro: entry.distro, projectPath: project.path, branchName });
  }
  
  async createWorktree(projectId: string, worktreePath: string, branchName: string): Promise<void> {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return;
    const project = entry.projects.find(p => p.id === projectId);
    if (!project) return;
    await invoke('wsl_create_worktree', { distro: entry.distro, projectPath: project.path, worktreePath, branchName, newBranch: false });
  }
  
  launchAgent(projectId: string, agent: AgentConfig): void {
    const entry = this.wslEntries.find(e => e.projects.some(p => p.id === projectId));
    if (!entry) return;
    const key = wslCacheKey(entry.distro, projectId);
    const cmd = this.agentCommandOverrides[agent.id] ?? agent.command;
    launchAgentInWslTerminal(key, cmd, agent.args);
  }
  
  async setAgent(projectId: string, agentId: string | null): Promise<void> {
    this.onEntriesChange(this.wslEntries.map(e => ({
      ...e,
      projects: e.projects.map(p => p.id === projectId ? { ...p, selected_agent: agentId } : p)
    })));
  }
  
  async setIde(projectId: string, ide: string | null): Promise<void> {
    this.onEntriesChange(this.wslEntries.map(e => ({
      ...e,
      projects: e.projects.map(p => p.id === projectId ? { ...p, selected_ide: ide } : p)
    })));
  }
  
  setCollapsed(_projectId: string, _collapsed: boolean): void {
    // WSL 项目暂无折叠状态
  }
}