import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { statusForCase, useTestResultsStore } from '../../store/testResults';
import { createUnifiedGutterExtension } from '../registry';
import { createTestCodelensCore, createTestRunContribution } from '../testRunContribution';
import { createTestStatusContribution, createTestStatusCore } from '../testStatusContribution';

const RUST_DOC = '#[test]\nfn parse_simple() {}\n\n#[test]\nfn other() {}\n';

/** 镜像 useUnifiedGutter 装配（editor 域内贡献 + test-status core）。 */
function makeView(projectId = 'p1', filePath = 'src/lib.rs') {
  const onRun = vi.fn();
  const onMenuRequest = vi.fn();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: RUST_DOC,
      extensions: [
        createTestCodelensCore({ fileName: filePath, onRun, onMenuRequest }),
        createTestStatusCore({ projectId, filePath }),
        createUnifiedGutterExtension({
          fileName: filePath,
          editable: true,
          contributions: [
            createTestRunContribution({ onRun, onMenuRequest }),
            createTestStatusContribution({ projectId, filePath }),
          ],
          onColumnClick: vi.fn(),
          onColumnHover: vi.fn(),
          onColumnLeave: vi.fn(),
        }),
      ],
    }),
    parent,
  });
  return { view, onRun, onMenuRequest };
}

/** Gutter elements draw on the first plugin update — nudge with a trailing doc change. */
function drawGutter(view: EditorView) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } });
}

