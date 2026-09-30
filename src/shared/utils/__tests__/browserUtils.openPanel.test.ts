import { beforeEach, describe, expect, it } from 'vitest';

import { useBrowserStore } from '@/shared/store/browserStore';
import { useDockStore } from '@/shared/store/dockStore';
import { useProjectStore } from '@/shared/store/projectStore';

import { openHtmlInBrowserPanel } from '../browserUtils';

/**
 * `openHtmlInBrowserPanel` 是 `browserUtils` 里唯一的**副作用**入口（另外几个是纯函数），
 * 因此单独成文件：需要 jsdom（`dockStore` 走 `persist`，要 localStorage）与两处 store 的种值。
 * 纯函数用例在 `browserUtils.test.ts`（node env）。
 */
const PROJECT = 'p1';

beforeEach(() => {
  useProjectStore.setState({ activeProjectId: PROJECT });
  useBrowserStore.getState().reset();
  useDockStore.setState((state) => ({
    zones: {
      ...state.zones,
      right: { ...state.zones.right, activePanelId: null, expanded: false },
    },
  }));
});

describe('openHtmlInBrowserPanel — 导航 + 停靠', () => {
  it('导航到该文件的 file:// 地址并展开右侧 browser 面板', () => {
    // 前置：browser 面板必须已登记在 right zone —— `activatePanel` 对未登记的 panel 直接 no-op，
    // 不先断言这条，下面「面板被激活」就成了可能因为 no-op 而假过（或假失败）的断言。
    expect(useDockStore.getState().zones.right.panels).toContain('browser');

    openHtmlInBrowserPanel('/repo/docs/index.html');

    const panel = useBrowserStore.getState().getPanelState(PROJECT);
    expect(panel.url).toBe('file:///repo/docs/index.html');
    // 先 navigateTo 再 activatePanel：面板挂载的那一帧 store 里必须已有 url + isLoading，
    // 否则挂载 effect 读到空地址（函数注释里记的正是这个顺序约束）。
    expect(panel.isLoading).toBe(true);
    expect(useDockStore.getState().zones.right.activePanelId).toBe('browser');
    expect(useDockStore.getState().zones.right.expanded).toBe(true);
  });

  it('Windows 盘符路径 → 三斜杠地址（盘符不得落到 host 位）', () => {
    openHtmlInBrowserPanel('C:\\dev\\proj\\index.html');

    expect(useBrowserStore.getState().getPanelState(PROJECT).url).toBe(
      'file:///C:/dev/proj/index.html',
    );
  });

  it('无激活项目：不写任何项目的地址，但仍激活面板', () => {
    useProjectStore.setState({ activeProjectId: null });

    openHtmlInBrowserPanel('/repo/docs/index.html');

    // navigateTo 的 1 参形态按「当前激活项目」定址，无激活项目时静默返回 ——
    // 这里钉住「不会把地址写进某个凭空的 projectId」。
    expect(useBrowserStore.getState().states).toEqual({});
    expect(useDockStore.getState().zones.right.activePanelId).toBe('browser');
  });
});
