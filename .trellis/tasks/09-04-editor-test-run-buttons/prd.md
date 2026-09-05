# 编辑器单测运行/调试按钮

## Goal

在代码编辑器中为单元测试用例显示内联 Run/Debug 按钮（CodeLens 风格）：TS/JS（vitest）与 Rust（cargo test）用例可直接运行（输出进 Task Console）；debug 首期支持 Rust（复用现有 lldb DAP adapter）。

## Background（2026-09-04 范围确认）

用户需求：编辑器显示执行按钮，单测用例可直接运行与 debug 运行。范围问答确认：

- **语言范围**：TS/JS（vitest）+ Rust（cargo test）运行双栈；debug 首期仅 Rust（现有 lldb adapter），TS debug（需 node DAP adapter，集成 vscode-js-debug）列为后续里程碑。
- **输出去向**：Task Console（复用 taskRunner + taskStore console sessions，零新增面板）。

现有基建：CodeMirror 6（decoration/StateField 先例：navigateCaret、断点 gutter）；`startTaskProcess`（taskRunner）+ taskStore console sessions + TaskConsoleOutput；后端 DAP 栈（dap/adapter：go、lldb）+ `dap_start_session(project_id, config_name, current_file)`。

## Requirements

- R1 用例检测：编辑器内识别测试用例——TS/JS `test('/`it(' 调用行；Rust `#[test]` / `#[tokio::test]` 属性行 + 紧随的 `fn <name>`。检测结果为纯函数（文本 → TestCaseInfo[]），可独立测试。仅测试文件启用（`*.test.*` / `*.spec.*`；Rust 文件含 `#[test]`）。
- R2 内联按钮（2026-09-04 二次迭代，用户指定 IDEA 交互）：行号旁 gutter 显示**单个 play 图标**（仅测试用例行）；点击弹出下拉菜单选择 Run / Debug（`ui/ContextMenu` 复用）。TS/JS 无 Debug 项——点击图标直接运行（单项菜单无意义，符合 IDEA 单配置直跑语义）；Rust 点击弹 Run/Debug 两项下拉。不再使用用例行上方文字/图标 widget。
- R3 命令构造（纯函数，TDD）：vitest `pnpm vitest run <relPath> -t <caseName>`；Rust `cargo test <caseName>`（libtest 子串过滤；实现期修正：`--exact` 匹配完整测试路径，仅传 fn 名时 `mod tests` 嵌套用例匹配 0 个，子串过滤根级/嵌套均可命中，同名用例可能多跑可接受）。命令经任务会话按项目环境执行（复用任务会话既有环境语义）。
- R4 Rust debug 闭环：Debug 按钮 → `cargo test <name> --no-run`（Task Console 可见）→ 从输出解析测试二进制路径（`Executable unittests ... target/debug/deps/...` 行）→ 以 lldb launch 配置（program=测试二进制, args=[name]）启动 DAP 会话 → 既有 DebugPanel 交互（断点/栈帧/变量）不变。需要后端支持按合成配置直接启动会话（扩展现有 dap 命令或新增命令，注册进 `neeko_invoke_handler!`）。
- R5 非 file tab（终端/agent-chat 等）与无用例文件不渲染按钮；性能不回退（检测防抖 + decoration 惰性更新，长文件不卡输入）。

## Out of Scope（后续里程碑）

- TS/JS debug（node DAP adapter + vscode-js-debug 集成）。
- describe 套件级运行按钮、测试结果内联渲染（✓/✗ 装饰）、测试面板/explorer。
- Go 测试 debug（dlv `test` 形态）、命令模板的项目级配置化（MVP 用推导命令）。

## Acceptance Criteria

- [ ] 用例检测纯函数：TS/JS test/it、Rust #[test]/#[tokio::test] 用例解析单测覆盖（含嵌套缩进、模板字符串名、多属性行）。
- [ ] 测试文件内用例行上方出现 Run（+Rust 时 Debug）按钮；非测试文件/非 file tab 无按钮。
- [ ] Run：vitest / cargo test 命令构造正确（纯函数断言）；点击后在 Task Console 出现会话并流式输出、可停止。
- [ ] Debug（Rust）：点击后构建二进制 → 解析路径 → lldb 会话启动 → DebugPanel 可用；构建失败时错误可见（Task Console）且不启动会话。
- [ ] 全程 TDD；`pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` / `cargo test` 全绿。

## Notes

  - 设计决策来自用户范围问答（2026-09-04）：运行双栈 + debug 首期 Rust；输出走 Task Console。
  - gutter 浮层二选一决策（2026-09-05，原型对齐）：TS/JS 保持图标点击直跑（R2 语义不变），不弹单项浮层——单项菜单无意义且多一次点击；Rust 两项浮层文案携带测试名（`Test '<name>'` / `Debug 'Test <name>'`），package/文件名后缀不塞进标签（经 Task Console 命令可见）；浮层锚定图标 rect 旁（非鼠标裸坐标），复用 shared ContextMenu（深色双行视觉、hover 高亮、Esc/外点关闭、TEST_MENU_OVERLAY_ID overlay 语义均保留）。
