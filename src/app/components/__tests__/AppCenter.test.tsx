import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';

// Mock the four center views so the routing test focuses on which one mounts.
vi.mock('@/app/components/ProjectWorkspace', () => ({
  default: () => <div data-testid="view-workspace">Workspace</div>,
}));
vi.mock('@/features/settings/components/SettingsView', () => ({
  default: () => <div data-testid="view-settings">Settings</div>,
}));
vi.mock('@/features/skill/components/SkillContent', () => ({
  default: () => <div data-testid="view-skills">Skills</div>,
}));
vi.mock('@/app/dock/wrappers/LibraryPanelWrapper', () => ({
  default: () => <div data-testid="view-library">Library</div>,
}));

import AppCenter from '../AppCenter';

describe('AppCenter — single-source center routing (appViewStore)', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
  });

  it('renders ProjectWorkspace for the normal view', () => {
    useAppViewStore.setState({ appView: 'normal' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-skills')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-library')).not.toBeInTheDocument();
  });

  it('renders SettingsView only when appView is settings', () => {
    useAppViewStore.setState({ appView: 'settings' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('view-workspace')).not.toBeInTheDocument();
  });

  it('renders SkillContent only when appView is skills (activation-only mount)', () => {
    useAppViewStore.setState({ appView: 'skills' });
    render(<AppCenter />);
    expect(screen.getByTestId('view-skills')).toBeInTheDocument();
    // ProjectWorkspace stays keep-mounted (hidden) so toggling back is cheap
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-library')).not.toBeInTheDocument();
  });

  it('renders LibraryPanel when appView is library', async () => {
    useAppViewStore.setState({ appView: 'library' });
    render(<AppCenter />);
    expect(await screen.findByTestId('view-library')).toBeInTheDocument();
    expect(screen.queryByTestId('view-workspace')).not.toBeInTheDocument();
  });

  it('switches views reactively when appView changes', () => {
    useAppViewStore.setState({ appView: 'skills' });
    const { rerender } = render(<AppCenter />);
    expect(screen.getByTestId('view-skills')).toBeInTheDocument();

    useAppViewStore.setState({ appView: 'normal' });
    rerender(<AppCenter />);
    expect(screen.getByTestId('view-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-skills')).not.toBeInTheDocument();
  });
});
