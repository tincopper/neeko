/**
 * 断点 gutter 贡献（debug 域自备，P1 外壳）。
 *
 * 防火墙说明：本文件不得 import editor 域任何符号（含 `import type`——
 * eslint no-restricted-paths 不区分类型/值导入）。与注册表接口的 conformance
 * 由装配侧（editor）在 `gutterContributions.of(...)` 调用点做结构检查，
 * 另见 `src/features/editor/gutter/__tests__/contribution.test.ts` 的
 * `conforms_to_registry_interface` 用例。
 *
 * markersOf 暂读现有 fields（breakpointField/hoverLineField，同域）；P3 后
 * 亦如此——本文件即断开直读的目标形态（field 常驻 debug 域内）。
 *
 * disabled 渲染：断点列 field 存的是**视觉态** entries（`useEditorBreakpoints`
 * 已把 mute 折叠为 disabled）；`markersOf` 据此出 `active | disabled | ghost`。
 */
import type { EditorState, Extension } from '@codemirror/state';

import type { BreakpointEntry } from '@/features/runner/types';

import {
  breakpointField,
  breakpointGutterTheme,
  currentLineDecoField,
  hoverLineField,
} from '../hooks/useBreakpointGutter';

export interface BreakpointGutterPayload {
  state: 'active' | 'disabled' | 'ghost';
}

/** 快照自家 fields（同域直读；合并器只调本函数，不见 field）。 */
function snapshotOf(state: EditorState): {
  breakpoints: readonly BreakpointEntry[];
  hover: number | null;
} {
  let breakpoints: readonly BreakpointEntry[] = [];
  let hover: number | null = null;
  try {
    breakpoints = state.field(breakpointField);
  } catch {
    // field 缺席（贡献未装配）→ 空快照，行无 marker。
  }
  try {
    hover = state.field(hoverLineField);
  } catch {
    // 同上。
  }
  return { breakpoints, hover };
}

export const breakpointContribution = {
  id: 'breakpoint',
  priority: 10,

  when(): boolean {
    // 断点列无行级门控：装配层（有 projectId + absFilePath 即挂载）负责开关。
    return true;
  },

  linesOf(state: EditorState): readonly number[] {
    const { breakpoints, hover } = snapshotOf(state);
    const lines = breakpoints
      .map((e) => e.line)
      .filter((line) => line >= 1 && line <= state.doc.lines);
    if (hover != null && hover >= 1 && hover <= state.doc.lines && !lines.includes(hover)) {
      lines.push(hover);
    }
    return lines;
  },

  markersOf(state: EditorState, line: number): { payload: BreakpointGutterPayload } | null {
    const { breakpoints, hover } = snapshotOf(state);
    const bp = breakpoints.find((e) => e.line === line);
    if (bp) return { payload: { state: bp.enabled ? 'active' : 'disabled' } };
    if (hover === line) return { payload: { state: 'ghost' } };
    return null;
  },

  render({
    payload,
  }: {
    contributionId: string;
    line: number;
    payload: BreakpointGutterPayload;
    anchorRect: DOMRect;
  }): HTMLElement | null {
    const el = document.createElement('div');
    if (payload.state === 'ghost') {
      el.className = 'cm-breakpoint-marker cm-breakpoint-marker--hover';
      el.title = 'Add breakpoint';
    } else if (payload.state === 'disabled') {
      // 灰空心圆（对齐 lucide `Circle` 的 cx12 cy12 r10 语义，CSS 画，不引入新图标组件）。
      el.className = 'cm-breakpoint-marker cm-breakpoint-marker--disabled';
      el.title = 'Disabled breakpoint';
    } else {
      el.className = 'cm-breakpoint-marker';
      el.title = 'Breakpoint';
    }
    el.setAttribute('data-gutter-contribution', 'breakpoint');
    return el;
  },

  // 无 onClick：红点/灰空心/ghost 点击冒泡到列级处理器 → toggleBreakpointAt
  // （存在性 toggle 语义不变：disabled 行单击 = 删除，评审 P12）。
};

/**
 * 断点贡献的自备扩展：自家 fields + 主题。装配点（editor useUnifiedGutter）
 * 原样挂载；合并器经快照函数消费，不直读 field（P3 合入标准）。
 */
export const breakpointContributionExtensions: Extension[] = [
  breakpointField,
  hoverLineField,
  currentLineDecoField,
  breakpointGutterTheme,
];
