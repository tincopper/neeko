import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { imeSpaceGuard } from '../codemirrorIme';

// jsdom 可能缺少 CompositionEvent，这里提供一个带 data 属性的兜底实现。
type CompositionEventLike = new (
  type: string,
  init?: { data?: string; bubbles?: boolean },
) => Event;

const CompositionEventCtor: CompositionEventLike =
  typeof CompositionEvent === 'function'
    ? CompositionEvent
    : class extends Event {
        readonly data: string;
        constructor(type: string, init: { data?: string; bubbles?: boolean } = {}) {
          super(type, { bubbles: init.bubbles });
          this.data = init.data ?? '';
        }
      };

/** 构造一个 doc 已包含「分词空格」文本、光标位于末尾的 CodeMirror 视图（模拟
 *  compositionend 派发时 WebKit 已将带空格文本应用到 contenteditable 的状态）。 */
function makeView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [imeSpaceGuard()],
  });
  const view = new EditorView({ state });
  document.body.appendChild(view.dom);
  return view;
}

/** 派发 compositionend 并返回派发后文档文本。 */
function fireCompositionEnd(view: EditorView, data: string): string {
  view.contentDOM.dispatchEvent(
    new CompositionEventCtor('compositionend', { data, bubbles: true }),
  );
  return view.state.doc.toString();
}

const views: EditorView[] = [];

function track(view: EditorView): EditorView {
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }
});

describe('imeSpaceGuard', () => {
  it("doc='hai hao' 派发 data='hai hao' 时剥离分词空格为 'haihao'", () => {
    const view = track(makeView('hai hao'));
    expect(fireCompositionEnd(view, 'hai hao')).toBe('haihao');
  });

  it("doc='a b c' 派发 data='a b c' 时剥离全部分词空格为 'abc'", () => {
    const view = track(makeView('a b c'));
    expect(fireCompositionEnd(view, 'a b c')).toBe('abc');
  });

  it("doc='你好' 派发 data='你好'（真实 CJK 提交）时文档不变", () => {
    const view = track(makeView('你好'));
    expect(fireCompositionEnd(view, '你好')).toBe('你好');
  });

  it("doc='hello' 派发 data='   '（纯空格）时文档不变", () => {
    const view = track(makeView('hello'));
    expect(fireCompositionEnd(view, '   ')).toBe('hello');
  });

  it("doc='haihao' 派发 data='hai hao'（光标前文本不匹配 data）时文档不变", () => {
    const view = track(makeView('haihao'));
    expect(fireCompositionEnd(view, 'hai hao')).toBe('haihao');
  });

  it('data 为空时文档不变', () => {
    const view = track(makeView('hello'));
    expect(fireCompositionEnd(view, '')).toBe('hello');
  });

  it('光标位于文档中间且光标前恰为拼音缓冲区时仅替换该段', () => {
    const state = EditorState.create({
      doc: 'prefix hai hao suffix',
      selection: { anchor: 'prefix hai hao'.length },
      extensions: [imeSpaceGuard()],
    });
    const view = track(new EditorView({ state }));
    document.body.appendChild(view.dom);

    const result = fireCompositionEnd(view, 'hai hao');

    expect(result).toBe('prefix haihao suffix');
  });

  it('真实时序：compositionend 派发时 doc 尚未包含提交文本（CodeMirror 异步 flush 前），flush 后仍剥离', async () => {
    const state = EditorState.create({
      doc: '',
      selection: { anchor: 0 },
      extensions: [imeSpaceGuard()],
    });
    const view = track(new EditorView({ state }));
    document.body.appendChild(view.dom);

    // 派发 compositionend 时 doc 仍为空 —— 模拟 WebKit 已更新 DOM 但
    // @codemirror/view 的 observers.compositionend 仅调度异步 flush、尚未读 DOM 的时序。
    view.contentDOM.dispatchEvent(
      new CompositionEventCtor('compositionend', { data: 'hai hao', bubbles: true }),
    );

    // 模拟 CodeMirror 随后的异步 flush：把 DOM 中的提交文本应用到文档。
    view.dispatch({
      changes: { from: 0, insert: 'hai hao' },
      selection: { anchor: 'hai hao'.length },
    });

    // 等待微任务，让 guard（若延迟核对）有机会执行
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.toString()).toBe('haihao');
  });
});
