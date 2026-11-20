import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the browser feature so BrowserTabView renders as a prop-recording stub.
const MockBrowserTabView = vi.fn(() => <div data-testid="mock-browser-tab">browser</div>);
vi.mock('@/features/browser', () => ({
  BrowserTabView: (props: Record<string, unknown>) => MockBrowserTabView(props),
}));

/**
 * 中央看板换成「只吃 props 的桩」：本文件要钉的是 **adapter 契约** ——
 * `PaneContent` 把 tab 数据投影成 `view`，并把写入函数注入成 `onViewChange`（落 `updateTab`）。
 * 真实组件的「点按钮就调 onViewChange」在 `TeamBoardCenterView.test.tsx` 里钉。
 */
const MockTeamBoardCenterView = vi.fn(
  ({
    view,
    onViewChange,
  }: {
    view: 'board' | 'flow';
    onViewChange: (next: 'board' | 'flow') => void;
  }) => (
    <div>
      <span data-testid="board-view">{view}</span>
      <button type="button" onClick={() => onViewChange('flow')}>
        Assignment graph
      </button>
      <button type="button" onClick={() => onViewChange('board')}>
        Board
      </button>
    </div>
  ),
);
vi.mock('@/features/agent-team', () => ({
  TeamBoardCenterView: (props: {
    view: 'board' | 'flow';
    onViewChange: (next: 'board' | 'flow') => void;
  }) => MockTeamBoardCenterView(props),
  TeamTaskCenterView: () => null,
}));

import PaneContent from '@/features/editor/components/PaneContent';
import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/** 测试身份源：项目 id → WorkspaceSession（主仓形态）。 */
function mkSession(projectId: string) {
  return WorkspaceSession.of(projectId, null);
}

const baseProps = {
  tabKey: 'p1',
  agents: [],
  diffMode: 'inline' as const,
  layoutId: 'layout-1',
  isActiveGroup: true,
  remoteProject: null,
  onCloseTab: vi.fn(),
  showToast: vi.fn(),
  onSplitStateChange: vi.fn(),
  onSetSplitHorizontal: vi.fn(),
  onSetSplitVertical: vi.fn(),
  onSetClosePane: vi.fn(),
};

const makeBrowserTab = (id: string): Tab => ({
  id,
  scope: { kind: 'workspace', session: mkSession('p1') },
  title: 'Browser',
  data: { kind: 'browser', url: '' },
});

const TEAM_BOARD_TAB_ID = 'team-board_tm_1';

const makeTeamBoardTab = (view: 'board' | 'flow'): Tab => ({
  id: TEAM_BOARD_TAB_ID,
  scope: { kind: 'workspace', session: mkSession('p1') },
  title: 'refactor · board',
  data: { kind: 'team-board', teamId: 'tm_1', teamName: 'refactor', view },
});

/** 从**真 store**里读回 tab 数据里的视图（断言的是 tab 数据，不是组件 state）。 */
function storedBoardView(tabKey: string): 'board' | 'flow' | undefined {
  const tab = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.id === TEAM_BOARD_TAB_ID);
  return tab?.data.kind === 'team-board' ? tab.data.view : undefined;
}

describe('PaneContent — browser tab dispatch', () => {
  it('renders BrowserTabView for a browser-kind active tab with tab identity props', () => {
    render(<PaneContent {...baseProps} activeTab={makeBrowserTab('tab_b1')} />);

    expect(screen.getByTestId('mock-browser-tab')).toBeInTheDocument();
    expect(MockBrowserTabView).toHaveBeenCalledWith(
      expect.objectContaining({
        tabKey: 'p1',
        tabId: 'tab_b1',
        projectId: 'p1',
        isActive: true,
      }),
    );
  });

  it('passes isActive=false when the pane is not the active group', () => {
    render(
      <PaneContent {...baseProps} isActiveGroup={false} activeTab={makeBrowserTab('tab_b1')} />,
    );

    expect(MockBrowserTabView).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it('renders nothing when there is no active tab', () => {
    const { container } = render(<PaneContent {...baseProps} activeTab={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * R2 / AC2 / AC3：tab 里的 board/flow 选择**写回 tab 数据**（`editorStore.updateTab`）。
 *
 * `PaneContent` 只渲染当前激活的 tab（切走即卸载），所以视图不能活在任何组件 state 里 ——
 * 它是 tab 的导航态，与地址 / 标题同一层。判据：写入后从**真 store** 读回，并且卸载重挂
 * （= 切 tab 离开再回来）渲染的仍是上次那个视图。
 */
describe('PaneContent — 看板视图写回 tab 数据', () => {
  const tabKey = mkSession('p1').key;

  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  it('点「Assignment graph」⇒ 注入的 onViewChange 落进 tab 数据（data.view）', () => {
    const tab = makeTeamBoardTab('board');
    useEditorStore.getState().addTab(tab);

    render(<PaneContent {...baseProps} tabKey={tabKey} activeTab={tab} />);
    expect(screen.getByTestId('board-view')).toHaveTextContent('board');

    fireEvent.click(screen.getByRole('button', { name: 'Assignment graph' }));

    expect(storedBoardView(tabKey)).toBe('flow');
    // 再点回看板 ⇒ 写回 board（两个方向都是同一份数据）
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(storedBoardView(tabKey)).toBe('board');
  });

  it('卸载后重新挂载（切 tab 离开再回来）⇒ 渲染的仍是上次选的视图', () => {
    const tab = makeTeamBoardTab('board');
    useEditorStore.getState().addTab(tab);

    const view = render(<PaneContent {...baseProps} tabKey={tabKey} activeTab={tab} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assignment graph' }));
    expect(storedBoardView(tabKey)).toBe('flow');
    view.unmount();

    // 重新挂载只用 store 里的那份 tab 数据（模拟 PaneContent 重新渲染激活 tab）
    const stored = useEditorStore
      .getState()
      .tabs[tabKey]?.tabs.find((t) => t.id === TEAM_BOARD_TAB_ID);
    render(<PaneContent {...baseProps} tabKey={tabKey} activeTab={stored ?? null} />);

    expect(screen.getByTestId('board-view')).toHaveTextContent('flow');
  });
});
