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

  it('leaves appView untouched regardless of the left panel', () => {
    useDockStore.setState({ zones: { left: { activePanelId: 'library' } } });
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('does not downgrade a non-normal appView', () => {
    useAppViewStore.setState({ appView: 'settings' });
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('settings');
  });
});
