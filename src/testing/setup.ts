import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

import { installTimerTracking } from './timers';

// 文件结束时取消本文件所有挂起的定时器 / RAF。为什么必须这样做、以及为什么是"取消"而不是
// "等一个宏任务"，见 `timers.ts` 的模块注释：Radix 弹层的卸载事件、终端与布局的 RAF 测量都排在
// 宏任务上，会在 jsdom 环境销毁之后触发（全局 Event 已还原成 Node 原生实现 ⇒ brand check 抛错），
// 没有任何用例失败却让整轮 vitest 判红。
const timerTracking = installTimerTracking();

afterEach(() => {
  cleanup();
  // 伪时钟不跨用例泄漏：它下面排的宏任务永远不会跑，会把后续用例的时序搅乱。
  vi.useRealTimers();
});

afterAll(() => {
  vi.useRealTimers();
  timerTracking.releaseAll();
});

// jsdom 未实现 scrollIntoView；文件树「选中即滚动」逻辑会调用它。
// 全局 mock 为 no-op，避免组件内调用抛 "Not implemented" 错误。
// typeof 守卫：@vitest-environment node 的纯逻辑测试无 DOM 全局，直接引用会 ReferenceError。
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView =
    vi.fn() as unknown as typeof HTMLElement.prototype.scrollIntoView;
}

// jsdom 未实现 ResizeObserver；@tanstack/react-virtual（OutputScroll 虚拟滚动）测量容器时依赖它。
// 全局 mock 为 no-op，避免组件挂载时抛 "ResizeObserver is not defined" 错误。
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom 未实现 Range 的几何测量；CodeMirror 的测量周期（scrollIntoView / 光标定位）会调用它。
// 缺失时会在**异步测量周期**里抛 `textRange(...).getClientRects is not a function` ——
// 表现为"用例通过但报 unhandled error"，还会污染后续断言的可信度。
if (typeof Range !== 'undefined') {
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }) as DOMRect;
  }
}

// 全局 mock：@tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

// 全局 mock：@tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// 全局 mock：@tauri-apps/api/window
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    isFullscreen: vi.fn(() => Promise.resolve(false)),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
    onResized: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// 全局 mock：@tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

// Mock asset imports (Vite transforms these to URLs in production)
vi.mock('*.png', () => ({ default: 'mock-png-url' }));
vi.mock('*.svg', () => ({ default: 'mock-svg-url' }));
