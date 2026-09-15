import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runCodelensConfig,
  type RunCodelensConfig,
} from '@/features/editor/gutter/runCodelensConfig';
import { createRunCodelensCore } from '@/features/editor/gutter/runContribution';
import { setLspRunnablesEffect } from '@/features/editor/gutter/runLspOverlay';
import { RunMarker, runCodelensField } from '@/features/editor/gutter/runMarkers';
import { targetLine, type RunTarget } from '@/features/runner';

function collectMarkers(view: EditorView): Array<{ from: number; marker: RunMarker }> {
  const doc = view.state.doc;
  const markers = view.state.field(runCodelensField);
  const out: Array<{ from: number; marker: RunMarker }> = [];
  const iter = markers.iter(0);
  while (iter.value && iter.from < doc.length) {
    out.push({ from: iter.from, marker: iter.value });
    iter.next();
  }
  return out;
}

const TS_DOC = ["describe('math', () => {", "  it('adds', () => {});", '});'].join('\n');
const RUST_DOC = '#[test]\nfn parse_simple() {}\n#[tokio::test]\nasync fn other() {}';
const GO_MAIN_DOC = ['package main', '', 'func main() {', '\tprintln("hi")', '}'].join('\n');
const RUST_MAIN_DOC = ['fn main() {', '\tprintln!("hi");', '}'].join('\n');
/** 表格驱动用例：父用例 + 逐行静态子测试（行 = 表格元素起始行）。 */
const GO_TABLE_DOC = [
  'package math',
  '',
  'import "testing"',
  '',
  'func TestFib(t *testing.T) {',
  '\ttests := []struct {',
  '\t\tname string',
  '\t\twant int',
  '\t}{',
  '\t\t{"zero", 0},',
  '\t\t{"one", 1},',
  '\t}',
  '\tfor _, tt := range tests {',
  '\t\tt.Run(tt.name, func(t *testing.T) {',
  '\t\t\tif got := Fib(); got != tt.want {',
  '\t\t\t\tt.Errorf("got %d", got)',
  '\t\t\t}',
  '\t\t})',
  '\t}',
  '}',
].join('\n');
const JAVA_MAIN_DOC = [
  'package com.example;',
  '',
  'public class App {',
  '    public static void main(String[] args) {',
  '        System.out.println("hi");',
  '    }',
  '}',
].join('\n');

function makeConfig(overrides: Partial<RunCodelensConfig> = {}): RunCodelensConfig {
  return {
    fileName: 'a.test.ts',
    onRun: vi.fn(),
    onMenuRequest: vi.fn(),
    ...overrides,
  };
}

function makeView(doc: string, config: RunCodelensConfig) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [createRunCodelensCore(config)],
    }),
    parent,
  });
  return view;
}

