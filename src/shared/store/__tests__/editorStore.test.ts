// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import type { EditorSplitLayout, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import type { ComposerDocJson } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import {
  activeTabIdOf,
  registerTabCleanup,
  unregisterTabCleanup,
  useEditorStore,
} from '../editorStore';
import { selectOrderedTabIds } from '../editorTabSelectors';

/** 测试身份源 + tab 空间键（addTab 现从 tab.scope 推导键；主仓 → `'p1\0'`）。 */
const mkSession = (projectId: string) => WorkspaceSession.of(projectId, null);
const SPACE = mkSession('p1').key;

function makeTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: mkSession('p1') },
    title: id,
    data: { kind: 'file', filePath: id, fileName: id, content: '', isDirty: false },
  };
}

function splitLayout(
  leftIds: string[],
  rightIds: string[],
  leftActive: string,
  rightActive: string,
): EditorSplitLayout {
  const layout = createDefaultEditorLayout();
  layout.isSplit = true;
  layout.activeGroupId = 'right';
  layout.groups.left = { tabIds: leftIds, activeTabId: leftActive };
  layout.groups.right = { tabIds: rightIds, activeTabId: rightActive };
  return layout;
}

function seedState(layout: EditorSplitLayout, tabs: Tab[]) {
  // 前台/顺序的唯一权威 = 布局（`selectActiveTabId` / `selectOrderedTabIds`）；
  // 空间级 `activeTabId` 与顶层 `activeTabId` 已随单源化删除。
  useEditorStore.setState({ tabs: { [SPACE]: { tabs } }, editorLayout: { [SPACE]: layout } });
}

describe('editorStore.closeTab — split layout active switch', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  it('closing a group active tab (not global active) keeps that group on a valid adjacent tab', () => {
    // left: [A, B] active=A ; right: [C] active=C ; global active=C
    const layout = splitLayout(['A', 'B'], ['C'], 'A', 'C');
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')]);

    useEditorStore.getState().closeTab(SPACE, 'A');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.left.tabIds).toEqual(['B']);
    // left group must NOT point at C (belongs to right group) → would render blank
    expect(next.groups.left.activeTabId).toBe('B');
    expect(next.groups.right.activeTabId).toBe('C');
    expect(activeTabIdOf(SPACE)).toBe('C');
  });

  it('closing the right group active tab keeps right group valid', () => {
    // left: [A] active=A ; right: [B, C] active=C（激活组 = right）
    const layout = splitLayout(['A'], ['B', 'C'], 'A', 'C');
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')]);

    useEditorStore.getState().closeTab(SPACE, 'C');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.right.tabIds).toEqual(['B']);
    expect(next.groups.right.activeTabId).toBe('B');
    expect(next.groups.left.activeTabId).toBe('A');
    // 前台 = 激活组（right）的激活 tab；关掉它后回退到同组相邻的 'B'
    expect(activeTabIdOf(SPACE)).toBe('B');
  });

  it('closing a non-foreground tab heals its own group, leaves the foreground group intact', () => {
    // 激活组 = right（前台 = 'D'）；关闭 left 的激活 tab 'B' 只影响 left 组。
    const layout = splitLayout(['A', 'B'], ['C', 'D'], 'B', 'D');
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C'), makeTab('D')]);

    useEditorStore.getState().closeTab(SPACE, 'B');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.left.tabIds).toEqual(['A']);
    expect(next.groups.left.activeTabId).toBe('A');
    // 前台仍是激活组 right 的激活 tab
    expect(activeTabIdOf(SPACE)).toBe('D');
  });
});

describe('editorStore.pinTab — 多 pinned tabs 追加语义', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  it('pin 第一个 tab：从 left 移除并加入 pinnedTabIds', () => {
    const layout = createDefaultEditorLayout();
    layout.groups.left = { tabIds: ['A', 'B'], activeTabId: 'A' };
    seedState(layout, [makeTab('A'), makeTab('B')]);

    useEditorStore.getState().pinTab(SPACE, 'A');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['A']);
    expect(next.pinnedActiveTabId).toBe('A');
    expect(next.groups.left.tabIds).toEqual(['B']);
  });

  it('已有 pinned 时再 pin 新 tab：追加而非替换', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['B'], activeTabId: 'B' };
    seedState(layout, [makeTab('A'), makeTab('B')]);

    useEditorStore.getState().pinTab(SPACE, 'B');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['A', 'B']);
    expect(next.pinnedActiveTabId).toBe('B');
    expect(next.groups.left.tabIds).toEqual([]);
  });

  it('已 pin 的 tab 再次 pin：保持原有列表（幂等）', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['B'], activeTabId: 'B' };
    seedState(layout, [makeTab('A'), makeTab('B')]);

    useEditorStore.getState().pinTab(SPACE, 'A');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['A']);
    expect(next.groups.left.tabIds).toEqual(['B']);
  });
});

