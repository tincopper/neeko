import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';

import { useAppGlobalEffects } from '../useAppGlobalEffects';

describe('useAppGlobalEffects', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
    useDockStore.setState({ zones: { left: { activePanelId: 'projects' } } });
  });

  it('syncs a persisted skills left-panel to appView at startup', () => {
    useDockStore.setState({ zones: { left: { activePanelId: 'skills' } } });
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('skills');
  });

  it('leaves appView untouched when the left panel is not skills', () => {
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('does not downgrade a non-normal appView', () => {
    useAppViewStore.setState({ appView: 'settings' });
    useDockStore.setState({ zones: { left: { activePanelId: 'skills' } } });
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('settings');
  });
});
