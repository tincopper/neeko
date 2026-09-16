# 现代案例 — Zed runnables + `@codemirror/lint` lintGutter

## A. Zed：断点归 core，运行归任务（runnables）

> 来源：Zed 官方文档（2026-09-05 直读）。

- **断点 gutter core 所有**：「To set a breakpoint, simply click next to the line number in the editor gutter」（`debugger.md` Breakpoints 节）。右键断点图标出条件/日志/hit count 菜单——断点的点击与菜单路由都在 core。
- **运行按钮 = inline runnable indicators**（行内可运行标记，非 gutter 列）：由任务系统驱动——`tasks.json` 的 `tags` 字段可覆盖某 runnable 的默认动作（`tasks.md` "Binding runnable tags to task templates"），触发经 code actions（`cmd-.`）或 gutter 自动创建 debug scenario（`debugger.md`："Automatic scenario creation also powers our scenario creation from gutter"，首批 Rust/Go/Python/JS/TS）。
- 所有权映射：**语言/任务提供 runnable（数据）→ core 渲染与路由（交互）**；断点与运行分属两个子系统、两种渲染位置，天然解耦。

来源：
- https://zed.dev/docs/debugger（Breakpoints / Automatic scenario creation）
- https://zed.dev/docs/tasks（runnable tags / code actions 运行任务）

## B. `@codemirror/lint` lintGutter：同框架可插拔 gutter 范本

> 来源：`@codemirror/lint` 最新 dist（jsDelivr，2026-09-05 拉取，`/tmp/lint.js`）。

```js
const lintGutterExtension = gutter({
  class: "cm-gutter-lint",                                   // 独立列，固定宽 1.4em
  markers: view => view.state.field(lintGutterMarkers),      // 纯读自家 field
  widgetMarker: (view, widget, block) => { ... }             // block widget 行兜底
});
function lintGutter(config = {}) {
  return [lintGutterConfig.of(config), lintGutterMarkers, lintGutterExtension, lintGutterTheme, lintGutterTooltip];
}
```

可抄的四点：

1. **一函数装配全家桶**：`lintGutter()` 一次返回 `[config facet, markers field, gutter 列, theme, tooltip field]`——贡献自包含，调用方一行接入。推荐方案的 contribution 应达到同样装配 ergonomics。
2. **配置注入用 facet**：`lintGutterConfig`（`combine` 默认值：`hoverTime/markerFilter/tooltipFilter`）——调用方可覆盖过滤器而不改贡献代码。对应推荐方案的 `when` + options facet。
3. **hover 走 `hoverTooltip` + 自家 tooltip field**，不与 markers 耦合——详情展示与图标渲染分离。Neeko 的测试名 tooltip/菜单锚点可同理走独立通道。
4. **field 更新正统形态**：`markers.map(tr.changes)` 跟随编辑 + 仅 `setDiagnosticsEffect` 到达时重算（`lintGutterMarkers.update`）——重解析只在 effect 驱动下发生。当前 `testCodelensField` 的防抖重解析与之一致，已对齐。

## C. 小结（给推荐方案的输入）

| 维度 | VS Code | JetBrains | Zed | lintGutter |
|---|---|---|---|---|
| 断点列所有权 | core | core（daemon+renderer） | core | —（无断点概念） |
| 执行入口位置 | 行间 CodeLens 横块 | 同 gutter 图标（合并+分组弹窗） | 行内 runnable 标记 | 独立 gutter 列 |
| 多源同行 | 各 provider 数组汇总，无去重 | `canMergeWith` 二次配对+权重+分组菜单 | 任务 tags 覆盖 | 不处理（单源列） |
| 点击路由 | `command` → `executeCommand` | `getClickAction` / popup ActionGroup | task spawn / debug scenario | hover tooltip（只读） |
| 刷新 | `onDidChangeCodeLenses` 推 | daemon pass | 任务重扫 | `StateEffect` 推 |
| DOM 稳定 | core 持有，diff 重渲染 | `equals/hashCode` 比对 | core 持有 | `eq`（GutterMarker） |

Neeko 约束（单列、CM6）下：渲染位置学 JetBrains（同列合并），刷新/状态学 lintGutter（field+effect+facet），注册/门控学 VS Code（selector≈when），所有权学 Zed（数据归域、渲染归合并器）。