describe('runCodelens gutter field', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should_mark_ts_test_lines_with_run_markers', () => {
    const config = makeConfig();
    const view = makeView(TS_DOC, config);
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(1);
    expect(markers[0].from).toBe(view.state.doc.line(2).from);
    expect(markers[0].marker.target).toEqual({
      kind: 'test',
      testCase: { name: 'adds', line: 2, lang: 'ts' },
    });
    view.destroy();
  });

  it('should_mark_rust_test_fn_lines_with_markers', () => {
    const config = makeConfig({ fileName: 'lib.rs' });
    const view = makeView(RUST_DOC, config);
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(2);
    expect(markers[0].marker.target).toEqual({
      kind: 'test',
      testCase: { name: 'parse_simple', line: 1, lang: 'rust' },
    });
    expect(markers[1].marker.target).toMatchObject({ kind: 'test' });
    view.destroy();
  });

  it('should_mark_go_main_with_the_same_run_marker_machinery', () => {
    const view = makeView(GO_MAIN_DOC, makeConfig({ fileName: 'cmd/agent/main.go' }));
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(1);
    expect(markers[0].from).toBe(view.state.doc.line(3).from);
    expect(markers[0].marker.target).toEqual({ kind: 'main', entry: { line: 3, language: 'go' } });
    view.destroy();
  });

  it('should_carry_static_subtest_names_on_the_parent_go_table_target', () => {
    // 菜单去重（§7.8.4）的数据来源：父用例目标自带「已被静态发现」的子测试全名，
    // 与运行时动态发现求差后，同一目标不会出现两个入口。
    const view = makeView(GO_TABLE_DOC, makeConfig({ fileName: 'pkg/math/fib_test.go' }));
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(3); // 父用例 + 两行表格元素（逐行按钮）

    const [parent, first, second] = markers.map((m) => m.marker.target);
    expect(parent).toEqual({
      kind: 'test',
      testCase: { name: 'TestFib', line: 5, lang: 'go' },
      overlay: { subtests: ['TestFib/zero', 'TestFib/one'] },
    });
    // 子测试自身是叶子 → 不携带载荷（其菜单不该再列自己）
    expect(first).toEqual({
      kind: 'test',
      testCase: { name: 'TestFib/zero', line: 10, lang: 'go' },
    });
    expect(second).toEqual({
      kind: 'test',
      testCase: { name: 'TestFib/one', line: 11, lang: 'go' },
    });
    view.destroy();
  });

  /**
   * **F15 回归（端到端）**：`/` 只对**声明了层级用例名**的语言表示父子关系。
   * 探针实测（F15 前）：TS `test('auth')` + `test('auth/login works')` 会让父目标携带
   * `staticSubtests: ['auth/login works']` —— 伪造的父子关系。TS 标题含 `/` 极常见
   * （`test('GET /users')`），故必须在 marker 层就阻断。
   */
  it('should_not_attach_static_subtests_for_ts_titles_containing_slash', () => {
    const doc = [
      "import { test } from 'vitest';",
      "test('auth', () => {});",
      "test('auth/login works', () => {});",
    ].join('\n');
    const view = makeView(doc, makeConfig({ fileName: 'api.test.ts' }));
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(2);
    for (const { marker } of markers) {
      expect(marker.target).not.toHaveProperty('staticSubtests');
    }
    view.destroy();
  });

  it('should_mark_rust_and_java_main_with_same_machinery', () => {
    const rust = makeView(RUST_MAIN_DOC, makeConfig({ fileName: 'src/main.rs' }));
    expect(collectMarkers(rust)[0].marker.target).toEqual({
      kind: 'main',
      entry: { line: 1, language: 'rust' },
    });
    rust.destroy();

    const java = makeView(
      JAVA_MAIN_DOC,
      makeConfig({ fileName: 'src/main/java/com/example/App.java' }),
    );
    const javaMarkers = collectMarkers(java);
    expect(javaMarkers[0].marker.target).toEqual({
      kind: 'main',
      entry: { line: 4, language: 'java' },
    });
    java.destroy();
  });

  it('should_merge_rust_main_and_tests_in_line_order', () => {
    // 同一 .rs 既有 main 又有测试、且 main 在测试之前：两路检测（测试先、
    // main 后）的产出若直接喂 RangeSetBuilder 会乱序 panic，必须先按行号归并。
    const doc = ['fn main() {}', '', '#[test]', 'fn t() {}'].join('\n');
    const view = makeView(doc, makeConfig({ fileName: 'src/main.rs' }));
    const markers = collectMarkers(view);
    expect(markers.map((m) => m.marker.target)).toEqual([
      { kind: 'main', entry: { line: 1, language: 'rust' } },
      { kind: 'test', testCase: { name: 't', line: 3, lang: 'rust' } },
    ]);
    view.destroy();
  });

  it('should_not_mark_non_test_files_without_main', () => {
    const config = makeConfig({ fileName: 'plain.ts' });
    const view = makeView(TS_DOC, config);
    expect(collectMarkers(view)).toHaveLength(0);
    view.destroy();
  });

  it('should_not_mark_rust_file_without_tests_or_main', () => {
    const config = makeConfig({ fileName: 'plain.rs' });
    const view = makeView('fn helper() {}\nfn other() {}', config);
    expect(collectMarkers(view)).toHaveLength(0);
    view.destroy();
  });

  it('should_rebuild_when_config_facet_changes', () => {
    const compartment = new Compartment();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const configA = makeConfig({ fileName: 'a.test.ts' });
    const configB = makeConfig({ fileName: 'plain.ts' });
    const view = new EditorView({
      state: EditorState.create({
        doc: TS_DOC,
        extensions: [compartment.of(runCodelensConfig.of(configA)), runCodelensField],
      }),
      parent,
    });
    expect(collectMarkers(view)).toHaveLength(1);

    view.dispatch({ effects: compartment.reconfigure(runCodelensConfig.of(configB)) });
    // Same doc but config now claims a plain ts file: no runnables.
    expect(collectMarkers(view)).toHaveLength(0);
    view.destroy();
  });

  it('should_reparse_after_doc_change_once_debounce_elapses', () => {
    const config = makeConfig();
    const view = makeView(TS_DOC, config);
    expect(collectMarkers(view)).toHaveLength(1);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\nit('later', () => {});" },
    });
    // Stale until the debounce fires — no immediate full reparse per keystroke.
    expect(collectMarkers(view)).toHaveLength(1);

    vi.advanceTimersByTime(400);
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(2);
    expect(markers[1].marker.target).toEqual({
      kind: 'test',
      testCase: { name: 'later', line: 4, lang: 'ts' },
    });
    view.destroy();
  });

  it('should_coalesce_rapid_doc_changes_into_single_reparse', () => {
    const config = makeConfig();
    const view = makeView(TS_DOC, config);

    view.dispatch({ changes: { from: 0, insert: 'x' } });
    vi.advanceTimersByTime(100);
    view.dispatch({ changes: { from: 0, insert: 'y' } });
    vi.advanceTimersByTime(100);
    view.dispatch({ changes: { from: 0, insert: 'z' } });
    vi.advanceTimersByTime(400);

    // Debounce refreshed exactly once — final state consistent, no throw.
    expect(collectMarkers(view).length).toBeGreaterThan(0);
    view.destroy();
  });
});

