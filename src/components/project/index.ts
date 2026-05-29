export { default as AddProjectModal } from "@/features/project/components/AddProjectModal";
export { default as ContextMenu } from "@/features/project/components/ContextMenu";
export { default as ProjectSettingsDialog } from "@/features/project/components/ProjectSettingsDialog";
export { default as ProjectItem } from "@/features/project/components/ProjectItem";
export { default as ProjectGitSection } from "@/features/project/components/ProjectGitSection";
export { default as ProjectGroup } from "@/features/project/components/ProjectGroup";
export { default as SessionRow } from "@/features/project/components/SessionRow";
export { default as SessionChips } from "@/features/project/components/SessionChips";
export { default as ProjectGuidePage } from "@/features/project/components/ProjectGuidePage";
export { default as GitCommitPanel } from "@/features/git/components/GitCommitPanel";
export { default as DraggableProjectItem } from "@/features/project/components/DraggableProjectItem";
export { useProjectItemDrag } from "@/features/project/components/useProjectItemDrag";
export { useProjectItemMenu } from "@/features/project/components/useProjectItemMenu";
export type {
  ProjectItemProps,
  ProjectItemActions,
  ProjectItemViewConfig,
} from "@/features/project/components/projectItemTypes";
export type { DragOffset, DropIndicator } from "@/features/project/components/useProjectItemDrag";
