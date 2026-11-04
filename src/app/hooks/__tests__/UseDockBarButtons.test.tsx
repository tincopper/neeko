import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appViewKey, panelView, tabKindView, type ViewKey } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';

// Mock DockBarButton to a thin passthrough so the hook test focuses on
// placement → bar derivation (slot / order / onBar) rather than registry/icon wiring.
vi.mock('@/app/components/DockBarButton', () => ({
  default: ({ view, side }: { view: string; side: string }) => (
    <span data-testid={`btn-${view}`} data-side={side} />
  ),
}));

import { useDockBarButtons } from '../UseDockBarButtons';

const PROJECTS = panelView('projects');
const FILES = panelView('files');
const LIBRARY = appViewKey('library');
const AGENT_CHAT = tabKindView('agent-chat');
const TERMINAL_VIEW = tabKindView('terminal');

function viewOf(entry: unknown): ViewKey {
  return (entry as { view: ViewKey }).view;
}

describe('useDockBarButtons', () => {
  beforeEach(() => {
    localStorage.clear();
    useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  });

  it('只给该侧的条目，按槽内 order 升序', () => {
    const { result } = renderHook(() => useDockBarButtons('left'));

    expect(result.current.map(viewOf)).toEqual([PROJECTS, LIBRARY]);
    expect(viewOf(result.current[0])).toBe(PROJECTS);
  });

  it('另一侧同理（右栏按声明表默认序）', () => {
    const { result } = renderHook(() => useDockBarButtons('right'));

    expect(result.current.map(viewOf)[0]).toBe(FILES);
    expect(result.current.length).toBeGreaterThan(1);
    // 每侧条目的图标顺序必须与落位序一致（bar 与 zone 读同一个真源）
    const views = result.current.map(viewOf);
    const orders = views.map((view) => useDockStore.getState().placements[view].order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('取消钉住（onBar=false）后该条目消失', () => {
    const { result, rerender } = renderHook(() => useDockBarButtons('left'));
    expect(result.current.map(viewOf)).toContain(LIBRARY);

    useDockStore.getState().setViewOnBar(LIBRARY, false);
    rerender();

    expect(result.current.map(viewOf)).not.toContain(LIBRARY);
  });

  it('图标换边后从原侧消失、在新侧按新顺序出现（同一真源，不可能只改一半）', () => {
    const onMove = vi.fn();
    const { result: leftResult, rerender: rerenderLeft } = renderHook(() =>
      useDockBarButtons('left', { onMove }),
    );
    const { result: rightResult, rerender: rerenderRight } = renderHook(() =>
      useDockBarButtons('right', { onMove }),
    );

    useDockStore.getState().moveView(FILES, 'left', 0);
    rerenderLeft();
    rerenderRight();

    expect(leftResult.current.map(viewOf)).toEqual([FILES, PROJECTS, LIBRARY]);
    expect(rightResult.current.map(viewOf)).not.toContain(FILES);
  });

  it('注入的 onMove 透传进按钮（拖拽与键盘共用同一个 app 层入口）', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useDockBarButtons('left', { onMove }));

    const entry = result.current[0] as unknown as {
      node: { props: { onMove?: typeof onMove } };
    };
    expect(entry.node.props.onMove).toBe(onMove);
  });

  it('注入的 onOpenTab 与可见性判据透传进按钮（种类入口的端口与选中态都在 app 层）', () => {
    const onOpenTab = vi.fn();
    const { result } = renderHook(() => useDockBarButtons('right', { onOpenTab }));

    const entry = result.current.find((item) => viewOf(item) === AGENT_CHAT) as unknown as {
      node: { props: { onOpenTab?: typeof onOpenTab; isTabKindVisible?: unknown } };
    };
    expect(entry.node.props.onOpenTab).toBe(onOpenTab);
    expect(typeof entry.node.props.isTabKindVisible).toBe('function');
  });

  it('种类入口默认在右栏（defaultOnBar: true 是需求本身：图标默认可见）', () => {
    const { result } = renderHook(() => useDockBarButtons('right'));

    expect(result.current.map(viewOf)).toEqual(expect.arrayContaining([AGENT_CHAT, TERMINAL_VIEW]));
  });
});
