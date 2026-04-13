# VSCode-Style Layout Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Neeko layout into VSCode-style three-zone layout: Activity Bar (48px icon rail) + Panel Area (collapsible, draggable) + Main Content + Right Panel (side terminal, extensible tabs).

**Architecture:** Add `ActivityBarContext` to manage active panel + panel width. Create `ActivityBar` icon rail, `PanelArea` container with resize + collapse, `ProjectsPanel`/`GitPanel` as panel content, `RightPanel` as extensible right zone with tab bar. Extract `AppLayout` component to sit inside providers and call `useActivityBar()` safely.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, existing cn()/AppContext/AppProvider patterns.

---

## File Structure

```
src/
├── context/
│   └── activity-bar-context.tsx     NEW  active panel + panel width state
├── components/
│   ├── layout/
│   │   ├── ActivityBar.tsx           NEW  48px icon rail (Projects / Git / Settings)
│   │   ├── PanelArea.tsx             NEW  collapsible panel container + resize handle
│   │   ├── AppLayout.tsx             NEW  inner layout using useActivityBar()
│   │   └── RightPanel.tsx            NEW  right zone wrapper (tab bar + content slot)
│   └── panels/
│       ├── ProjectsPanel.tsx         NEW  project list (extracted from ProjectSidebar)
│       └── GitPanel.tsx              NEW  active project git details
├── App.tsx                           MODIFY  wrap with ActivityBarProvider, use AppLayout
└── styles/index.css                  MODIFY  remove dead .sidebar rule
```

---

## Task 1: ActivityBarContext

**Files:**
- Create: `src/context/activity-bar-context.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React, { createContext, useCallback, useContext, useState } from "react";

export type ActivityPanel = "projects" | "git";

const PANEL_MIN = 180;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 280;

interface ActivityBarContextValue {
  activePanel: ActivityPanel | null;
  togglePanel: (panel: ActivityPanel) => void;
  panelWidth: number;
  onPanelResizeStart: (e: React.MouseEvent) => void;
}

const ActivityBarContext = createContext<ActivityBarContextValue | null>(null);

interface ActivityBarProviderProps {
  initialPanel?: ActivityPanel;
  initialPanelWidth?: number;
  onPanelWidthPersist?: (w: number) => void;
  children: React.ReactNode;
}

export function ActivityBarProvider({
  initialPanel = "projects",
  initialPanelWidth = PANEL_DEFAULT,
  onPanelWidthPersist,
  children,
}: ActivityBarProviderProps) {
  const [activePanel, setActivePanel] = useState<ActivityPanel | null>(initialPanel);
  const [panelWidth, setPanelWidth] = useState(initialPanelWidth);

  const togglePanel = useCallback((panel: ActivityPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const onPanelResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + (ev.clientX - startX)));
        setPanelWidth(next);
        document.documentElement.style.setProperty("--panel-width", `${next}px`);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (onPanelWidthPersist) {
          onPanelWidthPersist(Math.min(PANEL_MAX, Math.max(PANEL_MIN, panelWidth)));
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth, onPanelWidthPersist]
  );

  React.useEffect(() => {
    document.documentElement.style.setProperty("--panel-width", `${panelWidth}px`);
  }, [panelWidth]);

  return (
    <ActivityBarContext.Provider value={{ activePanel, togglePanel, panelWidth, onPanelResizeStart }}>
      {children}
    </ActivityBarContext.Provider>
  );
}

export function useActivityBar() {
  const ctx = useContext(ActivityBarContext);
  if (!ctx) throw new Error("useActivityBar must be used within ActivityBarProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 2: ActivityBar component (icon rail)

**Files:**
- Create: `src/components/layout/ActivityBar.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React from "react";
import { cn } from "../../utils/cn";
import { useActivityBar, type ActivityPanel } from "../../context/activity-bar-context";

function FolderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GitBranchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface ActivityBarProps {
  onOpenSettings: () => void;
}

