import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DialogType } from "./GitDialog";
import ContextMenu from "./ContextMenu";
import ProjectSettingsDialog from "./ProjectSettingsDialog";
import ProjectItemHeader from "./ProjectItemHeader";
import ProjectGitSection from "./ProjectGitSection";
import DraggableProjectItem from "./DraggableProjectItem";
import { useProjectItemDrag } from "./useProjectItemDrag";
import { useProjectItemMenu } from "./useProjectItemMenu";
import type { ProjectItemProps } from "./projectItemTypes";

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isActive,
  actions,
  viewConfig,
}) => {
  const {
    onSelectProject,
    onRemoveProject,
    onRefreshGit,
    onOpenDialog,
    onCommit,
    onPush,
    onPull,
    onOpenIde,
    onOpenWorktreeTerminal,
    onSelectWorktreeFile,
    onOpenSettings,
    onRefresh,
    onShowToast,
    onSaveProjectSettings,
    onDragEnd,
  } = actions;

  const ideCommandOverrides = viewConfig?.ideCommandOverrides;
  const agents = viewConfig?.agents;
  const config = viewConfig?.config;

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [projectCollapsed, setProjectCollapsed] = useState(project.collapsed ?? true);

  const {
    isDragging,
    dragOffset,
    dropIndicator,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useProjectItemDrag({ projectId: project.id, onDragEnd });

  const {
    gitMenuOpen,
    setGitMenuOpen,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
    contextMenuItems,
    settingsOpen,
    setSettingsOpen,
  } = useProjectItemMenu({
    project,
    onOpenDialog,
    onOpenIde,
    onRefresh,
    onOpenSettings,
    onRemoveProject,
    onCommit,
    onPush,
    onPull,
    hasConfig: Boolean(config),
  });

  const toggleCollapsed = async () => {
    const newCollapsed = !projectCollapsed;
    setProjectCollapsed(newCollapsed);
    try {
      await invoke("set_project_collapsed", {
        projectId: project.id,
        collapsed: newCollapsed,
      });
    } catch (e) {
      console.error("Failed to save collapsed state:", e);
    }
  };

  useEffect(() => {
    if (!gitMenuOpen) {
      return;
    }
    const close = () => setGitMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [gitMenuOpen, setGitMenuOpen]);

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openDialog = (type: DialogType, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenDialog({
      type,
      projectId: project.id,
      branches: project.git_info?.branches ?? [],
      ...(type === "new-worktree" ? { projectPath: project.path } : {}),
    });
  };

  return (
    <DraggableProjectItem
      dragId={project.id}
      isDragging={isDragging}
      dragOffset={dragOffset}
      dropIndicator={dropIndicator}
      isActive={isActive}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="gh-project"
    >
      <ProjectItemHeader
        project={project}
        isActive={isActive}
        projectCollapsed={projectCollapsed}
        gitMenuOpen={gitMenuOpen}
        setGitMenuOpen={setGitMenuOpen}
        ideCommandOverrides={ideCommandOverrides}
        actions={{
          onToggleCollapsed: () => void toggleCollapsed(),
          onContextMenu: handleContextMenu,
          onOpenIde,
          onOpenDialog: openDialog,
          onRemoveProject,
          onCommit,
          onPush,
          onPull,
        }}
      />

      {!projectCollapsed && (
        <ProjectGitSection
          project={project}
          isActive={isActive}
          expandedSections={expandedSections}
          actions={{
            onToggleSection: toggleSection,
            onSelectProject,
            onRefreshGit,
            onOpenDialog: openDialog,
            onOpenWorktreeTerminal,
            onSelectWorktreeFile,
            onShowToast,
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          position={contextMenu}
          onClose={closeContextMenu}
          items={contextMenuItems}
        />
      )}

      {settingsOpen && config && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          currentAgent={project.selected_agent}
          currentIde={project.selected_ide}
          agents={agents ?? []}
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={(agentId, ideCmd) => {
            onSaveProjectSettings?.(project.id, agentId, ideCmd);
            setSettingsOpen(false);
          }}
        />
      )}
    </DraggableProjectItem>
  );
};

export default React.memo(ProjectItem);
