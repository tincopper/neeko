/**
 * LSP 诊断的编辑器**投影**：把「最近一次推送、已按当前文档映射好的诊断」持久化在
 * base 配置内的 StateField 里，并在 CodeMirror 重建配置后重放回 lint 渲染层。
 *
 * 为什么需要这一层（根因，2026-09-18 实证）：
 * - `@codemirror/lsp-client` 的 `serverDiagnostics()` 只产生 `setDiagnostics` 事务；
 *   `@codemirror/lint` 的渲染扩展（lintState + wavy 装饰）由 `maybeEnableLint` 经
 *   `StateEffect.appendConfig` **惰性安装**（lint 源码 :126-127）。
 * - 宿主 `@uiw/react-codemirror` 在 `extensions` 身份变化时 dispatch
 *   `StateEffect.reconfigure`（useCodeMirror.js:141-148）；state 源码 :2614-2621
 *   显示 reconfigure 会整体替换 base —— `appendConfig` 的追加结果被丢弃，
 *   波浪线清零。Problems 面板由 lspStore 独立订阅同一事件，不受影响，
 *   于是出现「列表有、波浪线没了」。
 *
 * 设计归属（不变量 I2：投影可重建）：
 * - 事实权威副本在 lsp 域 store（不变量 I1），编辑器波浪线只是投影；
 * - server 坐标 → CM 位置的映射与 version 门控仍归 `@codemirror/lsp-client`（禁止
 *   旁路 / 二次计算），本模块只让**映射结果**可存活、可重建；
 * - 本模块只依赖 `@codemirror/{lint,state,view}`，不依赖 store / lsp-client / editor 域。
 *
 * 前提约束（沿用 design 不做清单）：lint 装饰**仅由 LSP 推送产生**。若再挂第二套
 * linter，重放会与它的结果互相覆盖。
 */
import { setDiagnostics, setDiagnosticsEffect, type Diagnostic } from '@codemirror/lint';
import {
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';

/** `EditorView.destroyed` 为 TS private，按仓内既有做法（useNavigateGoal）经 unknown 收窄。 */
function isViewDestroyed(view: EditorView): boolean {
  return (view as unknown as { readonly destroyed: boolean }).destroyed;
}

/**
 * 事务是否**替换了 base 配置**。
 *
 * 不能用 `Transaction.reconfigured`：它只是 `startState.config != state.config`，
 * 对 `StateEffect.appendConfig` 同样为 true —— 而 lint 的渲染扩展正是经
 * appendConfig 安装的，用它会「自己触发自己」（实证：首推与每次重放都会误触发，
 * 多出一次冗余重放，且若重放后 lint 仍未安装即成环）。
 * 只有 `StateEffect.reconfigure` 才是「宿主整体替换扩展」这一语义
 * （`Compartment.reconfigure` 不替换 base，lint 也不会因此丢失，故不触发）。
 */
function replacesBaseConfig(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(StateEffect.reconfigure));
}

/**
 * 「已映射诊断」的持久镜像。
 *
 * 它位于 **base 配置**（由 `lspDiagnosticsProjection()` 装配进编辑器扩展列表），
 * 因此 reconfigure 时 value 会被保留：`StateField.slot.reconfigure` 只在旧配置里
 * 存在同 id 字段时保留值（state 源码 :1794-1806）。
 *
 * **必须模块级定义**：`StateField.define` 每次调用分配新 id，写成函数内定义会让
 * reconfigure 后的镜像静默归零 —— 那正是本模块要修的病。
 *
 * **位置映射必须与 lint 逐位一致**（2026-09-21 实测修正）：镜像曾用
 * `mapPos(from, +1)` / `mapPos(to, -1)` 手写映射，与 lint 的
 * `RangeSet<Decoration>.map(tr.changes)` 语义分叉 —— 在诊断起点插入、删除首字符、
 * 零点诊断（`from == to`）三类场景下位置不同（分叉取证见
 * `lspDiagnosticsProjection.test.ts` 的 parity 用例）。后果是每次编辑后重放都把
 * 波浪线挪到错位置。现在改为**同一套值语义**：把诊断包成 `RangeValue`，两侧
 * side 取 `Decoration.mark()` 的公开属性（lint 的诊断就是 mark 装饰），并用
 * `RangeSet.map` 映射 —— 与 lint 同源，不再自行推导。
 */
class MirrorValue extends RangeValue {
  /**
   * 与 lint 渲染同 side：lint 把非空诊断渲染成 **mark**、零长度诊断渲染成
   * **widget 点**（`LintState.init` 的两条分支），两者的 side 语义不同，
   * 映射结果也不同。这里直接取两种公共装饰的公开属性，避免手写魔数、
   * 也避免"照抄一遍却在边界场景分叉"。
   */
  startSide: number;
  endSide: number;
  /** 零长度区间需显式声明 `point`，否则 `RangeSet.of` 直接丢弃。 */
  point = true;