/** 等待 store 订阅的微任务刷新 dispatch 完成（queueMicrotask 顺序保证）。 */
async function flushRefresh() {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe('testStatusContribution', () => {
  beforeEach(() => {
    useTestResultsStore.setState({ files: {}, versions: {} });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exposes_test_status_id_and_lower_priority_than_test_run', () => {
    const contrib = createTestStatusContribution({ projectId: 'p1', filePath: 'src/lib.rs' });
    expect(contrib.id).toBe('test-status');
    expect(contrib.priority).toBe(30);
    expect(contrib.priority).toBeGreaterThan(
      createTestRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() }).priority,
    );
  });

  it('when_gates_same_as_test_run', () => {
    const contrib = createTestStatusContribution({ projectId: 'p1', filePath: 'src/lib.rs' });
    expect(contrib.when({ line: 1, fileName: 'src/lib.rs', editable: true })).toBe(true);
    expect(contrib.when({ line: 1, fileName: 'src/a.test.ts', editable: true })).toBe(true);
    expect(contrib.when({ line: 1, fileName: 'src/plain.ts', editable: true })).toBe(false);
    expect(contrib.when({ line: 1, fileName: 'src/lib.rs', editable: false })).toBe(false);
  });

  it('markersOf_returns_case_status_payload_for_case_lines_only', () => {
    useTestResultsStore.getState().beginRun('p1', 'src/lib.rs');
    useTestResultsStore
      .getState()
      .applyResults('p1', 'src/lib.rs', [{ caseName: 'parse_simple', status: 'passed' }]);

    const state = EditorState.create({
      doc: RUST_DOC,
      extensions: [
        createTestCodelensCore({ fileName: 'src/lib.rs', onRun: vi.fn(), onMenuRequest: vi.fn() }),
      ],
    });
    const contrib = createTestStatusContribution({ projectId: 'p1', filePath: 'src/lib.rs' });

    expect(contrib.markersOf(state, 1)).toEqual({
      payload: { status: 'passed' },
    });
    // 非用例行无状态
    expect(contrib.markersOf(state, 2)).toBeNull();
    // 未运行过的用例无状态
    expect(contrib.markersOf(state, 4)).toBeNull();
    // 跨文件隔离
    const other = createTestStatusContribution({ projectId: 'p2', filePath: 'src/lib.rs' });
    expect(other.markersOf(state, 1)).toBeNull();
  });

  it('markersOf_gives_running_placeholder_while_file_is_running', () => {
    useTestResultsStore.getState().beginRun('p1', 'src/lib.rs');
    const state = EditorState.create({
      doc: RUST_DOC,
      extensions: [
        createTestCodelensCore({ fileName: 'src/lib.rs', onRun: vi.fn(), onMenuRequest: vi.fn() }),
      ],
    });
    const contrib = createTestStatusContribution({ projectId: 'p1', filePath: 'src/lib.rs' });
    expect(contrib.markersOf(state, 1)).toEqual({ payload: { status: 'running' } });
  });

  it('render_tags_fragment_and_uses_status_specific_icon_and_title', () => {
    const contrib = createTestStatusContribution({ projectId: 'p1', filePath: 'src/lib.rs' });
    const hit = (
      payload: Record<string, unknown>,
      line = 1,
    ): Parameters<typeof contrib.render>[0] => ({
      contributionId: 'test-status',
      line,
      payload: payload as never,
      anchorRect: new DOMRect(),
    });

    const failed = contrib.render(hit({ status: 'failed', message: 'assertion failed: 1 == 2' }));
    expect(failed!.getAttribute('data-gutter-contribution')).toBe('test-status');
    expect(failed!.className).toContain('cm-test-status-marker--failed');
    expect(failed!.title).toContain('assertion failed: 1 == 2');

    const passed = contrib.render(hit({ status: 'passed' }));
    expect(passed!.className).toContain('cm-test-status-marker--passed');

    const running = contrib.render(hit({ status: 'running' }));
    expect(running!.className).toContain('cm-test-status-marker--running');
    const ignored = contrib.render(hit({ status: 'ignored' }));
    expect(ignored!.className).toContain('cm-test-status-marker--ignored');
  });

  it('onClick_swallows_without_action_so_breakpoint_toggle_never_fires', () => {
    const contrib = createTestStatusContribution({ projectId: 'p1', filePath: 'src/lib.rs' });
    expect(contrib.onClick).toBeDefined();
    expect(
      contrib.onClick!(
        {
          contributionId: 'test-status',
          line: 1,
          payload: { status: 'passed' } as never,
          anchorRect: new DOMRect(),
        },
        new MouseEvent('mousedown'),
      ),
    ).toBe(true);
  });

  it('gutter_shows_running_then_passed_icon_via_store_subscription', async () => {
    const { view } = makeView();
    drawGutter(view);

    useTestResultsStore.getState().beginRun('p1', 'src/lib.rs');
    await flushRefresh();
    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    // 文件级进行中：所有用例行均给半透明占位（doc 内 2 个用例）
    expect(
      gutter.querySelectorAll(
        "[data-gutter-contribution='test-status'].cm-test-status-marker--running",
      ),
    ).toHaveLength(2);

    useTestResultsStore
      .getState()
      .applyResults('p1', 'src/lib.rs', [
        { caseName: 'parse_simple', status: 'failed', message: 'boom' },
      ]);
    await flushRefresh();

    const failedIcon = gutter.querySelector(
      "[data-gutter-contribution='test-status'].cm-test-status-marker--failed",
    );
    expect(failedIcon).not.toBeNull();
    expect(failedIcon!.getAttribute('title')).toContain('boom');
    view.destroy();
  });

  it('play_and_status_fragments_coexist_in_one_cell', async () => {
    const { view } = makeView();
    drawGutter(view);
    useTestResultsStore
      .getState()
      .applyResults('p1', 'src/lib.rs', [{ caseName: 'parse_simple', status: 'passed' }]);
    await flushRefresh();

    const cell = view.dom.querySelector('.cm-breakpoint-gutter .cm-unified-gutter-cell')!;
    expect(cell.querySelector("[data-gutter-contribution='test-run']")).not.toBeNull();
    expect(cell.querySelector("[data-gutter-contribution='test-status']")).not.toBeNull();
    view.destroy();
  });

  it('doc_edit_invalidates_stored_results', async () => {
    useTestResultsStore
      .getState()
      .applyResults('p1', 'src/lib.rs', [{ caseName: 'parse_simple', status: 'passed' }]);
    expect(statusForCase('p1', 'src/lib.rs', 'parse_simple')).toEqual({ status: 'passed' });

    const { view } = makeView();
    // 首个 doc 变更（装配 nudges 也算）→ invalidateFile 清空该文件状态
    view.dispatch({ changes: { from: 0, insert: ' ' } });

    expect(statusForCase('p1', 'src/lib.rs', 'parse_simple')).toBeNull();
    view.destroy();
  });
});