function ActivityBar({ onOpenSettings }: ActivityBarProps) {
  const { activePanel, togglePanel } = useActivityBar();

  const navItems: { id: ActivityPanel; icon: React.ReactNode; title: string }[] = [
    { id: "projects", icon: <FolderIcon />, title: "Projects" },
    { id: "git", icon: <GitBranchIcon />, title: "Git" },
  ];

  return (
    <div className="flex flex-col items-center w-12 shrink-0 bg-bg-secondary border-r border-border py-1">
      <div className="flex flex-col items-center gap-0.5 w-full">
        {navItems.map((item) => (
          <button
            key={item.id}
            title={item.title}
            onClick={() => togglePanel(item.id)}
            className={cn(
              "relative w-full h-12 flex items-center justify-center",
              "text-text-secondary transition-colors duration-150",
              "hover:text-text-primary hover:bg-bg-hover focus:outline-none",
              activePanel === item.id && [
                "text-text-primary",
                "before:absolute before:left-0 before:top-2 before:bottom-2",
                "before:w-0.5 before:bg-accent-blue before:rounded-r",
              ]
            )}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <div className="mt-auto flex flex-col items-center gap-0.5 w-full pb-1">
        <button
          title="Settings"
          onClick={onOpenSettings}
          className="w-full h-12 flex items-center justify-center text-text-secondary transition-colors duration-150 hover:text-text-primary hover:bg-bg-hover focus:outline-none"
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  );
}

export default React.memo(ActivityBar);
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 3: PanelArea component

**Files:**
- Create: `src/components/layout/PanelArea.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React from "react";
import { cn } from "../../utils/cn";
import { useActivityBar } from "../../context/activity-bar-context";

interface PanelAreaProps {
  children: React.ReactNode;
  className?: string;
}

function PanelArea({ children, className }: PanelAreaProps) {
  const { activePanel, panelWidth, onPanelResizeStart } = useActivityBar();

  if (activePanel === null) return null;

  return (
    <div
      className={cn(
        "relative flex flex-col shrink-0 bg-bg-secondary border-r border-border overflow-hidden",
        className
      )}
      style={{ width: panelWidth }}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </div>
      <div
        className="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-10 hover:bg-accent-blue/50 active:bg-accent-blue/50"
        onMouseDown={onPanelResizeStart}
      />
    </div>
  );
}

export default React.memo(PanelArea);
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 4: RightPanel component

**Files:**
- Create: `src/components/layout/RightPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React from "react";
import { cn } from "../../utils/cn";

export interface RightPanelTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface RightPanelProps {
  tabs: RightPanelTab[];
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  onClose?: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  className?: string;
}

function RightPanel({ tabs, activeTabId, onTabChange, onClose, width, onResizeStart, className }: RightPanelProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  if (tabs.length === 0) return null;

  return (
    <div
      className={cn("relative flex flex-col shrink-0 border-l border-border overflow-hidden", className)}
      style={{ width }}
    >
      {/* Left resize handle */}
      <div
        className="absolute top-0 left-[-3px] w-1.5 h-full cursor-col-resize z-10 hover:bg-accent-blue/50 active:bg-accent-blue/50"
        onMouseDown={onResizeStart}
      />
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0 bg-bg-secondary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "px-3 py-1.5 text-xs text-text-secondary transition-colors duration-100 hover:text-text-primary border-b-2",
              activeTab?.id === tab.id ? "border-accent-blue text-text-primary" : "border-transparent"
            )}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {onClose && (
          <button
            className="ml-auto px-2 py-1.5 text-text-muted hover:text-text-primary transition-colors duration-100"
            onClick={onClose}
            title="Close panel"
          >
            ×
          </button>
        )}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">{activeTab?.content}</div>
    </div>
  );
}

export default React.memo(RightPanel);
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 5: ProjectsPanel component

**Files:**
- Create: `src/components/panels/ProjectsPanel.tsx`

Move all content from `ProjectSidebar.tsx` into this file. The component renders the project list, WSL entries, SSH entries, and GitDialog. It reads `ideCommandOverrides`, `agents`, `config`, `showToast` from `useAppContext()`.

- [ ] **Step 1: Create `src/components/panels/` directory and the file**

Copy the entire body of `src/components/project/ProjectSidebar.tsx`, then:
1. Rename the component to `ProjectsPanel`
2. Remove the `SidebarRoot`/`SidebarContent` wrapper — replace with a plain `<div className="flex flex-col flex-1">`
3. Keep all props and logic unchanged

```tsx
// src/components/panels/ProjectsPanel.tsx
// (same props interface as ProjectSidebar, same render body,
//  but no SidebarRoot/SidebarContent wrapper)
import React, { useCallback, useState } from "react";
import { IS_WINDOWS } from "../../utils/platform";
import { useAppContext } from "../../context/app-context";
import ProjectItem from "../project/ProjectItem";
import GitDialog, { type DialogState } from "../project/GitDialog";
import { WSLItem, RemoteItem, type ActiveWslKey, type ActiveRemoteKey } from "../connections/RemoteItems";
import type { Project, WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject } from "../../types";

// ... (same interface + implementation as ProjectSidebar, minus SidebarRoot)
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 6: GitPanel component

**Files:**
- Create: `src/components/panels/GitPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React, { useState } from "react";
import type { Project, WSLProject, RemoteProject, RemoteEntrySession } from "../../types";
import FileTree, { buildTree } from "../project/FileTree";
import WorktreeList from "../project/WorktreeList";
import { cn } from "../../utils/cn";

interface GitPanelProps {
  activeProject: Project | null;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
  onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

function GitPanel({ activeProject, onSelectFile, onRefreshGit, onOpenWorktreeTerminal, onSelectWorktreeFile, onShowToast }: GitPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!activeProject?.git_info) {
    return (
      <div className="p-4 text-text-muted text-sm text-center mt-4">
        No active project with git info
      </div>
    );
  }

  const { git_info } = activeProject;
  const changedFiles = git_info.changed_files ?? [];
  const tree = buildTree(changedFiles);
  const worktrees = git_info.worktrees ?? [];

  return (
    <div className="flex flex-col py-1.5">
      {/* Branch */}
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Branch</span>
        <span className="text-xs font-mono text-accent-blue bg-accent-blue/10 border border-accent-blue/20 rounded-full px-2 py-0.5 truncate">
          {git_info.current_branch}
        </span>
      </div>

      {/* Changes */}
      {tree.length > 0 && (
        <div className="mt-1">
          <div
            className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-0.5 px-2 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
            onClick={(e) => toggleSection("__changes__", e)}
          >
            Changes ({changedFiles.length})
          </div>
          {expandedSections["__changes__"] !== false && (
            <div className="pl-2">
              <FileTree nodes={tree} projectId={activeProject.id} onSelectFile={onSelectFile} />
            </div>
          )}
        </div>
      )}

      {/* Worktrees */}
      {worktrees.length > 0 && (
        <WorktreeList
          worktrees={worktrees}
          projectId={activeProject.id}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          onOpenWorktreeTerminal={onOpenWorktreeTerminal}
          onSelectWorktreeFile={onSelectWorktreeFile}
          onRefreshGit={onRefreshGit}
          onShowToast={onShowToast}
        />
      )}

      {tree.length === 0 && worktrees.length === 0 && (
        <div className="p-4 text-text-muted text-sm text-center">Clean working tree</div>
      )}
    </div>
  );
}

export default React.memo(GitPanel);
```

NOTE: `buildTree` must be exported from `FileTree.tsx`. Check if it's already exported — if not, add `export` to its declaration.

- [ ] **Step 2: Export buildTree from FileTree.tsx if not already exported**

In `src/components/project/FileTree.tsx`, change:
```tsx
function buildTree(files: FileChange[]): TreeNode[] {
```
to:
```tsx
export function buildTree(files: FileChange[]): TreeNode[] {
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 7: AppLayout component

**Files:**
- Create: `src/components/layout/AppLayout.tsx`

This component sits inside all providers (AppProvider, ActivityBarProvider, SidebarProvider) and can safely call `useActivityBar()`. It receives all the props that were previously scattered between ProjectSidebar and MainContent in App.tsx.

- [ ] **Step 1: Create the file**

```tsx
// src/components/layout/AppLayout.tsx
import React, { useMemo } from "react";
import { useActivityBar } from "../../context/activity-bar-context";
import { useSidebar } from "../../context/sidebar-context";
import ActivityBar from "./ActivityBar";
import PanelArea from "./PanelArea";
import RightPanel from "./RightPanel";
import ProjectsPanel from "../panels/ProjectsPanel";
import GitPanel from "../panels/GitPanel";
import MainContent from "../MainContent";
import type {
  Project, WSLEntrySession, WSLProject,
  RemoteEntrySession, RemoteProject, AuthMethod,
} from "../../types";
import type { ActiveWslKey, ActiveRemoteKey } from "../connections/RemoteItems";

// Props: everything MainContent + ProjectsPanel needs from App.tsx
interface AppLayoutProps {
  // Projects panel
  projects: Project[];
  activeProjectId: string | null;
  wslEntries: WSLEntrySession[];
  remoteEntries: RemoteEntrySession[];
  activeWslKey: ActiveWslKey;
  activeRemoteKey: ActiveRemoteKey;
  wslOpenSessions: Set<string>;
  remoteOpenSessions: Set<string>;
  onAddProject: () => void;
  onRemoveProject: (id: string) => void;
  onSelectProject: (id: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onBackToMainTerminal: (projectId: string) => void;
  onOpenSettings: () => void;
  onOpenIde?: (projectId: string) => void;
  onOpenSideTerminal?: (projectId: string) => void;
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
  onOpenWslSideTerminal?: (entryId: string, projectId: string) => void;
  onOpenRemoteSideTerminal?: (entryId: string, projectId: string) => void;
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
  // MainContent
  activeProject: Project | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  sideTerminalOpenSet: Set<string>;
  sideTerminalWidth: number;
  handleSideDividerMouseDown: (e: React.MouseEvent) => void;
  setSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  focusedSideTerminalIndex: string | null;
  onFocusSideTerminal: (index: string | null) => void;
  handleSelectProject: (projectId: string) => void;
  handleAddProject: () => void;
  suppressResizeRef?: React.MutableRefObject<boolean>;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeWslWorktreePath: string | null;
  wslSideTerminalOpen: Set<string>;
  setWslSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeRemoteWorktreePath: string | null;
  remoteAuthStore: Map<string, AuthMethod>;
  remoteSideTerminalOpen: Set<string>;
  setRemoteSideTerminalOpen: (updater: (prev: Set<string>) => Set<string>) => void;
  setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;
  wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
  remoteDiffState: { entryId: string; host: string; port: number; username: string; auth: AuthMethod; projectPath: string; filePath: string } | null;
  worktreeDiffState: { worktreePath: string; filePath: string } | null;
  onWslDiffBack: () => void;
  onRemoteDiffBack: () => void;
  onWorktreeDiffBack: () => void;
  onShowToast: (message: string, type?: "info" | "error") => void;
}

function AppLayout(props: AppLayoutProps) {
  const { activePanel } = useActivityBar();
  const { onResizeStart: onRightPanelResizeStart, sidebarWidth: rightPanelWidth } = useSidebar();

  // Determine if right panel (side terminal) is open for current active context
  const hasSideTerminal =
    (props.activeProject && props.sideTerminalOpenSet.has(props.activeProject.id)) ||
    (props.activeWslProject && props.wslSideTerminalOpen.has(props.activeWslProject.project.id)) ||
    (props.activeRemoteProject && props.remoteSideTerminalOpen.has(props.activeRemoteProject.project.id));

  // Right panel tabs (extensible: add Preview etc. here later)
  const rightPanelTabs = useMemo(() => [], []); // side terminal is handled inline in MainContent for now

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Activity Bar */}
      <ActivityBar onOpenSettings={props.onOpenSettings} />

      {/* Panel Area */}
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
            onOpenSettings={props.onOpenSettings}
            onOpenIde={props.onOpenIde}
            onOpenSideTerminal={props.onOpenSideTerminal}
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
            onOpenWslSideTerminal={props.onOpenWslSideTerminal}
            onOpenRemoteSideTerminal={props.onOpenRemoteSideTerminal}
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
        {activePanel === "git" && (
          <GitPanel
            activeProject={props.activeProject}
            activeWslProject={props.activeWslProject}
            activeRemoteProject={props.activeRemoteProject}
            onSelectFile={props.onSelectFile}
            onRefreshGit={props.onRefreshGit}
            onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
            onSelectWorktreeFile={props.onSelectWorktreeFile}
            onShowToast={props.onShowToast}
          />
        )}
      </PanelArea>

      {/* Main Content */}
      <MainContent
        activeProject={props.activeProject}
        activeWorktreePath={props.activeWorktreePath}
        activeWorktreeBranch={props.activeWorktreeBranch}
        sideTerminalOpenSet={props.sideTerminalOpenSet}
        sideTerminalWidth={props.sideTerminalWidth}
        handleSideDividerMouseDown={props.handleSideDividerMouseDown}
        setSideTerminalOpen={props.setSideTerminalOpen}
        focusedSideTerminalIndex={props.focusedSideTerminalIndex}
        onFocusSideTerminal={props.onFocusSideTerminal}
        handleSelectProject={props.handleSelectProject}
        handleAddProject={props.handleAddProject}
        suppressResizeRef={props.suppressResizeRef}
        activeWslProject={props.activeWslProject}
        activeWslWorktreePath={props.activeWslWorktreePath}
        wslSideTerminalOpen={props.wslSideTerminalOpen}
        setWslSideTerminalOpen={props.setWslSideTerminalOpen}
        setWslOpenSessions={props.setWslOpenSessions}
        activeRemoteProject={props.activeRemoteProject}
        activeRemoteWorktreePath={props.activeRemoteWorktreePath}
        remoteAuthStore={props.remoteAuthStore}
        remoteSideTerminalOpen={props.remoteSideTerminalOpen}
        setRemoteSideTerminalOpen={props.setRemoteSideTerminalOpen}
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

---

## Task 8: Wire App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { ActivityBarProvider } from "./context/activity-bar-context";
import AppLayout from "./components/layout/AppLayout";
```

- [ ] **Step 2: Replace the inner layout in App.tsx render**

Replace:
```tsx
<SidebarProvider initialWidth={initialSidebarWidth} onWidthPersist={session.saveSidebarWidth}>
  <div className="flex flex-1 min-h-0 w-screen relative">
    <ProjectSidebar ... />
    <MainContent ... />
  </div>
  {/* modals */}
</SidebarProvider>
```

With:
```tsx
<ActivityBarProvider
  initialPanelWidth={initialSidebarWidth}
  onPanelWidthPersist={session.saveSidebarWidth}
>
  <SidebarProvider
    initialWidth={sideTerminalWidth}
    onWidthPersist={setSideTerminalWidth}
  >
    <AppLayout
      projects={projects}
      activeProjectId={activeProjectId}
      // ... all props (see AppLayoutProps in Task 7)
      onShowToast={showToast}
    />
    {/* Modals stay here, outside AppLayout */}
    {pendingPath && (
      <AddProjectModal
        pendingPath={pendingPath}
        onConfirm={handleConfirmAddProject}
        onCancel={() => setPendingPath(null)}
        loading={loading}
      />
    )}
  </SidebarProvider>
</ActivityBarProvider>
```

- [ ] **Step 3: Remove ProjectSidebar import and usage from App.tsx**

Delete the `import ProjectSidebar` line and the `<ProjectSidebar ... />` JSX block.

- [ ] **Step 4: Verify TypeScript**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Run tests**

Run: `cd D:\workspaces\work_rust\neeko && pnpm test`
Expected: 199 tests passing

---

## Task 9: Clean up old files + styles

**Files:**
- Modify: `src/components/project/ProjectSidebar.tsx`
- Modify: `src/styles/index.css`

- [ ] **Step 1: Replace ProjectSidebar with thin re-export**

Replace `src/components/project/ProjectSidebar.tsx` contents with:
```tsx
// Kept for backward-compat imports; content moved to src/components/panels/ProjectsPanel.tsx
export { default } from "../panels/ProjectsPanel";
```

- [ ] **Step 2: Remove dead .sidebar CSS rule from styles/index.css**

In `src/styles/index.css`, remove the line:
```css
.sidebar { position: relative; width: var(--sidebar-width); min-width: var(--sidebar-width); background-color: var(--bg-secondary); border-right: 1px solid var(--border-color); }
```

Also remove `--sidebar-width` from `@theme` block if present (replaced by `--panel-width`).

- [ ] **Step 3: Final verification**

Run: `cd D:\workspaces\work_rust\neeko && npx tsc --noEmit`
Run: `cd D:\workspaces\work_rust\neeko && pnpm test`
Run: `cd D:\workspaces\work_rust\neeko && pnpm build`
Expected: 0 TypeScript errors, 199 tests passing, build succeeds