describe('editorStore.unpinTab — 按 tab 移除并放回 left', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  it('unpin 指定 tab：从 pinnedTabIds 移除，放回 left 组首部', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'B';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')]);

    useEditorStore.getState().unpinTab(SPACE, 'A');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.groups.left.tabIds).toEqual(['A', 'C']);
  });

  it('unpin 当前激活的 pinned：pinnedActiveTabId 指向剩余的第一个', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: [], activeTabId: null };
    seedState(layout, [makeTab('A'), makeTab('B')]);

    useEditorStore.getState().unpinTab(SPACE, 'A');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.pinnedActiveTabId).toBe('B');
    expect(next.groups.left.tabIds).toEqual(['A']);
  });
});

describe('editorStore.activateTab — pinned tab 激活', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  it('激活 pinned tab：只更新 pinnedActiveTabId，不把 tab 加入 left/right 组', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')]);

    useEditorStore.getState().activateTab(SPACE, 'B');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedActiveTabId).toBe('B');
    expect(next.groups.left.tabIds).toEqual(['C']);
    expect(next.groups.right.tabIds).toEqual([]);
  });
});

describe('editorStore.updateTab — browser 标题/favicon 同步', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedBrowserTab() {
    useEditorStore.getState().addTab({
      id: 'tb1',
      scope: { kind: 'workspace', session: mkSession('p1') },
      title: 'Browser',
      data: { kind: 'browser', url: 'https://a.com' },
    });
  }

  it('同时更新浏览器 tab 顶层标题与 data.favicon', () => {
    seedBrowserTab();
    useEditorStore.getState().updateTab(SPACE, 'tb1', {
      title: 'GitHub',
      favicon: 'https://a.com/favicon.ico',
    });

    const tab = useEditorStore.getState().tabs[SPACE]!.tabs.find((t) => t.id === 'tb1')!;
    expect(tab.title).toBe('GitHub');
    expect(tab.data).toMatchObject({
      kind: 'browser',
      url: 'https://a.com',
      favicon: 'https://a.com/favicon.ico',
    });
  });

  it('仅更新 favicon 时保留 url', () => {
    seedBrowserTab();
    useEditorStore.getState().updateTab(SPACE, 'tb1', { favicon: 'https://a.com/fav.png' });

    const tab = useEditorStore.getState().tabs[SPACE]!.tabs.find((t) => t.id === 'tb1')!;
    expect(tab.data).toMatchObject({
      kind: 'browser',
      url: 'https://a.com',
      favicon: 'https://a.com/fav.png',
    });
  });
});

describe('editorStore.updateTab — file tab 只读字段透传（mergeTabData）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedReadonlyTab() {
    useEditorStore.getState().addTab({
      id: 'tf1',
      scope: { kind: 'workspace', session: mkSession('p1') },
      title: 'Foo.java',
      data: {
        kind: 'file',
        filePath: 'jdt:/java.base/java/lang/Foo.java',
        fileName: 'Foo.java',
        content: 'class Foo {}',
        isDirty: false,
        readOnly: true,
        virtualUri: 'jdt://java.base/java/lang/Foo.java',
      },
    });
  }

  const tabOf = () => useEditorStore.getState().tabs[SPACE]!.tabs.find((t) => t.id === 'tf1')!;

  it('externallyModified 刷新不剥离 readOnly / virtualUri', () => {
    seedReadonlyTab();
    useEditorStore.getState().updateTab(SPACE, 'tf1', { externallyModified: true });

    const data = tabOf().data;
    expect(data.kind === 'file' && data.readOnly).toBe(true);
    expect(data.kind === 'file' && data.virtualUri).toBe('jdt://java.base/java/lang/Foo.java');
  });

  it('content 刷新不剥离 readOnly / virtualUri', () => {
    seedReadonlyTab();
    useEditorStore.getState().updateTab(SPACE, 'tf1', {
      content: { path: 'jdt:/x', content: 'new', size: 3, is_binary: false },
    });

    const data = tabOf().data;
    expect(data.kind === 'file' && data.readOnly).toBe(true);
    expect(data.kind === 'file' && data.content.content).toBe('new');
  });

  it('显式写入 readOnly / virtualUri 时生效', () => {
    useEditorStore.getState().addTab({
      id: 'tf2',
      scope: { kind: 'workspace', session: mkSession('p1') },
      title: 'Bar.rs',
      data: {
        kind: 'file',
        filePath: 'src/lib.rs',
        fileName: 'lib.rs',
        content: '',
        isDirty: false,
      },
    });
    useEditorStore.getState().updateTab(SPACE, 'tf2', { readOnly: true });

    const data = useEditorStore.getState().tabs[SPACE]!.tabs.find((t) => t.id === 'tf2')!.data;
    expect(data.kind === 'file' && data.readOnly).toBe(true);
  });
});

/**
 * `agent-chat` tab 的字段必须能**落盘并读回**。
 *
 * # 为什么这条不能用 mock 写
 *
 * `mergeTabData` 是**穷举重建**（逐字段 `in p ? p.x : d.x`），不是浅合并 ——
 * 漏一个字段就静默丢弃它。早先 `modelId` / `resume*` 就是这样丢的：
 *
 * - `useSelectedModel` 的 effect 每次渲染都写 `modelId`，但**永远读不回来**
 *   → 切 tab 回来 `initialModelId` 为空 → 落到 `models[0]`
 *   → 「切个 tab 我的模型自己变了」那个 bug 实际没修好；
 * - `useChatRestore` 的「一次性消费」写入同样无效。
 *
 * 而当时那条 `ModelSelectionPersistence.test.tsx` 把整个 `@/shared/store/editorStore`
 * mock 掉了 —— 它保护的是 mock，不是行为。**护栏必须跑真 store。**
 */
