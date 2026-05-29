import { lazy } from "react";
import {
  FolderOpen,
  FileText,
  Wrench,
  GitCommitHorizontal,
  GitBranch,
  Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ���� DockPanelDef type ����

export interface DockPanelDef {
  id: string;
  title: string;
  icon: string; // key into dockPanelIcons
  defaultZone: "left" | "right";
  defaultOrder: number;
  component?: React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>>;
  minPanelSize?: number; // px, minimum panel size when expanded
  openAs?: "tab" | "panel"; // default "panel"
  /** Default zone width percentage (0-100) when this panel is active. Fallback: 18. */
  defaultZoneSize?: number;
}

// ���� Icon map (static imports for tree-shaking) ����

export const dockPanelIcons: Record<string, LucideIcon> = {
  FolderOpen,
  FileText,
  Wrench,
  GitCommitHorizontal,
  GitBranch,
  Globe,
};

// ���� Lazy-loaded panel components ����

// ProjectsPanel takes no props �� render directly
const ProjectsPanel = lazy(
  () => import("@/components/panels/ProjectsPanel"),
);

/**
 * Wrapper components bridge the gap between dock panel instantiation
 * (which expects zero-props components) and existing panels that require
 * context-derived props.
 *
 * Each wrapper reads from React context / Zustand store and passes
 * the required props to the underlying panel component.
 */

const LazyFilesPanelWrapper = lazy(
  () =>
    import("./DockLayout/DockPanelWrappers").then((m) => ({
      default: m.FilesPanelWrapper,
    })),
);

const LazySkillsPanelWrapper = lazy(
  () =>
    import("./DockLayout/DockPanelWrappers").then((m) => ({
      default: m.SkillsPanelWrapper,
    })),
);

const LazyGitCommitPanelWrapper = lazy(
  () =>
    import("./DockLayout/DockPanelWrappers").then((m) => ({
      default: m.GitCommitPanelWrapper,
    })),
);

const LazyBrowserPanel = lazy(
  () => import("@/features/browser/components/BrowserPanel"),
);


// ���� Registry ����

export const dockPanelRegistry: Record<string, DockPanelDef> = {
  projects: {
    id: "projects",
    title: "Projects",
    icon: "FolderOpen",
    defaultZone: "left",
    defaultOrder: 0,
    component: ProjectsPanel as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 200,
  },
  files: {
    id: "files",
    title: "Files",
    icon: "FileText",
    defaultZone: "right",
    defaultOrder: 0,
    component: LazyFilesPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 180,
  },
  skills: {
    id: "skills",
    title: "Skills",
    icon: "Wrench",
    defaultZone: "left",
    defaultOrder: 2,
    component: LazySkillsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 200,
  },
  gitCommit: {
    id: "gitCommit",
    title: "Commit",
    icon: "GitCommitHorizontal",
    defaultZone: "right",
    defaultOrder: 1,
    component: LazyGitCommitPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
  },
  git: {
    id: "git",
    title: "Git Log",
    icon: "GitBranch",
    defaultZone: "right",
    defaultOrder: 2,
    openAs: "tab",
  },
  browser: {
    id: "browser",
    title: "Browser",
    icon: "Globe",
    defaultZone: "right",
    defaultOrder: 3,
    component: LazyBrowserPanel as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 300,
    defaultZoneSize: 50,
  },
};
