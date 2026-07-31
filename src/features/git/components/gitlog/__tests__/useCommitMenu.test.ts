import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { useCommitMenu } from '../useCommitMenu';

afterEach(() => {
  cleanup();
  document.body.replaceChildren(); // 移除测试手动挂载的菜单/外部元素
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCommitMenu', () => {
  it('初始 menuOpen 为 null', () => {
    const { result } = renderHook(() => useCommitMenu());
    expect(result.current.menuOpen).toBeNull();
    expect(result.current.isMenuOpen('abc')).toBe(false);
  });

  it('openMenu 打开指定 commit 的菜单，closeMenu 关闭', () => {
    const { result } = renderHook(() => useCommitMenu());
    act(() => {
      result.current.openMenu('abc');
    });
    expect(result.current.menuOpen).toBe('abc');
    expect(result.current.isMenuOpen('abc')).toBe(true);
    expect(result.current.isMenuOpen('def')).toBe(false);
    act(() => {
      result.current.closeMenu();
    });
    expect(result.current.menuOpen).toBeNull();
  });

  it('openMenu 切换：点开另一个 commit 直接替换', () => {
    const { result } = renderHook(() => useCommitMenu());
    act(() => {
      result.current.openMenu('abc');
    });
    act(() => {
      result.current.openMenu('def');
    });
    expect(result.current.menuOpen).toBe('def');
    expect(result.current.isMenuOpen('abc')).toBe(false);
  });

  it('点击菜单内部不关闭', () => {
    const { result } = renderHook(() => useCommitMenu());
    act(() => {
      result.current.openMenu('abc');
    });
    const menuEl = document.createElement('div');
    document.body.appendChild(menuEl);
    result.current.menuRef.current = menuEl;
    const itemEl = document.createElement('button');
    menuEl.appendChild(itemEl);
    act(() => {
      menuEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    // target 在 menu 子树内 → 不关闭
    expect(result.current.menuOpen).toBe('abc');
  });

  it('外部点击（menu 之外的元素）关闭菜单', () => {
    const { result } = renderHook(() => useCommitMenu());
    act(() => {
      result.current.openMenu('abc');
    });
    const menuEl = document.createElement('div');
    document.body.appendChild(menuEl);
    result.current.menuRef.current = menuEl;
    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);
    act(() => {
      outsideEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.menuOpen).toBeNull();
  });

  it('menuOpen 为 null 时不挂 mousedown 监听', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const { rerender } = renderHook(() => useCommitMenu());
    expect(addSpy).not.toHaveBeenCalledWith('mousedown', expect.any(Function));
    rerender();
    expect(addSpy).not.toHaveBeenCalledWith('mousedown', expect.any(Function));
  });

  it('卸载时移除 mousedown 监听', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useCommitMenu());
    act(() => {
      result.current.openMenu('abc');
    });
    expect(addSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });
});
