import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppModals from '@/app/AppModals';
import {
  setCloseConfirmHostMounted,
  useCloseConfirmStore,
} from '@/features/editor/store/closeConfirmStore';
import { resetLibraryState, useLibraryStore } from '@/features/library/store/libraryStore';
import { AppProvider, TerminalInsertProvider } from '@/shared/contexts';
import { useOverlayStore } from '@/shared/store/overlayStore';

vi.mock('@/features/library/api/libraryApi', () => ({
  listPrompts: vi.fn().mockResolvedValue([]),
  savePrompt: vi.fn().mockResolvedValue(undefined),
  updatePrompt: vi.fn().mockResolvedValue(undefined),
  deletePrompt: vi.fn().mockResolvedValue(undefined),
  recordPromptUsage: vi.fn().mockResolvedValue(undefined),
}));

const appValue = {
  config: {} as never,
  customThemes: [],
  agents: [],
  agentInstalledMap: {},
  loading: false,
  ideCommandOverrides: {},
  showToast: vi.fn(),
  saveConfig: async () => {},
};

const NO_PROPS = {} as React.ComponentProps<typeof AppModals>;

/** 用真实 Provider 包裹：AppModals 子树经深路径（`shared/contexts/AppContext`）消费 context，mock 门面拦不住。 */
function renderModals() {
  return render(
    <AppProvider value={appValue}>
      <TerminalInsertProvider>
        <AppModals {...NO_PROPS} />
      </TerminalInsertProvider>
    </AppProvider>,
  );
}

/**
 * `AppModals` 是应用级浮层的唯一组合层（`AppShell.tsx:56`，常驻、与中心视图无关）。
 * 两组断言守同一条不变量：**store 驱动的弹窗必须在这里有渲染点**。渲染点一旦落到
 * 懒挂载的面板里，flag 翻起时就没有消费者 —— 弹窗不出现、Promise 永久悬挂、用户点了
 * 没反应（状态栏 Prompts 的「Fill Variables」正是这样漏掉的）。
 */
describe('AppModals — 全局弹窗宿主', () => {
  beforeEach(() => {
    resetLibraryState();
    useOverlayStore.getState().reset();
    useCloseConfirmStore.setState({ pending: null });
    setCloseConfirmHostMounted(false);
  });

  it('Prompt 弹窗只靠 store flag 即可渲染，无需打开 Library 视图', () => {
    renderModals();

    // act 回调必须返回 undefined：箭头函数若把 `openVariableDialog` 的 Promise 直接 return
    // 出去，act 会当成 async 作用域且不收敛，后续渲染全部丢失（表现为「弹窗不存在」）。
    act(() => {
      useLibraryStore.getState().openVariableDialog('hi {{name}}');
    });
    expect(screen.getByText('Fill Variables')).toBeInTheDocument();

    act(() => {
      useLibraryStore.getState().settleVariableDialog(null);
      useLibraryStore.getState().openEditor();
    });
    expect(screen.getByText('New Prompt')).toBeInTheDocument();

    act(() => {
      useLibraryStore.getState().closeEditor();
      useLibraryStore.getState().openInsert();
    });
    expect(screen.getByPlaceholderText(/Search prompts/)).toBeInTheDocument();
  });

  it('close-confirm 宿主就绪由组合层声明，卸载时在途请求按 cancel 结算', async () => {
    const { unmount } = renderModals();

    let action: string | undefined;
    act(() => {
      useCloseConfirmStore
        .getState()
        .request('a.ts')
        .then((v) => (action = v));
    });
    expect(useCloseConfirmStore.getState().pending).toEqual({ fileName: 'a.ts' });
    expect(useOverlayStore.getState().count).toBe(1);

    unmount();

    await waitFor(() => expect(action).toBe('cancel'));
    expect(useCloseConfirmStore.getState().pending).toBeNull();
    expect(useOverlayStore.getState().count).toBe(0);
  });
});