describe('editorStore.updateTab — terminal 字段是 `keep` 语义（与 agent-chat 相反）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedTerminalTab() {
    useEditorStore.getState().addTab({
      id: 'tt1',
      scope: { kind: 'workspace', session: mkSession('p1') },
      title: 'Terminal 1',
      data: { kind: 'terminal', agentId: null, ptySessionId: 'pty-1' },
    });
  }

  const termData = () =>
    useEditorStore.getState().tabs[SPACE]!.tabs.find((t) => t.id === 'tt1')!.data;

  it('挂载键 / 恢复标记写入后必须能读回', () => {
    seedTerminalTab();
    useEditorStore
      .getState()
      .updateTab(SPACE, 'tt1', { attachSessionId: 'pty-2', resumeFromSessionId: 'pty-3' });

    const data = termData();
    if (data.kind !== 'terminal') throw new Error('kind changed');
    expect(data.attachSessionId).toBe('pty-2');
    expect(data.resumeFromSessionId).toBe('pty-3');
    expect(data.ptySessionId).toBe('pty-1');
  });

  /**
   * 与 agent-chat 的 `clear` 恰好相反：终端写 `undefined` 表示「这次不更新」
   * （挂载键由 PTY 创建回调写入，清掉等于丢掉 tab ↔ 会话的唯一映射）。
   */
  it('显式 undefined 不清除（`keep` 语义）', () => {
    seedTerminalTab();
    useEditorStore.getState().updateTab(SPACE, 'tt1', { ptySessionId: undefined });

    const data = termData();
    expect(data.kind === 'terminal' && data.ptySessionId).toBe('pty-1');
  });

  /** `resumeFromSessionId` 是一次性标记：不消费就会在 PTY 重建时重复 adopt，侧栏多出同名行。 */
  it('恢复标记显式 undefined 会清除（`clear` 语义），其它 keep 字段不受影响', () => {
    seedTerminalTab();
    useEditorStore.getState().updateTab(SPACE, 'tt1', { resumeFromSessionId: 'pty-old' });
    const seeded = termData();
    expect(seeded.kind === 'terminal' && seeded.resumeFromSessionId).toBe('pty-old');

    useEditorStore
      .getState()
      .updateTab(SPACE, 'tt1', { ptySessionId: 'pty-new', resumeFromSessionId: undefined });

    const data = termData();
    if (data.kind !== 'terminal') throw new Error('kind changed');
    expect(data.resumeFromSessionId).toBeUndefined();
    expect(data.ptySessionId).toBe('pty-new');
  });
});

describe('editorStore.updateTab — agent-chat 字段落盘（mergeTabData 穷举白名单）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedChatTab() {
    useEditorStore.getState().addTab({
      id: 'tc1',
      scope: { kind: 'workspace', session: mkSession('p1') },
      title: 'Agent Chat',
      data: { kind: 'agent-chat', agentId: 'pi' },
    });
  }

  const chatData = () =>
    useEditorStore.getState().tabs[SPACE]!.tabs.find((t) => t.id === 'tc1')!.data;

  it('modelId 写入后必须能读回（否则模型选择持久化失效）', () => {
    seedChatTab();
    useEditorStore.getState().updateTab(SPACE, 'tc1', { modelId: 'deepseek-flash' });

    const data = chatData();
    expect(data.kind === 'agent-chat' && data.modelId).toBe('deepseek-flash');
  });

  it('写 modelId 不得顺手抹掉 agentId / sessionId', () => {
    seedChatTab();
    useEditorStore.getState().updateTab(SPACE, 'tc1', { sessionId: 'sid-1' });
    useEditorStore.getState().updateTab(SPACE, 'tc1', { modelId: 'm1' });

    const data = chatData();
    if (data.kind !== 'agent-chat') throw new Error('kind changed');
    expect(data.agentId).toBe('pi');
    expect(data.sessionId).toBe('sid-1');
    expect(data.modelId).toBe('m1');
  });

  /**
   * 显式写 `undefined` 是**清除**语义（切 agent 丢模型、恢复标记一次性消费）。
   * 用 `p.x !== undefined` 做判据会让清除也生效不了。
   */
  it('显式写 undefined 必须能清除已有值', () => {
    seedChatTab();
    useEditorStore.getState().updateTab(SPACE, 'tc1', { modelId: 'm1' });
    useEditorStore.getState().updateTab(SPACE, 'tc1', { modelId: undefined });

    const data = chatData();
    expect(data.kind === 'agent-chat' && data.modelId).toBeUndefined();
  });

  it('resume 目标同样必须能落盘与清除（useChatRestore 一次性消费）', () => {
    seedChatTab();
    useEditorStore.getState().updateTab(SPACE, 'tc1', {
      resumeConversationId: 'conv-1',
      resumeNativeSessionId: 'native-1',
    });
    let data = chatData();
    if (data.kind !== 'agent-chat') throw new Error('kind changed');
    expect(data.resumeConversationId).toBe('conv-1');
    expect(data.resumeNativeSessionId).toBe('native-1');

    useEditorStore.getState().updateTab(SPACE, 'tc1', {
      resumeConversationId: undefined,
      resumeNativeSessionId: undefined,
    });
    data = chatData();
    if (data.kind !== 'agent-chat') throw new Error('kind changed');
    expect(data.resumeConversationId).toBeUndefined();
    expect(data.resumeNativeSessionId).toBeUndefined();
  });

  it('composerDoc 写入后必须能读回（RichComposer 草稿按 tab 持久化）', () => {
    seedChatTab();
    const doc: ComposerDocJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'run ' },
            { type: 'commandChip', attrs: { name: 'tr', source: 'prompt' } },
          ],
        },
      ],
    };
    useEditorStore.getState().updateTab(SPACE, 'tc1', { composerDoc: doc });

    const data = chatData();
    expect(data.kind === 'agent-chat' && data.composerDoc).toEqual(doc);
  });

  it('显式写 undefined 必须能清除 composerDoc（清空草稿语义）', () => {
    seedChatTab();
    useEditorStore.getState().updateTab(SPACE, 'tc1', {
      composerDoc: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    useEditorStore.getState().updateTab(SPACE, 'tc1', { composerDoc: undefined });

    const data = chatData();
    expect(data.kind === 'agent-chat' && data.composerDoc).toBeUndefined();
  });
});

