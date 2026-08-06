import { describe, expect, it } from 'vitest';

import { decideProjectSwitchDock, type RightZoneSnapshot } from '../projectSwitchDock';

function right(partial: Partial<RightZoneSnapshot> = {}): RightZoneSnapshot {
  return {
    panels: ['files', 'gitControl', 'browser'],
    activePanelId: 'browser',
    expanded: true,
    ...partial,
  };
}

describe('decideProjectSwitchDock — 项目切换时的右侧 dock 决策', () => {
  // ── 目标项目浏览器已开启 ──
  it('浏览器已开启且 dock 正显示浏览器面板 → 不调整', () => {
    expect(decideProjectSwitchDock(right(), true)).toEqual({ type: 'none' });
  });

  it('浏览器已开启且 dock 显示其他面板 → 激活浏览器面板(切回去恢复开启)', () => {
    expect(decideProjectSwitchDock(right({ activePanelId: 'files' }), true)).toEqual({
      type: 'activate',
      panelId: 'browser',
    });
  });

  it('浏览器已开启且浏览器面板不在右侧 → 加入并激活', () => {
    expect(
      decideProjectSwitchDock(
        right({ panels: ['files', 'gitControl'], activePanelId: 'files' }),
        true,
      ),
    ).toEqual({ type: 'add-and-activate', panelId: 'browser' });
  });

  it('浏览器已开启但右侧收起 → 不打扰用户布局', () => {
    expect(decideProjectSwitchDock(right({ expanded: false }), true)).toEqual({ type: 'none' });
  });

  // ── 目标项目浏览器未开启 ──
  it('浏览器未开启且 dock 正显示浏览器面板 → 切到默认面板', () => {
    expect(decideProjectSwitchDock(right(), false)).toEqual({
      type: 'activate',
      panelId: 'files',
    });
  });

  it('浏览器未开启且右侧只剩浏览器面板 → 收起右侧', () => {
    expect(
      decideProjectSwitchDock(right({ panels: ['browser'], activePanelId: 'browser' }), false),
    ).toEqual({ type: 'collapse' });
  });

  it('浏览器未开启且 dock 显示其他面板 → 不调整', () => {
    expect(decideProjectSwitchDock(right({ activePanelId: 'files' }), false)).toEqual({
      type: 'none',
    });
  });

  it('浏览器未开启且右侧收起 → 不调整', () => {
    expect(decideProjectSwitchDock(right({ expanded: false }), false)).toEqual({
      type: 'none',
    });
  });
});
