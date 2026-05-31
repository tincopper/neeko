// Components
export { default as AddProjectModal } from "./components/AddProjectModal";
export { default as ContextMenu } from "./components/ContextMenu";
export { default as ProjectSettingsDialog } from "./components/ProjectSettingsDialog";
export { default as ProjectItem } from "./components/ProjectItem";
export { default as ProjectGitSection } from "./components/ProjectGitSection";
export { default as ProjectGroup } from "./components/ProjectGroup";
export { default as SessionRow } from "./components/SessionRow";
export { default as SessionChips } from "./components/SessionChips";
export { default as ProjectGuidePage } from "./components/ProjectGuidePage";
export { default as DraggableProjectItem } from "./components/DraggableProjectItem";
export { default as ProjectsPanel } from "./components/ProjectsPanel";
export { useProjectItemDrag } from "./components/useProjectItemDrag";
export { useProjectItemMenu } from "./components/useProjectItemMenu";
export type {
  ProjectItemProps,
  ProjectItemActions,
  ProjectItemViewConfig,
} from "./components/projectItemTypes";
export type { DragOffset, DropIndicator } from "./components/useProjectItemDrag";

// Hooks
export { useLocalProjects } from "./hooks/useLocalProjects";
export { useProjectList, useProjectListFromData, type ProjectListItem } from "./hooks/useProjectList";
export { useProjectSelection } from "./hooks/useProjectSelection";
export { useCrossTypeSelection } from "./hooks/useCrossTypeSelection";
export { useWorktreeActions } from "./hooks/useWorktreeActions";
export { useWorktreeState, type WorktreeItem } from "./hooks/useWorktreeState";
export { useActiveProject } from "./hooks/use-active-project";

// Store
export { useProjectStore } from "./store";
export { useWorktreeStore, type WorktreeSnapshotItem } from "./worktreeStore";

// Types
export type {
  Project,
  TerminalEntry,
  ProjectType,
  UnifiedProject,
  LocalConnectionContext,
  WslConnectionContext,
  RemoteConnectionContext,
  ConnectionContext,
  UnifiedProjectView,
  ProjectCommands,
  ProjectCapabilities,
  ActiveProjectContext,
} from "./types";

// Context
export { ProjectActionsProvider, useProjectActionsContext, type ProjectActionsContextValue } from "./context";
