import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerInsertPort, unregisterInsertPort } from '@/shared/inputs/insertPorts';
import type { InsertPort } from '@/shared/inputs/insertPorts';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { setDragFile, useFileDrop } from '../useFileDrop';

/**
 * ⑤ 代码编辑器端口（AC3 / AC5）。
 *
 * 端口由 editor 域自己注册（`editor/api/editorInsertPort.ts`）—— `shared/inputs` 不 import
 * `features/editor`（Gate B），本文件用**假端口**钉住仲裁位次：编辑器是「本 session 激活
 * tab 的编辑器」时，即使指针 / 焦点都不在它上面，也必须由它接住，且不误伤终端。
 */

const session = WorkspaceSession.of('proj-1', null);
const SESSION_KEY = session.key;

const registered: string[] = [];

function port(
  id: string,
  kind: InsertPort['kind'],
  overrides: Partial<Omit<InsertPort, 'id' | 'kind'>> = {},
) {
  const calls: string[] = [];
  registered.push(id);
  registerInsertPort({
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
  });
  return { id, calls };
}

function mount() {
  return renderHook(() => useFileDrop({ onUnhandled: unhandled }));
}

let unhandled: ReturnType<typeof vi.fn>;

beforeEach(() => {
  unhandled = vi.fn();
});

function drop(path = '/src/App.tsx') {
  act(() => {
    setDragFile(path, 'proj-1');
  });
  act(() => {
    document.dispatchEvent(new Event('dragend'));
  });
}

afterEach(() => {
  for (const id of registered.splice(0)) unregisterInsertPort(id);
  vi.restoreAllMocks();
});

describe('S2 · 代码编辑器端口', () => {
  it('active_editor_port_receives_the_path', () => {
    const editor = port('code-editor:tab-1', 'code-editor', { isActive: () => true });
    const terminal = port('terminal:tab-2:p1', 'terminal', { isActive: () => true });
    mount();

    drop('/src/util.ts');

    expect(editor.calls).toEqual(['/src/util.ts ']);
    expect(terminal.calls).toHaveLength(0);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('inactive_editor_does_not_steal_from_the_terminal', () => {
    const editor = port('code-editor:tab-1', 'code-editor', { isActive: () => false });
    const terminal = port('terminal:tab-2:p1', 'terminal', { isActive: () => true });
    mount();

    drop();

    expect(terminal.calls).toEqual(['/src/App.tsx ']);
    expect(editor.calls).toHaveLength(0);
  });
});
