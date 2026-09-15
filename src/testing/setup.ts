import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom 未实现 scrollIntoView；文件树「选中即滚动」逻辑会调用它。
// 全局 mock 为 no-op，避免组件内调用抛 "Not implemented" 错误。
if (!HTMLElement.prototype.scrollIntoView) {
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
