import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  listInsertPorts,
  portsOf,
  registerInsertPort,
  resolvePortAtFocus,
  resolvePortAtPoint,
  unregisterInsertPort,
  type InsertPort,
} from '../insertPorts';

/**
 * 插入端口注册表：**端口由渲染方注册**（只有它同时知道 PTY sessionId / paneId /
 * 激活态 / DOM 根）。本文件钉住三件事：
 *
 * 1. 指针落点 → 取**最内层**命中的端口（嵌套端口不打架）；
 * 2. 焦点 → 取包含 `document.activeElement` 的端口（焦点只作为**已注册端口的键**，
 *    不是「这是某某输入」的代理判据，见 R6）；
 * 3. 引用计数式注销（StrictMode 双挂载：先卸载不得摘掉仍存活的登记）。
 */

const registered: string[] = [];
const mounted: HTMLElement[] = [];

function makePort(overrides: Partial<InsertPort> & { id: string }): InsertPort {
  return {
    kind: 'terminal',
    sessionKey: 'session-a',
    el: null,
    isActive: () => true,
    insert: () => true,
    ...overrides,
  };
}

function reg(port: InsertPort): InsertPort {
  registered.push(port.id);
  registerInsertPort(port);
  return port;
}

function div(child?: HTMLElement): HTMLDivElement {
  const el = document.createElement('div');
  if (child) el.appendChild(child);
  document.body.appendChild(el);
  mounted.push(el);
  return el;
}

afterEach(() => {
  for (const id of registered.splice(0)) unregisterInsertPort(id);
  for (const el of mounted.splice(0)) el.remove();
  vi.restoreAllMocks();
});

describe('resolvePortAtPoint（① 指针落点）', () => {
  it('resolve_at_point_prefers_containing_port', () => {
    const inner = document.createElement('span');
    const root = div(inner);
    const hit = reg(makePort({ id: 'terminal:x', el: root }));
    // 其他 session 的同形端口各归各的：本模块按 sessionKey 隔离（仲裁只在 session 内挑）
    reg(makePort({ id: 'terminal:other', sessionKey: 'session-b', el: root }));

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(inner);

    expect(resolvePortAtPoint('session-a', 10, 20)).toBe(hit);
    expect(resolvePortAtPoint('session-b', 10, 20)?.id).toBe('terminal:other');
  });

  it('resolve_at_point_takes_the_innermost_of_nested_ports', () => {
    const child = document.createElement('span');
    const root = div(div(child));
    const outer = reg(makePort({ id: 'terminal:outer', el: root }));
    const innerEl = root.firstChild as HTMLElement;
    const inner = reg(makePort({ id: 'terminal:inner', el: innerEl }));

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(child);

    expect(outer).not.toBe(inner);
    expect(resolvePortAtPoint('session-a', 0, 0)).toBe(inner);
  });

  it('resolve_at_point_misses_when_nothing_contains_the_hit', () => {
    reg(makePort({ id: 'terminal:x', el: div() }));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body);

    expect(resolvePortAtPoint('session-a', 0, 0)).toBeNull();
  });
});

describe('resolvePortAtFocus（② 焦点所在端口）', () => {
  it('resolve_at_focus_finds_port_containing_active_element', () => {
    const box = document.createElement('textarea');
    const root = div(box);
    const hit = reg(makePort({ id: 'terminal:focus', el: root }));
    box.focus();

    expect(resolvePortAtFocus('session-a')).toBe(hit);
  });

  it('resolve_at_focus_is_null_when_focus_is_outside_every_port', () => {
    reg(makePort({ id: 'terminal:x', el: div() }));
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    mounted.push(outside);
    outside.focus();

    expect(resolvePortAtFocus('session-a')).toBeNull();
  });
});

describe('登记生命周期', () => {
  it('registration_is_ref_counted', () => {
    const first = makePort({ id: 'terminal:dup' });
    const second = makePort({ id: 'terminal:dup' });
    registered.push('terminal:dup');
    registerInsertPort(first);
    registerInsertPort(second);

    unregisterInsertPort('terminal:dup');
    // StrictMode 先卸载的那次不得摘掉仍存活的登记
    expect(listInsertPorts('session-a').map((p) => p.id)).toEqual(['terminal:dup']);
    // 后登记的实例胜出（先来的闭包可能已过期）
    expect(listInsertPorts('session-a')[0]).toBe(second);

    unregisterInsertPort('terminal:dup');
    expect(listInsertPorts('session-a')).toEqual([]);
  });

  it('unregister_of_unknown_id_is_a_no_op', () => {
    expect(() => unregisterInsertPort('never-registered')).not.toThrow();
    expect(listInsertPorts('session-a')).toEqual([]);
  });
});

describe('portsOf（④⑤⑥ 按种类取）', () => {
  it('filters_by_kind_and_session', () => {
    reg(makePort({ id: 'agent-composer:a', kind: 'agent-composer' }));
    reg(makePort({ id: 'terminal:t', kind: 'terminal' }));
    reg(makePort({ id: 'terminal:other', kind: 'terminal', sessionKey: 'session-b' }));

    expect(portsOf('session-a', 'agent-composer').map((p) => p.id)).toEqual(['agent-composer:a']);
    expect(portsOf('session-a', 'terminal').map((p) => p.id)).toEqual(['terminal:t']);
    expect(portsOf('session-a', 'code-editor')).toEqual([]);
  });
});
