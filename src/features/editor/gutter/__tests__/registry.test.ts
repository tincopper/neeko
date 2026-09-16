import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, type BlockInfo } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TestCaseInfo } from '@/features/runner';

import {
  clearBreakpointHoverLine,
  setBreakpointHoverLine,
  setBreakpointsEffect,
  setHoverLineEffect,
  toggleBreakpointAt,
} from '../../hooks/useBreakpointGutter';
import {
  breakpointContribution,
  breakpointContributionExtensions,
} from '../breakpointContribution';
import type { GutterContribution } from '../contribution';
import { ComposedMarker, createUnifiedGutterExtension } from '../registry';
import { createRunCodelensCore, createRunContribution } from '../runContribution';

const TS_DOC = ["describe('math', () => {", "  it('adds', () => {});", '});'].join('\n');
const RUST_DOC = '#[test]\nfn parse_simple() {}\n#[tokio::test]\nasync fn other() {}';

interface MakeOverrides {
  onToggleBreakpoint?: (line: number) => void;
  onRun?: (t: TestCaseInfo) => void;
  onMenuRequest?: (t: TestCaseInfo, x: number, y: number) => void;
  includeTestMarkers?: boolean;
  /** 行上下文可编辑性（readOnly/binary/超大文件 → when 门控关闭测试标记）。 */
  editable?: boolean;
  extraContributions?: GutterContribution<unknown>[];
}

/** P2 装配（镜像 useUnifiedGutter 的装配语义：fields + contributions + 列级回调）。 */
function makeRegistry(doc: string, fileName: string, overrides: MakeOverrides = {}) {
  const onToggleBreakpoint = overrides.onToggleBreakpoint ?? vi.fn();
  const onRun = overrides.onRun ?? vi.fn();
  const onMenuRequest = overrides.onMenuRequest ?? vi.fn();
  const includeTestMarkers = overrides.includeTestMarkers ?? true;
  const testRun = includeTestMarkers ? createRunContribution({ onRun, onMenuRequest }) : null;
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...breakpointContributionExtensions,
        ...(testRun ? [createRunCodelensCore({ fileName, onRun, onMenuRequest })] : []),
        createUnifiedGutterExtension({
          fileName,
          editable: overrides.editable ?? true,
          contributions: testRun
            ? [breakpointContribution, testRun, ...(overrides.extraContributions ?? [])]
            : [breakpointContribution, ...(overrides.extraContributions ?? [])],
          onColumnClick: (v, lineFrom) => toggleBreakpointAt(v, lineFrom, onToggleBreakpoint),
          onColumnHover: (v, lineFrom) => setBreakpointHoverLine(v, lineFrom),
          onColumnLeave: (v) => clearBreakpointHoverLine(v),
        }),
        lineNumbers(),
      ],
    }),
    parent,
  });
  return { view, onToggleBreakpoint, onRun, onMenuRequest };
}

/** Gutter elements draw on the first plugin update — nudge with a trailing doc change. */
function drawGutter(view: EditorView) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: ' ' } });
}

function stubLine(view: EditorView, lineNo: number) {
  const lineBlock = { from: view.state.doc.line(lineNo).from } as BlockInfo;
  vi.spyOn(view, 'lineBlockAtHeight').mockReturnValue(lineBlock);
}

function mockRect(el: HTMLElement, rect: { right: number; top: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: rect.top,
    right: rect.right,
    bottom: 212,
    width: 12,
    height: 12,
    x: 100,
    y: rect.top,
    toJSON: () => {},
  } as DOMRect);
}

