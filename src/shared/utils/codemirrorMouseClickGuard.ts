import type { Extension } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import { EditorView, type MouseSelectionStyle } from '@codemirror/view';

/**
 * 单击坐标映射护栏（WKWebView + 大文件场景）。
 *
 * 症状：滚动（滚轮/滚动条）后单击，光标落在错误位置；此前还会出现
 * 「旧光标位置 → 点击位置」的幻影选区。上游 6.43.11 未修复。
 *
 * 真实根因（探针实证 2026-09-09）：**WebKit focus 滚动漂移**。拖滚动条使
 * 编辑器 blur 后点击，CM mousedown 顺序是 startMouseSelection →
 * focusPreventScroll（同步 focus）→ mouseSel.start()（dispatch 新
 * selection）。WebKit 下 focusPreventScroll 失效：focus 把视图滚到「旧
 * caret」所在位置 → scrollTop 漂移 → 映射（无论哪种）基于错误 scrollTop，
 * 光标落错。不是 `posAtCoords` 的 heightMap 失准（Chromium 探针 + 双实例
 * 期间 CM 原生 basicMouseSelection 一直工作正常均证伪该假设）。
 *
 * 修复（两处，见 makeMouseClickGuardStyle）：
 * 1. **焦点锚定**：CM focus 之前把 selection dispatch 到点击处，focus 滚动
 *    目标变成视口内的新 caret，不再漂移。
 * 2. **静止点击恢复 scrollTop**：get() 中若 scrollTop 与 mousedown 时偏差
 *    > 2px，恢复 mousedown 值再映射。mousedown 的 start() 首次调 get() 同步
 *    完成，视觉无闪。
 *
 * 映射走 CM 原生 `posAndSideAtCoords`（与 basicMouseSelection 同一路径），
 * 不引入自建命中测试层。只接管单指单击（detail === 1）：
 * - 静止点击（位移 < 阈值）：返回 cursor，杜绝幻影 range；
 * - 真实拖拽（位移 ≥ 阈值）：保留默认 range(start, cur) 拖选语义；
 *   （拖拽期间 scrollTop 变化可能是用户拖出视口的 auto-scroll，属意图，
 *   不得恢复。）
 * - shift+click：保留默认 `startSel.main.extend` 扩选；
 * - 双击/三击 / 非主键：返回 null，回落 CM 内置 basicMouseSelection。
 *
 * 若上游修复 focusPreventScroll（WebKit 侧），scrollTop 恢复分支可删。
 */

/** Pointer movement below which a gesture is treated as a stationary click. */
const CLICK_MOVE_THRESHOLD_PX = 10;

interface MappedPoint {
  pos: number;
  assoc: -1 | 1;
}

/**
 * Map a viewport coordinate to a document position via CM's native
 * `posAndSideAtCoords`.
 */
function mapPoint(view: EditorView, x: number, y: number): MappedPoint {
  return view.posAndSideAtCoords({ x, y }, false);
}

export function makeMouseClickGuardStyle(
  view: EditorView,
  startEvent: MouseEvent,
): MouseSelectionStyle | null {
  if (startEvent.button !== 0) return null;
  if ((startEvent.detail || 1) !== 1) return null;

  const start = mapPoint(view, startEvent.clientX, startEvent.clientY);
  let startSel = view.state.selection;
  const startScrollTop = view.scrollDOM?.scrollTop ?? 0;

  // ── 焦点锚定（修复 WebKit focus 滚动漂移）────────────────────────────
  // 在 CM focus 之前把 selection dispatch 到点击处：caret 锚定在视口内的
  // 新位置，随后的 focus 滚动目标正确，scrollTop 不再漂移。
  const caret = EditorSelection.cursor(start.pos, start.assoc);
  try {
    if (typeof startSel.main.eq !== 'function' || !startSel.main.eq(caret)) {
      view.dispatch({ selection: caret, scrollIntoView: false });
    }
  } catch {
    // dispatch 失败不影响后续 mapping（兜底 CM 默认行为）
  }

  return {
    update(update) {
      if (update.docChanged) {
        start.pos = update.changes.mapPos(start.pos);
        startSel = startSel.map(update.changes);
      }
    },
    get(event, extend) {
      const moved =
        Math.abs(event.clientX - startEvent.clientX) + Math.abs(event.clientY - startEvent.clientY);
      // 静止点击：若 focus 滚动漂移了 scrollTop，先恢复 mousedown 值再映射。
      if (!extend && moved < CLICK_MOVE_THRESHOLD_PX) {
        const st = view.scrollDOM?.scrollTop;
        if (typeof st === 'number' && Math.abs(st - startScrollTop) > 2) {
          view.scrollDOM.scrollTop = startScrollTop;
        }
      }
      const cur = mapPoint(view, event.clientX, event.clientY);
      const clicked = EditorSelection.cursor(cur.pos, cur.assoc);
      if (extend) {
        return startSel.replaceRange(startSel.main.extend(clicked.from, clicked.to, cur.assoc));
      }
      if (moved < CLICK_MOVE_THRESHOLD_PX) {
        // Stationary click — never synthesize a phantom range.
        return EditorSelection.create([clicked]);
      }
      // Real drag — CM default semantics: anchor at mousedown, head at pointer.
      return EditorSelection.create([EditorSelection.range(start.pos, cur.pos, cur.assoc)]);
    },
  };
}

/** Install once in the CodeMirror extension list. */
export function mouseClickGuard(): Extension {
  return EditorView.mouseSelectionStyle.of(makeMouseClickGuardStyle);
}
