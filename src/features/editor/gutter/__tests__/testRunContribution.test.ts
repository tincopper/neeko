import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTestCodelensCore,
  testCodelensConfig,
  testCodelensField,
  TestRunMarker,
  type TestCodelensConfig,
} from '../testRunContribution';

function collectMarkers(view: EditorView): Array<{ from: number; marker: TestRunMarker }> {
  const doc = view.state.doc;
  const markers = view.state.field(testCodelensField);
  const out: Array<{ from: number; marker: TestRunMarker }> = [];
  const iter = markers.iter(0, doc.length);
  while (iter.value) {
    out.push({ from: iter.from, marker: iter.value });
    iter.next();
  }
  return out;
}

const TS_DOC = ["describe('math', () => {", "  it('adds', () => {});", '});'].join('\n');
const RUST_DOC = '#[test]\nfn parse_simple() {}\n#[tokio::test]\nasync fn other() {}';

function makeConfig(overrides: Partial<TestCodelensConfig> = {}): TestCodelensConfig {
  return {
    fileName: 'a.test.ts',
    onRun: vi.fn(),
    onMenuRequest: vi.fn(),
    ...overrides,
  };
}

function makeView(doc: string, config: TestCodelensConfig) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [createTestCodelensCore(config)],
    }),
    parent,
  });
  return view;
}

describe('testCodelens gutter field', () => {
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
    expect(markers[0].marker.testCase).toEqual({ name: 'adds', line: 2, lang: 'ts' });
    view.destroy();
  });

  it('should_mark_rust_test_fn_lines_with_markers', () => {
    const config = makeConfig({ fileName: 'lib.rs' });
    const view = makeView(RUST_DOC, config);
    const markers = collectMarkers(view);
    expect(markers).toHaveLength(2);
    expect(markers[0].marker.testCase).toEqual({ name: 'parse_simple', line: 1, lang: 'rust' });
    expect(markers[1].marker.testCase.name).toBe('other');
    view.destroy();
  });

  it('should_not_mark_non_test_files', () => {
    const config = makeConfig({ fileName: 'plain.ts' });
    const view = makeView(TS_DOC, config);
    expect(collectMarkers(view)).toHaveLength(0);
    view.destroy();
  });

  it('should_not_mark_rust_file_without_test_attributes', () => {
    const config = makeConfig({ fileName: 'plain.rs' });
    const view = makeView('fn main() {}', config);
    expect(collectMarkers(view)).toHaveLength(0);
    view.destroy();
  });

  it('should_rebuild_when_config_facet_changes', () => {
    const compartment = new Compartment();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const configA = makeConfig({ fileName: 'a.test.ts' });
    const configB = makeConfig({ fileName: 'lib.rs' });
    const view = new EditorView({
      state: EditorState.create({
        doc: TS_DOC,
        extensions: [compartment.of(testCodelensConfig.of(configA)), testCodelensField],
      }),
      parent,
    });
    expect(collectMarkers(view)).toHaveLength(1);

    view.dispatch({ effects: compartment.reconfigure(testCodelensConfig.of(configB)) });
    // Same TS doc but config now claims a rust file: ts test-call lines no longer count,
    // and no rust attributes exist → empty.
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
    expect(markers[1].marker.testCase).toEqual({ name: 'later', line: 4, lang: 'ts' });
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

describe('testCodelens marker DOM', () => {
  it('should_render_play_icon_without_click_routing', () => {
    // 点击路由已移入统一 gutter 列级委托（registry.test.ts 覆盖 TS 直跑 /
    // Rust rect 锚点菜单）；图标本体为纯视觉片段。
    const config = makeConfig();
    const icon = new TestRunMarker({ name: 'adds', line: 2, lang: 'ts' }).toDOM();
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(icon.title).toBe('Run test');
    icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(config.onRun).not.toHaveBeenCalled();
    expect(config.onMenuRequest).not.toHaveBeenCalled();
  });
});
