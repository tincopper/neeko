import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDockBarButtons } from '@/app/hooks/UseDockBarButtons';
import { useDockBarMove, type DockBarMovePorts } from '@/app/hooks/useDockBarMove';
import DockBar from '@/layout/dock-layout/DockBar';
import DockBarDnd from '@/layout/dock-layout/DockBarDnd';
import { appViewKey, panelView, type ViewKey } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';

/**
 * 键盘换边的**焦点保持**（真实两栏 + 真实按钮 + 真实 store）。
 *
 * 缺陷形态：`Alt+←/→` 换边后图标在另一条栏重新挂载 → 原 `<button>` 被卸载 → 焦点掉到
 * `body`，键盘用户失去位置（连按两次方向键就再也对不上目标）。交接在
 * `dockBarFocusHandoff`（模块级单次消费），只由键盘端口写入。
 */

const PROJECTS = panelView('projects');
const FILES = panelView('files');
const LIBRARY = appViewKey('library');

const slotOf = (view: ViewKey) => useDockStore.getState().placements[view].slot;
const button = (label: RegExp) => screen.getByRole('button', { name: label });

/** 组合根里这两个端口分别注入给按钮（键盘）与 DockLayout（拖拽）。 */
interface PortsRef {
  current: DockBarMovePorts | null;
}

/**
 * 与组合根同构的装配：一条 hook 出两个端口，键盘端口给按钮、拖拽端口给 DndContext。
 */
function DockBars({ portsRef }: { portsRef: PortsRef }) {
  const { moveView, moveViewByKeyboard } = useDockBarMove();
  const leftBarItems = useDockBarButtons('left', { onMove: moveViewByKeyboard });
  const rightBarItems = useDockBarButtons('right', { onMove: moveViewByKeyboard });

  useEffect(() => {
    portsRef.current = { moveView, moveViewByKeyboard };
  }, [moveView, moveViewByKeyboard, portsRef]);

  return (
    <DockBarDnd leftBarItems={leftBarItems} rightBarItems={rightBarItems} onMoveView={moveView}>
      <DockBar side="left" items={leftBarItems} />
      <DockBar side="right" items={rightBarItems} />
    </DockBarDnd>
  );
}

const portsRef = (): PortsRef => ({ current: null });

beforeEach(() => {
  localStorage.clear();
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
});

describe('键盘换边后的焦点保持', () => {
  it('连按两次 Alt+→ 移动两个不同图标，焦点始终跟着被移动的那个', () => {
    render(<DockBars portsRef={portsRef()} />);

    // ── 第一次：左栏的 Projects 移到右栏 ──
    expect(slotOf(PROJECTS)).toBe('left');
    button(/^Projects/).focus();
    fireEvent.keyDown(button(/^Projects/), { key: 'ArrowRight', altKey: true });

    expect(slotOf(PROJECTS)).toBe('right');
    // 焦点落在**换边后新挂载**的那一个按钮上（不是残留的 body）
    expect(button(/^Projects/)).toHaveFocus();

    // ── 第二次：左栏剩下的 Library 移到右栏（同样的按键序列必须还能走通） ──
    expect(slotOf(LIBRARY)).toBe('left');
    button(/^Library/).focus();
    fireEvent.keyDown(button(/^Library/), { key: 'ArrowRight', altKey: true });

    expect(slotOf(LIBRARY)).toBe('right');
    expect(button(/^Library/)).toHaveFocus();
  });

  it('鼠标拖拽落位不抢焦点（交接只在键盘路径登记）', () => {
    const ports = portsRef();
    render(<DockBars portsRef={ports} />);

    button(/^Library/).focus();

    act(() => ports.current?.moveView(FILES, 'left'));

    expect(slotOf(FILES)).toBe('left'); // 图标确实在左栏重新挂载了
    expect(button(/^Library/)).toHaveFocus(); // 但焦点仍在用户原来的位置
  });

  it('交接是单次的：之后无关的重挂载不再把焦点抢回去', () => {
    const ports = portsRef();
    render(<DockBars portsRef={ports} />);

    button(/^Projects/).focus();
    fireEvent.keyDown(button(/^Projects/), { key: 'ArrowRight', altKey: true });
    expect(button(/^Projects/)).toHaveFocus();

    // 用户自己换了位置，随后另一个图标因落位变化重新挂载 —— 不得抢回焦点
    button(/^Files/).focus();
    act(() => ports.current?.moveView(LIBRARY, 'right'));

    expect(button(/^Files/)).toHaveFocus();
  });
});