describe('editorStore.unpinTabTo — 拖拽 unpin 到指定组', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  it('拖到 left 组某 tab 上：从 pinned 移除，插到 over tab 之前', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C', 'D'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C'), makeTab('D')]);

    useEditorStore.getState().unpinTabTo(SPACE, 'A', 'left', 'D');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.groups.left.tabIds).toEqual(['C', 'A', 'D']);
  });

  it('拖入的 tab 成为目标组激活 tab', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('C')]);

    useEditorStore.getState().unpinTabTo(SPACE, 'A', 'left', 'C');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.left.activeTabId).toBe('A');
  });

  it('被拖 tab 是 pinnedActiveTabId 时交接给剩余第一个', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A', 'B'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')]);

    useEditorStore.getState().unpinTabTo(SPACE, 'A', 'left', 'C');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedActiveTabId).toBe('B');
  });

  it('overId 为 null → 追加到目标组尾部', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C', 'D'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('C'), makeTab('D')]);

    useEditorStore.getState().unpinTabTo(SPACE, 'A', 'left', null);

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.left.tabIds).toEqual(['C', 'D', 'A']);
  });

  it('tab 不在 pinned → 幂等返回原 layout', () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['B'];
    layout.pinnedActiveTabId = 'B';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    seedState(layout, [makeTab('A'), makeTab('B'), makeTab('C')]);

    useEditorStore.getState().unpinTabTo(SPACE, 'A', 'left', 'C');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['B']);
    expect(next.groups.left.tabIds).toEqual(['C']);
  });

  it('unpin 后 pinned 清空、目标组是 right 时 isSplit 保持', () => {
    const layout = createDefaultEditorLayout();
    layout.isSplit = true;
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    layout.groups.left = { tabIds: ['C'], activeTabId: 'C' };
    layout.groups.right = { tabIds: ['D'], activeTabId: 'D' };
    seedState(layout, [makeTab('A'), makeTab('C'), makeTab('D')]);

    useEditorStore.getState().unpinTabTo(SPACE, 'A', 'right', 'D');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual([]);
    expect(next.isSplit).toBe(true);
    expect(next.groups.right.tabIds).toEqual(['A', 'D']);
    expect(next.groups.left.tabIds).toEqual(['C']);
  });
});

