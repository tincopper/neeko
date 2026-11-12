import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerInsertPort,
  unregisterInsertPort,
  type InsertPort,
  type InsertPortKind,
} from '@/shared/inputs/insertPorts';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { setDragFile, useFileDrop } from '../useFileDrop';

/**
 * 文件拖拽投递的**仲裁**（`useFileDrop`）。
 *
 * 本文件第一条用例就是 2026-11 事故的回归钉：终端不在第一个 pane（右侧 dock / 分屏）时，
 * 旧实现按 `paneId = 'p1'` 解析 PTY ⇒ 精确键必然 miss ⇒ **静默无操作**。
 * 现在端口由渲染方注册（自带自己的 PTY sessionId），pane 无关性从结构上成立。
 *
 * 仲裁顺序（每一级都真的调 `insert()`，返回 false 就继续）：
 * ① 指针落点端口 → ② 焦点所在端口 → ③ 聚焦文本控件 → ④ composer → ⑤ 代码编辑器
 * → ⑥ 终端 → ⑦ `onUnhandled`（toast + debug，**不再静默**）。
 */

const session = WorkspaceSession.of('proj-1', null);
const SESSION_KEY = session.key;

const registered: string[] = [];
const mounted: HTMLElement[] = [];

/** 造一个端口并登记：`calls` 记录它收到的文本（未收到 = 没被仲裁命中）。 */
function port(
  id: string,
  kind: InsertPortKind,
  overrides: Partial<Omit<InsertPort, 'id' | 'kind'>> = {},
) {
  const calls: string[] = [];
  const value: InsertPort = {
    id,
    kind,
    sessionKey: SESSION_KEY,
    el: null,
    isActive: () => false,
    insert: (text) => {
      calls.push(text);
      return true;
    },
    ...overrides,
  };
  registered.push(id);
  registerInsertPort(value);
  return { id, calls, value };
}

/** 挂一个受控的 DOM 子树（端口 el 用），用例结束统一摘除。 */
function mountEl<K extends keyof HTMLElementTagNameMap>(tag: K, parent?: HTMLElement) {
  const el = document.createElement(tag);
  (parent ?? document.body).appendChild(el);
  mounted.push(el);
  return el;
}

function mount() {
  return renderHook(() => useFileDrop(handlers()));
}

let unhandled: ReturnType<typeof vi.fn>;

function handlers() {
  return { onUnhandled: unhandled };
}

function dragStart(path = '/some/path', projectId = 'proj-1') {
  act(() => {
    setDragFile(path, projectId);
  });
}

function hover(x: number, y: number) {
  act(() => {
    document.dispatchEvent(new MouseEvent('dragover', { clientX: x, clientY: y }));
  });
}

function dragEnd() {
  act(() => {
    document.dispatchEvent(new Event('dragend'));
  });
}

/** 一次最朴素的拖放：无指针命中（`elementFromPoint` → null）、无焦点落在端口内。 */
function drop(path = '/some/path') {
  dragStart(path);
  dragEnd();
}

afterEach(() => {
  for (const id of registered.splice(0)) unregisterInsertPort(id);
  for (const el of mounted.splice(0)) el.remove();
  vi.restoreAllMocks();
});

