import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { flushMicrotasks } from '@/testing/async';

import { __diagnosticsMirrorForTests, lspDiagnosticsProjection } from '../lspDiagnosticsProjection';

/**
 * 投影契约：`setDiagnostics` 推送（由 @codemirror/lsp-client 产生）落到 CM 后，
 * 即使宿主重建编辑器配置（`@uiw/react-codemirror` 在 extensions 身份变化时
 * dispatch `StateEffect.reconfigure`），波浪线也必须自愈——因为
 * `@codemirror/lint` 的渲染扩展是经 `StateEffect.appendConfig` 惰性安装的，
 * 而 reconfigure 会整体替换 base 把它丢掉（state 源码 2614-2621 实证）。
 */
describe('lspDiagnosticsProjection — 配置重建后诊断投影自愈', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
  });

  /** 模拟 @uiw/react-codemirror：新数组身份 + 相同扩展实例（模块级单例）。 */
  function reconfigure(view: EditorView, extra: Extension[] = []): void {
    view.dispatch({
      effects: StateEffect.reconfigure.of([...lspDiagnosticsProjection(), ...extra]),
    });
  }

  function makeView(doc: string, extra: Extension[] = []): EditorView {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [...lspDiagnosticsProjection(), ...extra],
      }),
      parent: document.body,
    });
    views.push(view);
    return view;
  }

  function push(view: EditorView, diagnostics: Diagnostic[]): void {
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }

  function waveNodes(view: EditorView): NodeListOf<Element> {
    return view.dom.querySelectorAll('.cm-lintRange-error');
  }

  it('推送诊断 → 渲染波浪线', () => {
    const view = makeView('const value = fmt.Println(1);');
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);

    expect(waveNodes(view)).toHaveLength(1);
  });

  it('配置重建后波浪线自愈（核心回归：曾经出现后消失且不恢复）', async () => {
    const view = makeView('const value = fmt.Println(1);');
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);
    expect(waveNodes(view)).toHaveLength(1);

    reconfigure(view);
    await flushMicrotasks();

    expect(waveNodes(view)).toHaveLength(1);
  });

  it('mirror 随文档变化映射位置（插入位移）', () => {
    const view = makeView('const value = fmt.Println(1);');
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);

    view.dispatch({ changes: { from: 0, insert: 'ab' } });

    const mirror = view.state.field(__diagnosticsMirrorForTests);
    expect(mirror.map((d) => [d.from, d.to])).toEqual([[16, 19]]);
  });

  it('诊断所在文本被删除 → 塌缩项丢弃，配置重建不复活', async () => {
    const view = makeView('const value = fmt.Println(1);');
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);

    // 删掉被诊断的 `fmt` 本身 → 该诊断塌缩为空区间，与 lint 的装饰语义一致地丢弃
    view.dispatch({ changes: { from: 14, to: 17, insert: '' } });

    expect(view.state.field(__diagnosticsMirrorForTests)).toHaveLength(0);

    reconfigure(view);
    await flushMicrotasks();

    expect(waveNodes(view)).toHaveLength(0);
  });

  it('mirror 为空时配置重建不产生多余事务', async () => {
    let transactions = 0;
    const counter = EditorView.updateListener.of(() => {
      transactions += 1;
    });
    const view = makeView('const value = 1;', [counter]);

    reconfigure(view, [counter]);
    await flushMicrotasks();

    expect(transactions).toBe(1);
  });

  it('推送诊断本身不触发重放（appendConfig 同样改变 config，判据须只认 reconfigure）', async () => {
    let transactions = 0;
    const counter = EditorView.updateListener.of(() => {
      transactions += 1;
    });
    const view = makeView('const value = fmt.Println(1);', [counter]);

    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);
    await flushMicrotasks();

    expect(transactions).toBe(1);
    expect(waveNodes(view)).toHaveLength(1);
  });

  it('连续两次配置重建合并为一次重放', async () => {
    let transactions = 0;
    const counter = EditorView.updateListener.of(() => {
      transactions += 1;
    });
    const view = makeView('const value = fmt.Println(1);', [counter]);
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);

    reconfigure(view, [counter]);
    reconfigure(view, [counter]);
    await flushMicrotasks();

    // setDiagnostics + 两次 reconfigure + 一次合并后的重放（多一次即判据或合并失效）
    expect(transactions).toBe(4);
    expect(waveNodes(view)).toHaveLength(1);
  });

  it('重放前镜像被服务端清空 → 不重放（不复活已清空的诊断）', async () => {
    const view = makeView('const value = fmt.Println(1);');
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);

    reconfigure(view);
    // 重放微任务兑现前，服务端推送空诊断（文件关闭 / 问题修复）
    push(view, []);
    await flushMicrotasks();

    expect(waveNodes(view)).toHaveLength(0);
  });

  it('视图销毁后挂起的重放不抛错', async () => {
    const view = makeView('const value = fmt.Println(1);');
    push(view, [{ from: 14, to: 17, severity: 'error', message: 'undefined: fmt' }]);

    reconfigure(view);
    view.destroy();

    await expect(flushMicrotasks()).resolves.toBeUndefined();
  });
});
