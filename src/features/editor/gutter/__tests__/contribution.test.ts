import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';

import { setBreakpointsEffect, setHoverLineEffect } from '../../hooks/useBreakpointGutter';
import {
  breakpointContribution,
  breakpointContributionExtensions,
} from '../breakpointContribution';
import type { GutterContribution, GutterLineContext } from '../contribution';
import { gutterContributions } from '../contribution';
import { createRunCodelensCore, createRunContribution } from '../runContribution';

const TS_DOC = ["describe('math', () => {", "  it('adds', () => {});", '});'].join('\n');
const RUST_DOC = '#[test]\nfn parse_simple() {}\n#[tokio::test]\nasync fn other() {}';

function ctxOf(overrides: Partial<GutterLineContext> = {}): GutterLineContext {
  return { line: 2, fileName: 'a.test.ts', editable: true, ...overrides };
}

describe('gutterContributions registry facet', () => {
  it('combines_contributions_in_registration_order', () => {
    const state = EditorState.create({
      doc: TS_DOC,
      extensions: [
        gutterContributions.of(breakpointContribution),
        gutterContributions.of(createRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() })),
      ],
    });
    const ids = state.facet(gutterContributions).map((c) => c.id);
    expect(ids).toEqual(['breakpoint', 'run']);
  });
});

describe('breakpointContribution', () => {
  it('exposes_stable_identity_and_priority_before_test_run', () => {
    expect(breakpointContribution.id).toBe('breakpoint');
    expect(breakpointContribution.priority).toBeLessThan(
      createRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() }).priority,
    );
    // 断点列无门控：装配层（有 projectId/absFilePath 即挂载）负责开关。
    expect(breakpointContribution.when(ctxOf())).toBe(true);
  });

  it('conforms_to_registry_interface', () => {
    // 结构断言：debug 侧不得 import editor 类型（防火墙），此处反向验证可注册性。
    const registered: GutterContribution<unknown>[] = [breakpointContribution];
    expect(registered[0].id).toBe('breakpoint');
  });

  function bpState() {
    // 经门面自备扩展装配（不断点 field 名直引，P3 防火墙形态）。
    return EditorState.create({ doc: TS_DOC, extensions: [...breakpointContributionExtensions] });
  }

  it('markersOf_maps_breakpoint_and_hover_lines', () => {
    let state = bpState();
    state = state.update({ effects: setBreakpointsEffect.of([1]) }).state;
    expect(breakpointContribution.markersOf(state, 1)).toEqual({ payload: { state: 'active' } });
    expect(breakpointContribution.markersOf(state, 2)).toBeNull();

    state = state.update({ effects: setHoverLineEffect.of(2) }).state;
    expect(breakpointContribution.markersOf(state, 2)).toEqual({ payload: { state: 'ghost' } });
    // 已有断点的行 hover 不再出 ghost（与现行合并循环语义一致）。
    expect(breakpointContribution.markersOf(state, 1)).toEqual({ payload: { state: 'active' } });
  });

  it('linesOf_enumerates_breakpoint_and_hover_lines', () => {
    let state = bpState();
    state = state.update({ effects: setBreakpointsEffect.of([1]) }).state;
    state = state.update({ effects: setHoverLineEffect.of(2) }).state;
    expect([...breakpointContribution.linesOf(state)].sort()).toEqual([1, 2]);
  });

  it('render_returns_dot_and_ghost_fragments_tagged_for_explicit_hit', () => {
    const dot = breakpointContribution.render({
      contributionId: 'breakpoint',
      line: 1,
      payload: { state: 'active' },
      anchorRect: new DOMRect(),
    });
    expect(dot?.classList.contains('cm-breakpoint-marker')).toBe(true);
    expect(dot?.getAttribute('data-gutter-contribution')).toBe('breakpoint');

    const ghost = breakpointContribution.render({
      contributionId: 'breakpoint',
      line: 2,
      payload: { state: 'ghost' },
      anchorRect: new DOMRect(),
    });
    expect(ghost?.classList.contains('cm-breakpoint-marker--hover')).toBe(true);
    expect(ghost?.getAttribute('data-gutter-contribution')).toBe('breakpoint');
  });

  it('has_no_onClick_so_dot_clicks_bubble_to_column_toggle', () => {
    // 红点点击沿用列级 toggle：贡献不吞事件（P2 合并器未命中 onClick 即冒泡）。
    expect(breakpointContribution.onClick).toBeUndefined();
  });
});

