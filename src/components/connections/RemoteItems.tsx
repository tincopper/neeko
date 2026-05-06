import React, { useState } from "react";
import { getDistroIcon } from "../../utils/distros";
import serverIcon from "../../assets/server.svg";
import { PlusIcon, TrashIcon } from "../icons";
import ConnectionProjectCard from "./ConnectionProjectCard";
import type { WSLItemProps, RemoteItemProps, ConnectionProjectCardProps } from "./types";

export const WSLItem = React.memo<WSLItemProps>(
  ({
    entry,
    activeKey,
    openSessions,
    onSelectProject,
    onCloseProject,
    onRemoveProject,
    onRemoveEntry,
    onAddProject,
    onSelectFile,
    onRefreshGit,
    onOpenIde,
    onOpenWorktreeTerminal,
    onOpenDialog,
    ideCommandOverrides,
    onOpenSettings,
    onRefresh,
    agents,
    config,
    onSaveProjectSettings,
    onShowToast,
  }) => {
    void onCloseProject;
    const [collapsed, setCollapsed] = useState(false);

    return (
      <div className="gh-project mb-0.5 rounded-md overflow-visible">
        <div className="gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover">
          <img
            src={getDistroIcon(entry.distro)}
            className="sidebar-distro-icon w-5 h-5 shrink-0"
            alt=""
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((v) => !v);
            }}
          />
          <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
              {entry.distro}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
              WSL
            </span>
          </div>
          <div
            className="gh-project-actions flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
              title="Add WSL project"
              onClick={() => onAddProject(entry.id)}
            >
              <PlusIcon size={11} />
            </button>
            <button
              className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150"
              title="Remove distro"
              onClick={() => onRemoveEntry(entry.id)}
            >
              <TrashIcon size={11} />
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="py-0.5 pb-1" style={{ paddingLeft: 16 }}>
            {entry.projects.length === 0 ? (
              <div className="text-xs text-text-muted py-2" style={{ paddingLeft: 28 }}>
                No projects
              </div>
            ) : (
              entry.projects.map((project) => {
                const isActive =
                  activeKey?.distro === entry.distro &&
                  activeKey?.projectId === project.id;
                const hasSession = openSessions.has(project.id);
                return (
                  <ConnectionProjectCard
                    key={project.id}
                    project={project}
                    entryId={entry.id}
                    source={{ type: "wsl", distro: entry.distro }}
                    isActive={isActive}
                    hasSession={hasSession}
                    onSelectProject={onSelectProject as ConnectionProjectCardProps['onSelectProject']}
                    onRemoveProject={onRemoveProject}
                    onSelectFile={onSelectFile}
                    onRefreshGit={onRefreshGit}
                    onOpenIde={onOpenIde}
                    onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                    onOpenDialog={onOpenDialog as ConnectionProjectCardProps['onOpenDialog']}
                    ideCommandOverrides={ideCommandOverrides}
                    onOpenSettings={onOpenSettings}
                    onRefresh={
                      onRefresh ? () => onRefresh(entry.distro, project.id) : undefined
                    }
                    agents={agents}
                    config={config}
                    onSaveProjectSettings={onSaveProjectSettings}
                    onShowToast={onShowToast}
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    );
  },
);

export const RemoteItem = React.memo<RemoteItemProps>(
  ({
    entry,
    activeKey,
    openSessions,
    onSelectProject,
    onCloseProject,
    onRemoveProject,
    onRemoveEntry,
    onAddProject,
    onSelectFile,
    onRefreshGit,
    onOpenIde,
    onOpenWorktreeTerminal,
    invokeRemoteGit,
    onOpenDialog,
    ideCommandOverrides,
    onOpenSettings,
    onRefresh,
    agents,
    config,
    onSaveProjectSettings,
    onShowToast,
  }) => {
    void onCloseProject;
    const [collapsed, setCollapsed] = useState(false);
    const label = `${entry.host}:${entry.port}`;

    return (
      <div className="gh-project mb-0.5 rounded-md overflow-visible">
        <div className="gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover">
          <img
            src={serverIcon}
            className="sidebar-distro-icon w-5 h-5 shrink-0"
            alt=""
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((v) => !v);
            }}
          />
          <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
            <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
              {label}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
              SSH
            </span>
          </div>
          <div
            className="gh-project-actions flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
              title="Add remote project"
              onClick={() => onAddProject(entry.id)}
            >
              <PlusIcon size={11} />
            </button>
            <button
              className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150"
              title="Remove server"
              onClick={() => onRemoveEntry(entry.id)}
            >
              <TrashIcon size={11} />
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="py-0.5 pb-1" style={{ paddingLeft: 16 }}>
            {entry.projects.length === 0 ? (
              <div className="text-xs text-text-muted py-2" style={{ paddingLeft: 28 }}>
                No projects
              </div>
            ) : (
              entry.projects.map((project) => {
                const isActive =
                  activeKey?.host === entry.host && activeKey?.projectId === project.id;
                const hasSession = openSessions.has(project.id);
                return (
                  <ConnectionProjectCard
                    key={project.id}
                    project={project}
                    entryId={entry.id}
                    source={{
                      type: "remote",
                      entryId: entry.id,
                      host: entry.host,
                      invokeRemoteGit: invokeRemoteGit!,
                    }}
                    isActive={isActive}
                    hasSession={hasSession}
                    onSelectProject={onSelectProject as ConnectionProjectCardProps['onSelectProject']}
                    onRemoveProject={onRemoveProject}
                    onSelectFile={onSelectFile}
                    onRefreshGit={onRefreshGit}
                    onOpenIde={onOpenIde}
                    onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                    onOpenDialog={onOpenDialog as ConnectionProjectCardProps['onOpenDialog']}
                    ideCommandOverrides={ideCommandOverrides}
                    onOpenSettings={onOpenSettings}
                    onRefresh={
                      onRefresh ? () => onRefresh(entry.id, project.id) : undefined
                    }
                    agents={agents}
                    config={config}
                    onSaveProjectSettings={onSaveProjectSettings}
                    onShowToast={onShowToast}
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    );
  },
);
