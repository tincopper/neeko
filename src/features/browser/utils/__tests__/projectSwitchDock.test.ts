// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { panelView, type ViewKey } from '@/shared/dock';

import {
  BROWSER_VIEW,
  decideProjectSwitchDock,
  type RightSlotSnapshot,
} from '../projectSwitchDock';

const FILES = panelView('files');
const GIT = panelView('gitControl');

function right(partial: Partial<RightSlotSnapshot> = {}): RightSlotSnapshot {
  return {
    views: [FILES, GIT, BROWSER_VIEW],
    activeView: BROWSER_VIEW,
    expanded: true,
    ...partial,
  };
}

describe('decideProjectSwitchDock — 项目切换时的右侧 dock 决策', () => {
  // ── 目标项目浏览器已开启 ──
  it('浏览器已开启且右槽前台就是浏览器 → 不调整', () => {
    expect(decideProjectSwitchDock(right(), true)).toEqual({ type: 'none' });
  });

  it('浏览器已开启且前台是别的视图 → 激活浏览器（切回去恢复开启）', () => {
    expect(decideProjectSwitchDock(right({ activeView: FILES }), true)).toEqual({
      type: 'activate',
      view: BROWSER_VIEW,
    });
  });

  /**
   * v6 之后「面板不在任何 zone 里」不可表示：用户把浏览器图标移到左栏是**布局决定**，
   * 切项目不该把它拽回右槽（旧实现的 add-and-activate 分支已随之删除）。
   */
  it('浏览器被用户移到别的槽 → 不动布局', () => {
    expect(
      decideProjectSwitchDock(right({ views: [FILES, GIT], activeView: FILES }), true),
    ).toEqual({ type: 'none' });
  });

  it('浏览器已开启但右侧收起 → 不打扰用户布局', () => {
    expect(decideProjectSwitchDock(right({ expanded: false }), true)).toEqual({ type: 'none' });
  });

  // ── 目标项目浏览器未开启 ──
  it('浏览器未开启且右槽前台是浏览器 → 切到右槽内第一个非浏览器视图', () => {
    expect(decideProjectSwitchDock(right(), false)).toEqual({ type: 'activate', view: FILES });
  });

  it('浏览器未开启且右侧只剩浏览器 → 收起右侧', () => {
    expect(
      decideProjectSwitchDock(right({ views: [BROWSER_VIEW], activeView: BROWSER_VIEW }), false),
    ).toEqual({ type: 'collapse' });
  });

  it('浏览器未开启且前台是别的视图 → 不调整', () => {
    expect(decideProjectSwitchDock(right({ activeView: FILES }), false)).toEqual({
      type: 'none',
    });
  });

  it('浏览器未开启且右侧收起 → 不调整', () => {
    expect(decideProjectSwitchDock(right({ expanded: false }), false)).toEqual({
      type: 'none',
    });
  });

  it('回退目标必须是右槽内真实存在的视图（不构造新 ViewKey）', () => {
    const action = decideProjectSwitchDock(right(), false);
    if (action.type !== 'activate') throw new Error('expected activate');
    expect(right().views as ViewKey[]).toContain(action.view);
  });
});
