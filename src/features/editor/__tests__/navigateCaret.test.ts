import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  applyNavigateCaret,
  navigateCaretExtension,
  resolveDocPos,
} from "../navigateCaret";

function makeView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [navigateCaretExtension],
    }),
    parent,
  });
}

describe("navigateCaret", () => {
  it("should_clamp_line_and_col_to_doc", () => {
    const view = makeView("hello\nworld\n");
    expect(resolveDocPos(view, 1, 0)).toEqual({ pos: 0, line: 1 });
    expect(resolveDocPos(view, 2, 2)?.line).toBe(2);
    expect(resolveDocPos(view, 2, 99)?.pos).toBe(view.state.doc.line(2).to);
    expect(resolveDocPos(view, 99, 0)?.line).toBe(view.state.doc.lines);
    view.destroy();
  });

  it("should_move_selection_to_target_on_apply", () => {
    const view = makeView("aaa\nbbb\nccc");
    const ok = applyNavigateCaret(view, 2, 1, { flashMs: 10 });
    expect(ok).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from + 1);
    view.destroy();
  });

  it("should_return_false_for_empty_doc_edge", () => {
    const view = makeView("");
    // empty doc still has 1 empty line in CodeMirror
    const resolved = resolveDocPos(view, 1, 0);
    expect(resolved).not.toBeNull();
    view.destroy();
  });
});