describe('registry single column', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should_render_single_breakpoint_column_and_no_test_run_column', () => {
    const { view } = makeRegistry(TS_DOC, 'a.test.ts');
    drawGutter(view);

    expect(view.dom.querySelector('.cm-run-gutter')).toBeNull();
    const gutters = view.dom.querySelectorAll('.cm-gutters > .cm-gutter');
    const names = Array.from(gutters).map((g) => g.className);
    expect(names.filter((c) => c.includes('cm-breakpoint-gutter'))).toHaveLength(1);
    expect(names[0]).toContain('cm-breakpoint-gutter');
    expect(names[1]).toContain('cm-lineNumbers');
    view.destroy();
  });

  it('should_show_red_dot_on_breakpoint_lines_only', () => {
    const { view } = makeRegistry(TS_DOC, 'a.test.ts');
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 1, enabled: true }]) });
    drawGutter(view);

    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    const dots = gutter.querySelectorAll('.cm-breakpoint-marker:not(.cm-breakpoint-marker--hover)');
    expect(dots).toHaveLength(1);
    expect(gutter.querySelectorAll('.cm-run-marker')).toHaveLength(1);
    expect(gutter.querySelectorAll('.cm-gutterElement')).toHaveLength(2);
    view.destroy();
  });

  it('should_keep_registration_order_for_equal_priority', () => {
    const tagged = (id: string): GutterContribution<unknown> => ({
      id,
      priority: 20,
      when: () => true,
      linesOf: () => [2],
      markersOf: (_state, line) => (line === 2 ? { payload: `${id}@2` } : null),
      render: (hit) => {
        const el = document.createElement('div');
        el.setAttribute('data-gutter-contribution', hit.contributionId);
        el.textContent = String(hit.payload);
        return el;
      },
    });
    const { view } = makeRegistry('const a = 1;\nconst b = 2;\n', 'plain.ts', {
      includeTestMarkers: false,
      extraContributions: [tagged('aaa'), tagged('bbb')],
    });
    drawGutter(view);

    const cell = view.dom.querySelector('.cm-breakpoint-gutter .cm-unified-gutter-cell')!;
    const order = Array.from(cell.children).map((el) =>
      el.getAttribute('data-gutter-contribution'),
    );
    expect(order).toEqual(['aaa', 'bbb']);
    view.destroy();
  });

  it('should_keep_existing_fragments_unchanged_when_third_contribution_joins', () => {
    const coverage: GutterContribution<unknown> = {
      id: 'coverage',
      priority: 30,
      when: () => true,
      linesOf: () => [2],
      markersOf: (_state, line) => (line === 2 ? { payload: 'covered' } : null),
      render: (hit) => {
        const el = document.createElement('div');
        el.className = 'cm-coverage-marker';
        el.setAttribute('data-gutter-contribution', hit.contributionId);
        return el;
      },
    };
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { extraContributions: [coverage] });
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 2, enabled: true }]) });
    drawGutter(view);

    // OCP 回归：同行冲突下断点片段被丢弃，新贡献只追加在 play 之后。
    const cell = view.dom.querySelector('.cm-breakpoint-gutter .cm-unified-gutter-cell')!;
    const order = Array.from(cell.children).map((el) =>
      el.getAttribute('data-gutter-contribution'),
    );
    expect(order).toEqual(['run', 'coverage']);
    expect(cell.querySelector('.cm-breakpoint-marker')).toBeNull();
    expect(cell.querySelector('.cm-run-marker')).not.toBeNull();
    view.destroy();
  });

  it('should_route_play_click_to_run_without_toggling_breakpoint', () => {
    const onToggleBreakpoint = vi.fn();
    const onRun = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onToggleBreakpoint, onRun });
    drawGutter(view);
    stubLine(view, 2);

    const icon = view.dom.querySelector<HTMLElement>('.cm-run-marker')!;
    icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith({
      kind: 'test',
      testCase: { name: 'adds', line: 2, lang: 'ts' },
    });
    expect(onToggleBreakpoint).not.toHaveBeenCalled();
    view.destroy();
  });

  it('should_route_click_when_target_is_svg_child_of_icon', () => {
    // 真实浏览器点击 play 图标时 event.target 是内联 <svg>/<polygon>（SVGElement，
    // 不是 HTMLElement）——命中判定必须用 Element 基类，否则点击无响应（回归防线）。
    const onToggleBreakpoint = vi.fn();
    const onRun = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onToggleBreakpoint, onRun });
    drawGutter(view);
    stubLine(view, 2);

    const polygon = view.dom.querySelector('.cm-run-marker polygon')!;
    polygon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith({
      kind: 'test',
      testCase: { name: 'adds', line: 2, lang: 'ts' },
    });
    expect(onToggleBreakpoint).not.toHaveBeenCalled();
    view.destroy();
  });

  it('should_stop_propagation_when_contribution_handles_click', () => {
    // 开启浮层的 mousedown 不得冒泡到 document：已打开浮层的 outside-click 监听
    // 会把这次点击判为外部点击而立即 closeMenu，新菜单秒关（开↔关竞态，回归防线）。
    const onRun = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onRun });
    drawGutter(view);
    stubLine(view, 2);

    const docEvents: Event[] = [];
    const docHandler = (e: Event) => docEvents.push(e);
    document.addEventListener('mousedown', docHandler);
    try {
      const icon = view.dom.querySelector<HTMLElement>('.cm-run-marker')!;
      icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(onRun).toHaveBeenCalledTimes(1);
      expect(docEvents).toHaveLength(0);
    } finally {
      document.removeEventListener('mousedown', docHandler);
    }
    view.destroy();
  });

  it('should_toggle_breakpoint_when_clicking_dot_zone', () => {
    // 非用例行（行 1）红点点击 → 冒泡列级 toggle（断点贡献无 onClick）。
    const onToggleBreakpoint = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onToggleBreakpoint });
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 1, enabled: true }]) });
    drawGutter(view);
    stubLine(view, 1);

    const dot = view.dom.querySelector<HTMLElement>(
      '.cm-gutterElement .cm-breakpoint-marker:not(.cm-breakpoint-marker--hover)',
    )!;
    dot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onToggleBreakpoint).toHaveBeenCalledWith(1);
    view.destroy();
  });

  it('should_toggle_breakpoint_when_clicking_blank_gutter_zone', () => {
    const onToggleBreakpoint = vi.fn();
    const onRun = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onToggleBreakpoint, onRun });
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 1, enabled: true }]) });
    drawGutter(view);
    stubLine(view, 1);

    // 空白区（gutterElement 本体，无 data-gutter-contribution）→ 列级 toggle。
    // 非用例行（行 1）语义不变；用例行空白区吞掉见 should_swallow_blank_clicks_on_test_lines。
    const cell = view.dom.querySelector<HTMLElement>('.cm-breakpoint-gutter .cm-gutterElement')!;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onToggleBreakpoint).toHaveBeenCalledWith(1);
    expect(onRun).not.toHaveBeenCalled();
    view.destroy();
  });

  it('should_not_handle_clicks_on_detached_fragments', () => {
    // P2 委托语义：图标本体不再自吞 mousedown（监听已移入列级委托）；
    // 游离片段点击无任何路由，真实点击必经 gutter 列处理器显式命中。
    const onRun = vi.fn();
    const contrib = createRunContribution({ onRun, onMenuRequest: vi.fn() });
    const el = contrib.render({
      contributionId: 'run',
      line: 2,
      payload: { kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } },
      anchorRect: new DOMRect(),
    })!;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('should_bubble_to_toggle_when_contribution_declines_click', () => {
    const onToggleBreakpoint = vi.fn();
    const polite: GutterContribution<unknown> = {
      id: 'polite',
      priority: 5,
      when: () => true,
      linesOf: () => [1],
      markersOf: () => ({ payload: 'hi' }),
      render: (hit) => {
        const el = document.createElement('div');
        el.setAttribute('data-gutter-contribution', hit.contributionId);
        return el;
      },
      onClick: () => false,
    };
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', {
      onToggleBreakpoint,
      extraContributions: [polite],
    });
    drawGutter(view);
    stubLine(view, 1);

    const frag = view.dom.querySelector<HTMLElement>('[data-gutter-contribution="polite"]')!;
    frag.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onToggleBreakpoint).toHaveBeenCalledWith(1);
    view.destroy();
  });

  it('should_render_only_play_when_breakpoint_set_on_test_line', () => {
    // 同行冲突：用例行（TS 行 2）同时有断点与 play → 只保留 play，无红点。
    const { view } = makeRegistry(TS_DOC, 'a.test.ts');
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 2, enabled: true }]) });
    drawGutter(view);

    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    expect(gutter.querySelectorAll('.cm-gutterElement')).toHaveLength(1);
    const cell = gutter.querySelector('.cm-gutterElement')!;
    expect(cell.querySelector('.cm-run-marker')).not.toBeNull();
    expect(cell.querySelector('.cm-breakpoint-marker')).toBeNull();
    view.destroy();
  });

  it('should_suppress_hover_ghost_on_test_lines', () => {
    // hover 经过用例行 → ghost 同理丢弃，只剩 play。
    const { view } = makeRegistry(TS_DOC, 'a.test.ts');
    view.dispatch({ effects: setHoverLineEffect.of(2) });
    drawGutter(view);

    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    const cell = gutter.querySelector('.cm-gutterElement')!;
    expect(cell.querySelector('.cm-run-marker')).not.toBeNull();
    expect(cell.querySelector('.cm-breakpoint-marker--hover')).toBeNull();
    view.destroy();
  });

  it('should_swallow_blank_clicks_on_test_lines_without_toggling_breakpoint', () => {
    // 点 play 附近空白区 → 吞掉，不误设断点。
    const onToggleBreakpoint = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onToggleBreakpoint });
    drawGutter(view);
    stubLine(view, 2);

    const cell = view.dom.querySelector<HTMLElement>('.cm-breakpoint-gutter .cm-gutterElement')!;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onToggleBreakpoint).not.toHaveBeenCalled();
    view.destroy();
  });

  it('should_keep_breakpoint_toggle_and_ghost_on_non_test_lines', () => {
    // 非用例行断点语义不变：红点/ghost 照常，空白区点击照常 toggle。
    const onToggleBreakpoint = vi.fn();
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { onToggleBreakpoint });
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 1, enabled: true }]) });
    view.dispatch({ effects: setHoverLineEffect.of(3) });
    drawGutter(view);

    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    expect(
      gutter.querySelectorAll('.cm-breakpoint-marker:not(.cm-breakpoint-marker--hover)'),
    ).toHaveLength(1);
    expect(gutter.querySelector('.cm-breakpoint-marker--hover')).not.toBeNull();

    stubLine(view, 1);
    const cells = gutter.querySelectorAll<HTMLElement>('.cm-gutterElement');
    cells[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onToggleBreakpoint).toHaveBeenCalledWith(1);
    view.destroy();
  });

  it('should_allow_breakpoints_on_rust_fn_body_lines_below_attribute', () => {
    // Rust 用例行 = 属性行（1、3）；fn 体行（2）仍可设断点。
    const onToggleBreakpoint = vi.fn();
    const { view } = makeRegistry(RUST_DOC, 'lib.rs', { onToggleBreakpoint });
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 2, enabled: true }]) });
    drawGutter(view);

    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    expect(gutter.querySelectorAll('.cm-run-marker')).toHaveLength(2);
    expect(
      gutter.querySelectorAll('.cm-breakpoint-marker:not(.cm-breakpoint-marker--hover)'),
    ).toHaveLength(1);

    stubLine(view, 2);
    const dots = gutter.querySelectorAll<HTMLElement>('.cm-gutterElement');
    dots[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onToggleBreakpoint).toHaveBeenCalledWith(2);
    view.destroy();
  });

  it('should_request_rust_menu_anchored_to_icon_rect', () => {
    const onMenuRequest = vi.fn();
    const onRun = vi.fn();
    const { view } = makeRegistry(RUST_DOC, 'lib.rs', { onMenuRequest, onRun });
    drawGutter(view);
    stubLine(view, 3);

    const icons = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-run-marker'));
    expect(icons).toHaveLength(2);
    // 浮层锚定到图标 rect 旁，而非鼠标裸坐标：用偏离的 clientX/Y 点击，
    // 断言回调拿到的是 rect 推导锚点，且 anchorRect 非空。
    mockRect(icons[1], { right: 112, top: 200 });
    icons[1].dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 12, clientY: 34 }),
    );
    expect(onMenuRequest).toHaveBeenCalledWith(
      { kind: 'test', testCase: { name: 'other', line: 3, lang: 'rust' } },
      116,
      200,
    );
    expect(onRun).not.toHaveBeenCalled();
    view.destroy();
  });

  it('should_show_only_dots_in_non_test_files_without_second_column', () => {
    const { view } = makeRegistry('const a = 1;\nconst b = 2;\n', 'plain.ts');
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 1, enabled: true }]) });
    drawGutter(view);

    expect(view.dom.querySelector('.cm-run-gutter')).toBeNull();
    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    expect(gutter.querySelectorAll('.cm-breakpoint-marker')).toHaveLength(1);
    expect(gutter.querySelectorAll('.cm-run-marker')).toHaveLength(0);
    view.destroy();
  });

  it('should_omit_play_icons_when_test_markers_disabled', () => {
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { includeTestMarkers: false });
    drawGutter(view);

    expect(view.dom.querySelector('.cm-run-gutter')).toBeNull();
    expect(view.dom.querySelectorAll('.cm-run-marker')).toHaveLength(0);
    expect(view.dom.querySelector('.cm-breakpoint-gutter')).not.toBeNull();
    view.destroy();
  });

  it('should_keep_icon_titles_after_listener_removal', () => {
    const { view } = makeRegistry(TS_DOC, 'a.test.ts');
    drawGutter(view);

    expect(view.dom.querySelector<HTMLElement>('.cm-run-marker')!.title).toBe('Run test');
    view.destroy();

    const { view: rustView } = makeRegistry(RUST_DOC, 'lib.rs');
    drawGutter(rustView);
    const titles = Array.from(rustView.dom.querySelectorAll<HTMLElement>('.cm-run-marker')).map(
      (el) => el.title,
    );
    expect(titles).toEqual(['Run or Debug test', 'Run or Debug test']);
    rustView.destroy();
  });

  it('should_hide_play_icons_in_readonly_tabs_at_merger_level', () => {
    // 贡献已注册、检测核心已挂载，但 when(editable=false) 在合并器层过滤——
    // readOnly/binary/超大文件 tab 只有断点列语义。
    const { view } = makeRegistry(TS_DOC, 'a.test.ts', { editable: false });
    view.dispatch({ effects: setBreakpointsEffect.of([{ line: 1, enabled: true }]) });
    drawGutter(view);

    const gutter = view.dom.querySelector('.cm-breakpoint-gutter')!;
    expect(gutter.querySelectorAll('.cm-run-marker')).toHaveLength(0);
    expect(
      gutter.querySelectorAll('.cm-breakpoint-marker:not(.cm-breakpoint-marker--hover)'),
    ).toHaveLength(1);
    view.destroy();
  });

  it('should_reuse_icon_dom_when_only_callbacks_change', () => {
    // G4 防回归：回调交换（新闭包引用、payload 值不变）不得触发整列 DOM 重建。
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const compartment = new Compartment();
    const testRun = (onRun: (t: TestCaseInfo) => void) =>
      createRunContribution({ onRun, onMenuRequest: vi.fn() });
    const view = new EditorView({
      state: EditorState.create({
        doc: TS_DOC,
        extensions: [
          ...breakpointContributionExtensions,
          compartment.of(
            createRunCodelensCore({
              fileName: 'a.test.ts',
              onRun: vi.fn(),
              onMenuRequest: vi.fn(),
            }),
          ),
          createUnifiedGutterExtension({
            fileName: 'a.test.ts',
            editable: true,
            contributions: [breakpointContribution, testRun(vi.fn())],
            onColumnClick: () => false,
            onColumnHover: () => false,
            onColumnLeave: () => false,
          }),
          lineNumbers(),
        ],
      }),
      parent,
    });
    drawGutter(view);
    const before = view.dom.querySelector('.cm-run-marker');
    expect(before).not.toBeNull();

    view.dispatch({
      effects: compartment.reconfigure(
        createRunCodelensCore({ fileName: 'a.test.ts', onRun: vi.fn(), onMenuRequest: vi.fn() }),
      ),
    });
    // field 重建（新 RunMarker 实例）→ 合并器重建 marker → eq 值比较命中 → DOM 复用。
    expect(view.dom.querySelector('.cm-run-marker')).toBe(before);
    view.destroy();
  });
});

