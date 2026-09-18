import { setDiagnostics } from '@codemirror/lint';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lspDiagnosticsProjection } from '@/features/lsp';
import { flushMicrotasks } from '@/testing/async';

import { useEditorExtensions } from '../useEditorExtensions';

/**
 * 装配层契约：`useEditorExtensions` 产出的 extensions 就是
 * `@uiw/react-codemirror` 的 `extensions` prop。
 *
 * 为何单独钉住这一层：投影模块自身的单测（`lspDiagnosticsProjection.test.ts`）直接构造
 * EditorView，**不经过真实装配段**；而 `FileEditor.compose.test.tsx` 为隔离依赖把门面
 * stub 成 `lspDiagnosticsProjection: () => []`。两处夹击之下，「装配段到底有没有把投影
 * 放进扩展列表」无人断言 —— 一旦该行被删/被重排，全部测试依旧全绿，用户侧波浪线
 * 「出现后消失」的回归会静默复现。
 */
describe('useEditorExtensions — 诊断投影装配契约', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
  });

  /** 命名不带 `use` 前缀：内部只是 renderHook 包装，不是自定义 Hook。 */
  function renderAssembledExtensions() {
    return renderHook(() =>
      useEditorExtensions({
        fontFamily: '',
        fontSize: 14,
        langExtension: null,
        saveKeymap: [],
        viewStateExt: [],
        lspClientExt: [],
        lspKeymap: [],
        cmdClickExt: [],
        linkHighlightExt: [],
        bpGutterExt: [],
        handleLnClick: vi.fn(() => false),
        handleLnHover: vi.fn(() => false),
        handleLnLeave: vi.fn(() => false),
      }),
    );
  }

  it('扩展列表包含诊断投影（模块级单例，不引入配置抖动）', () => {
    const { result } = renderAssembledExtensions();

    // 引用相等：投影是模块级单例，重复装配不会产生新的扩展身份。
    expect(result.current.extensions).toContain(lspDiagnosticsProjection());
  });

  it('真实装配段下配置重建后波浪线自愈（端到端回归）', async () => {
    const { result } = renderAssembledExtensions();
    const extensions = result.current.extensions as Extension[];

    const view = new EditorView({
      state: EditorState.create({ doc: 'const value = fmt.Println(1);', extensions }),
      parent: document.body,
    });
    views.push(view);

    view.dispatch(
      setDiagnostics(view.state, [
        { from: 14, to: 17, severity: 'error', message: 'undefined: fmt' },
      ]),
    );
    expect(view.dom.querySelector('.cm-lintRange-error')).not.toBeNull();

    // 模拟 @uiw/react-codemirror 在 extensions 身份变化时的 reconfigure
    view.dispatch({ effects: StateEffect.reconfigure.of([...extensions]) });
    await flushMicrotasks();

    expect(view.dom.querySelector('.cm-lintRange-error')).not.toBeNull();
  });
});
