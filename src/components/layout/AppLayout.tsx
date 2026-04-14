import React from "react";
import { useSidebar } from "../../context/sidebar-context";
import ActivityBar from "./ActivityBar";
import PanelArea from "./PanelArea";
import ProjectsPanel from "../panels/ProjectsPanel";
import MainContent from "../MainContent";
import type {
   Project,
   WSLEntrySession,
   WSLProject,
   RemoteEntrySession,
   RemoteProject,
   AuthMethod,
   AgentConfig,
   TerminalTab,
} from "../../types";
import type { ActiveWslKey, ActiveRemoteKey } from "../connections/RemoteItems";

interface AppLayoutProps {
   projects: Project[];
   activeProjectId: string | null;
   wslEntries: WSLEntrySession[];
   remoteEntries: RemoteEntrySession[];
   activeWslKey: ActiveWslKey;
   activeRemoteKey: ActiveRemoteKey;
   wslOpenSessions: Set<string>;
   remoteOpenSessions: Set<string>;
   onAddProject: () => void;
   onAddWsl: () => void;
   onAddRemote: () => void;
   onRemoveProject: (id: string) => void;
   onOpenSettings: () => void;
   onSelectProject: (id: string) => void;
   onSelectFile: (projectId: string, filePath: string) => void;
   onRefreshGit: (projectId: string) => void;
   onBackToMainTerminal: (projectId: string) => void;
   onOpenIde?: (projectId: string) => void;
   onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
   onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
   onSelectWslProject: (distro: string, project: WSLProject) => void;
   onCloseWslProject: (entryId: string, projectId: string) => void;
   onRemoveWslProject: (entryId: string, projectId: string) => void;
   onRemoveWslEntry: (entryId: string) => void;
   onAddWslProject: (entryId: string) => void;
   onSelectRemoteProject: (host: string, project: RemoteProject) => void;
   onCloseRemoteProject: (entryId: string, projectId: string) => void;
   onRemoveRemoteProject: (entryId: string, projectId: string) => void;
   onRemoveRemoteEntry: (entryId: string) => void;
   onAddRemoteProject: (entryId: string) => void;
   onSelectWslFile?: (distro: string, projectPath: string, filePath: string) => void;
   onSelectRemoteFile?: (entryId: string, projectPath: string, filePath: string) => void;
   onRefreshWslGit?: (distro: string, projectId: string, projectPath: string) => void;
   onRefreshRemoteGit?: (entryId: string, projectId: string, projectPath: string) => void;
   onOpenWslIde?: (distro: string, projectPath: string, ide: string) => void;
   onOpenRemoteIde?: (entryId: string, projectPath: string, ide: string) => void;
   onOpenWslWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
   onOpenRemoteWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
   invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
   onDragEnd?: (draggedId: string, targetId: string) => void;
   onSaveProjectSettings?: (projectId: string, agentId: string | null, ideCommand: string | null) => void;

   activeProject: Project | null;
   activeWorktreePath: string | null;
   activeWorktreeBranch: string;
   handleSelectProject: (projectId: string) => void;
   handleAddProject: () => void;
   suppressResizeRef?: React.MutableRefObject<boolean>;

   tabs: TerminalTab[];
   activeTabId: string | null;
   onActivateTab: (tabId: string) => void;
   onCloseTab: (tabId: string) => void;
   onAddTab: () => void;
   onTabStatusChange?: (tabId: string, status: "Idle" | "Running" | "Failed") => void;

   agents: AgentConfig[];
   compactMode: boolean;
   showAgentBar: boolean;
   onAgentClick: (agent: AgentConfig) => void;
   showToast: (message: string, type?: "info" | "error") => void;

   activeWslProject: { distro: string; project: WSLProject } | null;
   activeWslWorktreePath: string | null;
   setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
   activeRemoteWorktreePath: string | null;
   remoteAuthStore: Map<string, AuthMethod>;
   setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
   remoteDiffState: {
      entryId: string;
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
      filePath: string;
   } | null;
   worktreeDiffState: { worktreePath: string; filePath: string } | null;
   onWslDiffBack: () => void;
   onRemoteDiffBack: () => void;
   onWorktreeDiffBack: () => void;
}

