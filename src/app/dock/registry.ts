import {
  Blocks,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Globe,
  MessagesSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { lazy } from 'react';

import type { DockPanelViewDef } from '@/layout/DockRegistryContext';
import { DOCK_PANEL_META } from '@/shared/dock';

// ── Icon map (static imports for tree-shaking) ──────────────────────────────

export const dockPanelIcons: Record<string, LucideIcon> = {
  Blocks,
  FolderOpen,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  GitBranch,
  Globe,
  MessagesSquare,
};

// ── Lazy-loaded panel components ────────────────────────────────────────────

const ProjectsPanel = lazy(() => import('@/features/project/components/ProjectsPanel'));

/**
 * Wrapper components bridge the gap between dock panel instantiation
 * (which expects zero-props components) and existing panels that require
 * context-derived props.
 */
const LazyFilesPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.FilesPanelWrapper,
  })),
);

const LazySkillsPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.SkillsPanelWrapper,
  })),
);

const LazyGitCommitPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.GitCommitPanelWrapper,
  })),
);

const LazyBrowserPanel = lazy(() => import('@/features/browser/components/BrowserPanel'));

const LazyConversationsPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.ConversationsPanelWrapper,
  })),
);

const LazyPullRequestsPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.PullRequestsPanelWrapper,
  })),
);

type UiBinding = Pick<DockPanelViewDef, 'title' | 'icon' | 'component' | 'minPanelSize'>;

const UI_BINDINGS: Record<string, UiBinding> = {
  projects: {
    title: 'Projects',
    icon: 'FolderOpen',
    component: ProjectsPanel as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 200,
  },
  files: {
    title: 'Files',
    icon: 'FileText',
    component: LazyFilesPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 180,
  },
  skills: {
    title: 'Skills',
    icon: 'Blocks',
    component: LazySkillsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 200,
  },
  gitCommit: {
    title: 'Commit',
    icon: 'GitCommitHorizontal',
    component: LazyGitCommitPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
  },
  pullRequests: {
    title: 'Pull Requests',
    icon: 'GitPullRequest',
    component: LazyPullRequestsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
  },
  git: {
    title: 'Git Log',
    icon: 'GitBranch',
    // tab-mode: no dock component
  },
  browser: {
    title: 'Browser',
    icon: 'Globe',
    component: LazyBrowserPanel as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 300,
  },
  conversations: {
    title: 'History',
    icon: 'MessagesSquare',
    component: LazyConversationsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
  },
};

function buildDockPanelRegistry(): Record<string, DockPanelViewDef> {
  const registry: Record<string, DockPanelViewDef> = {};
  for (const [panelId, meta] of Object.entries(DOCK_PANEL_META)) {
    const ui = UI_BINDINGS[panelId];
    if (!ui) {
      throw new Error(`[dock] missing UI binding for panel "${panelId}"`);
    }
    registry[panelId] = { ...meta, ...ui };
  }
  return registry;
}

/** Full UI registry: meta (shared) + title/icon/component bindings (app). */
export const dockPanelRegistry = buildDockPanelRegistry();
