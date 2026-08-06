# useBrowserPanel 重构:useTauriEvent 抽取 + 测试(P1)

## Goal

消除 `useBrowserPanel.ts`(581 行)中 5 段重复的 `listen` 样板(cancelled/unlisten 模式),并为其关键行为补测试。

## Requirements

* 抽取共享 hook `useTauriEvent<T>(event: string, handler: (payload: T) => void)`(放 `src/shared/hooks/`),内部统一处理 listen/unlisten/cancelled 生命周期
* `useBrowserPanel` 与 `useBrowserPicker` 改用 `useTauriEvent`,消灭重复样板
* 为 hook 补关键行为测试(renderHook + act):
  * 事件监听按 label 过滤(非当前项目事件不更新状态)
  * 项目切换时 hide/show 与 dock 决策触发
  * navigateTo 外部调用驱动导航
* hook 内其余逻辑(项目级 store 交互、dock 决策)保持不变

## Acceptance Criteria

* [ ] `useBrowserPanel` 中 `let unlisten` 样板清零(改用 useTauriEvent)
* [ ] 新增 hook 测试覆盖事件过滤 + 项目切换关键路径
* [ ] `pnpm type-check` + `pnpm lint:fe` + `pnpm test:run` 通过,浏览器功能无回归

## Out of Scope

* 组件拆分/UI 重构
* picker 脚本改造
