import {
  Bot,
  FileText,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Globe,
  Library,
  MessagesSquare,
  PanelLeft,
  PanelRight,
  Search,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { lazy } from 'react';

import type { DockViewDef } from '@/layout/DockRegistryContext';
import {
  DOCK_VIEW_META,
  appViewKey,
  panelView,
  tabHostView,
  tabKindView,
  type DockViewMeta,
} from '@/shared/dock';

// ── Icon map (static imports for tree-shaking) ──────────────────────────────

export const dockPanelIcons: Record<string, LucideIcon> = {
  Bot,
  FileText,
  FolderOpen,
  GitPullRequest,
  GitBranch,
  Globe,
  Library,
  MessagesSquare,
  Search,
  PanelLeft,
  PanelRight,
  Terminal,
};

// ── Lazy-loaded panel components ────────────────────────────────────────────

const ProjectsPanel = lazy(() =>
  import('@/features/project').then((m) => ({ default: m.ProjectsPanel })),
);

/**
 * Wrapper components bridge the gap between dock panel instantiation
 * (which expects zero-props components) and existing panels that require
 * context-derived props.
 *
 * 每个 wrapper 独立文件 + 独立 lazy chunk：打开任一面板只加载该面板的代码，
 * 避免单文件聚合导致全部面板代码同 chunk 加载。
 */
const LazyFilesPanelWrapper = lazy(() => import('@/app/dock/wrappers/FilesPanelWrapper'));

const LazyLibraryPanelWrapper = lazy(() => import('@/app/dock/wrappers/LibraryPanelWrapper'));

const LazyGitControlPanelWrapper = lazy(() => import('@/app/dock/wrappers/GitControlPanelWrapper'));

const LazyBrowserPanel = lazy(() =>
  import('@/features/browser').then((m) => ({ default: m.BrowserPanel })),
);

const LazyConversationsPanelWrapper = lazy(
  () => import('@/app/dock/wrappers/ConversationsPanelWrapper'),
);

const LazyPullRequestsPanelWrapper = lazy(
  () => import('@/app/dock/wrappers/PullRequestsPanelWrapper'),
);

const LazySearchPanelWrapper = lazy(() => import('@/app/dock/wrappers/SearchPanelWrapper'));

// 槽位 tab 宿主：同一模块两个导出 —— wrapper 决定 slot（宿主不得从 activeView 反推自己是谁）
const LazyLeftDockTabHost = lazy(() =>
  import('@/app/dock/wrappers/DockTabHostWrapper').then((m) => ({
    default: m.DockTabHostLeftWrapper,
  })),
);

const LazyRightDockTabHost = lazy(() =>
  import('@/app/dock/wrappers/DockTabHostWrapper').then((m) => ({
    default: m.DockTabHostRightWrapper,
  })),
);

type UiBinding = Pick<DockViewDef, 'title' | 'icon' | 'component' | 'minPanelSize'>;

/** UI 绑定按 **ViewKey** 索引（ViewKey 的唯一铸造点在 `shared/dock/viewKey`）。 */
const UI_BINDINGS: Record<string, UiBinding> = {
  [panelView('projects')]: {
    title: 'Projects',
    icon: 'FolderOpen',
    component: ProjectsPanel as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 200,
  },
  [panelView('files')]: {
    title: 'Files',
    icon: 'FileText',
    component: LazyFilesPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 180,
  },
  [appViewKey('library')]: {
    title: 'Library',
    icon: 'Library',
    component: LazyLibraryPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 240,
  },
  [panelView('gitControl')]: {
    title: 'Git Control',
    icon: 'GitBranch',
    component: LazyGitControlPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 280,
  },
  [panelView('pullRequests')]: {
    title: 'Pull Requests',
    icon: 'GitPullRequest',
    component: LazyPullRequestsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
  },
  [panelView('browser')]: {
    title: 'Browser',
    icon: 'Globe',
    component: LazyBrowserPanel as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 300,
  },
  [panelView('conversations')]: {
    title: 'History',
    icon: 'MessagesSquare',
    component: LazyConversationsPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 260,
  },
  [panelView('search')]: {
    title: 'Search',
    icon: 'Search',
    component: LazySearchPanelWrapper as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 240,
  },
  [tabHostView('left')]: {
    title: 'Docked Tabs (Left)',
    icon: 'PanelLeft',
    component: LazyLeftDockTabHost as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 240,
  },
  [tabHostView('right')]: {
    title: 'Docked Tabs',
    icon: 'PanelRight',
    component: LazyRightDockTabHost as React.LazyExoticComponent<
      React.ComponentType<Record<string, unknown>>
    >,
    minPanelSize: 240,
  },
  // 种类级入口：`host: 'none'` ⇒ 不进 zone，不需要 component（只有 bar 上的 title / icon）。
  // 点击行为由 `activation.kind === 'openTab'` 在 app 层分发（`useDockBarOpenTab`）。
  [tabKindView('agent-chat')]: {
    title: 'Agent Chat',
    icon: 'Bot',
  },
  [tabKindView('terminal')]: {
    title: 'Agent Terminal',
    icon: 'Terminal',
  },
};

/**
 * 声明表 + UI 绑定 → 完整注册表。缺绑定直接抛：注册表是编译期静态表，
 * 静默缺失会让图标点出「什么都不发生」，比启动失败更难查。
 *
 * 入参可注入：负例（缺绑定 / 缺 component / 孤儿绑定）要能直测 fail-fast，
 * 不必真的删一行声明再祈祷测试环境能重新加载模块。
 */
export function buildDockPanelRegistry(
  meta: Record<string, DockViewMeta> = DOCK_VIEW_META,
  bindings: Record<string, UiBinding> = UI_BINDINGS,
): Record<string, DockViewDef> {
  for (const view of Object.keys(bindings)) {
    if (!meta[view]) {
      throw new Error(`[dock] UI binding "${view}" has no entry in DOCK_VIEW_META`);
    }
  }

  const registry: Record<string, DockViewDef> = {};
  for (const [view, viewMeta] of Object.entries(meta)) {
    const ui = bindings[view];
    if (!ui) {
      throw new Error(`[dock] missing UI binding for view "${view}"`);
    }
    // 有 zone 内容的视图必须有组件；`host: 'none'`（只上 bar 的入口）不要求
    if (viewMeta.host !== 'none' && !ui.component) {
      throw new Error(`[dock] view "${view}" is hosted but has no component`);
    }
    registry[view] = { ...viewMeta, ...ui };
  }
  return registry;
}

/** Full UI registry: meta (shared) + title/icon/component bindings (app). */
export const dockPanelRegistry = buildDockPanelRegistry();
