import { EditorState, RangeSet, StateEffect } from '@codemirror/state';
import { EditorView, gutter, lineNumbers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import type { FileLineChange } from '@/shared/types/git';

import {
  createGitChangeExtensions,
  fileLineChangesField,
  setFileLineChangesEffect,
} from '../index';

const DOC = ['line one', 'line two', 'line three', 'line four', 'line five'].join('\n');

function makeView(enabled = true, changes: FileLineChange[] = []) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [lineNumbers(), ...createGitChangeExtensions(enabled)],
    }),
    parent,
  });
  if (changes.length > 0) {
    view.dispatch({ effects: setFileLineChangesEffect.of(changes) });
  }
  return view;
}

function drawGutter(view: EditorView) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } });
}

describe('fileLineChangesField', () => {
  it('should_update_state_on_set_effect', () => {
    const state = EditorState.create({
      doc: DOC,
      extensions: [fileLineChangesField],
    });
    const next = state.update({
      effects: setFileLineChangesEffect.of([{ line: 2, kind: 'added' }]),
    }).state;
    expect(next.field(fileLineChangesField)).toEqual([{ line: 2, kind: 'added' }]);
  });

  it('should_keep_previous_value_for_unrelated_effects', () => {
    const noop = StateEffect.define<null>();
    let state = EditorState.create({
      doc: DOC,
      extensions: [fileLineChangesField],
    });
    state = state.update({
      effects: setFileLineChangesEffect.of([{ line: 1, kind: 'modified' }]),
    }).state;
    state = state.update({ effects: noop.of(null) }).state;
    expect(state.field(fileLineChangesField)).toEqual([{ line: 1, kind: 'modified' }]);
  });

  it('should_remap_line_numbers_when_document_changes', () => {
    const state = EditorState.create({
      doc: DOC,
      extensions: [fileLineChangesField],
    });
    let next = state.update({
      effects: setFileLineChangesEffect.of([{ line: 3, kind: 'added' }]),
    }).state;
    // 在文档开头插入一行 → 原 line 3 变为 line 4
    next = next.update({ changes: { from: 0, insert: 'inserted\n' } }).state;
    expect(next.field(fileLineChangesField)).toEqual([{ line: 4, kind: 'added' }]);
  });
});

describe('line decorations', () => {
  it('should_apply_line_background_classes', () => {
    const view = makeView(true, [
      { line: 2, kind: 'modified', words: [{ from: 5, to: 7 }] },
      { line: 4, kind: 'added' },
    ]);
    const lines = view.dom.querySelectorAll('.cm-line');
    expect(lines[1].className).toContain('cm-git-line-modified');
    expect(lines[3].className).toContain('cm-git-line-added');
    expect(lines[0].className).not.toContain('cm-git-line');
    view.destroy();
  });

  it('should_mark_word_ranges_inside_modified_line', () => {
    const view = makeView(true, [{ line: 1, kind: 'modified', words: [{ from: 0, to: 4 }] }]);
    const marks = view.dom.querySelectorAll('.cm-git-word');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('line');
    view.destroy();
  });

  it('should_clip_out_of_range_word_spans', () => {
    const view = makeView(true, [{ line: 1, kind: 'modified', words: [{ from: 0, to: 9999 }] }]);
    const marks = view.dom.querySelectorAll('.cm-git-word');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('line one');
    view.destroy();
  });

  it('should_render_no_decorations_without_data', () => {
    const view = makeView(true, []);
    expect(view.dom.querySelectorAll('.cm-git-line-added')).toHaveLength(0);
    expect(view.dom.querySelectorAll('.cm-git-line-modified')).toHaveLength(0);
    expect(view.dom.querySelectorAll('.cm-git-word')).toHaveLength(0);
    view.destroy();
  });

  it('should_render_nothing_when_disabled', () => {
    const view = makeView(false, [{ line: 1, kind: 'added' }]);
    expect(view.dom.querySelector('.cm-change-gutter')).toBeNull();
    expect(view.dom.querySelectorAll('.cm-git-line-added')).toHaveLength(0);
    view.destroy();
  });
});