describe('editorStore.addTab — targetGroup 指定落组（pane 内 + 创建跟随发起面板）', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  function seedTwoGroups() {
    const layout = createDefaultEditorLayout();
    layout.isSplit = true;
    layout.groups.left = { tabIds: ['L1'], activeTabId: 'L1' };
    layout.groups.right = { tabIds: ['R1'], activeTabId: 'R1' };
    // 激活组为 right：缺省落组行为（回归基准）
    layout.activeGroupId = 'right';
    seedState(layout, [makeTab('L1'), makeTab('R1')]);
  }

  function makeNewTab(id: string): Tab {
    return {
      id,
      scope: { kind: 'workspace', session: mkSession('p1') },
      title: id,
      data: { kind: 'browser', url: '' },
    };
  }

  it("targetGroup='pinned' → 落 pinnedTabIds 并激活 pinned，groups 不含它", () => {
    seedTwoGroups();
    useEditorStore.getState().addTab(makeNewTab('NEW'), 'pinned');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['NEW']);
    expect(next.pinnedActiveTabId).toBe('NEW');
    expect(next.groups.left.tabIds).toEqual(['L1']);
    expect(next.groups.right.tabIds).toEqual(['R1']);
    // pinned 激活态与编辑器组前台**正交**（design §2.3）：落 pinned 不改组前台，
    // 故 `activeTabIdOf`（= 组前台）仍是原来的 'R1'；pinned 自身的激活看
    // `pinnedActiveTabId`（上一行）—— 这是今日行为，有意保留。
    expect(activeTabIdOf(SPACE)).toBe('R1');
  });

  it("targetGroup='left' → 落 left 组并激活（即使激活组是 right）", () => {
    seedTwoGroups();
    useEditorStore.getState().addTab(makeNewTab('NEW'), 'left');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.left.tabIds).toEqual(['L1', 'NEW']);
    expect(next.groups.left.activeTabId).toBe('NEW');
    expect(next.groups.right.tabIds).toEqual(['R1']);
  });

  it("targetGroup='right' → 落 right 组并激活", () => {
    seedTwoGroups();
    useEditorStore.getState().addTab(makeNewTab('NEW'), 'right');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.right.tabIds).toEqual(['R1', 'NEW']);
    expect(next.groups.right.activeTabId).toBe('NEW');
  });

  it('缺省 targetGroup → 保持现状落到 activeGroupId（回归保护）', () => {
    seedTwoGroups();
    useEditorStore.getState().addTab(makeNewTab('NEW'));

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.groups.right.tabIds).toEqual(['R1', 'NEW']);
    expect(next.groups.left.tabIds).toEqual(['L1']);
    expect(next.pinnedTabIds).toEqual([]);
  });

  it("targetGroup='pinned' 且布局已有 pinned tab → 追加不替换", () => {
    const layout = createDefaultEditorLayout();
    layout.pinnedTabIds = ['P1'];
    layout.pinnedActiveTabId = 'P1';
    layout.groups.left = { tabIds: ['L1'], activeTabId: 'L1' };
    seedState(layout, [makeTab('P1'), makeTab('L1')]);

    useEditorStore.getState().addTab(makeNewTab('NEW'), 'pinned');

    const next = useEditorStore.getState().editorLayout[SPACE];
    expect(next.pinnedTabIds).toEqual(['P1', 'NEW']);
    expect(next.pinnedActiveTabId).toBe('NEW');
  });
});

describe('editorStore.renameTab — Save As 身份迁移（改 id 保持一致性）', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
    });
  });

  it('改 id 并保持 order / 双组 / pinned / 激活一致', () => {
    const layout = splitLayout(['u1', 'A'], ['B'], 'u1', 'B');
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    seedState(layout, [makeTab('u1'), makeTab('A'), makeTab('B')]);

    useEditorStore.getState().renameTab(SPACE, 'u1', 'p1:/repo/x.ts');

    const s = useEditorStore.getState();
    expect(s.tabs[SPACE].tabs.map((t) => t.id)).toEqual(['p1:/repo/x.ts', 'A', 'B']);
    const l = s.editorLayout[SPACE];
    expect(l.groups.left.tabIds).toEqual(['p1:/repo/x.ts', 'A']);
    expect(l.groups.left.activeTabId).toBe('p1:/repo/x.ts');
    expect(l.groups.right.tabIds).toEqual(['B']);
    expect(l.pinnedTabIds).toEqual(['A']);
    expect(l.pinnedActiveTabId).toBe('A');
  });

  it('目标 id 已被占用 → 拒绝（无变化）', () => {
    seedState(splitLayout(['u1', 'A'], [], 'u1', 'u1'), [makeTab('u1'), makeTab('A')]);

    useEditorStore.getState().renameTab(SPACE, 'u1', 'A');

    const s = useEditorStore.getState();
    expect(s.tabs[SPACE].tabs.map((t) => t.id)).toEqual(['u1', 'A']);
    expect(s.editorLayout[SPACE].groups.left.activeTabId).toBe('u1');
  });

  it('old id 不存在 → 无变化', () => {
    seedState(splitLayout(['A'], [], 'A', 'A'), [makeTab('A')]);

    useEditorStore.getState().renameTab(SPACE, 'missing', 'X');

    const s = useEditorStore.getState();
    expect(s.tabs[SPACE].tabs.map((t) => t.id)).toEqual(['A']);
    expect(s.editorLayout[SPACE].groups.left.activeTabId).toBe('A');
  });
});

