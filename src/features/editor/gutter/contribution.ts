/**
 * Gutter provider 注册表：类型 + facet（P1 外壳，无实现）。
 *
 * 目标（research/recommendation.md §2）：断点 / 单测 / 未来能力（coverage、AI、
 * LSP Lens 等）统一扩展——各域自备 contribution，合并器（gutter/registry.ts）
 * 只依赖本模块的接口，不直读任何域的 StateField。
 *
 * 与推荐草图的差异（有意）：
 * - `markersOf/linesOf` 显式接收 `EditorState`：各贡献读自家 field 需要 state；
 *   由调用方传入可避免贡献闭包捕获跨域 field（防火墙：editor 不直读 debug field）。
 * - 新增 `linesOf`：合并器需要候选行枚举；逐行全文档调用 markersOf 会把每次
 *   按键的开销从 O(有标记行) 放大到 O(文档行)，故由各贡献自备高效枚举。
 * - 省略草图的 `tooltip/elementClass`：title 由 render 直接写入（与现行一致），
 *   不用的接口不立（YAGNI）。
 */
import { Facet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';

/** 合并器行上下文：只给可序列化/稳定引用，marker eq 据此值比较。 */
export interface GutterLineContext {
  /** 1-based 行号。 */
  line: number;
  fileName: string;
  editable: boolean;
}

/** 命中：事件委托反查的结果（替代"冒泡即断点"的隐式约定）。 */
export interface GutterHit<P = unknown> {
  contributionId: string;
  /** 1-based 行号。 */
  line: number;
  /** 如 TestCaseInfo；必须值可比（供 eq）。 */
  payload: P;
  /** 菜单锚点（现行 rect 语义保留；render 期为占位空 rect，事件期为真值）。 */
  anchorRect: DOMRect;
}

export interface GutterContribution<P = unknown> {
  /** 唯一 id：'breakpoint' | 'run' | 'coverage' | ... */
  id: string;
  /** 同行排序（小在先/左）；同值按注册序（稳定，Array.prototype.sort 稳定性保证）。 */
  priority: number;
  /** 门控：替代散落的 includeTestMarkers/isTestFile 布尔。 */
  when(ctx: GutterLineContext): boolean;
  /** 候选行枚举（1-based）：合并器只对这些行调用 markersOf。 */
  linesOf(state: EditorState): readonly number[];
  /** 该贡献的行 marker（读自家 StateField 快照，不读别家 field）。 */
  markersOf(state: EditorState, line: number): { payload: P } | null;
  /** 渲染 cell 内片段；根节点必须带 data-gutter-contribution="<id>"。 */
  render(hit: GutterHit<P>): HTMLElement | null;
  /** 返回 true=吞掉（不再冒泡给列级 toggle）；false/缺省=冒泡。 */
  onClick?(hit: GutterHit<P>, ev: MouseEvent): boolean;
}

/** 注册表：各域贡献，合并器唯一依赖。combine=恒等（每贡献独立 provider，扩展顺序即注册序）。 */
export const gutterContributions = Facet.define<
  GutterContribution<unknown>,
  readonly GutterContribution<unknown>[]
>({
  combine: (values) => values,
});
