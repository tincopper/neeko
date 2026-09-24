import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from '@codemirror/view';

import type { FileLineChange, LineChangeKind, WordRange } from '@/shared/types/git';

// ── State channel：数据只经 effect 更新，扩展引用终身稳定（防 reconfigure）──

export const setFileLineChangesEffect = StateEffect.define<readonly FileLineChange[]>();

/**
 * 行级变更快照。文档编辑时按位置映射重照行号（高亮跟随内容），
 * 下次 VCS 拉取用真实 new 侧行号覆盖。
 */
export const fileLineChangesField = StateField.define<readonly FileLineChange[]>({
  create: () => [],
  update(lines, tr) {
    for (const e of tr.effects) {
      if (e.is(setFileLineChangesEffect)) return e.value;
    }
    if (tr.docChanged && lines.length > 0) {
      return lines.map((c) => {
        if (c.line < 1 || c.line > tr.startState.doc.lines) return c;
        try {
          const from = tr.startState.doc.line(c.line).from;
          const mapped = tr.changes.mapPos(from, 1);
          return { ...c, line: tr.state.doc.lineAt(mapped).number };
        } catch {
          return c;
        }
      });
    }
    return lines;
  },
});

// ── 行背景 + 词级 Decoration ──────────────────────────────────────────────

function clipWords(lineLen: number, words: readonly WordRange[]): WordRange[] {
  const out: WordRange[] = [];
  for (const w of words) {
    const from = Math.max(0, Math.min(w.from, lineLen));
    const to = Math.max(from, Math.min(w.to, lineLen));
    if (to > from) out.push({ from, to });
  }
  return out;
}

function buildChangeDecorations(
  state: EditorState,
  changes: readonly FileLineChange[],
): DecorationSet {
  if (changes.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const docLines = state.doc.lines;
  for (const c of changes) {
    if (c.line < 1 || c.line > docLines) continue;
    const line = state.doc.line(c.line);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: c.kind === 'added' ? 'cm-git-line-added' : 'cm-git-line-modified',
      }),
    );
    if (c.kind === 'modified' && c.words) {
      for (const w of clipWords(line.length, c.words)) {
        builder.add(
          line.from + w.from,
          line.from + w.to,
          Decoration.mark({ class: 'cm-git-word' }),
        );
      }
    }
  }
  return builder.finish();
}

const changeDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setFileLineChangesEffect)) {
        return buildChangeDecorations(tr.state, e.value);
      }
    }
    // 行号已在 fileLineChangesField 中重映射；此处先 map 旧区间保持可见，
    // 下一次 setFileLineChangesEffect / 重建即与 field 对齐。
    if (tr.docChanged) return deco.map(tr.changes);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── 变更条（独立薄列，被动状态，不进 gutterContributions registry）───────

class ChangeBarMarker extends GutterMarker {
  constructor(
    readonly kind: LineChangeKind,
    readonly seg: 'start' | 'end' | 'mid' | 'single',
    readonly title: string,
  ) {
    super();
  }

  eq(other: ChangeBarMarker): boolean {
    return other.kind === this.kind && other.seg === this.seg;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = `cm-change-bar cm-change-bar--${this.kind} cm-change-bar--seg-${this.seg}`;
    el.title = this.title;
    return el;
  }
}

function titleForKind(kind: LineChangeKind): string {
  return kind === 'added' ? '新增行 · 相对 HEAD 为新增' : '已修改 · git 工作区 vs HEAD';
}

const changeGutter = gutter({
  class: 'cm-change-gutter',
  markers(view) {
    let changes: readonly FileLineChange[] = [];
    try {
      changes = view.state.field(fileLineChangesField);
    } catch {
      return RangeSet.empty;
    }
    if (changes.length === 0) return RangeSet.empty;
    const kindByLine = new Map<number, LineChangeKind>();
    for (const c of changes) kindByLine.set(c.line, c.kind);
    const builder = new RangeSetBuilder<ChangeBarMarker>();
    const docLines = view.state.doc.lines;
    for (const c of changes) {
      if (c.line < 1 || c.line > docLines) continue;
      const prevSame = kindByLine.get(c.line - 1) === c.kind;
      const nextSame = kindByLine.get(c.line + 1) === c.kind;
      const seg =
        !prevSame && !nextSame ? 'single' : !prevSame ? 'start' : !nextSame ? 'end' : 'mid';
      const pos = view.state.doc.line(c.line).from;
      builder.add(pos, pos, new ChangeBarMarker(c.kind, seg, titleForKind(c.kind)));
    }
    return builder.finish();
  },
});

// ── 单一扩展工厂：enabled=false 完全卸载（零残留 DOM）──────────────────

/**
 * Git 行级变更高亮扩展（旁路）：field + 行/词 Decoration + 最左变更条列。
 * 装配顺序须位于 unified breakpoint gutter **之前**（对齐 IDEA 最左变更条）。
 * 数据更新一律走 `setFileLineChangesEffect`，禁止把数据本身接进 extensions memo。
 */
export function createGitChangeExtensions(enabled: boolean): Extension[] {
  if (!enabled) return [];
  return [fileLineChangesField, changeDecorationsField, changeGutter];
}
