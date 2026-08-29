import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useZoneExpandCollapse } from '../useZoneExpandCollapse';

interface FakePanel {
  expand: ReturnType<typeof vi.fn>;
  collapse: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
}

function makePanelRef(): { ref: RefObject<FakePanel | null>; panel: FakePanel } {
  const panel: FakePanel = { expand: vi.fn(), collapse: vi.fn(), resize: vi.fn() };
  const ref: RefObject<FakePanel | null> = { current: panel };
  return { ref, panel };
}

/**
 * 受控 rAF：帧回调进入队列、手动逐帧 flush —— 可验证「双帧延迟」与「effect
 * 清理取消挂起帧」两个时序语义。同步执行的 rAF stub（cb 立即触发）无法区分
 * 「尚未执行」与「已被取消」，覆盖不了迟到 resize 竞态。
 */
function createRafController() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const raf = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, cb);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    pending.delete(id);
  });
  return {
    raf,
    cancel,
    flush(frames: number) {
      for (let i = 0; i < frames; i += 1) {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const cb of callbacks) cb(0);
      }
    },
    pendingCount: () => pending.size,
  };
}

let raf: ReturnType<typeof createRafController>;

describe('useZoneExpandCollapse', () => {
  beforeEach(() => {
    raf = createRafController();
    vi.stubGlobal('requestAnimationFrame', raf.raf);
    vi.stubGlobal('cancelAnimationFrame', raf.cancel);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('expanded 翻转 false → collapse（不 expand / 不 resize）', () => {
    const { ref, panel } = makePanelRef();
    const { rerender } = renderHook(({ expanded }) => useZoneExpandCollapse(ref, expanded, 18), {
      initialProps: { expanded: true },
    });
    rerender({ expanded: false });
    expect(panel.collapse).toHaveBeenCalledTimes(1);
    expect(panel.expand).not.toHaveBeenCalled();
    expect(panel.resize).not.toHaveBeenCalled();
  });

  it('expanded 未翻转 → 不触发任何命令（prev ref 守卫）', () => {
    const { ref, panel } = makePanelRef();
    const { rerender } = renderHook(({ expanded }) => useZoneExpandCollapse(ref, expanded, 18), {
      initialProps: { expanded: true },
    });
    rerender({ expanded: true });
    expect(panel.expand).not.toHaveBeenCalled();
    expect(panel.collapse).not.toHaveBeenCalled();
  });

  it('panelRef 为空时不崩溃', () => {
    const ref: RefObject<FakePanel | null> = { current: null };
    const { rerender } = renderHook(({ expanded }) => useZoneExpandCollapse(ref, expanded, 18), {
      initialProps: { expanded: true },
    });
    expect(() => rerender({ expanded: false })).not.toThrow();
  });

  it('展开 → 双帧后才 resize(targetSize%)（首帧 settle、次帧 first paint）', () => {
    const { ref, panel } = makePanelRef();
    const { rerender } = renderHook(({ expanded }) => useZoneExpandCollapse(ref, expanded, 18), {
      initialProps: { expanded: false },
    });
    rerender({ expanded: true });
    expect(panel.expand).toHaveBeenCalledTimes(1);
    // 只有外层帧挂起；内层帧在外层回调执行时才入队
    expect(raf.pendingCount()).toBe(1);
    raf.flush(1);
    expect(raf.pendingCount()).toBe(1);
    expect(panel.resize).not.toHaveBeenCalled();
    raf.flush(1);
    expect(panel.resize).toHaveBeenCalledWith('18%');
  });

  it('展开后立即折叠：挂起的迟到 resize 被取消（不把面板重新撑开）', () => {
    const { ref, panel } = makePanelRef();
    const { rerender } = renderHook(({ expanded }) => useZoneExpandCollapse(ref, expanded, 18), {
      initialProps: { expanded: false },
    });
    rerender({ expanded: true });
    rerender({ expanded: false });
    expect(panel.collapse).toHaveBeenCalledTimes(1);
    raf.flush(5);
    expect(panel.resize).not.toHaveBeenCalled();
  });

  it('卸载：挂起的迟到 resize 被取消', () => {
    const { ref, panel } = makePanelRef();
    const { rerender, unmount } = renderHook(
      ({ expanded }) => useZoneExpandCollapse(ref, expanded, 18),
      { initialProps: { expanded: false } },
    );
    rerender({ expanded: true });
    unmount();
    raf.flush(5);
    expect(panel.resize).not.toHaveBeenCalled();
  });
});