describe('runCodelens marker DOM', () => {
  it('should_render_play_icon_without_click_routing', () => {
    // 点击路由已移入统一 gutter 列级委托（registry.test.ts 覆盖 TS 直跑 /
    // Rust rect 锚点菜单）；图标本体为纯视觉片段。
    const config = makeConfig();
    const icon = new RunMarker({
      kind: 'test',
      testCase: { name: 'adds', line: 2, lang: 'ts' },
    }).toDOM();
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.title).toBe('Run test');
    icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(config.onRun).not.toHaveBeenCalled();
    expect(config.onMenuRequest).not.toHaveBeenCalled();
  });

  it('should_render_main_marker_with_same_icon_but_main_title', () => {
    const mainTarget: RunTarget = { kind: 'main', entry: { line: 3, language: 'go' } };
    const icon = new RunMarker(mainTarget).toDOM();
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.title).toBe('Run or Debug main');
  });
});

describe('LSP runnable 覆盖（tier ①）', () => {
  const runnable = {
    label: 'cargo run -p api',
    kind: 'cargo' as const,
    args: { cwd: '/proj', cargoArgs: ['run', '--package', 'api'], executableArgs: [] },
  };

  it('未注入 LSP 结果时 marker 无 lsp（纯快路径）', () => {
    const view = makeView(RUST_MAIN_DOC, makeConfig({ fileName: 'main.rs' }));
    const [marker] = collectMarkers(view);
    expect(marker.marker.target).toEqual({ kind: 'main', entry: { line: 1, language: 'rust' } });
    expect(marker.marker.target.overlay).toBeUndefined();
    view.destroy();
  });

  it('注入 LSP 结果后按行覆盖（同 target 携带 lsp，供命令构造走 tier ①）', () => {
    const view = makeView(RUST_MAIN_DOC, makeConfig({ fileName: 'main.rs' }));
    view.dispatch({ effects: setLspRunnablesEffect.of(new Map([[1, runnable]])) });
    const [marker] = collectMarkers(view);
    expect(marker.marker.target.overlay).toEqual(runnable);
    // 行号未变 → 仍是同一行
    expect(targetLine(marker.marker.target)).toBe(1);
    view.destroy();
  });

  it('覆盖仅影响命中行：未命中行保持快路径 payload', () => {
    const doc = ['#[test]', 'fn a() {}', '', 'fn main() {}'].join('\n');
    const view = makeView(doc, makeConfig({ fileName: 'main.rs' }));
    view.dispatch({ effects: setLspRunnablesEffect.of(new Map([[4, runnable]])) });
    const markers = collectMarkers(view);
    expect(markers.map((m) => m.marker.target.overlay)).toEqual([undefined, runnable]);
    view.destroy();
  });

  it('RunMarker.eq 纳入 lsp：仅 lsp 变化也触发重建', () => {
    const base = { kind: 'main' as const, entry: { line: 1, language: 'rust' as const } };
    const other = {
      label: 'cargo run -p other',
      kind: 'cargo' as const,
      args: { cwd: '/proj', cargoArgs: ['run', '--package', 'other'], executableArgs: [] },
    };
    expect(new RunMarker(base).eq(new RunMarker({ ...base, overlay: runnable }))).toBe(false);
    expect(
      new RunMarker({ ...base, overlay: runnable }).eq(new RunMarker({ ...base, overlay: other })),
    ).toBe(false);
    expect(
      new RunMarker({ ...base, overlay: runnable }).eq(
        new RunMarker({ ...base, overlay: runnable }),
      ),
    ).toBe(true);
  });
});