describe('change gutter', () => {
  it('should_render_bars_only_on_changed_lines', () => {
    const view = makeView(true, [
      { line: 2, kind: 'modified' },
      { line: 4, kind: 'added' },
    ]);
    drawGutter(view);
    const gutterEl = view.dom.querySelector('.cm-change-gutter');
    expect(gutterEl).not.toBeNull();
    const bars = gutterEl!.querySelectorAll('.cm-change-bar');
    expect(bars).toHaveLength(2);
    expect(gutterEl!.querySelectorAll('.cm-change-bar--modified')).toHaveLength(1);
    expect(gutterEl!.querySelectorAll('.cm-change-bar--added')).toHaveLength(1);
    view.destroy();
  });

  it('should_mark_contiguous_segment_ends', () => {
    const view = makeView(true, [
      { line: 1, kind: 'added' },
      { line: 2, kind: 'added' },
      { line: 3, kind: 'added' },
      { line: 5, kind: 'modified' },
    ]);
    drawGutter(view);
    const gutterEl = view.dom.querySelector('.cm-change-gutter')!;
    // 连续 added 段（line 1-3）：start + mid + end；孤立 modified（line 5）：single
    expect(gutterEl.querySelectorAll('.cm-change-bar--seg-start')).toHaveLength(1);
    expect(gutterEl.querySelectorAll('.cm-change-bar--seg-end')).toHaveLength(1);
    expect(gutterEl.querySelectorAll('.cm-change-bar--seg-mid')).toHaveLength(1);
    expect(gutterEl.querySelectorAll('.cm-change-bar--seg-single')).toHaveLength(1);
    view.destroy();
  });

  it('should_break_segment_between_different_kinds', () => {
    const view = makeView(true, [
      { line: 1, kind: 'added' },
      { line: 2, kind: 'modified' },
    ]);
    drawGutter(view);
    const gutterEl = view.dom.querySelector('.cm-change-gutter')!;
    const bars = gutterEl.querySelectorAll('.cm-change-bar');
    expect(bars[0].className).toContain('cm-change-bar--seg-single');
    expect(bars[1].className).toContain('cm-change-bar--seg-single');
    view.destroy();
  });

  it('should_not_join_interactive_gutter_registry', () => {
    const view = makeView(true, [{ line: 1, kind: 'added' }]);
    drawGutter(view);
    const gutterEl = view.dom.querySelector('.cm-change-gutter')!;
    expect(gutterEl.querySelector('[data-gutter-contribution]')).toBeNull();
    view.destroy();
  });

  it('should_sit_left_of_breakpoint_column_when_both_present', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    // 镜像 FileEditor 装配序：change gutter → unified breakpoint gutter → line numbers
    const dummyGutter = gutter({ class: 'cm-breakpoint-gutter', markers: () => RangeSet.empty });
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [...createGitChangeExtensions(true), dummyGutter, lineNumbers()],
      }),
      parent,
    });
    view.dispatch({ effects: setFileLineChangesEffect.of([{ line: 1, kind: 'added' }]) });
    drawGutter(view);
    const names = Array.from(view.dom.querySelectorAll('.cm-gutters > .cm-gutter')).map((g) =>
      String(g.className),
    );
    expect(names[0]).toContain('cm-change-gutter');
    expect(names[1]).toContain('cm-breakpoint-gutter');
    expect(names[2]).toContain('cm-lineNumbers');
    view.destroy();
  });
});

describe('createGitChangeExtensions', () => {
  it('should_return_empty_when_disabled', () => {
    expect(createGitChangeExtensions(false)).toEqual([]);
  });

  it('should_return_non_empty_when_enabled', () => {
    expect(createGitChangeExtensions(true).length).toBeGreaterThan(0);
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});
