import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetLibraryState,
  setPromptDialogHostMounted,
  useLibraryStore,
} from '@/features/library/store/libraryStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import type { PromptResource } from '@/shared/types/library';

const hoisted = vi.hoisted(() => ({
  toast: vi.fn(),
  api: {
    current: {} as {
      insertToTerminal?: (text: string) => boolean;
      insertToAgentInput?: (text: string) => void;
    },
  },
}));

vi.mock('@/shared/contexts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/contexts')>();
  return {
    ...actual,
    useTerminalInsert: () => ({ api: hoisted.api.current, register: vi.fn(() => () => {}) }),
    useAppContext: () => ({ showToast: hoisted.toast }),
  };
});

vi.mock('@/features/library/api/libraryApi', () => ({
  listPrompts: vi.fn().mockResolvedValue([]),
  savePrompt: vi.fn().mockResolvedValue(undefined),
  updatePrompt: vi.fn().mockResolvedValue(undefined),
  deletePrompt: vi.fn().mockResolvedValue(undefined),
  recordPromptUsage: vi.fn().mockResolvedValue(undefined),
}));

import PromptDialogHost from '../PromptDialogHost';

function promptFixture(over: Partial<PromptResource> & { id: string }): PromptResource {
  return {
    name: `prompt-${over.id}`,
    description: null,
    content: `content-${over.id}`,
    slash: null,
    tags: [],
    scope: 'global',
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

/**
 * 宿主存在的理由：三个 prompt 弹窗的开关是**全局 store 状态**，触发点却不只在 Library 视图
 * （状态栏 Prompts chip、命令面板）。渲染点一旦落在懒挂载的 `LibraryPanel` 里，flag 翻起时
 * 没有消费者 ⇒ 弹窗不出现、`openVariableDialog` 的 Promise 永久悬挂、插入静默丢失。
 * 下列用例即该缺陷（store 驱动弹窗必须有应用级唯一渲染点）的回归守卫 —— 全部**不挂** LibraryPanel。
 */
describe('PromptDialogHost — prompt 弹窗的唯一渲染点', () => {
  beforeEach(() => {
    resetLibraryState();
    setPromptDialogHostMounted(false);
    useOverlayStore.getState().reset();
    hoisted.api.current = {};
    hoisted.toast.mockClear();
  });

  it('仅凭变量请求即渲染 Fill Variables 表单，确认后回传渲染文本', async () => {
    render(<PromptDialogHost />);

    let rendered!: Promise<string | null>;
    act(() => {
      rendered = useLibraryStore.getState().openVariableDialog('hi {{name}}');
    });

    const form = await screen.findByText('Fill Variables');
    expect(form).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'tom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    await expect(rendered).resolves.toBe('hi tom');
    expect(useLibraryStore.getState().variableRequest).toBeNull();
  });

  it('仅凭 editorOpen 即渲染 prompt 编辑表单', () => {
    render(<PromptDialogHost />);

    act(() => {
      useLibraryStore.setState({ editorOpen: true, editorKind: 'prompt' });
    });

    expect(screen.getByText('New Prompt')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('仅凭 insertOpen 即渲染插入选择器并列出 prompts', () => {
    render(<PromptDialogHost />);

    act(() => {
      useLibraryStore.setState({
        insertOpen: true,
        prompts: [promptFixture({ id: 'p1', name: 'Review' })],
      });
    });

    expect(screen.getByPlaceholderText(/Search prompts/)).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  /**
   * 选择器必须先关再投递：含 `{{var}}` 的 prompt 投递会立刻拉起变量表单，两个 modal
   * 同帧共存会互抢焦点陷阱（Radix modal 的 focus trap 只能有一个活动宿主）。
   */
  it('选择器选中含 {{var}} 的项：先关选择器，再弹变量表单', async () => {
    const insertToAgentInput = vi.fn();
    hoisted.api.current = { insertToAgentInput };
    render(<PromptDialogHost />);

    act(() => {
      useLibraryStore.setState({
        insertOpen: true,
        prompts: [promptFixture({ id: 'p1', name: 'Review', content: 'hi {{name}}' })],
      });
    });

    // 左键 = 插入 agent（右键 / Shift+Enter 才是 terminal），见该行的 title 提示。
    fireEvent.click(screen.getByText('Review'));

    expect(useLibraryStore.getState().insertOpen).toBe(false);
    expect(screen.queryByPlaceholderText(/Search prompts/)).not.toBeInTheDocument();
    expect(await screen.findByText('Fill Variables')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    // 投递在 openVariableDialog 的 `.then` 微任务里，必须等它跑完。
    await waitFor(() => expect(insertToAgentInput).toHaveBeenCalledWith('hi {{name}}'));
  });

  it('取消变量表单结算为 null 并清空请求', async () => {
    render(<PromptDialogHost />);

    let rendered!: Promise<string | null>;
    act(() => {
      rendered = useLibraryStore.getState().openVariableDialog('hi {{name}}');
    });
    await screen.findByText('Fill Variables');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(rendered).resolves.toBeNull();
    expect(useLibraryStore.getState().variableRequest).toBeNull();
  });

  it('宿主未挂载时请求立即结算为 null（fail-closed，绝不悬挂）', async () => {
    const rendered = await useLibraryStore.getState().openVariableDialog('hi {{name}}');

    expect(rendered).toBeNull();
    expect(useLibraryStore.getState().variableRequest).toBeNull();
  });

  it('宿主卸载时在途请求按 null 结算（await 方不得永久挂起）', async () => {
    const { unmount } = render(<PromptDialogHost />);

    let rendered!: Promise<string | null>;
    act(() => {
      rendered = useLibraryStore.getState().openVariableDialog('hi {{name}}');
    });
    expect(useLibraryStore.getState().variableRequest).toBe('hi {{name}}');

    unmount();

    await expect(rendered).resolves.toBeNull();
    expect(useLibraryStore.getState().variableRequest).toBeNull();
  });

  it('三个弹窗打开期间上报浮层、关闭后撤销（Browser 子 webview 的 z-order 依据）', () => {
    const { unmount } = render(<PromptDialogHost />);

    act(() => {
      useLibraryStore.getState().openVariableDialog('hi {{name}}');
    });
    expect(useOverlayStore.getState().open['prompt-variables']).toBe(true);
    act(() => {
      useLibraryStore.getState().settleVariableDialog(null);
    });
    expect(useOverlayStore.getState().open['prompt-variables']).toBe(false);

    act(() => {
      useLibraryStore.getState().openEditor();
    });
    expect(useOverlayStore.getState().open['prompt-editor']).toBe(true);
    act(() => {
      useLibraryStore.getState().closeEditor();
    });
    expect(useOverlayStore.getState().open['prompt-editor']).toBe(false);

    act(() => {
      useLibraryStore.getState().openInsert();
    });
    expect(useOverlayStore.getState().open['prompt-insert']).toBe(true);
    act(() => {
      useLibraryStore.getState().closeInsert();
    });
    expect(useOverlayStore.getState().open['prompt-insert']).toBe(false);

    expect(useOverlayStore.getState().count).toBe(0);
    unmount();
  });
});