describe('ComposedMarker eq', () => {
  const contribs = new Map();

  it('treats_distinct_but_value_equal_payloads_as_equal', () => {
    // 同 payload、不同对象身份（旧 eq 比较回调引用即全量重建，G4）。
    const a = new ComposedMarker(
      2,
      [{ id: 'run', payload: { name: 'adds', line: 2, lang: 'ts' } }],
      contribs,
    );
    const b = new ComposedMarker(
      2,
      [{ id: 'run', payload: { name: 'adds', line: 2, lang: 'ts' } }],
      contribs,
    );
    expect(a.eq(b)).toBe(true);
    expect(b.eq(a)).toBe(true);
  });

  it('rejects_differing_payload_values_order_and_length', () => {
    const base = [{ id: 'run', payload: { name: 'adds', line: 2, lang: 'ts' } }];
    const same = new ComposedMarker(2, base, contribs);
    expect(
      same.eq(
        new ComposedMarker(
          2,
          [{ id: 'run', payload: { name: 'renamed', line: 2, lang: 'ts' } }],
          contribs,
        ),
      ),
    ).toBe(false);
    expect(
      same.eq(
        new ComposedMarker(
          2,
          [
            { id: 'breakpoint', payload: { state: 'active' } },
            { id: 'run', payload: { name: 'adds', line: 2, lang: 'ts' } },
          ],
          contribs,
        ),
      ),
    ).toBe(false);
    expect(
      new ComposedMarker(
        2,
        [
          { id: 'run', payload: { name: 'adds', line: 2, lang: 'ts' } },
          { id: 'breakpoint', payload: { state: 'active' } },
        ],
        contribs,
      ).eq(
        new ComposedMarker(
          2,
          [
            { id: 'breakpoint', payload: { state: 'active' } },
            { id: 'run', payload: { name: 'adds', line: 2, lang: 'ts' } },
          ],
          contribs,
        ),
      ),
    ).toBe(false);
  });
});
