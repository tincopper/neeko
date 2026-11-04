import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { appViewKey, panelView } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';

import { useAppGlobalEffects } from '../useAppGlobalEffects';

describe('useAppGlobalEffects', () => {
  beforeEach(() => {
    useAppViewStore.setState({ appView: 'normal' });
    useDockStore.getState().activateView(panelView('projects'));
  });

  it('leaves appView untouched regardless of the left panel', () => {
    // 左栏前台是 Library 入口（host:'none'，只上 bar）也不该把 appView 推成 library
    useDockStore.getState().activateView(appViewKey('library'));
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('does not downgrade a non-normal appView', () => {
    useAppViewStore.setState({ appView: 'settings' });
    renderHook(() => useAppGlobalEffects());
    expect(useAppViewStore.getState().appView).toBe('settings');
  });
});
