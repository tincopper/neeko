import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tabKindView } from '@/shared/dock';
import { createDefaultDockState, useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { unregisterTabSurfacePolicy } from '@/shared/store/tabSurfacePolicy';
import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { registerNewTabDockPolicy } from '../registerNewTabDockPolicy';

/**
 * 新 tab 落点的**真实策略**（声明表能力位 `docksNewTabs` → 图标当前所在槽）。
 *
 * 守三件事：
 * 1. `agent-chat` 的新 tab 落侧区宿主（D3 选项②：否则侧栏 / Action Menu / Histor 恢复
 *    出来的 chat 全在中间，只有「点图标」一条路径是对的）；
 * 2. 落点**跟随图标**：图标移到左栏后新 tab 落 `docked.left`（`defaultSlot` 只是首次
 *    启动的默认值，不能变成第二条 kind → slot 策略）；
 * 3. `terminal` / 其它种类**不受影响**（普通 shell / 任务终端不该被搬进侧区）。
 */

const SPACE = WorkspaceSession.of('p1', null).key;

function tab(id: string, data: Tab['data']): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data,
  };
}

function layoutOf() {
  const layout = useEditorStore.getState().editorLayout[SPACE];
  if (!layout) throw new Error('layout 缺失：addTab 是唯一创建入口，应同时 ensureLayout');
  return layout;
}

beforeEach(() => {
  localStorage.clear();
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  registerNewTabDockPolicy();
});

afterEach(() => {
  unregisterTabSurfacePolicy();
});

describe('registerNewTabDockPolicy — agent-chat 落侧区宿主', () => {
  it('图标停在右栏（缺省）→ 新 chat 落 docked.right，不进中心', () => {
    useEditorStore.getState().addTab(tab('chat-1', { kind: 'agent-chat' }));

    const layout = layoutOf();
    expect(layout.docked.right.tabIds).toEqual(['chat-1']);
    expect(layout.groups.left.tabIds).toEqual([]);
    expect(layout.groups.right.tabIds).toEqual([]);
  });

  it('图标被移到左栏 → 新 chat 落 docked.left（落点 = 布局事实，不是 meta.defaultSlot）', () => {
    expect(useDockStore.getState().moveView(tabKindView('agent-chat'), 'left')).toBe(true);

    useEditorStore.getState().addTab(tab('chat-2', { kind: 'agent-chat' }));

    const layout = layoutOf();
    expect(layout.docked.left.tabIds).toEqual(['chat-2']);
    expect(layout.docked.right.tabIds).toEqual([]);
  });

  it('注册两次仍是一条策略（bootstrap 只跑一次，但不惩罚重复注册）', () => {
    registerNewTabDockPolicy();

    useEditorStore.getState().addTab(tab('chat-3', { kind: 'agent-chat' }));

    expect(layoutOf().docked.right.tabIds).toEqual(['chat-3']);
  });
});

describe('registerNewTabDockPolicy — 不受影响的种类', () => {
  it('terminal：docksNewTabs 缺省 → 仍落中心区（普通 shell / 任务终端不被搬进侧区）', () => {
    useEditorStore.getState().addTab(tab('term-1', { kind: 'terminal', agentId: null }));

    const layout = layoutOf();
    expect(layout.groups.left.tabIds).toEqual(['term-1']);
    expect(layout.docked.right.tabIds).toEqual([]);
    expect(layout.docked.left.tabIds).toEqual([]);
  });

  it('file：没有种类级入口 → 落中心区', () => {
    useEditorStore.getState().addTab(
      tab('f1', {
        kind: 'file',
        filePath: 'a.ts',
        fileName: 'a.ts',
        content: '',
        isDirty: false,
      }),
    );

    expect(layoutOf().groups.left.tabIds).toEqual(['f1']);
    expect(layoutOf().docked.right.tabIds).toEqual([]);
  });
});