  constructor(readonly diagnostic: Diagnostic) {
    super();
    const sides = diagnostic.from === diagnostic.to ? WIDGET_SIDES : MARK_SIDES;
    this.startSide = sides.startSide;
    this.endSide = sides.endSide;
  }

  eq(other: MirrorValue): boolean {
    return (
      other.diagnostic.from === this.diagnostic.from &&
      other.diagnostic.to === this.diagnostic.to &&
      other.diagnostic.message === this.diagnostic.message
    );
  }
}

const MARK_SIDES = (() => {
  const mark = Decoration.mark({});
  return { startSide: mark.startSide, endSide: mark.endSide };
})();

const WIDGET_SIDES = (() => {
  class ProbeWidget extends WidgetType {
    toDOM(): HTMLElement {
      return document.createElement('span');
    }
  }
  const widget = Decoration.widget({ widget: new ProbeWidget() });
  return { startSide: widget.startSide, endSide: widget.endSide };
})();

function toRangeSet(diagnostics: readonly Diagnostic[]): RangeSet<MirrorValue> {
  return RangeSet.of(
    diagnostics.map((diagnostic) =>
      new MirrorValue(diagnostic).range(diagnostic.from, diagnostic.to),
    ),
    true,
  );
}

const diagnosticsMirror = StateField.define<RangeSet<MirrorValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = tr.docChanged ? value.map(tr.changes) : value;
    for (const effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) next = toRangeSet(effect.value);
    }
    return next;
  },
});

/**
 * 镜像中的诊断（重放用）。
 *
 * 必须用映射后的 `iter.from/to` 重建诊断：`MirrorValue.diagnostic` 存的是推送时刻的
 * 旧坐标，直接透传会在每次编辑 + 配置重建后把波浪线弹回旧位置（2026-09-21 实证：
 * 打字时波浪线乱跳）。其余字段（severity/message/source/code/actions 等）原样保留。
 */
function diagnosticsOf(mirror: RangeSet<MirrorValue>): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const iter = mirror.iter(); iter.value; iter.next()) {
    out.push({ ...iter.value.diagnostic, from: iter.from, to: iter.to });
  }
  return out;
}

/** @internal 测试钩子：断言镜像内容（生产代码不得使用）。 */
export const __diagnosticsMirrorForTests = {
  field: diagnosticsMirror,
  positions: (state: EditorState): [number, number][] => {
    const out: [number, number][] = [];
    const mirror = state.field(diagnosticsMirror, false);
    if (mirror) {
      for (const iter = mirror.iter(); iter.value; iter.next()) {
        out.push([iter.from, iter.to]);
      }
    }
    return out;
  },
};

/**
 * 配置重建后把镜像重放回 lint 渲染层。
 *
 * 触发判据只有「事务以 `StateEffect.reconfigure` 替换了 base 且镜像非空」：
 * - 镜像非空 ⇒ lint 曾被安装（唯一安装点是 LSP 推送）；
 * - base 替换是**唯一**丢失路径（`Compartment.reconfigure` 不替换 base，
 *   已由 state 源码 :2606-2621 确认；本仓无其它 linter）。
 * 刻意不用 `diagnosticCount` 比对：它返回 lint **合并后**的 range 数，
 * 重叠诊断下健康态也会小于镜像长度，会引入每次重建的多余重放。
 *
 * 重放是幂等的：`setDiagnostics` 经 `maybeEnableLint` 重新 appendConfig 装上渲染扩展。
 */
const reconciler = ViewPlugin.fromClass(
  class {
    /** 合并同一批（或在微任务兑现前接连发生的）重建，避免重复重放。 */
    private pending = false;

    update(update: ViewUpdate): void {
      if (this.pending) return;
      if (!update.transactions.some(replacesBaseConfig)) return;
      if (!update.state.field(diagnosticsMirror, false)?.size) return;

      this.pending = true;
      // CM 更新周期内禁止 dispatch（.trellis/spec/frontend/navigation-goal.md §4），
      // 放到微任务；此时视图可能已销毁，必须守卫。
      queueMicrotask(() => {
        this.pending = false;
        const view = update.view;
        if (isViewDestroyed(view)) return;
        const mirror = view.state.field(diagnosticsMirror, false);
        if (!mirror?.size) return;
        view.dispatch(setDiagnostics(view.state, diagnosticsOf(mirror)));
      });
    }
  },
);

/**
 * 模块级单例：扩展实例身份恒定，可直接放入 `extensions` 数组而不引入配置抖动。
 * 装配点见 `src/features/editor/hooks/useEditorExtensions.ts`（稳定段，不随
 * LSP client 挂载/释放的 `lspClientExt` 生命周期起落）。
 */
const LSP_DIAGNOSTICS_PROJECTION: Extension = [diagnosticsMirror, reconciler];

/** 诊断投影扩展（模块级单例，重复调用返回同一实例）。 */
export function lspDiagnosticsProjection(): Extension {
  return LSP_DIAGNOSTICS_PROJECTION;
}