beforeEach(() => {
  unhandled = vi.fn();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

describe('S1 · 终端端口（pane 无关）', () => {
  /**
   * **本次 bug 的回归钉**：终端在非默认 pane 也必须落地。
   * 旧实现（`terminalCache.resolveTerminalEntry` 的 `paneId='p1'` 默认值）在本用例上必红：
   * 缓存里只有 `:p2` 这一条，精确键恒 miss，`{ ok: false }` 且无任何提示。
   */
  it('terminal_in_a_non_default_pane_receives_the_path', () => {
    const terminal = port('terminal:tab-1:p2', 'terminal', { isActive: () => false });
    mount();

    drop('/dir/file.txt');

    expect(terminal.calls).toEqual(['/dir/file.txt ']);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('激活 pane 的终端优先于未激活的 pane', () => {
    const inactive = port('terminal:tab-1:p1', 'terminal', { isActive: () => false });
    const active = port('terminal:tab-1:p2', 'terminal', { isActive: () => true });
    mount();

    drop();

    expect(active.calls).toHaveLength(1);
    expect(inactive.calls).toHaveLength(0);
  });
});

describe('S1 · 仲裁顺序', () => {
  it('pointer_port_wins_over_everything_else', () => {
    const composer = port('agent-composer:c1', 'agent-composer', { isActive: () => true });
    const root = mountEl('div');
    const hit = mountEl('span', root);
    const terminal = port('terminal:t1:p1', 'terminal', { el: root });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(hit);
    mount();

    dragStart();
    hover(120, 40);
    dragEnd();

    expect(terminal.calls).toHaveLength(1);
    expect(composer.calls).toHaveLength(0);
  });

  it('focused_port_wins_over_the_composer', () => {
    const composer = port('agent-composer:c1', 'agent-composer', { isActive: () => true });
    const root = mountEl('div');
    const box = mountEl('textarea', root);
    const terminal = port('terminal:t1:p1', 'terminal', { el: root });
    box.focus();
    mount();

    drop();

    expect(terminal.calls).toHaveLength(1);
    expect(composer.calls).toHaveLength(0);
  });

  it('falls_back_to_composer_then_editor_then_terminal', () => {
    const terminal = port('terminal:t1:p1', 'terminal', { isActive: () => true });
    const editor = port('code-editor:e1', 'code-editor', { isActive: () => true });
    const composer = port('agent-composer:c1', 'agent-composer', { isActive: () => true });
    mount();

    drop();

    expect(composer.calls).toHaveLength(1);
    expect(editor.calls).toHaveLength(0);
    expect(terminal.calls).toHaveLength(0);
  });

  /** 端口的 `insert()` 返回 false = 本次没落地 —— 调用方必须继续下一个候选。 */
  it('port_refusing_does_not_stop_the_chain', () => {
    const refusingInsert = vi.fn(() => false);
    port('terminal:t1:p1', 'terminal', { isActive: () => true, insert: refusingInsert });
    const next = port('terminal:t1:p2', 'terminal', { isActive: () => false });
    mount();

    drop();

    expect(refusingInsert).toHaveBeenCalledTimes(1);
    expect(next.calls).toEqual(['/some/path ']);
    expect(unhandled).not.toHaveBeenCalled();
  });

  /** 仲裁只在**本 session** 内挑端口：别的 workspace 的端口永不接住本次投递。 */
  it('other_session_ports_are_never_consulted', () => {
    const foreign = port('terminal:other:p1', 'terminal', {
      sessionKey: WorkspaceSession.of('proj-1', '/wt/a').key,
      isActive: () => true,
    });
    mount();

    drop();

    expect(foreign.calls).toHaveLength(0);
    expect(unhandled).toHaveBeenCalledTimes(1);
  });
});

describe('S1 · 未命中必须可见（R4）', () => {
  it('unhandled_drop_calls_onUnhandled', () => {
    mount();

    drop('/dir/nowhere');

    expect(unhandled).toHaveBeenCalledTimes(1);
    expect(unhandled).toHaveBeenCalledWith('/dir/nowhere ');
    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it('onUnhandled_is_optional（没有注入时只是记日志，不抛）', () => {
    renderHook(() => useFileDrop());

    expect(() => drop()).not.toThrow();
    expect(console.debug).toHaveBeenCalledTimes(1);
  });
});

describe('S3 · 焦点文本控件端口', () => {
  /** `document.execCommand('insertText')` 在选区处插入（真实浏览器行为的最小替身）。 */
  function stubExecCommand() {
    const fn = vi.fn((command: string, _ui?: boolean, text?: string) => {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      if (command !== 'insertText' || !el || typeof el.selectionStart !== 'number') return false;
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      el.value = `${el.value.slice(0, start)}${text ?? ''}${el.value.slice(end)}`;
      el.setSelectionRange(start + (text ?? '').length, start + (text ?? '').length);
      return true;
    });
    (document as unknown as { execCommand: unknown }).execCommand = fn;
    return fn;
  }

  afterEach(() => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it('focused_input_receives_text_at_cursor', () => {
    const input = mountEl('input');
    input.value = 'see ';
    input.focus();
    input.setSelectionRange(4, 4);
    stubExecCommand();
    mount();

    drop('/src/a.ts');

    expect(input.value).toBe('see /src/a.ts ');
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('focused_textarea_receives_text_at_cursor', () => {
    const box = mountEl('textarea');
    box.value = 'commit: ';
    box.focus();
    box.setSelectionRange(8, 8);
    stubExecCommand();
    mount();

    drop('/src/b.ts');

    expect(box.value).toBe('commit: /src/b.ts ');
  });

  it('text_control_that_did_not_really_insert_falls_through_to_unhandled', () => {
    const input = mountEl('input');
    input.value = 'unchanged';
    input.focus();
    input.setSelectionRange(9, 9);
    // execCommand 说成功但什么都没变（＝文本没进去）不得被当成落地
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
    mount();

    drop('/src/c.ts');

    expect(input.value).toBe('unchanged');
    expect(unhandled).toHaveBeenCalledTimes(1);
  });
});

describe('useFileDrop · pendingDrag 生命周期与文本形态', () => {
  it('无 pendingDrag → 什么都不做', () => {
    const terminal = port('terminal:t1:p1', 'terminal', { isActive: () => true });
    mount();
    dragEnd();

    expect(terminal.calls).toHaveLength(0);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('pendingDrag 单次消费：第二次 dragend 不重复投递', () => {
    const terminal = port('terminal:t1:p1', 'terminal', { isActive: () => true });
    mount();

    drop();
    dragEnd();

    expect(terminal.calls).toHaveLength(1);
  });

  it('卸载后不再响应 dragend（监听器已摘）', () => {
    const terminal = port('terminal:t1:p1', 'terminal', { isActive: () => true });
    const { unmount } = mount();
    unmount();

    act(() => {
      setDragFile('/after/unmount', 'proj-1');
      document.dispatchEvent(new Event('dragend'));
    });

    expect(terminal.calls).toHaveLength(0);
  });

  it('路径原样 + 一个尾空格：不加引号、不加尾斜杠、不补 \\r（可继续输入）', () => {
    const terminal = port('terminal:t1:p1', 'terminal', { isActive: () => true });
    mount();

    drop('/dir/with space.txt');

    const text = terminal.calls[0];
    expect(text).toBe('/dir/with space.txt ');
    expect(text.startsWith('"')).toBe(false);
    expect(text.endsWith('/')).toBe(false);
    expect(text.endsWith('\r')).toBe(false);
  });
});
