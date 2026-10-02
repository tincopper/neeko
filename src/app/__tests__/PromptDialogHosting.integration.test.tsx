import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppModals from '@/app/AppModals';
import AppCenter from '@/app/components/AppCenter';
import { resetLibraryState, useLibraryStore } from '@/features/library/store/libraryStore';
import { AppProvider, TerminalInsertProvider } from '@/shared/contexts';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useOverlayStore } from '@/shared/store/overlayStore';

// Center views stubbed: the test cares about「宿主是否随中心视图懒挂载」, not the views themselves.
vi.mock('@/app/components/ProjectWorkspace', () => ({
  default: () => <div data-testid="view-workspace">Workspace</div>,
}));
vi.mock('@/features/settings/components/SettingsView', () => ({
  default: () => <div data-testid="view-settings">Settings</div>,
}));
vi.mock('@/app/dock/wrappers/LibraryPanelWrapper', () => ({
  default: () => <div data-testid="view-library">Library</div>,
}));

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

/**
 * Prompt 弹窗是「store 驱动 + 触发点在状态栏/命令面板」的全局浮层，其渲染点必须在
 * **与中心视图无关**的组合层（`AppShell` → `AppModals`）。历史缺陷：渲染点落在懒挂载的
 * Library 面板里 ⇒ 首次会话不进 Library 时 `variableRequest` 翻起却没有消费者，弹窗不出现、
 * Promise 永久悬挂、插入静默丢失（状态栏 Prompts 的 Fill Variables 正是这样漏掉的）。
 *
 * 本文件把真宿主（`AppModals`）与真中心路由（`AppCenter`）放在同一棵树里，钉住两条不变量：
 * 1. Library 未挂载时弹窗照样渲染（`view-library` 缺席）；
 * 2. 弹窗经 portal 挂在 `document.body`，**不在任何中心视图子树内** —— 因此切到 `settings`
 *    （`AppCenter` 条件渲染、卸载 workspace / library）也不受影响（AC1/AC3）。
 */
describe('prompt 弹窗宿主与中心视图解耦', () => {
  beforeEach(() => {
    resetLibraryState();
    useOverlayStore.getState().reset();
  });

  it.each(['normal', 'settings'] as const)(
    'appView=%s：Library 未挂载时变量表单仍可渲染并在主界面结算',
    async (appView) => {
      useAppViewStore.setState({ appView });
      render(
        <AppProvider value={appValue}>
          <TerminalInsertProvider>
            <AppCenter />
            <AppModals {...NO_PROPS} />
          </TerminalInsertProvider>
        </AppProvider>,
      );

      // 前置：Library 面板确实没有挂载（首次会话从未进入 library 视图）。
      expect(screen.queryByTestId('view-library')).not.toBeInTheDocument();
      const centerTestId = appView === 'settings' ? 'view-settings' : 'view-workspace';
      const centerView = screen.getByTestId(centerTestId);
      expect(centerView).toBeInTheDocument();

      let rendered!: Promise<string | null>;
      // 与状态栏「Fill Variables」同一入口；act 回调必须返回 undefined（见 AppModals.test 注释）。
      act(() => {
        rendered = useLibraryStore.getState().openVariableDialog('hi {{name}}');
      });

      const title = screen.getByText('Fill Variables');
      expect(title).toBeInTheDocument();
      // 弹窗经 Radix portal 挂在 body，不在中心视图子树内 ⇒ 视图切换/卸载不影响宿主。
      // 用 `role=dialog`（Radix Content）+ Testing Library 的 `within` 表达，不直取 node。
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(within(centerView).queryByRole('dialog')).not.toBeInTheDocument();
      expect(within(centerView).queryByText('Fill Variables')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('name'), { target: { value: 'tom' } });
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

      await expect(rendered).resolves.toBe('hi tom');
      expect(useLibraryStore.getState().variableRequest).toBeNull();
      expect(useOverlayStore.getState().count).toBe(0);
    },
  );
});
