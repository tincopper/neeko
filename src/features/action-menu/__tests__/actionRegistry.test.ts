// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLibraryState, useLibraryStore } from '@/features/library/store/libraryStore';
import { useOverlayStore } from '@/shared/store/overlayStore';

import { getActionMenuItems } from '../actionRegistry';
import type { ActionContext } from '../types/actionMenu';

const baseCtx: ActionContext = {
  projectId: 'proj-1',
  tabKey: 'proj-1',
  agents: [],
  recentFiles: [],
  closeMenu: () => {},
};

describe('getActionMenuItems — new-browser entry', () => {
  it('includes the new-browser action in the browser group', () => {
    const items = getActionMenuItems(baseCtx);

    const browser = items.find((i) => i.id === 'new-browser');
    expect(browser).toBeDefined();
    expect(browser?.group).toBe('browser');
    expect(browser?.label).toBe('New Browser');
    expect(browser?.keywords).toContain('browser');
  });

  it('new-browser is always visible (no project/agent gating)', () => {
    const items = getActionMenuItems({ ...baseCtx, projectId: null, agents: [] });

    expect(items.some((i) => i.id === 'new-browser')).toBe(true);
  });

  it('new-browser matches the browser keyword filter', () => {
    const items = getActionMenuItems(baseCtx);

    const browser = items.find((i) => i.id === 'new-browser')!;
    expect(browser.keywords.some((k) => k.includes('browser') || k.includes('web'))).toBe(true);
  });
});

/**
 * 弹窗宿主已上收到 `AppModals`（见 `PromptDialogHost`），因此 prompt 命令就地打开即可，
 * 不该再把用户的工作区换成 Library 视图。`new-prompt` 此前被折叠成插入选择器（打开的不是表单）。
 */
describe('getActionMenuItems — prompt 命令就地打开弹窗', () => {
  beforeEach(() => {
    resetLibraryState();
    useOverlayStore.getState().reset();
  });

  function run(id: string, openLibrary = vi.fn()) {
    const ctx: ActionContext = { ...baseCtx, openLibrary, closeMenu: vi.fn() };
    getActionMenuItems(ctx)
      .find((i) => i.id === id)!
      .execute(ctx);
    return { state: useLibraryStore.getState(), openLibrary };
  }

  it('new-prompt 打开编辑表单，且不切换中心视图', () => {
    const { state, openLibrary } = run('new-prompt');

    expect(state.editorOpen).toBe(true);
    expect(state.editorKind).toBe('prompt');
    expect(state.insertOpen).toBe(false);
    expect(openLibrary).not.toHaveBeenCalled();
  });

  it('insert-prompt 打开插入选择器，且不切换中心视图', () => {
    const { state, openLibrary } = run('insert-prompt');

    expect(state.insertOpen).toBe(true);
    expect(state.editorOpen).toBe(false);
    expect(openLibrary).not.toHaveBeenCalled();
  });

  it('open-resource-library 仍是纯导航（打开 Library 视图，不弹表单）', () => {
    const { state, openLibrary } = run('open-resource-library');

    expect(openLibrary).toHaveBeenCalledWith({});
    expect(state.editorOpen).toBe(false);
    expect(state.insertOpen).toBe(false);
  });
});
