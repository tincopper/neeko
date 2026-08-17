import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock the browser feature so BrowserTabView renders as a prop-recording stub.
const MockBrowserTabView = vi.fn(() => <div data-testid="mock-browser-tab">browser</div>);
vi.mock('@/features/browser', () => ({
  BrowserTabView: (props: Record<string, unknown>) => MockBrowserTabView(props),
}));

import PaneContent from '@/features/editor/components/PaneContent';
import type { Tab } from '@/shared/types/tab';

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
  projectId: 'p1',
  title: 'Browser',
  order: 0,
  data: { kind: 'browser', url: '' },
});

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
