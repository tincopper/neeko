# PRD：编辑器 LSP 自动导入与诊断提示体系

## Goal

让用户在编辑器内获得业界 IDE 水平的「写代码即被辅助」体验：输入 `fmt.Println()` 时
自动导入 `fmt` 包、代码有误时即时看到错误/警告（squiggle + 问题列表）、并可从诊断
一键修正（quickfix）。

**关键事实**（research/lsp-capability-matrix.md 实证）：主通道已在代码库运行——
lsp-client 补全接受已原子应用 `additionalTextEdits`（自动导入核心）、gopls 已注册、
`serverDiagnostics` 已装配。本任务 = **点亮未接线的部分 + 补齐缺失通道**，不是从零实现。

## Requirements

- **R1 诊断可视化闭环**：`DiagnosticsPanel`（现存孤儿组件）接入诊断数据流——诊断状态
  单写点为 lspStore（直采 Tauri `lsp-diagnostics-{projectPath}` 事件，与 CM 渲染解耦）；
  面板展示当前文件诊断（severity 分组 + 点击跳转行）；编辑器内提供稳定入口（可见性与
  挂载点实现期从既有面板/dock 模式中取最小侵入方案，设计文档给出判定标准）
- **R2 会话健康度可观测**：LS 生命周期信号（starting / running / failed / stopped，
  按语言）进 status-bar——用户能自答「为什么没有提示」（LS 没起来 ≠ 没有该功能）
- **R3 codeAction 通道**：诊断驱动的 quickfix——后端 `server_request.rs` 新增
  `workspace/applyEdit` 转发（进白名单，转 Tauri 事件）；前端 codeAction 请求封装 +
  灯泡入口（诊断行内）+ applyEdit 原子应用
- **R4 导入策略三态**（Ask/Auto/Never）：控制补全接受时是否自动应用 additionalTextEdits
  （默认 Auto；Ask 用于多候选场景弹选择）
- **R5 语言无关性（强制约束）**：以上全部能力通过 LSP 传输与能力协商实现，**禁止**
  任何语言特定逻辑（包名表、正则匹配、按语言分支 UI）——新 LS 接入即自动获得全部能力

## Acceptance Criteria

- [ ] AC1（R1）：打开含类型错误的文件 → 编辑器 squiggle（既有）+ 问题列表显示该诊断
      （severity 分组、点击跳转对应行）；无诊断时列表空态
- [ ] AC2（R2）：gopls/jdt.ls 启动、就绪、崩溃三态在 status-bar 可见；崩溃含重试入口
- [ ] AC3（R3）：Go 文件输入未导入符号产生诊断 → 诊断行 quickfix「Add import」→
      接受后 import 落块、诊断消失
- [ ] AC4（R4）：策略设置为 Never 时接受补全不应用附加编辑；Auto 时应用；Ask 弹选择
- [ ] AC5（R5）：全链路无语言分支；新增任意遵循 LSP 的 LS（以 builtins 现有 17 种中
      未实测的一种验证）无需改动本任务代码即可获得三通道
- [ ] AC6：门禁全绿（type-check / test:run / lint / eslint / cargo test）；每阶段
      TDD 红绿留痕

## 用户协作验证项（M0，需用户配合）

- 在 Go 项目中实测现有链路：gopls 是否安装/启动、`fmt.` 是否弹出补全、接受后是否
  自动落 import、错误是否显示 squiggle——**实测结果决定 M1 前是否需要先修链路断点**

## Notes

- 设计契约见 `design.md`；业界机制见 `research/industry-survey.md`；仓库实证见
  `research/lsp-capability-matrix.md`
- 禁止事项：语言特定逻辑（R5）、无差别透传 server 请求（保持白名单语义）、绕开
  lspStore 单写点直采诊断
