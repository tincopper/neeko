import React, { useState } from "react";
import { WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject } from "../../types";

// ─── Active selection type ───────────────────────────────────────────────────
export type ActiveWslKey = { distro: string; projectId: string } | null;
export type ActiveRemoteKey = { host: string; projectId: string } | null;

// ─── WSLItem ──────────────────────────────────────────────────────────────────

interface WSLItemProps {
  entry: WSLEntrySession;
  activeKey: ActiveWslKey;
  openSessions: Set<string>; // projectId set for sessions that have an active terminal
  onSelectProject: (distro: string, project: WSLProject) => void;
  onCloseProject: (entryId: string, projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
}

export const WSLItem: React.FC<WSLItemProps> = ({
  entry,
  activeKey,
  openSessions,
  onSelectProject,
  onCloseProject,
  onRemoveProject,
  onRemoveEntry,
  onAddProject,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="gh-project">
      {/* 发行版 header */}
      <div
        className="gh-project-header"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className={`gh-project-chevron ${collapsed ? "collapsed" : ""}`}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </span>
        <span style={{ fontSize: 15 }}>🐧</span>
        <div className="gh-project-meta">
          <span className="gh-project-name">{entry.distro}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>WSL</span>
        </div>
        <div className="gh-project-actions" onClick={(e) => e.stopPropagation()}>
          {/* 添加项目 */}
          <button
            className="gh-icon-btn"
            title="Add WSL project"
            onClick={() => onAddProject(entry.id)}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {/* 删除发行版 */}
          <button
            className="gh-icon-btn gh-icon-btn-danger"
            title="Remove distro"
            onClick={() => onRemoveEntry(entry.id)}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 项目列表 */}
      {!collapsed && (
        <div className="gh-project-body">
          {entry.projects.length === 0 ? (
            <div className="gh-empty-section" style={{ paddingLeft: 28 }}>No projects</div>
          ) : (
            entry.projects.map((project) => {
              const isActive =
                activeKey?.distro === entry.distro && activeKey?.projectId === project.id;
              const hasSession = openSessions.has(project.id);
              return (
                <div
                  key={project.id}
                  className={`gh-branch-item${isActive ? " current" : ""}`}
                  style={{ paddingLeft: 28, cursor: "pointer" }}
                  onClick={() => onSelectProject(entry.distro, project)}
                  title={project.path}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6 }}>
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z" />
                  </svg>
                  <span className="gh-branch-item-name">{project.name}</span>
                  {hasSession && (
                    <span
                      title="Terminal active"
                      style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "var(--accent, #528bff)",
                        display: "inline-block", flexShrink: 0, marginLeft: 4,
                      }}
                    />
                  )}
                  <div className="gh-project-actions" style={{ marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                    {hasSession && (
                      <button
                        className="gh-icon-btn"
                        style={{ opacity: 0 }}
                        title="Close terminal"
                        onClick={() => onCloseProject(entry.id, project.id)}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
                      >
                        {/* stop / square icon */}
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                          <rect x="2" y="2" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="gh-icon-btn gh-icon-btn-danger"
                      style={{ opacity: 0 }}
                      title="Remove project"
                      onClick={() => onRemoveProject(entry.id, project.id)}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
                    >×</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

// ─── RemoteItem ───────────────────────────────────────────────────────────────

interface RemoteItemProps {
  entry: RemoteEntrySession;
  activeKey: ActiveRemoteKey;
  openSessions: Set<string>; // projectId set for sessions that have an active terminal
  onSelectProject: (host: string, project: RemoteProject) => void;
  onCloseProject: (entryId: string, projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
}

export const RemoteItem: React.FC<RemoteItemProps> = ({
  entry,
  activeKey,
  openSessions,
  onSelectProject,
  onCloseProject,
  onRemoveProject,
  onRemoveEntry,
  onAddProject,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const label = `${entry.host}:${entry.port}`;

  return (
    <div className="gh-project">
      {/* 服务器 header */}
      <div
        className="gh-project-header"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className={`gh-project-chevron ${collapsed ? "collapsed" : ""}`}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </span>
        <span style={{ fontSize: 15 }}>🖥️</span>
        <div className="gh-project-meta">
          <span className="gh-project-name">{label}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>SSH</span>
        </div>
        <div className="gh-project-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="gh-icon-btn"
            title="Add remote project"
            onClick={() => onAddProject(entry.id)}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="gh-icon-btn gh-icon-btn-danger"
            title="Remove server"
            onClick={() => onRemoveEntry(entry.id)}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 项目列表 */}
      {!collapsed && (
        <div className="gh-project-body">
          {entry.projects.length === 0 ? (
            <div className="gh-empty-section" style={{ paddingLeft: 28 }}>No projects</div>
          ) : (
            entry.projects.map((project) => {
              const isActive =
                activeKey?.host === entry.host && activeKey?.projectId === project.id;
              const hasSession = openSessions.has(project.id);
              return (
                <div
                  key={project.id}
                  className={`gh-branch-item${isActive ? " current" : ""}`}
                  style={{ paddingLeft: 28, cursor: "pointer" }}
                  onClick={() => onSelectProject(entry.host, project)}
                  title={project.path}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6 }}>
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z" />
                  </svg>
                  <span className="gh-branch-item-name">{project.name}</span>
                  {hasSession && (
                    <span
                      title="Terminal active"
                      style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "var(--accent, #528bff)",
                        display: "inline-block", flexShrink: 0, marginLeft: 4,
                      }}
                    />
                  )}
                  <div className="gh-project-actions" style={{ marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                    {hasSession && (
                      <button
                        className="gh-icon-btn"
                        style={{ opacity: 0 }}
                        title="Close terminal"
                        onClick={() => onCloseProject(entry.id, project.id)}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                          <rect x="2" y="2" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="gh-icon-btn gh-icon-btn-danger"
                      style={{ opacity: 0 }}
                      title="Remove project"
                      onClick={() => onRemoveProject(entry.id, project.id)}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
                    >×</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
