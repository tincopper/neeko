# JetBrains — gutter IconRenderer + LineMarkerProvider 扩展点

> 一手来源：intellij-community `master` 源码（2026-09-05 直读 raw）。

## 1. 扩展点形状

`LineMarkerProvider`（`platform/lang-api/.../daemon/LineMarkerProvider.java`）：

```java
interface LineMarkerProvider extends PossiblyDumbAware {
  LineMarkerInfo<?> getLineMarkerInfo(PsiElement element);          // 快路径，单元素
  default void collectSlowLineMarkers(List<? extends PsiElement>, Collection<...> result) {} // 慢路径，批量
}
```

- **只给叶子元素建 marker**（如方法名 identifier，而非整个方法体）——否则半可见时闪烁。对应 CM6：marker 应锚定行首 `from`，不跨行。
- **两遍 pass 性能设计**：`LineMarkersPass` 先扫可见区、再扫其余；两遍都无结果才清 marker。对应 CM6：viewport 裁剪 + 防抖重解析。
- EP 注册：`LineMarkerProviders#EP_NAME`，任意插件可贡献（OCP）；`LineMarkerProviderDescriptor` 叠加**用户可开关**（设置页 Gutter Icons，按 provider 启停 ≈ 用户维度的 `when`）。

## 2. 同行多 provider 合并（核心答案）

`MergeableLineMarkerInfo.merge()`（`platform/lang-api/.../daemon/MergeableLineMarkerInfo.java`）：

- 同行所有 mergeable markers 做 `canMergeWith` **二次配对**（注释明说 quadratic，行内数量小可接受）。
- 合并后只显示**一个图标**：`getCommonIcon()`，模板取 `getWeight()` 最大者（权重=优先级的可比形态）。
- 合并后的点击行为：`getClickAction()` 置空（不再直跑），`isNavigateAction()=true`，弹窗=各来源 `ActionGroup` **按组分隔拼接**（`getCommonActionGroup`：组间 `addSeparator`，无组者退化为单 navigate action）。
- 即：**同行冲突解决 = 单图标（权重胜出）+ 分组弹窗（全保留）**，既不丢动作也不堆图标。

## 3. 图标渲染器契约（点击路由范本）

`GutterIconRenderer`（`platform/editor-ui-api/.../markup/GutterIconRenderer.java`）：

| 方法 | 语义 | 对应 Neeko 需求 |
|---|---|---|
| `getClickAction()`（左键） | null = 无直跑动作 | TS 单 play 直跑 / Rust 弹菜单的分流点 |
| `getPopupMenuActions()` | 右键/弹窗菜单（ActionGroup） | Run/Debug 分组 |
| `getMiddleButtonClickAction()` / `getRightButtonClickAction()` | 按键区分路由 | 预留 |
| `getTooltipText()` | hover 文本 | 测试名/状态提示 |
| `isNavigateAction()` | 手型光标 | 可点击 affordance |
| `getAlignment()` | LEFT/RIGHT/CENTER/**LINE_NUMBERS**（断点新 UI 直接替换行号） | 列内定位策略 |
| `equals/hashCode` **必须覆写** | daemon 比对新旧 renderer，相等则不重绘，防闪烁 | **≈ CM6 `GutterMarker.eq` 的 DOM 复用语义** |

## 4. 对 Neeko 的启示

1. **合并策略抄 `merge` + `getCommonActionGroup`**：同行多贡献 → cell 内横向共存（Neeko 列宽允许）或权重单图标 + 分组菜单；当前"红点+play 横排"已是该策略的特例，应一般化为 priority 排序。
2. **点击/弹窗分离**（`getClickAction` vs `getPopupMenuActions`）正好建模 TS（click=直跑）vs Rust（click=菜单）：贡献接口应同时有 `onClick`（返回是否吞掉）与菜单 payload，而不是调用方 `if lang` 分流。
3. **`equals` 防闪烁 = `eq` 全覆盖**：`eq` 必须覆盖全部渲染输入；回调引用不稳定会导致每轮重建 DOM（当前 `UnifiedGutterMarker.eq` 把三个回调都纳入比较——回调每 render 重建即全量重建，见 recommendation P4）。
4. **用户可开关**：`LineMarkerProviderDescriptor` 提示 `when` 除文件门控外可留用户设置维度（后续，非 MVP）。

来源：
- https://github.com/JetBrains/intellij-community/blob/master/platform/lang-api/src/com/intellij/codeInsight/daemon/LineMarkerProvider.java
- https://github.com/JetBrains/intellij-community/blob/master/platform/lang-api/src/com/intellij/codeInsight/daemon/MergeableLineMarkerInfo.java
- https://github.com/JetBrains/intellij-community/blob/master/platform/editor-ui-api/src/com/intellij/openapi/editor/markup/GutterIconRenderer.java
