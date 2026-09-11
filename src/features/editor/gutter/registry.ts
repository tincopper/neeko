/**
 * 统一 gutter 列合并器：单列，多贡献（registry 驱动）。
 *
 * 所有权：合并器只依赖 `gutter/contribution.ts` 的类型 + facet，不直读任何域的
 * StateField（各贡献经 `markersOf/linesOf` 自备快照）。新增能力（coverage、AI、
 * LSP Lens……）只需注册新 contribution，不改本文件（OCP）。
 *
 * 行为契约（与旧 unifiedGutter.ts 逐条一致，纯重构）：
 * - 单列复用 `cm-breakpoint-gutter`；无图标行不产生 marker（零开销），无第二列。
 * - 同行多贡献按 `priority` 排序渲染（小在先/左），同 priority 按注册序（稳定）。
 * - 事件路由：`[data-gutter-contribution]` 显式命中 → 对应 `onClick`（返回 true
 *   吞掉）；未命中（空白区）/ 无 onClick / onClick 返回 false → 冒泡给列级
 *   toggle（旧"冒泡即断点"语义的显式化）。
 * - eq = parts 值比较（id + payload），回调引用不在比较输入内：回调重建
 *   （每 render 新闭包）不再触发整列 DOM 重建（旧 G4 缺陷已修）。
 *
 * - 不设 `lineMarkerChange`：hover ghost 依赖 markers() 全量重算（hover 行的
 *   marker 内容随 hover 状态变化），谓词过滤 hover 会直接破坏 ghost；
 *   有标记行数恒小（断点/用例行），全量重算成本可忽略。
 * - 不设 `initialSpacer`：列宽已由主题 `width:auto + minWidth:16px` 稳定；
 *   spacer 会以隐藏 GutterElement 常驻列内，改变 `.cm-gutterElement` 计数语义。
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';

import { gutterContributions, type GutterContribution, type GutterHit } from './contribution';

/** 列装配：行上下文 + 贡献表 + 列级回调（toggle/hover 语义由装配点注入）。 */
export interface UnifiedGutterOptions {
  fileName: string;
  editable: boolean;
  contributions: Array<GutterContribution<unknown>>;
  /** 空白区 / 非吞没点击 → 列级断点 toggle（debug 语义，装配点绑定）。 */
  onColumnClick: (view: EditorView, lineFrom: number) => boolean;
  onColumnHover: (view: EditorView, lineFrom: number) => boolean;
  onColumnLeave: (view: EditorView) => boolean;
}

/** 同行冲突规则（最小实现：run 优先硬规则）。
 *
 * 用例属性行（Rust `#[test]`/`#[tokio::test]` 行）只显示 play 图标，不提供断点：
 * 同行同时有 run 与 breakpoint 片段时丢弃断点片段（active 红点与 hover
 * ghost 同理丢弃——ghost 只是 breakpoint 贡献的另一种 payload）。
 * 扩展点：后续贡献（coverage 等）若需与断点互斥，把互斥声明收敛到此一处
 * （如 `excludes: ['breakpoint']` 注册表），合并器按声明过滤，不碰各贡献。
 */
const CONFLICT_WINNER = 'run';
const CONFLICT_LOSER = 'breakpoint';

/** payload 值比较：JSON 语义相等即相等（payload 契约为纯数据，见 GutterHit）。 */
function payloadEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

interface ComposedPart {
  id: string;
  payload: unknown;
}

/**
 * 单行组合 marker：同行各贡献按 priority 顺序共存（两者皆无的行不建 marker）。
 * 渲染分发经构造期捕获的贡献表；eq 只看行号 + parts 值（回调不在内）。
 */
export class ComposedMarker extends GutterMarker {
  constructor(
    readonly line: number,
    readonly parts: ComposedPart[],
    private readonly contribs: ReadonlyMap<string, GutterContribution<unknown>>,
  ) {
    super();
  }

  eq(other: ComposedMarker): boolean {
    return (
      other.line === this.line &&
      other.parts.length === this.parts.length &&
      this.parts.every(
        (part, i) =>
          other.parts[i].id === part.id && payloadEqual(other.parts[i].payload, part.payload),
      )
    );
  }

  toDOM(): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'cm-unified-gutter-cell';
    for (const part of this.parts) {
      const contrib = this.contribs.get(part.id);
      if (!contrib) continue;
      const hit: GutterHit<unknown> = {
        contributionId: part.id,
        line: this.line,
        payload: part.payload,
        // 渲染期占位：真值只在 onClick 事件期由命中片段 rect 推导。
        anchorRect: new DOMRect(),
      };
      let el: HTMLElement | null = null;
      try {
        el = contrib.render(hit);
      } catch {
        el = null;
      }
      if (el) cell.appendChild(el);
    }
    return cell;
  }
}
/**
 * 用例行判定（列级点击消歧用）：winner 贡献在该行是否有 marker。
 * 只经注册表接口（when + markersOf），不直读任何域的 StateField。
 */
function hasWinnerMarker(
  view: EditorView,
  lineNo: number,
  fileName: string,
  editable: boolean,
): boolean {
  let winner: GutterContribution<unknown> | undefined;
  try {
    winner = view.state.facet(gutterContributions).find((c) => c.id === CONFLICT_WINNER);
  } catch {
    return false;
  }
  if (!winner) return false;
  let gate = false;
  try {
    gate = winner.when({ line: lineNo, fileName, editable });
  } catch {
    return false;
  }
  if (!gate) return false;
  try {
    return winner.markersOf(view.state, lineNo) != null;
  } catch {
    return false;
  }
}

