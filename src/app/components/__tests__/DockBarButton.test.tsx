import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appViewKey, panelView, tabKindView, type DockSlot, type ViewKey } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { TooltipProvider } from '@/ui/Tooltip';

import DockBarButton from '../DockBarButton';

const LIBRARY = appViewKey('library');
const FILES = panelView('files');
const PROJECTS = panelView('projects');
const AGENT_CHAT = tabKindView('agent-chat');

interface Handlers {
  onMove?: (view: ViewKey, slot: DockSlot) => void;
  onOpenTab?: (view: ViewKey, slot: DockSlot) => void;
  isTabKindVisible?: (kind: string) => boolean;
}

function renderButton(view: ViewKey, side: DockSlot = 'left', handlers: Handlers = {}): void {
  render(
    <TooltipProvider>
      <DockBarButton
        view={view}
        side={side}
        onMove={handlers.onMove}
        onOpenTab={handlers.onOpenTab}
        isTabKindVisible={handlers.isTabKindVisible}
      />
    </TooltipProvider>,
  );
}

/** 高亮类在装饰性内层 span 上，无 Testing Library 等价查询。 */
function innerSpanOf(label: string): HTMLElement {
  const button = screen.getByRole('button', { name: new RegExp(`^${label}`) });
  // eslint-disable-next-line testing-library/no-node-access
  return button.querySelector('span') as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.getState().setSlotExpanded('right', false);
  useDockStore.getState().activateView(PROJECTS);
});

describe('DockBarButton — 选中态按 activation.kind 分发', () => {
  it('appView 类（Library）：中心视图激活时高亮（它永不进 zone）', () => {
    useAppViewStore.setState({ appView: 'library' });
    renderButton(LIBRARY);

    expect(innerSpanOf('Library').className).toContain('bg-bg-selected');
  });

  it('appView 类：normal 视图下不高亮', () => {
    renderButton(LIBRARY);

    expect(innerSpanOf('Library').className).not.toContain('bg-bg-selected');
  });

  it('toggleZone 类：该视图在其槽内前台且展开时高亮', () => {
    useDockStore.getState().activateView(FILES);
    renderButton(FILES, 'right');

    expect(innerSpanOf('Files').className).toContain('bg-bg-selected');
  });

  it('toggleZone 类：槽被收起后不高亮', () => {
    useDockStore.getState().activateView(FILES);
    useDockStore.getState().setSlotExpanded('right', false);
    renderButton(FILES, 'right');

    expect(innerSpanOf('Files').className).not.toContain('bg-bg-selected');
  });
});

describe('DockBarButton — 点击走 store 的统一 toggleView', () => {
  it('点 Library 切换 appView（与左栏互斥）', () => {
    renderButton(LIBRARY);
    fireEvent.click(screen.getByRole('button', { name: /^Library/ }));

    expect(useAppViewStore.getState().appView).toBe('library');
    expect(useDockStore.getState().zones.left.expanded).toBe(false);
  });

  it('点已在前台的 dock 图标 → 收起该槽', () => {
    useDockStore.getState().activateView(FILES);
    renderButton(FILES, 'right');
    fireEvent.click(screen.getByRole('button', { name: /^Files/ }));

    expect(useDockStore.getState().zones.right.expanded).toBe(false);
  });
});

describe('DockBarButton — 键盘等价操作（Alt+←/→ 换边）', () => {
  it('右栏图标按 Alt+ArrowLeft → 移到左栏', () => {
    const onMove = vi.fn();
    renderButton(FILES, 'right', { onMove });

    fireEvent.keyDown(screen.getByRole('button', { name: /^Files/ }), {
      key: 'ArrowLeft',
      altKey: true,
    });

    expect(onMove).toHaveBeenCalledWith(FILES, 'left');
  });

  it('左栏图标按 Alt+ArrowRight → 移到右栏', () => {
    const onMove = vi.fn();
    renderButton(PROJECTS, 'left', { onMove });

    fireEvent.keyDown(screen.getByRole('button', { name: /^Projects/ }), {
      key: 'ArrowRight',
      altKey: true,
    });

    expect(onMove).toHaveBeenCalledWith(PROJECTS, 'right');
  });

  it('已在目标栏的方向键是 no-op（不能把「移到同槽」解释成追加到末尾）', () => {
    const onMove = vi.fn();
    renderButton(FILES, 'right', { onMove });

    fireEvent.keyDown(screen.getByRole('button', { name: /^Files/ }), {
      key: 'ArrowRight',
      altKey: true,
    });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('不按 Alt / 其它键 → 不触发移动', () => {
    const onMove = vi.fn();
    renderButton(FILES, 'right', { onMove });
    const button = screen.getByRole('button', { name: /^Files/ });

    fireEvent.keyDown(button, { key: 'ArrowLeft' });
    fireEvent.keyDown(button, { key: 'Enter', altKey: true });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('可移动的图标在 aria 上声明可拖动与快捷键', () => {
    renderButton(FILES, 'right');
    const button = screen.getByRole('button', { name: /^Files/ });

    expect(button).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
    expect(button).toHaveAttribute('aria-label', expect.stringContaining('draggable'));
  });
});

describe('DockBarButton — 种类级入口（openTab）', () => {
  it('点击走**注入的** onOpenTab，不碰 store 建 tab（按钮不认识任何 feature 域）', () => {
    const onOpenTab = vi.fn();
    renderButton(AGENT_CHAT, 'right', { onOpenTab });
    const zonesBefore = useDockStore.getState().zones;

    fireEvent.click(screen.getByRole('button', { name: /^Agent Chat/ }));

    expect(onOpenTab).toHaveBeenCalledWith(AGENT_CHAT, 'right');
    // 没有注入的 store 端口被触碰：tab 空间 / 槽运行态都不动
    expect(useEditorStore.getState().tabs).toEqual({});
    expect(useDockStore.getState().zones).toBe(zonesBefore);
  });

  it('没注入 handler 时点击是 no-op（不抛：图标渲染与端口装配解耦）', () => {
    renderButton(AGENT_CHAT, 'right');

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: /^Agent Chat/ })),
    ).not.toThrow();
    expect(useEditorStore.getState().tabs).toEqual({});
  });

  it('选中态由注入的可见性判据给出（openTab 不进 zone，没有别的来源）', () => {
    renderButton(AGENT_CHAT, 'right', { isTabKindVisible: (kind) => kind === 'agent-chat' });

    expect(innerSpanOf('Agent Chat').className).toContain('bg-bg-selected');
  });

  it('该种类的 tab 不可见时不亮（收起宿主里的 tab 不该点亮图标）', () => {
    renderButton(AGENT_CHAT, 'right', { isTabKindVisible: () => false });

    expect(innerSpanOf('Agent Chat').className).not.toContain('bg-bg-selected');
  });

  it('aria 上区分「种类入口」与「工具面板」（读屏用户需要知道点了会发生什么）', () => {
    renderButton(AGENT_CHAT, 'right');

    expect(screen.getByRole('button', { name: /^Agent Chat/ })).toHaveAttribute(
      'aria-label',
      expect.stringContaining('tab entry'),
    );
  });
});
