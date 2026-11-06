import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';

// Mock the three center views so the routing test focuses on which one mounts.
vi.mock('@/app/components/ProjectView', () => ({
  default: () => <div data-testid="view-workspace">Workspace</div>,
}));
vi.mock('@/features/settings/components/SettingsView', () => ({
  default: () => <div data-testid="view-settings">Settings</div>,
}));
// 探针：把子树看到的可见性写进 DOM —— AppCenter 的职责只是「声明可见性」，
// 拉取门控由子树（LibraryPanel / SkillContent）自己按 `useVisible()` 做。
vi.mock('@/app/dock/wrappers/LibraryPanelWrapper', async () => {
  const { useVisible } = await import('@/shared/contexts');
  const Probe = () => <div data-testid="view-library" data-visible={String(useVisible())} />;
  return { default: Probe };
});

import AppCenter from '../AppCenter';

/** hidden 是独立 class；包装层 className 恒含 overflow-hidden，不能用字符串包含判断。 */
// eslint-disable-next-line testing-library/no-node-access
const isHidden = (el: HTMLElement) => el.parentElement?.classList.contains('hidden') ?? false;

describe('AppCenter — single-source center routing (appViewStore)', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
    vi.restoreAllMocks();
  });

  it('renders ProjectView for the normal view, with Library pre-mounted hidden', async () => {
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-settings')).not.toBeInTheDocument();
    // Library 子树启动即挂载（hidden）：首进切换不经过 lazy 挂载间隙
    const library = await screen.findByTestId('view-library');
    expect(isHidden(library)).toBe(true);
  });

  it('首进 Library 不重挂载：normal → library 只切 hidden，DOM 节点保持不变', async () => {
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    const library = await screen.findByTestId('view-library');
    expect(isHidden(library)).toBe(true);

    act(() => useAppViewStore.setState({ appView: 'library' }));
    // 同一 DOM 节点 ⇒ 没有卸载 / 重新挂载，也就没有首帧空绘制
    expect(screen.getByTestId('view-library')).toBe(library);
    expect(isHidden(library)).toBe(false);
  });

  it('向 Library 子树声明可见性：隐藏态 false、激活态 true', async () => {
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    // 常驻挂载 ≠ 可见：子树据此门控 mount 拉取，启动期不花 IPC
    expect(await screen.findByTestId('view-library')).toHaveAttribute('data-visible', 'false');

    act(() => useAppViewStore.setState({ appView: 'library' }));
    expect(screen.getByTestId('view-library')).toHaveAttribute('data-visible', 'true');
  });

  it('renders SettingsView only when appView is settings', () => {
    useAppViewStore.setState({ appView: 'settings' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('view-workspace')).not.toBeInTheDocument();
  });

  it('renders LibraryPanel when appView is library', async () => {
    useAppViewStore.setState({ appView: 'library' });
    render(<AppCenter />);
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();
    // 工作区常驻但隐藏（hidden 类在无语义包装层上，无 Testing Library 等价查询）
    expect(isHidden(screen.getByTestId('view-workspace'))).toBe(true);
  });

  it('keeps Library mounted (hidden) after switching away — no remount flash', async () => {
    useAppViewStore.setState({ appView: 'library' });
    const { rerender } = render(<AppCenter />);
    const library = await screen.findByTestId('view-library');

    act(() => useAppViewStore.setState({ appView: 'normal' }));
    rerender(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    // 常驻：切走后仍在 DOM（hidden），再进无需重挂载
    expect(screen.getByTestId('view-library')).toBe(library);
    expect(isHidden(library)).toBe(true);
  });
});
