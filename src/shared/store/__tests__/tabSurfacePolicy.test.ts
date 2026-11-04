// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Tab } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useEditorStore } from '../editorStore';
import {
  registerTabSurfacePolicy,
  resolveTabSurface,
  unregisterTabSurfacePolicy,
} from '../tabSurfacePolicy';

/**
 * 「新建 tab 落在哪个 surface」的策略点（`tabSurfacePolicy` + `addTab` 的缺省落组分支）。
 *
 * 两条判据：
 * 1. **默认不越权**：未注册策略时行为与引入本模块之前逐字一致（落激活组）；
 * 2. **归一只表达一次**（I3 / G1）：策略说进 dock 时，新 tab 必须**离开**中心组 ——
 *    `ensureLayout` 会先把新 tab 塞进 left 组，漏了剔除就是一条 tab 两个组（双挂载）。
 */

const SPACE = WorkspaceSession.of('p1', null).key;

function chatTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: { kind: 'agent-chat' },
  };
}

function fileTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WorkspaceSession.of('p1', null) },
    title: id,
    data: { kind: 'file', filePath: id, fileName: id, content: '', isDirty: false },
  };
}

function layoutOf() {
  const layout = useEditorStore.getState().editorLayout[SPACE];
  if (!layout) throw new Error('layout 缺失：addTab 是唯一创建入口，应同时 ensureLayout');
  return layout;
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
});

afterEach(() => {
  unregisterTabSurfacePolicy();
});

describe('tabSurfacePolicy — 单槽注册表', () => {
  it('未注册 → 一律中心区（null）', () => {
    expect(resolveTabSurface(chatTab('t1'))).toBeNull();
  });

  it('注册后返回策略给出的槽', () => {
    registerTabSurfacePolicy(() => 'right');
    expect(resolveTabSurface(chatTab('t1'))).toBe('right');
  });

  it('再次注册 = 覆盖（单槽语义，不允许两条策略并存）', () => {
    registerTabSurfacePolicy(() => 'right');
    registerTabSurfacePolicy(() => 'left');
    expect(resolveTabSurface(chatTab('t1'))).toBe('left');
  });

  it('注销 → 回到中心区', () => {
    registerTabSurfacePolicy(() => 'right');
    unregisterTabSurfacePolicy();
    expect(resolveTabSurface(chatTab('t1'))).toBeNull();
  });
});

describe('addTab — 缺省落组问一次策略', () => {
  it('策略给槽 → 落该槽宿主组，中心三组都不含它（G1 单值 surface）', () => {
    registerTabSurfacePolicy((tab) => (tab.data.kind === 'agent-chat' ? 'right' : null));

    useEditorStore.getState().addTab(chatTab('chat-1'));

    const layout = layoutOf();
    expect(layout.docked.right.tabIds).toEqual(['chat-1']);
    expect(layout.docked.right.activeTabId).toBe('chat-1');
    expect(layout.docked.left.tabIds).toEqual([]);
    expect(layout.groups.left.tabIds).toEqual([]);
    expect(layout.groups.right.tabIds).toEqual([]);
    expect(layout.pinnedTabIds).toEqual([]);
  });

  it('空间的**第一条** tab 也成立：不残留在 ensureLayout 预填的 left 组', () => {
    // ensureLayout 在 layout 缺失时会把 allTabIds 全塞进 left —— 这条用例专门钉住剔除
    expect(useEditorStore.getState().editorLayout[SPACE]).toBeUndefined();
    registerTabSurfacePolicy(() => 'right');

    useEditorStore.getState().addTab(chatTab('first'));

    const layout = layoutOf();
    expect(layout.groups.left.tabIds).not.toContain('first');
    expect(layout.groups.left.activeTabId).toBeNull();
    expect(layout.docked.right.tabIds).toEqual(['first']);
  });

  it('策略返回 null → 落激活组（与引入本模块前逐字一致）', () => {
    registerTabSurfacePolicy(() => null);

    useEditorStore.getState().addTab(fileTab('f1'));

    const layout = layoutOf();
    expect(layout.groups.left.tabIds).toEqual(['f1']);
    expect(layout.docked.left.tabIds).toEqual([]);
    expect(layout.docked.right.tabIds).toEqual([]);
  });

  it('显式 targetGroup 优先：策略不生效（调用方的落组意图不被种类策略覆盖）', () => {
    registerTabSurfacePolicy(() => 'right');

    useEditorStore.getState().addTab(chatTab('chat-left'), 'left');

    const layout = layoutOf();
    expect(layout.groups.left.tabIds).toEqual(['chat-left']);
    expect(layout.docked.right.tabIds).toEqual([]);
  });

  it("targetGroup='pinned' 优先级最高：策略不生效，且不进中心组", () => {
    registerTabSurfacePolicy(() => 'right');

    useEditorStore.getState().addTab(chatTab('chat-pinned'), 'pinned');

    const layout = layoutOf();
    expect(layout.pinnedTabIds).toEqual(['chat-pinned']);
    expect(layout.pinnedActiveTabId).toBe('chat-pinned');
    expect(layout.docked.right.tabIds).toEqual([]);
    expect(layout.groups.left.tabIds).toEqual([]);
  });

  it('策略给出不存在的槽（上层 bug）→ tab 不丢，回落中心组', () => {
    registerTabSurfacePolicy(() => 'bottom' as never);

    useEditorStore.getState().addTab(chatTab('chat-fallback'));

    const layout = layoutOf();
    expect(layout.groups.left.tabIds).toEqual(['chat-fallback']);
    expect(layout.groups.left.activeTabId).toBe('chat-fallback');
  });
});
