import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

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
