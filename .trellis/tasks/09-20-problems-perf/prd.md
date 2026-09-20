# PRD：Problems 大项目性能优化

## Goal

Java 大项目初次导入/构建时，jdtls 短时间内对数百个文件逐个 `publishDiagnostics`，
Problems 列表必须保持首屏可交互、不卡顿（当前：突发 N 次全量重建 + 全量行渲染，
千行级即明显卡顿）。

## Requirements

- **R1 发布合并**：突发诊断事件收敛为最小次数的 store 更新（单写点语义不变：
  仍按 uri 整体替换，只是把 N 次对象重建压成 1 次）。
- **R2 默认折叠 + 行懒渲染**：文件组数超阈值默认折叠；折叠组不渲染行；组内
  `languageId` 按组算一次。
- **R3 行 memo 化**：诊断行（含灯泡）`React.memo` 化，避免无关 publish 引发全行重渲染。
- **R4 约束**：不改变诊断语义（排序/分组/清空/跳转/AI 动作行为不变）；不引入虚拟滚动
  （后手，另起一轮）；R5 语言无关保持。

## Acceptance Criteria

- [ ] AC1：构造 N=200 文件 × M=20 诊断的突发 publish，面板重渲染次数 ≤ 3（回归测试钉死）。
- [ ] AC2：折叠组零行渲染；展开后行渲染正确，跳转/quickfix/AI 动作行为不变（既有单测全绿）。
- [ ] AC3：`pnpm type-check` + 相关 vitest + eslint 全绿；无新增超 300 行文件。

## Notes

- 根因分析见父任务会话：`lspStore.setProjectDiagnostics` 每次展开新建对象 →
  `DiagnosticsPanel` selector 身份变化 → `buildGroups` 全量重建重排 + 全行挂载。