describe('editorStore.navigateGoal — cleared when its target tab is removed', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      navigateGoal: null,
    });
  });

  it('closeTab removes the goal target tab → navigateGoal cleared', () => {
    seedState(splitLayout(['A', 'B'], [], 'A', 'A'), [makeTab('A'), makeTab('B')]);
    useEditorStore.getState().setNavigateGoal({ tabKey: SPACE, tabId: 'A', line: 1, col: 0 });

    useEditorStore.getState().closeTab(SPACE, 'A');

    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('closeTab removes another tab → navigateGoal preserved', () => {
    seedState(splitLayout(['A', 'B'], [], 'A', 'A'), [makeTab('A'), makeTab('B')]);
    useEditorStore.getState().setNavigateGoal({ tabKey: SPACE, tabId: 'A', line: 1, col: 0 });

    useEditorStore.getState().closeTab(SPACE, 'B');

    const goal = useEditorStore.getState().navigateGoal;
    expect(goal).not.toBeNull();
    expect(goal?.tabId).toBe('A');
  });

  it('closeTab on a pinned tab (not actually removed) → navigateGoal preserved', () => {
    // closeTab 对 pinned tab 早退（不移除）：清理只随真实移除发生，goal 不得被误清。
    const layout = splitLayout(['A'], [], 'A', 'A');
    layout.pinnedTabIds = ['A'];
    layout.pinnedActiveTabId = 'A';
    seedState(layout, [makeTab('A')]);
    useEditorStore.getState().setNavigateGoal({ tabKey: SPACE, tabId: 'A', line: 1, col: 0 });

    useEditorStore.getState().closeTab(SPACE, 'A');

    expect(useEditorStore.getState().navigateGoal?.tabId).toBe('A');
  });

  it('clearProjectTabs removes the project tab space → goal for that tabKey cleared', () => {
    seedState(splitLayout(['A'], [], 'A', 'A'), [makeTab('A')]);
    useEditorStore.getState().setNavigateGoal({ tabKey: SPACE, tabId: 'A', line: 1, col: 0 });

    useEditorStore.getState().clearProjectTabs(SPACE);

    expect(useEditorStore.getState().navigateGoal).toBeNull();
  });

  it('clearProjectTabs on another project → navigateGoal preserved', () => {
    seedState(splitLayout(['A'], [], 'A', 'A'), [makeTab('A')]);
    useEditorStore.getState().setNavigateGoal({ tabKey: 'p2', tabId: 'X', line: 1, col: 0 });

    useEditorStore.getState().clearProjectTabs(SPACE);

    expect(useEditorStore.getState().navigateGoal?.tabKey).toBe('p2');
  });
});

describe('editorStore.tabCleanup — handler 异常在分发点隔离', () => {
  // 注册表按 kind 分发且对 feature 开放：某个 handler 抛错不得外溢到调用方
  // （store 移除变更在 handler 运行前已提交，异常只剩破坏调用方后续流程）。
  let throwingHandler: (tabKey: string, tab: Tab) => void;
  beforeEach(() => {
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      navigateGoal: null,
    });
    throwingHandler = vi.fn((tabKey: string, tab: Tab) => {
      if (tab.id === 'A') throw new Error('cleanup exploded');
    });
    registerTabCleanup('file', throwingHandler);
  });

  afterEach(() => {
    unregisterTabCleanup('file');
    vi.restoreAllMocks();
  });

  it('clearProjectTabs：A 的 handler 抛错 → B 仍被清理、tab 空间仍被移除、异常不外溢', () => {
    seedState(splitLayout(['A', 'B'], [], 'A', 'A'), [makeTab('A'), makeTab('B')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => useEditorStore.getState().clearProjectTabs(SPACE)).not.toThrow();

    expect(throwingHandler).toHaveBeenCalledTimes(2); // A 抛错不中断 B 的清理
    expect(useEditorStore.getState().tabs[SPACE]).toBeUndefined();
  });

  it('closeTab：handler 抛错 → tab 仍被移除、异常不外溢', () => {
    seedState(splitLayout(['A', 'B'], [], 'A', 'A'), [makeTab('A'), makeTab('B')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => useEditorStore.getState().closeTab(SPACE, 'A')).not.toThrow();

    expect(useEditorStore.getState().tabs[SPACE].tabs.map((t) => t.id)).toEqual(['B']);
  });
});

describe('activeTabIdOf（前台布局派生的命令式封装）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, navigateGoal: null });
  });

  it('activeTabIdOf 读指定空间的激活 tab；未知空间返回 null', () => {
    useEditorStore.getState().addTab(makeTab('A'));
    expect(activeTabIdOf(SPACE)).toBe('A');
    expect(activeTabIdOf(mkSession('other').key)).toBeNull();
  });
});

/**
 * 空间级激活位是布局「哪个 pane 在前台」的**投影**。
 *
 * 分屏迁移与换 pane 只改布局、不改投影时，「前台 tab」就有两个答案：编辑器高亮按布局，
 * 而拖拽/插入仲裁（`terminalRouting.sessionTabSpace`）与 Cmd+W 按旧投影 ——
 * 用户可见缺陷 = 分屏后拖文件只落到上一个 pane 的输入框。本组钉住投影跟随。
 */
describe('editorStore — pane 前台变化投影到 tabs[tabKey].activeTabId', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedTwo(): void {
    useEditorStore.getState().addTab(makeTab('A'));
    useEditorStore.getState().addTab(makeTab('B'));
    useEditorStore.getState().activateTab(SPACE, 'A');
  }

  it('moveToRight：前台投影指向被迁移 tab', () => {
    seedTwo();
    useEditorStore.getState().moveToRight(SPACE, 'B');
    expect(activeTabIdOf(SPACE)).toBe('B');
  });

  it('splitRight：前台投影指向拆出的 tab', () => {
    seedTwo();
    useEditorStore.getState().splitRight(SPACE, 'B');
    expect(activeTabIdOf(SPACE)).toBe('B');
  });

  it('moveToLeft：前台投影指向被迁移 tab', () => {
    seedTwo();
    useEditorStore.getState().moveToRight(SPACE, 'B');
    useEditorStore.getState().moveToLeft(SPACE, 'B');
    expect(activeTabIdOf(SPACE)).toBe('B');
  });

  it('setActiveGroup：切到某 pane 后投影指向该 pane 的激活 tab', () => {
    seedTwo();
    useEditorStore.getState().moveToRight(SPACE, 'B');
    // moveToRight 使 right 在前台（B）；切回 left 应投影回 A。
    useEditorStore.getState().setActiveGroup(SPACE, 'left');
    expect(activeTabIdOf(SPACE)).toBe('A');
    useEditorStore.getState().setActiveGroup(SPACE, 'right');
    expect(activeTabIdOf(SPACE)).toBe('B');
  });

  it('setActiveGroup 幂等：已是该组时不改投影', () => {
    seedTwo();
    useEditorStore.getState().setActiveGroup(SPACE, 'left');
    expect(activeTabIdOf(SPACE)).toBe('A');
  });

  it('unsplit：前台投影指向原激活 pane 的激活 tab', () => {
    seedTwo();
    useEditorStore.getState().moveToRight(SPACE, 'B');
    useEditorStore.getState().unsplit(SPACE);
    expect(activeTabIdOf(SPACE)).toBe('B');
  });
});