/** 列宽自适应覆盖（断点红点/ghost/play 样式复用各自模块主题，不在此重定义）。 */
const unifiedGutterTheme = EditorView.theme({
  '.cm-breakpoint-gutter': {
    width: 'auto',
    minWidth: '16px',
  },
  '.cm-breakpoint-gutter .cm-gutterElement': {
    padding: '0 2px',
  },
  '.cm-unified-gutter-cell': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '3px',
  },
});

/**
 * 统一 gutter 扩展：贡献表注册 + 单 gutter 列。
 * 贡献缺席 / 门控关闭时退化为纯断点列（不断点行无 marker）。
 */
export function createUnifiedGutterExtension(options: UnifiedGutterOptions): Extension {
  const { fileName, editable, contributions, onColumnClick, onColumnHover, onColumnLeave } =
    options;

  return [
    // 每个贡献独立 provider（Facet.of 只收单值，多参静默丢弃）；
    // combine=flat 按扩展顺序拼接 → 注册序稳定。
    contributions.map((c) => gutterContributions.of(c)),
    gutter({
      class: 'cm-breakpoint-gutter',
      markers(view) {
        try {
          // Array.sort 稳定 → 同 priority 按注册序。
          const ordered = [...view.state.facet(gutterContributions)].sort(
            (a, b) => a.priority - b.priority,
          );
          const docLines = view.state.doc.lines;
          const byLine = new Map<number, ComposedPart[]>();
          for (const contrib of ordered) {
            let candidate: readonly number[] = [];
            try {
              candidate = contrib.linesOf(view.state);
            } catch {
              continue;
            }
            for (const lineNo of candidate) {
              if (lineNo < 1 || lineNo > docLines) continue;
              let gate = false;
              try {
                gate = contrib.when({ line: lineNo, fileName, editable });
              } catch {
                continue;
              }
              if (!gate) continue;
              let marker: { payload: unknown } | null = null;
              try {
                marker = contrib.markersOf(view.state, lineNo);
              } catch {
                continue;
              }
              if (marker == null) continue;
              const parts = byLine.get(lineNo);
              const part = { id: contrib.id, payload: marker.payload };
              if (parts) {
                if (parts.some((p) => p.id === contrib.id)) continue;
                parts.push(part);
              } else {
                byLine.set(lineNo, [part]);
              }
            }
          }

          // 同行冲突（CONFLICT_WINNER 优先）：有用例片段的行丢弃断点片段。
          // 只读合并器自备的 parts（注册表接口产物），不跨域直读任何 field。
          for (const [conflictLine, conflictParts] of byLine) {
            if (
              conflictParts.some((p) => p.id === CONFLICT_WINNER) &&
              conflictParts.some((p) => p.id === CONFLICT_LOSER)
            ) {
              byLine.set(
                conflictLine,
                conflictParts.filter((p) => p.id !== CONFLICT_LOSER),
              );
            }
          }
          const contribsById = new Map(ordered.map((c) => [c.id, c]));
          const builder = new RangeSetBuilder<ComposedMarker>();
          for (const lineNo of [...byLine.keys()].sort((a, b) => a - b)) {
            const from = view.state.doc.line(lineNo).from;
            builder.add(from, from, new ComposedMarker(lineNo, byLine.get(lineNo)!, contribsById));
          }
          return builder.finish();
        } catch {
          return new RangeSetBuilder<ComposedMarker>().finish();
        }
      },
      domEventHandlers: {
        mousedown(view, line, event) {
          let lineNo: number | null = null;
          try {
            lineNo = view.state.doc.lineAt(line.from).number;
          } catch {
            lineNo = null;
          }
          if (lineNo != null) {
            const target = event.target;
            const fragment =
              target instanceof Element ? target.closest('[data-gutter-contribution]') : null;
            const contributionId = fragment?.getAttribute('data-gutter-contribution');
            if (contributionId && fragment instanceof Element) {
              const contrib = view.state
                .facet(gutterContributions)
                .find((c) => c.id === contributionId);
              if (contrib?.onClick) {
                let marker: { payload: unknown } | null = null;
                try {
                  marker = contrib.markersOf(view.state, lineNo);
                } catch {
                  marker = null;
                }
                // 快照已失效（field 在 DOM 与事件之间更新）→ 退回列级处理。
                if (marker) {
                  let handled = false;
                  try {
                    handled = contrib.onClick(
                      {
                        contributionId,
                        line: lineNo,
                        payload: marker.payload,
                        anchorRect: fragment.getBoundingClientRect(),
                      },
                      event as MouseEvent,
                    );
                  } catch {
                    handled = false;
                  }
                  if (handled) {
                    // 开启浮层的这次 mousedown 不得继续冒泡到 document：上一份
                    // 浮层的 outside-click 监听（document 级）会把这次点击判为
                    // "外部点击"而立即 closeMenu，新菜单秒关（开↔关竞态）。
                    (event as MouseEvent).stopPropagation();
                    return true;
                  }
                }
              }
            }
          }
          // 用例行空白区吞掉：点 play 附近误触不再设断点（返回 true，不冒泡 toggle）。
          // 只经注册表接口（when + markersOf）判定用例行，不跨域直读 field。
          if (lineNo != null && hasWinnerMarker(view, lineNo, fileName, editable)) return true;
          return onColumnClick(view, line.from);
        },
        mouseover(view, line) {
          return onColumnHover(view, line.from);
        },
        mouseout(view) {
          return onColumnLeave(view);
        },
      },
    }),
    unifiedGutterTheme,
  ];
}
