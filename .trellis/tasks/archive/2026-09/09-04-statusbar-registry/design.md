# Design: StatusBar registry（左右统一）

## 链路

```
StatusBar.tsx（瘦身：bridge + 两簇 map 渲染）
 → registry.ts（STATUS_BAR_ITEMS：id/side/order/exclusiveGroup/component）
 → renderer（per side 排序；组内首个非 null；无组全渲染）
 → bridges/（LspSubscriptionBridge、InstallProgressBridge，常驻 null）
 → lspStore（新增 installProgress 切片；既有 profiles/sessions/conflicts 复用）
```

## 变更点（按序，每步可绿）

1. **registry 地基**：`types.ts` + `registry.ts` + 渲染器；先只搬右簇
   5 项 + 左簇常驻项（branch、conflicts），`leftContent()` 保持原样。
   StatusBar 删硬编码按钮，改 map 渲染。
2. **左簇入组**：加 bridges（effects 从 StatusBar 原样迁移，注释保留），
   `installProgress` 入 `lspStore`；拆 `leftContent` 为组内三 item，
   删 `leftContent`。
3. **LspStatusSection 自订阅**：props 改内部 `useLspStore/useProjectStore`
   读取；registry 快照单测 + 组切换单测。

## 范本对照

- 静态 meta + 构建：`shared/dock/panelMeta.ts` + `app/dock/registry.ts:143`。
- item 自订阅/自守卫：`PromptsStatusSection.tsx:46,143`。
- chip/portal 骨架：`LspStatusSection.tsx`（本次只动其数据来源，不动 UI）。

## 约束

- feature `index.ts` 仅门面；registry/types 经 feature 内直导。
- store 目录化直导；`installProgress` 切片放 `store/`（或 lspStore 内聚）。
- TDD；不跑全量门禁（主会话统一跑）；不提交。
