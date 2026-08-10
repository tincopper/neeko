import {
  Blocks,
  FileText,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Globe,
  Library,
  MessagesSquare,
  Search,
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
  GitPullRequest,
  GitBranch,
  Globe,
  Library,
  MessagesSquare,
  Search,
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

const LazyLibraryPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.LibraryPanelWrapper,
  })),
);

const LazyGitControlPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.GitControlPanelWrapper,
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

const LazySearchPanelWrapper = lazy(() =>
  import('@/app/dock/DockPanelWrappers').then((m) => ({
    default: m.SearchPanelWrapper,
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
  library: {
    title: 'Library',
    icon: 'Library',
    component: LazyLibraryPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 240,
  },
  gitControl: {
    title: 'Git Control',
    icon: 'GitBranch',
    component: LazyGitControlPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 280,
  },
  pullRequests: {
    title: 'Pull Requests',
    icon: 'GitPullRequest',
    component: LazyPullRequestsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
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
  search: {
    title: 'Search',
    icon: 'Search',
    component: LazySearchPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 240,
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
