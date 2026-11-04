// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { appViewKey, isViewKey, panelView, tabHostView, tabKindView } from '../viewKey';

/**
 * ViewKey 的唯一铸造点：形态被钉死（前缀 + id），因为持久化快照里的字符串
 * 要靠「查表」判定真伪 —— 前缀一旦漂移，旧快照会整体变成未知视图而被丢弃。
 */
describe('viewKey mint', () => {
  it('四个 mint 产出稳定前缀形态', () => {
    expect(panelView('files')).toBe('panel:files');
    expect(tabHostView('right')).toBe('tabHost:right');
    expect(tabKindView('agent-chat')).toBe('tabKind:agent-chat');
    expect(appViewKey('library')).toBe('appView:library');
  });

  it('同一个 id 反复铸造得到同一个字符串（键身份稳定）', () => {
    expect(panelView('files')).toBe(panelView('files'));
  });
});

describe('isViewKey', () => {
  it('接受非空字符串（把 dnd 的 UniqueIdentifier 收窄成 ViewKey）', () => {
    expect(isViewKey('panel:files')).toBe(true);
  });

  it('拒绝非字符串与空串', () => {
    expect(isViewKey(undefined)).toBe(false);
    expect(isViewKey(null)).toBe(false);
    expect(isViewKey(0)).toBe(false);
    expect(isViewKey('')).toBe(false);
    expect(isViewKey('   ')).toBe(false);
  });

  it('不校验前缀 —— 前缀语义属于声明表（查表裁定真伪，不在这里造第二份知识）', () => {
    expect(isViewKey('whatever:anything')).toBe(true);
  });
});
