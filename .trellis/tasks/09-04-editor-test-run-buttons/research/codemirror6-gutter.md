# CodeMirror 6 官方 — gutter facet + GutterMarker 最佳实践

> 一手来源：`@codemirror/view@6.43.9` 本地安装包（`node_modules/@codemirror/view/dist/index.d.ts` 类型定义 + `dist/index.js` 实现，行号为该版本实测）。

## 1. `gutter()` 配置面（`index.d.ts:2306`）

```ts
gutter({
  class?: string;                       // 列 class（多 gutter 并存用 class 区分）
  renderEmptyElements?: boolean;        // 默认 false：无 marker 行不占位（零开销列）
  markers?: (view) => RangeSet<GutterMarker> | readonly RangeSet<GutterMarker>[];
  lineMarker?: (view, line, otherMarkers) => GutterMarker | null;  // ★官方合并钩子
  widgetMarker?: (view, widget, block) => GutterMarker | null;
  lineMarkerChange?: null | ((update: ViewUpdate) => boolean);     // 额外状态变更谓词
  initialSpacer?: (view) => GutterMarker;   // 列宽基线
  updateSpacer?: (spacer, update) => GutterMarker;
  domEventHandlers?: { [event]: (view, line: BlockInfo, event) => boolean }; // true=已处理
  side?: "before" | "after";
})
```

- **原生多源**：`markers` 可返回 `RangeSet[]` 数组，`asArray`（`index.js:11538`）归一后合并渲染——单 gutter 多 marker 源是官方支持形态，不是 hack。
- **`lineMarker(view, line, otherMarkers)` 是官方指定的"同行合并"钩子**：先有各源 markers，再按行给一次看到 `otherMarkers` 后追加/覆盖的机会。Neeko 当前手写合并循环，本质是在复刻这个钩子。
- **列顺序由 extension priority 决定**（`gutter` 文档原话）。
- 另有三条官方注入通道，可替代"读别人 field"：`lineNumberMarkers` facet（向行号列注 marker）、`gutterLineClass` facet（只给 `elementClass` 的 class 型 marker）、`gutterWidgetClass`。

## 2. 事件委托（`index.js:11606`）

- 监听挂在 gutter 根 DOM，按 `event.target` 回溯到 `.cm-gutterElement`，取其中线 `getBoundingClientRect` 中点 → `lineBlockAtHeight(y)` 定位行，再调 `handlers[prop](view, line, event)`。
- handler 返回 `true` → `preventDefault()`（即"已处理"）；**不负责 stopPropagation**——"吞 vs 冒泡"要贡献自己在 DOM 上处理（如当前 play 图标的 mousedown 自吞）。
- 含义：命中判定天然是"行级"的；**列内图标级命中必须由 marker DOM 自己区分**（`data-*` 属性 + `closest`），这正是推荐方案要求显式化的点。

## 3. DOM 复用（`index.js` `GutterElement.setMarkers` / `sameMarkers`）

- 同行新旧 markers 逐个 `compare`（即 `GutterMarker.eq`）：命中则**复用 DOM 节点**（`domPos.nextSibling` 跳过），未命中才 `toDOM()` 新建；移除的调 `destroy(dom)`。
- `elementClass` 会并入 `cm-gutterElement` 的 class 串。
- 推论：`eq` 返回 false 的代价是整节点重建（含内联 SVG/监听器）；**`eq` 输入必须稳定**（payload 值比较，忌闭包引用比较）。

## 4. 更新裁剪（`SingleGutterView.update`）

```js
return !RangeSet.eq(this.markers, prevMarkers, vp.from, vp.to) ||
       (this.config.lineMarkerChange ? this.config.lineMarkerChange(update) : false);
```

- 只比较 **viewport 内**的 RangeSet 是否相等；额外状态（hover 行、断点集）经 `lineMarkerChange` 谓词声明。当前 unifiedGutter 把 hover/breakpoints 读进 `markers()` 使每次 hover 都全量重算——功能正确但可优化：hover/breakpoint 应走自家 field + `lineMarkerChange`，或接受现状（行数小）并记录取舍。

## 5. 状态存放正统形态

- 各贡献自备 `StateField<RangeSet>`，`update` 里先 `markers.map(tr.changes)` 跟随文档，再按 `StateEffect` 重算（见 lint 案例）。
- 配置注入用 `Facet`（`combine` 归一），刷新用 `StateEffect`（推）+ `EditorView.dispatch`。

来源：
- https://codemirror.net/docs/ref/#view.gutter（`gutter`/`GutterMarker`/`lineNumberMarkers`）
- `@codemirror/view@6.43.9` `dist/index.d.ts:2270-2400`、`dist/index.js`（`SingleGutterView`/`GutterElement`/`sameMarkers`）