/**
 * PRD AC1–AC4 回归（TDD Red 优先，见 implement.md「Red 证据」）。
 *
 * 断言面刻意选在**唯一读取点** `activeTabIdOf`（批 2 起改为 `selectActiveTabId` 派生）
 * 与新派生点 `selectOrderedTabIds` 上 —— 字段删除后这些用例语义不变，仍然钉住
 * 「布局是唯一权威」。
 */
describe('editorStore — AC1/AC2/AC4（布局是唯一前台/顺序权威）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedTwo(): void {
    useEditorStore.getState().addTab(makeTab('A'));
    useEditorStore.getState().addTab(makeTab('B'));
    useEditorStore.getState().activateTab(SPACE, 'A');
  }

  it('AC1：moveToRight 后前台 = 被迁移 tab；setActiveGroup 切回左 pane 后前台 = 左 pane 激活 tab', () => {
    seedTwo();
    useEditorStore.getState().moveToRight(SPACE, 'B');
    const layout = useEditorStore.getState().editorLayout[SPACE];
    expect(layout.activeGroupId).toBe('right');
    expect(layout.groups.left).toEqual({ tabIds: ['A'], activeTabId: 'A' });
    expect(layout.groups.right).toEqual({ tabIds: ['B'], activeTabId: 'B' });
    expect(activeTabIdOf(SPACE)).toBe('B');

    useEditorStore.getState().setActiveGroup(SPACE, 'left');
    expect(activeTabIdOf(SPACE)).toBe('A');
  });

  it('AC2：分屏后 pinTab → unpinTab，前台仍等于布局激活 pane 的 tab（补丁漏掉的路径）', () => {
    seedTwo();
    useEditorStore.getState().moveToRight(SPACE, 'B');
    expect(activeTabIdOf(SPACE)).toBe('B');

    // pin：B 从 right 组移入 pinned 面板 → 编辑器组前台回到 left 的 A
    useEditorStore.getState().pinTab(SPACE, 'B');
    expect(useEditorStore.getState().editorLayout[SPACE].groups.left.activeTabId).toBe('A');
    expect(activeTabIdOf(SPACE)).toBe('A');

    // unpin：B 放回 left 首部，但 left 激活位仍是 A（pinned 交互语义不变）
    useEditorStore.getState().unpinTab(SPACE, 'B');
    expect(useEditorStore.getState().editorLayout[SPACE].groups.left).toEqual({
      tabIds: ['B', 'A'],
      activeTabId: 'A',
    });
    expect(activeTabIdOf(SPACE)).toBe('A');
  });

  it('AC4：reorderTab 后顺序派生点反映新视觉顺序（不再读创建序）', () => {
    seedTwo();
    expect(selectOrderedTabIds(useEditorStore.getState(), SPACE)).toEqual(['A', 'B']);

    // 把 B 拖到 A 之前
    useEditorStore.getState().reorderTab(SPACE, 'left', 'B', 'A');
    expect(selectOrderedTabIds(useEditorStore.getState(), SPACE)).toEqual(['B', 'A']);
  });
});

/**
 * P1：tab 停靠（`dockTab` 是唯一移动入口，见 design §7.2 / I3）。
 *
 * 断言面 = 布局本身（四组 tabIds / 各组前台）+ `selectOrderedTabIds`（G2 覆盖全量）。
 * **G1 单值 surface**（同一 tab 不同时出现在两组）是防「双 PTY 双 stream」的那条线，
 * 因此每个迁移用例都断言「源组已剔除」而不只断言「目标组已包含」。
 */
