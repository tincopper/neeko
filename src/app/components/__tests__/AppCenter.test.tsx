import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useAppViewStore } from '@/shared/store/appViewStore';

// Mock the three center views so the routing test focuses on which one mounts.
vi.mock('@/app/components/ProjectWorkspace', () => ({
  default: () => <div data-testid="view-workspace">Workspace</div>,
}));
vi.mock('@/features/settings/components/SettingsView', () => ({
  default: () => <div data-testid="view-settings">Settings</div>,
}));
vi.mock('@/app/dock/wrappers/LibraryPanelWrapper', () => ({
  default: () => <div data-testid="view-library">Library</div>,
}));

import AppCenter from '../AppCenter';

describe('AppCenter — single-source center routing (appViewStore)', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
    vi.restoreAllMocks();
  });

  it('renders ProjectWorkspace for the normal view', () => {
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-library')).not.toBeInTheDocument();
  });

  it('renders SettingsView only when appView is settings', () => {
    useAppViewStore.setState({ appView: 'settings' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('view-workspace')).not.toBeInTheDocument();
  });

  it('renders LibraryPanel when appView is library', async () => {
    vi.spyOn(useLibraryStore.getState(), 'refreshPrompts').mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'library' });
    render(<AppCenter />);
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();
    // 工作区常驻但隐藏（hidden 类在无语义包装层上，无 Testing Library 等价查询）
    // eslint-disable-next-line testing-library/no-node-access
    expect(screen.getByTestId('view-workspace').parentElement?.className).toContain('hidden');
  });

  it('keeps Library mounted (hidden) after switching away — no remount flash', async () => {
    vi.spyOn(useLibraryStore.getState(), 'refreshPrompts').mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'library' });
    const { rerender } = render(<AppCenter />);
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();

    useAppViewStore.setState({ appView: 'normal' });
    rerender(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    // 常驻：切走后仍在 DOM（hidden），再进无需重挂载
    expect(screen.getByTestId('view-library')).toBeInTheDocument();
  });

  it('refreshes library data in the background on activation', async () => {
    const refreshSpy = vi
      .spyOn(useLibraryStore.getState(), 'refreshPrompts')
      .mockResolvedValue(undefined);
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    expect(refreshSpy).not.toHaveBeenCalled();

    useAppViewStore.setState({ appView: 'library' });
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalled();
  });
});
