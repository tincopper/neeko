# 实施计划：M1 → M2 → M3 → M4（M0 用户协作验证贯穿）

> 契约依据：design.md §2。每阶段独立可交付，TDD 红绿留痕，阶段完成即跑门禁。

## 顺序与理由

**M1 诊断可视化**（首个实现阶段）：独立可交付（纯前端 + store）、是 AC 的感知基础、
为 M3 灯泡提供数据承载。M0 用户协作验证与其并行。

**M2 健康度**：Rust 钩子 + status-bar，小而独立。

**M3 codeAction 通道**：横跨 Rust 转发 + 前端应用 + 灯泡 UI（复用 M1 面板），依赖
M1 的诊断行承载。

**M4 策略三态**：纯策略层，最后（在真实三通道跑通后才有意义）。

## M0：用户协作验证清单（与 M1 并行，不阻塞）

用户在 Go 项目中执行并回填结果：
1. gopls 是否安装（终端 `gopls version`）；未装 → Neeko 内触发 builtins 安装兜底
2. 打开 Go 文件 → 编辑器是否有 squiggle（如输入 `undefinedX()` 观察诊断）
3. 输入 `fmt.` → 是否弹补全；选择 `Println` → import 块是否自动落 `import "fmt"`
4. status-bar 是否有 LSP 相关信号（预期：无 → M2 交付项）
结果回填 prd.md「用户协作验证项」，任何断点按 design 错误矩阵定位。

## M1 诊断可视化（R1/AC1）

1. **Red**：lspStore 诊断切片单测——整体替换语义 / 空 arrays 清空 / 跨项目隔离 /
   解析容错（设计错误矩阵逐条）；DiagnosticsPanel 分组/跳转/空态组件测试
2. **Green**：lspStore 切片 + 事件订阅生命周期（acquire/release 对齐会话）+
   DiagnosticsPanel 接线（数据从 props 改为 lspStore 选择）
3. 挂载点：按 design §M1 判定标准三选一（dock 面板 / 底部折叠条 / status-bar 弹层），
   实现期考察既有面板模式后取最小侵入；在实现报告里记录选择依据
4. 门禁 + 汇报挂载点决策

## M2 健康度（R2/AC2）

1. Rust：会话生命周期钩子 → `lsp-health-{projectPath}` 事件（常量化进 events.ts，
   前后端同源）；白名单语义不动
2. 前端：lspStore health 切片（幂等）+ status-bar item（语言图标 + phase + failed
   重试入口）
3. 测试：Rust 触发矩阵单测、store 幂等、item 组件测试

## M3 codeAction（R3/AC3）

1. Rust：`workspace/applyEdit` 进 server_request 白名单 → `lsp-apply-edit-{projectPath}`
   事件转发 + ok 应答（LSP 语义）；MethodNotFound 兜底回归测试
2. 前端：`requestCodeActions` / `applyCodeAction` 封装（lspRequest 面）+ applyEdit
   事件消费（原子多 edit 应用）+ DiagnosticsPanel 行内灯泡（动作列表 + 应用）
3. 测试：Rust 转发单测、前端原子应用事务测试、灯泡交互测试、mock codeAction 链路
4. **Go 真机验证**：未导入符号诊断 → quickfix → import 落块（AC3 终验）

## M4 策略三态（R4/AC4）

1. 设置项 `editor.lsp.importStrategy`（settings 域既有模式 + 持久化）
2. 拦截点：`lspCompletionInfoRenderer.createThemedCompletionSource` 返回处按策略变换
   option（auto 放行 / never 剥离附加编辑 / ask 弹 import 预览确认）
3. 测试：三态行为差异单元测试 + 设置持久化

## 收尾

- AC5 语言无关性验证：builtins 中选一个未实测 LS（如 python/pyright 或 rust-analyzer）
  重复 M0 清单 1-3 项
- 全量门禁 + 各阶段报告归档 implement.jsonl / check.jsonl
- trellis-update-spec：三通道模型沉淀进 spec（LSP 域规范文件——参照 dap-domain.md
  先例新建 lsp-domain.md，收录：通道模型、单写点决策 D3、白名单语义 D4、语言无关铁律 D1）
