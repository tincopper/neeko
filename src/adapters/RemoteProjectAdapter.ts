import { invoke } from '@tauri-apps/api/core';
import type { ProjectAdapter } from './ProjectAdapter';
import type { UnifiedProject, GitInfo, AgentConfig, RemoteEntrySession, RemoteProject, AuthMethod } from '../types';
import { launchAgentInRemoteTerminal, remoteCacheKey } from '../components/terminal';

function remoteProjectToUnified(p: RemoteProject): UnifiedProject {
   return {
      type: 'remote',
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

export class RemoteProjectAdapter implements ProjectAdapter {
   readonly type = 'remote' as const;

   private remoteEntries: RemoteEntrySession[] = [];
   private activeRemoteKey: { host: string; projectId: string } | null = null;
   private authStore: Map<string, AuthMethod> = new Map();
   private onEntriesChange: (entries: RemoteEntrySession[]) => void = () => { };
   private onActiveChange: (entry: RemoteEntrySession | null, project: RemoteProject | null) => void = () => { };
   private agentCommandOverrides: Record<string, string> = {};

   constructor(
      remoteEntries: RemoteEntrySession[],
      activeRemoteKey: { host: string; projectId: string } | null,
      authStore: Map<string, AuthMethod>,
      onEntriesChange: (entries: RemoteEntrySession[]) => void,
      onActiveChange: (entry: RemoteEntrySession | null, project: RemoteProject | null) => void,
      agentCommandOverrides: Record<string, string> = {}
   ) {
      this.remoteEntries = remoteEntries;
      this.activeRemoteKey = activeRemoteKey;
      this.authStore = authStore;
      this.onEntriesChange = onEntriesChange;
      this.onActiveChange = onActiveChange;
      this.agentCommandOverrides = agentCommandOverrides;
   }

   updateState(
      remoteEntries: RemoteEntrySession[],
      activeRemoteKey: { host: string; projectId: string } | null,
      authStore: Map<string, AuthMethod>
   ) {
      this.remoteEntries = remoteEntries;
      this.activeRemoteKey = activeRemoteKey;
      this.authStore = authStore;
   }

   updateConfig(overrides: Record<string, string>) {
      this.agentCommandOverrides = overrides;
   }

   getProjects(): UnifiedProject[] {
      return this.remoteEntries.flatMap(entry =>
         entry.projects.map(p => ({ ...remoteProjectToUnified(p), _entryId: entry.id } as UnifiedProject & { _entryId: string }))
      );
   }

   getActiveProject(): UnifiedProject | null {
      if (!this.activeRemoteKey) return null;
      const { host, projectId } = this.activeRemoteKey;
      const entry = this.remoteEntries.find((e) => e.host === host);
      const project = entry?.projects.find((p) => p.id === projectId);
      if (!entry || !project) return null;
      return { ...remoteProjectToUnified(project), _entryId: entry.id } as UnifiedProject & { _entryId: string };
   }

   selectProject(projectId: string): void {
      const entry = this.remoteEntries.find((e) =>
         e.projects.some((p) => p.id === projectId),
      );
      if (!entry) return;
      const project = entry.projects.find((p) => p.id === projectId);
      if (!project) return;
      this.activeRemoteKey = { host: entry.host, projectId };
      this.onActiveChange(entry, project);

      const auth = this.authStore.get(entry.id);
      if (auth) {
         invoke<GitInfo>('refresh_remote_git_info', {
            host: entry.host,
            port: entry.port,
            username: entry.username,
            auth,
            projectPath: project.path,
         })
            .then(gitInfo => {
               this.onEntriesChange(this.remoteEntries.map(e => ({
                  ...e,
                  projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } : p)
               })));
            })
            .catch(() => { });
      }
   }

   async refreshGit(projectId: string): Promise<GitInfo | null> {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return null;
      const project = entry.projects.find(p => p.id === projectId);
      if (!project) return null;
      const auth = this.authStore.get(entry.id);
      if (!auth) return null;
      try {
         const gitInfo = await invoke<GitInfo>('refresh_remote_git_info', {
            host: entry.host,
            port: entry.port,
            username: entry.username,
            auth,
            projectPath: project.path,
         });
         this.onEntriesChange(this.remoteEntries.map(e => ({
            ...e,
            projects: e.projects.map(p => p.id === projectId ? { ...p, git_info: gitInfo } : p)
         })));
         return gitInfo;
      } catch {
         return null;
      }
   }

   async openIde(projectId: string, ide: string): Promise<void> {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return;
      const project = entry.projects.find(p => p.id === projectId);
      if (!project) return;
      await invoke('open_remote_ide', {
         host: entry.host,
         port: entry.port,
         username: entry.username,
         projectPath: project.path,
         ide,
      });
   }

   async getFileDiff(projectId: string, filePath: string): Promise<unknown> {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return null;
      const project = entry.projects.find(p => p.id === projectId);
      if (!project) return null;
      const auth = this.authStore.get(entry.id);
      if (!auth) return null;
      return invoke('get_remote_file_diff_command', {
         host: entry.host,
         port: entry.port,
         username: entry.username,
         auth,
         projectPath: project.path,
         filePath,
      });
   }

   async checkoutBranch(projectId: string, branchName: string): Promise<void> {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return;
      const project = entry.projects.find(p => p.id === projectId);
      if (!project) return;
      const auth = this.authStore.get(entry.id);
      if (!auth) return;
      await invoke('remote_checkout_branch', {
         host: entry.host,
         port: entry.port,
         username: entry.username,
         auth,
         projectPath: project.path,
         branchName,
      });
   }

   async createBranch(projectId: string, branchName: string): Promise<void> {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return;
      const project = entry.projects.find(p => p.id === projectId);
      if (!project) return;
      const auth = this.authStore.get(entry.id);
      if (!auth) return;
      await invoke('remote_create_branch', {
         host: entry.host,
         port: entry.port,
         username: entry.username,
         auth,
         projectPath: project.path,
         branchName,
      });
   }

   async createWorktree(projectId: string, worktreePath: string, branchName: string): Promise<void> {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return;
      const project = entry.projects.find(p => p.id === projectId);
      if (!project) return;
      const auth = this.authStore.get(entry.id);
      if (!auth) return;
      await invoke('remote_create_worktree', {
         host: entry.host,
         port: entry.port,
         username: entry.username,
         auth,
         projectPath: project.path,
         worktreePath,
         branchName,
         newBranch: false,
      });
   }

   launchAgent(projectId: string, agent: AgentConfig): void {
      const entry = this.remoteEntries.find(e => e.projects.some(p => p.id === projectId));
      if (!entry) return;
      const key = remoteCacheKey(entry.id, projectId);
      const cmd = this.agentCommandOverrides[agent.id] ?? agent.command;
      launchAgentInRemoteTerminal(key, cmd, agent.args);
   }

   async setAgent(projectId: string, agentId: string | null): Promise<void> {
      this.onEntriesChange(this.remoteEntries.map(e => ({
         ...e,
         projects: e.projects.map(p => p.id === projectId ? { ...p, selected_agent: agentId } : p)
      })));
   }

   async setIde(projectId: string, ide: string | null): Promise<void> {
      this.onEntriesChange(this.remoteEntries.map(e => ({
         ...e,
         projects: e.projects.map(p => p.id === projectId ? { ...p, selected_ide: ide } : p)
      })));
   }

   setCollapsed(_projectId: string, _collapsed: boolean): void {
      // SSH 项目暂无折叠状态
   }
}