describe('editorStore.dockTab — 原子停靠（G1 单值 surface）', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  function seedThree(): void {
    useEditorStore.getState().addTab(makeTab('A'));
    useEditorStore.getState().addTab(makeTab('B'));
    useEditorStore.getState().addTab(makeTab('C'));
    useEditorStore.getState().activateTab(SPACE, 'B');
  }

  /** G1：中心三组（left/right/pinned）与 docked 两组两两不相交。 */
  function expectSingleSurface(tabKey: string): void {
    const layout = useEditorStore.getState().editorLayout[tabKey]!;
    const buckets = [
      layout.groups.left.tabIds,
      layout.groups.right.tabIds,
      layout.pinnedTabIds,
      layout.docked.left.tabIds,
      layout.docked.right.tabIds,
    ];
    const seen = new Set<string>();
    for (const ids of buckets) {
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  }

  it('center → right dock：源组剔除、目标组追加并激活、G1 成立', () => {
    seedThree();
    const moved = useEditorStore.getState().dockTab(SPACE, 'B', 'right');

    expect(moved).toBe(true);
    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.groups.left.tabIds).toEqual(['A', 'C']);
    expect(layout.docked.right).toEqual({ tabIds: ['B'], activeTabId: 'B' });
    expect(layout.docked.left).toEqual({ tabIds: [], activeTabId: null });
    expectSingleSurface(SPACE);
  });

  it('被移走的是源组前台 → 源组前台回退到左邻（与 closeTab 同向，不留悬挂 activeTabId）', () => {
    seedThree();
    // left = [A, B, C]，前台 = B（addTab 激活最后一个，seedThree 再切 B）
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');
    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.groups.left.activeTabId).toBe('A');
  });

  it('dock → center：落到激活组并激活（不留在 docked 组）', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');

    expect(useEditorStore.getState().dockTab(SPACE, 'B', 'center')).toBe(true);
    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.groups[layout.activeGroupId].tabIds).toContain('B');
    expect(layout.groups[layout.activeGroupId].activeTabId).toBe('B');
    expect(layout.docked.right).toEqual({ tabIds: [], activeTabId: null });
    expectSingleSurface(SPACE);
  });

  it('dock → 另一个 dock：跨槽迁移只留一份', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');

    expect(useEditorStore.getState().dockTab(SPACE, 'B', 'left')).toBe(true);
    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.docked.right.tabIds).toEqual([]);
    expect(layout.docked.left).toEqual({ tabIds: ['B'], activeTabId: 'B' });
    expectSingleSurface(SPACE);
  });

  it('R9：pinned tab 被拒（返回 false 且布局一字不动，不静默 unpin）', () => {
    seedThree();
    useEditorStore.getState().pinTab(SPACE, 'B');
    const before = useEditorStore.getState().editorLayout[SPACE];

    expect(useEditorStore.getState().dockTab(SPACE, 'B', 'right')).toBe(false);
    expect(useEditorStore.getState().editorLayout[SPACE]).toBe(before);
  });

  it('未知 tabKey / 未知 tabId → false 且不改状态', () => {
    seedThree();
    const before = useEditorStore.getState().editorLayout[SPACE];

    expect(useEditorStore.getState().dockTab('no-such-space', 'A', 'right')).toBe(false);
    expect(useEditorStore.getState().dockTab(SPACE, 'ghost', 'right')).toBe(false);
    expect(useEditorStore.getState().editorLayout[SPACE]).toBe(before);
  });

  it('幂等：已在目标组且已是该组前台 → false（不写、不触发订阅）', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');
    const before = useEditorStore.getState().editorLayout[SPACE];

    expect(useEditorStore.getState().dockTab(SPACE, 'B', 'right')).toBe(false);
    expect(useEditorStore.getState().editorLayout[SPACE]).toBe(before);
  });

  it('G2：停靠后仲裁顺序仍覆盖全部 tab（长度相等、无重复）', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');

    const ordered = selectOrderedTabIds(useEditorStore.getState(), SPACE);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered).size).toBe(3);
    expect(ordered).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('closeTab：关闭停靠的 tab 从 docked 组剔除并修复该组前台', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');
    useEditorStore.getState().dockTab(SPACE, 'C', 'right');
    expect(useEditorStore.getState().editorLayout[SPACE]!.docked.right.activeTabId).toBe('C');

    useEditorStore.getState().closeTab(SPACE, 'C');

    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.docked.right).toEqual({ tabIds: ['B'], activeTabId: 'B' });
    expect(useEditorStore.getState().tabs[SPACE]!.tabs.map((t) => t.id)).toEqual(['A', 'B']);
  });

  it('activateTab：激活停靠的 tab 只改它那一组的前台（中心组前台不变）', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');
    useEditorStore.getState().dockTab(SPACE, 'C', 'right');
    expect(useEditorStore.getState().editorLayout[SPACE]!.docked.right.activeTabId).toBe('C');

    useEditorStore.getState().activateTab(SPACE, 'B');

    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.docked.right.activeTabId).toBe('B');
    expect(layout.groups.left.activeTabId).toBe('A');
  });

  it('renameTab：停靠 tab 改 id 时 docked 组与前台同步迁移', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');

    useEditorStore.getState().renameTab(SPACE, 'B', 'B2');

    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.docked.right).toEqual({ tabIds: ['B2'], activeTabId: 'B2' });
  });

  it('pinTab：停靠 tab 被 pin 时先从 docked 组剔除（不改 G1 单值 surface）', () => {
    seedThree();
    useEditorStore.getState().dockTab(SPACE, 'B', 'right');

    useEditorStore.getState().pinTab(SPACE, 'B');

    const layout = useEditorStore.getState().editorLayout[SPACE]!;
    expect(layout.docked.right).toEqual({ tabIds: [], activeTabId: null });
    expect(layout.pinnedTabIds).toEqual(['B']);
    expectSingleSurface(SPACE);
  });
});
