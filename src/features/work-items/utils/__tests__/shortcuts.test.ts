/**
 * `resolveShortcut` / `isEditableElement`：design §11.7 的快捷键判据。
 *
 * 纯函数 100% 覆盖是仓库红线（见 `vitest.config.ts` 的 thresholds）。这里的重点是**每一条
 * 不许动的条件**都要有一个用例 —— 它们的反面分别是「删掉整条工作项」「叠出第二层对话框」
 * 「静默什么都不做」，都靠 UI 手测覆盖不到。
 */
import { describe, expect, it } from 'vitest';

import {
  isEditableElement,
  resolveShortcut,
  type ShortcutContext,
  type ShortcutEventLike,
} from '../shortcuts';

/** 一个「干净的」按键：没有修饰键、焦点不在输入框、没有对话框、没有选中。 */
function key(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return { key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

function ctx(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
  return { editable: false, dialogOpen: false, hasSelection: false, ...overrides };
}

describe('resolveShortcut — 新建', () => {
  it('Cmd+N 与 Ctrl+N 都是新建（不做平台探测）', () => {
    expect(resolveShortcut(key({ key: 'n', metaKey: true }), ctx())).toBe('create');
    expect(resolveShortcut(key({ key: 'n', ctrlKey: true }), ctx())).toBe('create');
  });

  it('Shift / Alt 组合留给别的功能，不算新建', () => {
    expect(resolveShortcut(key({ key: 'N', metaKey: true, shiftKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: 'n', ctrlKey: true, altKey: true }), ctx())).toBeNull();
  });

  it('没有修饰键的 n 只是普通输入，不算新建', () => {
    expect(resolveShortcut(key({ key: 'n' }), ctx())).toBeNull();
  });

  it('新建不要求选中（空列表里也要能开对话框）', () => {
    expect(resolveShortcut(key({ key: 'n', metaKey: true }), ctx({ hasSelection: false }))).toBe(
      'create',
    );
  });
});

describe('resolveShortcut — 输入中不拦', () => {
  it('焦点在输入框里时任何键都不归面板（含 Cmd+N / Backspace）', () => {
    const editable = ctx({ editable: true, hasSelection: true });
    expect(resolveShortcut(key({ key: 'Backspace' }), editable)).toBeNull();
    expect(resolveShortcut(key({ key: 'Delete' }), editable)).toBeNull();
    expect(resolveShortcut(key({ key: 'Escape' }), editable)).toBeNull();
    expect(resolveShortcut(key({ key: 'n', metaKey: true }), editable)).toBeNull();
  });
});

describe('resolveShortcut — 对话框开着时键盘归它', () => {
  it('Escape 不在这里处理（Radix Dialog 自己关，两处都关 = 一次按键两个所有者）', () => {
    expect(
      resolveShortcut(key({ key: 'Escape' }), ctx({ dialogOpen: true, hasSelection: true })),
    ).toBeNull();
  });

  it('Cmd+N 不叠第二层对话框', () => {
    expect(resolveShortcut(key({ key: 'n', metaKey: true }), ctx({ dialogOpen: true }))).toBeNull();
  });

  it('Delete 不删掉对话框背后那一行', () => {
    expect(
      resolveShortcut(key({ key: 'Delete' }), ctx({ dialogOpen: true, hasSelection: true })),
    ).toBeNull();
  });
});

describe('resolveShortcut — 删除与关闭', () => {
  it('Delete / Backspace 删除选中的那一行（Mac 笔记本只有 Backspace）', () => {
    const selected = ctx({ hasSelection: true });
    expect(resolveShortcut(key({ key: 'Delete' }), selected)).toBe('delete');
    expect(resolveShortcut(key({ key: 'Backspace' }), selected)).toBe('delete');
  });

  it('没有选中时 Delete / Backspace / Escape 都不归面板', () => {
    const none = ctx({ hasSelection: false });
    expect(resolveShortcut(key({ key: 'Delete' }), none)).toBeNull();
    expect(resolveShortcut(key({ key: 'Backspace' }), none)).toBeNull();
    expect(resolveShortcut(key({ key: 'Escape' }), none)).toBeNull();
  });

  it('选中时 Escape 关闭详情面板', () => {
    expect(resolveShortcut(key({ key: 'Escape' }), ctx({ hasSelection: true }))).toBe('close');
  });

  it('其它键一律不归面板（含纯修饰键自身的 keydown）', () => {
    const selected = ctx({ hasSelection: true });
    expect(resolveShortcut(key({ key: 'a' }), selected)).toBeNull();
    expect(resolveShortcut(key({ key: 'Enter' }), selected)).toBeNull();
    expect(resolveShortcut(key({ key: 'Meta' }), selected)).toBeNull();
  });
});

describe('isEditableElement', () => {
  it('input / textarea 命中', () => {
    expect(isEditableElement(document.createElement('input'))).toBe(true);
    expect(isEditableElement(document.createElement('textarea'))).toBe(true);
  });

  it('普通元素（按钮 / div / 卡片）不命中', () => {
    expect(isEditableElement(document.createElement('button'))).toBe(false);
    expect(isEditableElement(document.createElement('div'))).toBe(false);
  });

  it('null / undefined（没有焦点）不命中', () => {
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement(undefined)).toBe(false);
  });

  it('contentEditable 在祖先上也算（光标在里面的 span 里）', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    host.appendChild(child);

    expect(isEditableElement(child)).toBe(true);
  });

  it('裸属性（contenteditable=""）与 plaintext-only 都算可编辑', () => {
    const bare = document.createElement('div');
    bare.setAttribute('contenteditable', '');
    const plain = document.createElement('div');
    plain.setAttribute('contenteditable', 'plaintext-only');

    expect(isEditableElement(bare)).toBe(true);
    expect(isEditableElement(plain)).toBe(true);
  });

  it('contenteditable="false" 是可编辑区里的「不可编辑岛」，中断向上查找', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const island = document.createElement('div');
    island.setAttribute('contenteditable', 'false');
    host.appendChild(island);

    expect(isEditableElement(island)).toBe(false);
  });

  it('无效值按 inherit 处理：继续向上找（不因为写了垃圾值就中断）', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const weird = document.createElement('div');
    weird.setAttribute('contenteditable', 'banana');
    host.appendChild(weird);

    expect(isEditableElement(weird)).toBe(true);
  });
});