describe('runContribution', () => {
  function testState(doc: string, fileName: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [createRunCodelensCore({ fileName, onRun: vi.fn(), onMenuRequest: vi.fn() })],
    });
  }

  function makeContrib() {
    return createRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() });
  }

  it('markersOf_maps_case_lines_to_payload', () => {
    const ts = testState(TS_DOC, 'a.test.ts');
    expect(makeContrib().markersOf(ts, 2)).toEqual({
      payload: { kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } },
    });
    expect(makeContrib().markersOf(ts, 1)).toBeNull();

    const rust = testState(RUST_DOC, 'lib.rs');
    expect(makeContrib().markersOf(rust, 1)).toEqual({
      payload: { kind: 'test', testCase: { name: 'parse_simple', line: 1, lang: 'rust' } },
    });
    expect(makeContrib().markersOf(rust, 2)).toBeNull();

    // main 入口同样映射（同一贡献、同一 payload 通道）
    const go = testState('package main\n\nfunc main() {}\n', 'main.go');
    expect(makeContrib().markersOf(go, 3)).toEqual({
      payload: { kind: 'main', entry: { line: 3, language: 'go' } },
    });
  });

  it('when_gates_non_test_files_and_readonly_tabs', () => {
    const contrib = createRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() });
    expect(contrib.id).toBe('run');
    expect(contrib.when(ctxOf())).toBe(true);
    expect(contrib.when(ctxOf({ fileName: 'plain.ts' }))).toBe(false);
    expect(contrib.when(ctxOf({ editable: false }))).toBe(false);
    expect(contrib.when(ctxOf({ fileName: 'lib.rs' }))).toBe(true);
    // main 语言文件进列（main 与测试共用贡献）
    expect(contrib.when(ctxOf({ fileName: 'cmd/main.go' }))).toBe(true);
  });

  it('onClick_routes_ts_direct_run_and_rust_menu_by_rect', () => {
    const onRun = vi.fn();
    const onMenuRequest = vi.fn();
    const contrib = createRunContribution({ onRun, onMenuRequest });

    const tsCase: RunTarget = { kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } };
    expect(
      contrib.onClick?.(
        { contributionId: 'run', line: 2, payload: tsCase, anchorRect: new DOMRect() },
        new MouseEvent('mousedown'),
      ),
    ).toBe(true);
    expect(onRun).toHaveBeenCalledWith(tsCase);
    expect(onMenuRequest).not.toHaveBeenCalled();

    const rustCase: RunTarget = {
      kind: 'test',
      testCase: { name: 'other', line: 3, lang: 'rust' },
    };
    // rect.right=112/top=200 → 锚点 (116, 200)，与现行图标监听语义一致。
    const rect = { right: 112, top: 200 } as DOMRect;
    expect(
      contrib.onClick?.(
        { contributionId: 'run', line: 3, payload: rustCase, anchorRect: rect },
        new MouseEvent('mousedown'),
      ),
    ).toBe(true);
    expect(onMenuRequest).toHaveBeenCalledWith(rustCase, 116, 200);

    // main 入口同样走菜单（与测试同路由）
    const mainCase: RunTarget = { kind: 'main', entry: { line: 3, language: 'go' } };
    contrib.onClick?.(
      { contributionId: 'run', line: 3, payload: mainCase, anchorRect: rect },
      new MouseEvent('mousedown'),
    );
    expect(onMenuRequest).toHaveBeenCalledWith(mainCase, 116, 200);
  });

  it('render_returns_tagged_play_fragment', () => {
    const contrib = createRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() });
    const el = contrib.render({
      contributionId: 'run',
      line: 2,
      payload: { kind: 'test', testCase: { name: 'adds', line: 2, lang: 'ts' } },
      anchorRect: new DOMRect(),
    });
    expect(el?.classList.contains('cm-run-marker')).toBe(true);
    expect(el?.getAttribute('data-gutter-contribution')).toBe('run');
    expect(el?.querySelector('svg')).not.toBeNull();
  });

  it('conforms_to_registry_interface', () => {
    const registered: GutterContribution<unknown>[] = [
      createRunContribution({ onRun: vi.fn(), onMenuRequest: vi.fn() }),
    ];
    expect(registered[0].id).toBe('run');
  });
});
