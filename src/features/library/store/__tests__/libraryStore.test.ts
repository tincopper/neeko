import { beforeEach, describe, expect, it } from 'vitest';

import { resetLibraryState, useLibraryStore } from '../libraryStore';

describe('libraryStore navSize（面板内分栏统一标准）', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLibraryState();
  });

  it('默认 18，与应用侧栏比例一致', () => {
    expect(useLibraryStore.getState().navSize).toBe(18);
  });

  it('setNavSize 写入拖动提交的百分比', () => {
    useLibraryStore.getState().setNavSize(25.5);
    expect(useLibraryStore.getState().navSize).toBe(25.5);
  });

  it('resetLibraryState 恢复默认宽度', () => {
    useLibraryStore.getState().setNavSize(30);
    resetLibraryState();
    expect(useLibraryStore.getState().navSize).toBe(18);
  });
});
