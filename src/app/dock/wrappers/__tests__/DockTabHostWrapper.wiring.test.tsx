import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `DockTabHostWrapper` 的接线契约：**slot 由注册表传入**、`tabKey` 由激活 workspace 派生。
 *
 * 这两条都是「第二份表示」最容易冒出来的地方：
 * - 宿主若从 `activeView` 反推自己是谁，左右两个 wrapper 就会在换边/隐藏时互相冒充；
 * - 宿主若自己算 tab 空间键，就会绕开 `selectActiveWorkspaceKey`（I4 跨项目污染）。
 *
 * 这里 mock 宿主组件本身：断言面是宿主**收到的 props**，避免把 EditorGroupPane 的
 * 全套上下文拖进来（渲染行为另有 `DockTabHost.test.tsx`）。
 */

const captured = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock('@/features/dock-tabs', () => ({
  DockTabHost: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return null;
  },
}));

vi.mock('@/features/agent/api/agentApi', () => ({
  checkAgentsInstalled: vi.fn(async () => ({})),
}));

import {
  DockTabHostLeftWrapper,
  DockTabHostRightWrapper,
} from '@/app/dock/wrappers/DockTabHostWrapper';
import { AppProvider } from '@/shared/contexts';
import { ConnectionProjectProvider } from '@/shared/contexts/ConnectionProjectContext';
import { useProjectStore } from '@/shared/store/projectStore';
import type { Project } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const PROJECT = {
  id: 'p1',
  name: 'demo',
  path: '/demo',
  environment: { type: 'Local' },
} as unknown as Project;

const connectionValue = {
  remoteEntries: [],
  remoteOpenSessions: new Set<string>(),
  activeRemoteCheckoutPath: null,
  remoteAuthStore: new Map(),
  setRemoteOpenSessions: () => {},
  setPendingAuthEntry: () => {},
  onCloseRemoteProject: vi.fn(),
  onRemoveRemoteProject: vi.fn(),
  onRemoveRemoteEntry: vi.fn(),
  onAddRemoteProject: vi.fn(),
  onHideRemoteProject: vi.fn(),
  wslEntries: [],
  wslStats: new Map(),
  wslAuthStore: new Map(),
  activeWslCheckoutPath: null,
} as never;

const appValue = {
  config: {} as never,
  customThemes: [],
  agents: [],
  agentInstalledMap: {},
  loading: false,
  ideCommandOverrides: {},
  showToast: vi.fn(),
  saveConfig: async () => {},
};

function renderWrapper(node: ReactNode) {
  return render(
    <AppProvider value={appValue}>
      <ConnectionProjectProvider value={connectionValue}>{node}</ConnectionProjectProvider>
    </AppProvider>,
  );
}

function latestProps(): Record<string, unknown> {
  return captured.props.at(-1)!;
}

describe('DockTabHostWrapper — slot 由注册表传入（不由 activeView 反推）', () => {
  beforeEach(() => {
    captured.props.length = 0;
    useProjectStore.setState({
      projects: [PROJECT],
      activeProjectId: PROJECT.id,
      activeProject: PROJECT,
    });
  });

  it('左/右 wrapper 各自传自己的 slot', () => {
    renderWrapper(
      <>
        <DockTabHostLeftWrapper />
        <DockTabHostRightWrapper />
      </>,
    );

    expect(captured.props.map((p) => p.slot)).toEqual(['left', 'right']);
    for (const props of captured.props) {
      expect(props.tabKey).toBe(WorkspaceSession.of(PROJECT.id, null).key);
    }
  });

  it('无激活项目 → tabKey = null（宿主渲染为空，不凭空占位）', () => {
    useProjectStore.setState({ projects: [], activeProjectId: null, activeProject: null });

    renderWrapper(<DockTabHostRightWrapper />);

    expect(latestProps().tabKey).toBeNull();
  });

  it('buildLayoutId 把 slot 编进面板身份（左右宿主不共享分屏状态）', () => {
    renderWrapper(
      <>
        <DockTabHostLeftWrapper />
        <DockTabHostRightWrapper />
      </>,
    );

    const [left, right] = captured.props;
    const buildLeft = left.buildLayoutId as (paneId: string, tabId: string | null) => string;
    const buildRight = right.buildLayoutId as (paneId: string, tabId: string | null) => string;

    expect(buildLeft('dockLeft', 'tab1')).not.toBe(buildRight('dockRight', 'tab1'));
  });
});