function AppLayout(props: AppLayoutProps) {
   const { activePanel } = useSidebar();

   return (
      <div className="flex flex-1 min-h-0 overflow-hidden bg-bg-primary">
         <ActivityBar
            onOpenSettings={props.onOpenSettings}
            onAddProject={props.onAddProject}
            onAddWsl={props.onAddWsl}
            onAddRemote={props.onAddRemote}
         />

         <PanelArea>
            {activePanel === "projects" && (
               <ProjectsPanel
                  projects={props.projects}
                  activeProjectId={props.activeProjectId}
                  wslEntries={props.wslEntries}
                  remoteEntries={props.remoteEntries}
                  activeWslKey={props.activeWslKey}
                  activeRemoteKey={props.activeRemoteKey}
                  wslOpenSessions={props.wslOpenSessions}
                  remoteOpenSessions={props.remoteOpenSessions}
                  onAddProject={props.onAddProject}
                  onRemoveProject={props.onRemoveProject}
                  onSelectProject={props.onSelectProject}
                  onSelectFile={props.onSelectFile}
                  onRefreshGit={props.onRefreshGit}
                  onBackToMainTerminal={props.onBackToMainTerminal}
                  onOpenIde={props.onOpenIde}
                  onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
                  onSelectWorktreeFile={props.onSelectWorktreeFile}
                  onSelectWslProject={props.onSelectWslProject}
                  onCloseWslProject={props.onCloseWslProject}
                  onRemoveWslProject={props.onRemoveWslProject}
                  onRemoveWslEntry={props.onRemoveWslEntry}
                  onAddWslProject={props.onAddWslProject}
                  onSelectRemoteProject={props.onSelectRemoteProject}
                  onCloseRemoteProject={props.onCloseRemoteProject}
                  onRemoveRemoteProject={props.onRemoveRemoteProject}
                  onRemoveRemoteEntry={props.onRemoveRemoteEntry}
                  onAddRemoteProject={props.onAddRemoteProject}
                  onSelectWslFile={props.onSelectWslFile}
                  onSelectRemoteFile={props.onSelectRemoteFile}
                  onRefreshWslGit={props.onRefreshWslGit}
                  onRefreshRemoteGit={props.onRefreshRemoteGit}
                  onOpenWslIde={props.onOpenWslIde}
                  onOpenRemoteIde={props.onOpenRemoteIde}
                  onOpenWslWorktreeTerminal={props.onOpenWslWorktreeTerminal}
                  onOpenRemoteWorktreeTerminal={props.onOpenRemoteWorktreeTerminal}
                  invokeRemoteGit={props.invokeRemoteGit}
                  onDragEnd={props.onDragEnd}
                  onSaveProjectSettings={props.onSaveProjectSettings}
               />
            )}
         </PanelArea>

         <MainContent
            activeProject={props.activeProject}
            activeWorktreePath={props.activeWorktreePath}
            activeWorktreeBranch={props.activeWorktreeBranch}
            handleSelectProject={props.handleSelectProject}
            handleAddProject={props.handleAddProject}
            suppressResizeRef={props.suppressResizeRef}
            tabs={props.tabs}
            activeTabId={props.activeTabId}
            onActivateTab={props.onActivateTab}
            onCloseTab={props.onCloseTab}
            onAddTab={props.onAddTab}
            onTabStatusChange={props.onTabStatusChange}
            agents={props.agents}
            compactMode={props.compactMode}
            showAgentBar={props.showAgentBar}
            onAgentClick={props.onAgentClick}
            showToast={props.showToast}
            activeWslProject={props.activeWslProject}
            activeWslWorktreePath={props.activeWslWorktreePath}
            setWslOpenSessions={props.setWslOpenSessions}
            activeRemoteProject={props.activeRemoteProject}
            activeRemoteWorktreePath={props.activeRemoteWorktreePath}
            remoteAuthStore={props.remoteAuthStore}
            setRemoteOpenSessions={props.setRemoteOpenSessions}
            wslDiffState={props.wslDiffState}
            remoteDiffState={props.remoteDiffState}
            worktreeDiffState={props.worktreeDiffState}
            onWslDiffBack={props.onWslDiffBack}
            onRemoteDiffBack={props.onRemoteDiffBack}
            onWorktreeDiffBack={props.onWorktreeDiffBack}
         />
      </div>
   );
}

export default React.memo(AppLayout);
