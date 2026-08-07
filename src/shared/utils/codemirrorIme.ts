import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { isAbandonedImeAsciiBuffer, stripImeSegmentationSpaces } from './ime';

/** CodeMirror 扩展：修复 macOS WKWebView 下切换输入法放弃组字时提交的「分词空格」。
 *  compositionend 派发时从光标 head 回退 data.length 精确定位并核对原文后，
 *  以剥离空格版本替换。兼容两种时序：
 *  - 文档已应用带空格文本（同步核对命中，立即修正）；
 *  - CodeMirror 内部 observers 尚未把 DOM 变更 flush 到 view.state（微任务中重试）。
 *  注意：@codemirror/view 的 DOMEventHandlers 签名为 (event, view)。 */
export function imeSpaceGuard(): Extension {
  return EditorView.domEventHandlers({
    compositionend: (e, view) => {
      const data = e.data;
      if (!data || !isAbandonedImeAsciiBuffer(data)) return false;

      const tryFix = (): boolean => {
        try {
          const head = view.state.selection.main.head;
          const from = Math.max(0, head - data.length);
          if (view.state.doc.sliceString(from, head) !== data) return false;
          view.dispatch({ changes: { from, to: head, insert: stripImeSegmentationSpaces(data) } });
          return true;
        } catch {
          // view 在微任务执行前已被销毁等场景，跳过修正
          return false;
        }
      };

      if (!tryFix()) {
        // compositionend 派发时 @codemirror/view 的内部 observers 只调度异步 flush
        // （DOM 变更尚未应用到 view.state），同步核对必然失败。延迟到微任务、
        // 在 flush 之后重试一次，保证真实 WKWebView 时序下同样生效。
        queueMicrotask(() => {
          tryFix();
        });
      }
      return false;
    },
  });
}
