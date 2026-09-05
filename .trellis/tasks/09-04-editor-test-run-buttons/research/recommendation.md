# 推荐方案 — GutterContribution provider 接口 + 注册表 + 合并器

> 目标：断点 / 单测 / 未来能力（coverage、AI、LSP Lens 等）统一扩展；高内聚（各域自备贡献）、低耦合（合并器只依赖注册表接口）、可扩展（新增能力只加 contribution，不改合并器）。
> 现状基线：`src/features/editor/unifiedGutter.ts`（单列特化合并：断点+测试双字段硬编码，直读 debug field）+ `testCodelens.ts` + `useBreakpointGutter.ts`。

## 1. 业界方案对比表（含来源）

| 维度 | VS Code | JetBrains | CodeMirror 6 官方 | Zed / lintGutter | Neeko 现状 |
|---|---|---|---|---|---|
| 断点列所有权 | core（decorations 只叠只读图标）— [vscode.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) | daemon + renderer，core 持有 — [GutterIconRenderer.java](https://github.com/JetBrains/intellij-community/blob/master/platform/editor-ui-api/src/com/intellij/openapi/editor/markup/GutterIconRenderer.java) | 各 gutter 独立列，顺序按 extension priority — [ref](https://codemirror.net/docs/ref/#view.gutter) | core gutter 点击设断点 — [debugger.md](https://zed.dev/docs/debugger) | editor 组装，消费 debug field（选 A 已记录） |
| 执行入口位置 | 行间 CodeLens 横块（非 gutter） | 同 gutter 图标 | 任意 gutter / 行号列 | 行内 runnable 标记 / 独立 lint 列 | 与断点同列（单列约束） |
| 多源同行合并 | 多 provider 数组汇总，无去重 | `canMergeWith` 配对 + weight 选图标 + 分组弹窗 — [MergeableLineMarkerInfo.java](https://github.com/JetBrains/intellij-community/blob/master/platform/lang-api/src/com/intellij/codeInsight/daemon/MergeableLineMarkerInfo.java) | `markers` 可返 `RangeSet[]`；`lineMarker(view,line,otherMarkers)` 合并钩子 | lint 单源不处理；Zed tasks tags 覆盖 — [tasks.md](https://zed.dev/docs/tasks) | 手写双源合并循环 |
| 点击路由 | `command` → `executeCommand` | `getClickAction`（左键）/ `getPopupMenuActions`（菜单）分离 | `domEventHandlers` 返回 true=已处理；图标级命中靠 marker DOM 自区分（`@codemirror/view@6.43.9` dist 实测） | task spawn / debug scenario | play 自吞 / 其余冒泡（DOM 冒泡隐式判定） |
| 刷新机制 | `onDidChangeCodeLenses` 推 | daemon 两遍 pass（可见区优先）— [LineMarkerProvider.java](https://github.com/JetBrains/intellij-community/blob/master/platform/lang-api/src/com/intellij/codeInsight/daemon/LineMarkerProvider.java) | `StateEffect` 推 + `lineMarkerChange` 谓词 | `setDiagnosticsEffect` 推 | `refreshTestCodelensEffect` + 防抖（已对齐） |
| DOM 稳定 | core diff | `equals/hashCode` 必覆写防闪烁 | `eq` 比对复用，未命中重建（`GutterElement.setMarkers`） | 同左 | `eq` 含回调引用比较（不稳定则全量重建，见 §4） |
| 配置/门控 | `DocumentSelector` 语言作用域 | `LineMarkerProviderDescriptor` 用户可开关 | `Facet` + `combine` | facet config（`markerFilter` 等） | `includeTestMarkers` 布尔 |

## 2. 推荐接口草图（TS）

```ts
// src/features/editor/gutter/contribution.ts —— 仅类型 + registry facet，无实现
import type { Extension, RangeSet } from '@codemirror/state';
import type { GutterMarker } from '@codemirror/view';

/** 合并器行上下文：只给可序列化/稳定引用，marker eq 据此值比较。 */
export interface GutterLineContext {
  line: number;            // 1-based
  fileName: string;
  editable: boolean;
}

/** 命中：事件委托反查的结果（替代"冒泡即断点"的隐式约定）。 */
export interface GutterHit<P = unknown> {
  contributionId: string;
  line: number;
  payload: P;              // 如 TestCaseInfo；必须值可比（供 eq）
  anchorRect: DOMRect;     // 菜单锚点（现行 rect 语义保留）
}

export interface GutterContribution<P = unknown> {
  /** 唯一 id：'breakpoint' | 'test-run' | 'coverage' | ... */
  id: string;
  /** 同行排序（小在左/先）；同值按注册序（稳定）。 */
  priority: number;
  /** 门控：替代散落的 includeTestMarkers/isTestFile 布尔。 */
  when: (ctx: GutterLineContext) => boolean;
  /** 该贡献的行 markers（读自家 StateField 快照，不读别家 field）。 */
  markersOf: (line: number) => { payload: P; elementClass?: string } | null;
  /** 渲染 cell 内片段；根节点必须带 data-gutter-contribution="<id>"。 */
  render: (hit: GutterHit<P>) => HTMLElement | null;
  /** 返回 true=吞掉（不再冒泡给列级 toggle）；false/缺省=冒泡。 */
  onClick?: (hit: GutterHit<P>, ev: MouseEvent) => boolean;
  tooltip?: (hit: GutterHit<P>) => string | undefined;
}

/** 注册表：各域贡献，合并器唯一依赖。combine=concat（注册序稳定）。 */
export const gutterContributions = Facet.define<GutterContribution, readonly GutterContribution[]>({
  combine: (groups) => groups.flat(),
});
```

合并器（单 gutter 列，`createContribGutterExtension()`）：

- `markers(view)`：取 registry → 过 `when` → 收集有 payload 的行号并集 → 每行 `RangeSetBuilder` 加一个 `ComposedMarker { parts: [{id, payload}] }`（`eq` = parts 值比较）。
- `toDOM()`：按 `priority` 排序渲染各 `render()` 片段，容器 `display:flex; gap`（现行 `.cm-unified-gutter-cell` 语义保留）。
- `domEventHandlers.mousedown`：`event.target.closest('[data-gutter-contribution]')` → 命中则调对应 `onClick`，返回 true 吞掉；未命中（空白区）→ 返回 false，冒泡给列级断点 toggle（现行语义显式化）。
- 列宽：`width:auto + initialSpacer`（现行 auto 语义保留，spacer 防抖动）。

## 3. 所有权（无交叉导入）

```
features/debug/gutter/breakpointContribution.ts  → 提供 { id:'breakpoint', markersOf/render/onClick(toggle), tooltip }
features/editor/gutter/testRunContribution.ts    → 提供 { id:'test-run', markersOf/render/onClick(TS直跑/Rust菜单), tooltip }
features/editor/gutter/registry.ts               → contribution.ts 类型 + gutterContributions facet + 合并器
features/coverage/... / features/ai/...          → 后续各自提供 contribution（零改合并器）
```

- debug 不 import editor，editor 不 import debug field：双方只 import `registry.ts` 的类型/facet（防火墙方向：`editor/gutter ← debug` 仅类型层，值层由装配点 `useUnifiedGutter` 按 `when` 拼 registry）。
- 现行"选 A"（editor 直读 debug field）被 P3 切断：debug 自备 field 并随 contribution 暴露 `markersOf`，合并器不再见 `breakpointField`。

## 4. 与现状差距（按严重度）

| # | 差距 | 现状 | 目标 | 影响 |
|---|---|---|---|---|
| G1 | 无注册表 | 双源字段硬编码在 `UnifiedGutterMarker` | registry facet 驱动 | 加 coverage/AI 要改合并器（违 OCP） |
| G2 | 反向 field 依赖 | editor 直读 `breakpointField/hoverLineField` | 各贡献自带 `markersOf` | debug 改 field 即破 editor |
| G3 | 命中判定隐式 | play mousedown 自吞 + 冒泡=toggle | `data-gutter-contribution` + `closest` 显式反查 | 加第三种图标时路由歧义 |
| G4 | `eq` 输入不稳定 | `eq` 比较三个回调引用（每 render 重建即全量 DOM 重建） | payload 值比较；回调经稳定 registry 查表 | hover/输入时整列 DOM 重建（性能） |
| G5 | 门控布尔化 | `includeTestMarkers` + 调用方 `isTestOrRust` | `when(ctx)`（文件/可编辑/项目/用户设置可组合） | 每加一类门控加一布尔 |
| G6 | 缺 `lineMarkerChange`/spacer | hover 经 `markers()` 全量重算 | hover/breakpoint 走自家 field + 谓词（或记录取舍） | hover 全列重算（行数小可接受，需显式决策） |

## 4. 性能与测试策略

- 性能：各贡献 StateField 独立 `map(tr.changes)` 跟随 + effect 驱动重算（lint 范式）；防抖保留在各贡献内；`markers()` 合并复杂度 O(行×贡献)；`renderEmptyElements=false`（无图标行零开销，现行语义保留）；`initialSpacer` 稳定列宽。
- 测试（行为级，禁实现断言）：
  - 贡献级：`markersOf` 行映射（用例行有/非用例行无）、`when` 门控（非测试文件/只读无贡献）。
  - 合并器级：同行双贡献渲染顺序（priority）、同 priority 注册序稳定、第三贡献加入后既有快照不变（OCP 回归）。
  - 事件级：点击 play 片段 → 对应 `onClick` 被调且列级 toggle 未触发；点击空白 → toggle 触发；`anchorRect` 非空（菜单锚点契约）。
  - 性能级：`eq` 对同 payload 不同回调引用返回 true（防 G4 回归）。

## 5. 最小迁移路径（分阶段，每步独立合入、不改产品行为）

- **P1 注册表外壳**：新增 `gutter/contribution.ts`（类型 + facet）+ 把现有两源包成 `breakpoint` / `test-run` 两个 contribution 对象（`markersOf` 暂读现有 fields，`render/onClick` 搬现有函数）；合并器仍走旧循环。合入标准：行为零变化，type-check + 既有单测全绿。
- **P2 合并器 registry 化**：`markers()` 改按行收集 registry → `ComposedMarker`；事件改 `data-gutter-contribution` 显式命中；`UnifiedGutterMarker` 删除（或转 thin adapter）。合入标准：§4 事件级 + 合并器级新单测绿，旧行为快照不变。
- **P3 断开 field 直读**：debug 侧暴露 `breakpointContribution`（自备 field 快照函数），editor 删除 `@/features/debug` field 导入（保留 toggle 回调注入）；`testCodelensField` 收归 test-run 贡献内部。合入标准：`grep breakpointField unifiedGutter` 零命中；防火墙检查过。
- **P4 稳定化**：`eq` 改 payload 值比较；补 `lineMarkerChange`/spacer（或书面记录不做）；补 §4 测试矩阵。合入标准：hover/输入场景 DOM 复用断言绿。

> 约束重申：全程不改产品行为（纯重构）；每步独立可合入可回滚；不新增 npm 依赖；mod 边界遵循 AGENTS.md（门面/防火墙/directory-structure）。
