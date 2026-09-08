# VSCode 单元测试运行 / 调试架构调研

> 范围：TestController run/debug 管线异同、调试器挂载方式、Run 输出与 Debug 会话的 UI 分流、断点生效、构建失败处理。
> 方法：官方文档直读 + 一手源码（rust-analyzer vscode 客户端、vscode 自托管测试扩展、CodeLLDB 手册）。web_search 全 providers 被限流，未用。

## 1. run 与 debug 请求在管线上有何异同

**结论：同一入口、同一用例集合，差异只在 profile kind 与_handler_分支；是否"同一进程启动路径"由扩展自己决定，官方示例恰好展示了两种做法。**

- Testing API 以 `TestRunProfileKind`（Run / Debug / Coverage）区分意图，每个 profile 有自己的 `runHandler`。官方文档示例让 Run 与 Debug 共用同一个 `runHandler(shouldDebug, request, token)`，只差一个布尔 flag：
  https://code.visualstudio.com/api/extension-guides/testing
- vscode 自托管测试扩展（第一方标杆实现）用同一工厂函数创建两种 profile，管线完全一致（`scanTestOutput` 统一消费事件更新 `TestRun`），仅在启动时二选一：`kind === Debug ? runner.debug(...) : runner.run(...)`：
  https://raw.githubusercontent.com/microsoft/vscode-selfhost-test-provider/main/src/extension.ts
- rust-analyzer 则走了"同源异构"路线：Run profile 把 `include/exclude` 发给语言服务器（`runTest` LSP 请求，服务端跑 cargo 并回推 `changeTestState` 通知）；Debug profile **不创建 `TestRun`**，只查 `idToRunnableMap` 取出 `Runnable`，转交调试启动函数，且限制一次只能 debug 一个用例：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/test_explorer.ts

## 2. 调试测试二进制时 debugger 如何挂上

**结论：扩展按"用例 → 可执行文件 + 参数"推导出完整 launch 配置，再调 `vscode.debug.startDebugging` 启动；launch 配置优先复用用户 `launch.json`，否则程序化构造。**

- `startDebugSession`：先按 `runnable.label` 在 `launch.json` 里找同名配置（命中则直接用，相当于用户可覆盖）；找不到才调用 `getDebugConfiguration` 现场构造，最后 `vscode.debug.startDebugging(undefined, debugConfig)`：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/debug.ts
- `program` 推导（`Cargo.artifactSpec` / `executableFromArgs`，`toolchain.ts`）：`cargo test` 自动改写为 `cargo test --no-run --message-format=json`；解析每行 `compiler-artifact` JSON 取 `executable` 字段；`test`/`bench` 只保留 `profile.test` 的产物；0 个或多个产物都抛错（单测调试只允许唯一定位）：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/toolchain.ts
- `args` 推导：`executableArgs`（即用例精确路径，如 `test_bar::foo`，常带 `--exact --nocapture`），按目标调试引擎填入对应字段（lldb/CodeLLDB/cppdbg 用 `args` 数组，Native Debug gdb 用拼接好的 `arguments` 字符串）：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/debug.ts
- 引擎选择：`rust-analyzer.debug.engine` 设为 `auto` 时按 CodeLLDB → lldb-dap → cpptools → Native Debug 顺序探测已安装扩展；各引擎的 `program/env/args/sourceMap` 字段映射由一张 `knownEngines` 表集中管理：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/debug.ts
- 另一条路（CodeLLDB 原生支持）：launch 配置里用 `cargo: { args: ["test", "foo", "--", ...] }` 代替 `program`，由 adapter 自己构建并定位二进制，还提供 `Generate Cargo Launch Configurations` 命令批量生成：
  https://raw.githubusercontent.com/vadimcn/codelldb/master/MANUAL.md（"Cargo Support" 节）

## 3. Run 输出与 Debug 会话的 UI 如何分流

**结论：分流点不在视图层，而在"谁启动了什么会话"——`TestRun` 事件流向 Test Explorer/编辑器/gutter 与 Test Results 面板；`startDebugging` 产出的 debug session 流向 Run and Debug 视图 + Debug Console。由扩展的 handler 决定两者是否同时更新。**

- Run 侧：`run.appendOutput` 进 Test Results 面板（需用户点 Test Explorer 的 Show Output 打开，非自动弹出）；`run.passed/failed` 更新 Test Explorer 树 + 编辑器 gutter 状态 + 失败 overlay：
  https://code.visualstudio.com/docs/editor/testing（"Run and debug tests" 节）
  https://code.visualstudio.com/api/extension-guides/testing（"Test Output" 节）
- Debug 侧：会话一旦启动，VSCode 自动显示 DEBUG CONSOLE 并变色状态栏；CALL STACK / VARIABLES / BREAKPOINTS / WATCH / Debug toolbar 全套调试 UI 接管：
  https://code.visualstudio.com/docs/debugtest/debugging（"Start a debugging session"、"Debugger user interface" 节）
- 关键分叉证据：rust-analyzer 的 Debug profile **根本不创建 `TestRun`**——调试时 Test Results 面板无更新，只有调试 UI 动；自托管扩展则相反，debug 产物同样喂给 `scanTestOutput`，测试树状态与调试会话同时推进：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/test_explorer.ts
  https://raw.githubusercontent.com/microsoft/vscode-selfhost-test-provider/main/src/extension.ts
- "谁决定"：扩展的 runHandler（调 `startDebugging` 还是只写 `TestRun`）+ VSCode 内核（debug session 启动后的自动 reveal）。Run 侧的终端呈现可配 `presentationOptions.focus = false` 防抢焦点（rust-analyzer `createTaskFromRunnable` 显式设置）：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/run.ts

## 4. 断点如何在测试进程中生效

**结论：断点与测试运行解耦——编辑器 gutter 断点平时只是 UI 标记；debug session 启动后由 debug adapter 在"target 建好、进程 launch 之前"统一注册到被调试进程。**

- 用户在 gutter 点的断点先只是编辑器标记；会话启动时"无法向调试器注册的断点会变成灰色空心圆"：
  https://code.visualstudio.com/docs/debugtest/debugging（"Breakpoints" 节）
- CodeLLDB launch 时序写得很死：`target create` → 应用 args/env/cwd → **Create breakpoints** → `preRunCommands` → `process launch`；attach 时序同理（target → breakpoints → attach）：
  https://raw.githubusercontent.com/vadimcn/codelldb/master/MANUAL.md（"Launch Sequence"/"Attach sequence" 节）
- 路径映射是断点命中的前提：rust-analyzer 自动计算 `sourceFileMap`（`/rustc/<commit-hash>` → 本地 sysroot），按引擎填 `sourceMap`/`sourceFileMap`；CodeLLDB 另有 `breakpointMode: path|file`（Rust 多 `mod.rs` 同名文件时用 `file` 模式会多处命中）与 `sourceMap` 配置：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/debug.ts（`discoverSourceFileMap`）
  https://raw.githubusercontent.com/vadimcn/codelldb/master/MANUAL.md（"Source Path Remapping"、launch 属性表）

## 5. 构建失败时的处理

**结论：构建是调试的前置门——拿不到可执行文件就不启动会话；run 侧失败走任务/problemMatcher 进 Problems 面板。**

- rust-analyzer 调试链：`cargo --message-format=json` 非零退出 → `getArtifacts` 抛 `Cargo invocation has failed`；零产物抛 `No compilation artifacts`；`getDebugExecutable` 注释明示"到这里意味着此前无编译错误"——任一失败都直接中断，不会产生 debug session，错误以通知形式抛给用户：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/toolchain.ts
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/debug.ts
- run 侧：`cargo test` 以 VSCode Task 跑在终端，挂 `$rustc` problemMatcher，编译错误进 Problems 面板；`presentationOptions.focus = false` 避免构建输出抢焦点：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/run.ts
- CodeLLDB `cargo` 模式同样接受 `problemMatcher: "$rustc"`，构建输出走问题匹配：
  https://raw.githubusercontent.com/vadimcn/codelldb/master/MANUAL.md（"Cargo Support" 节）
- 附带设计：rust-analyzer 跟踪活跃 debug session，**会话结束（Restart/Terminate）后自动跑 `cargo test --no-run` 任务重编测试二进制**，保证下次调试命中的是新代码——构建与调试的衔接是显式状态机，不是"每次现编现调"：
  https://raw.githubusercontent.com/rust-lang/rust-analyzer/master/editors/code/src/debug.ts（`initializeDebugSessionTrackingAndRebuild` / `recompileTestFromDebuggingSession`）

## 对 Neeko 的可借鉴点（3 条）

1. **管线同源、launch 分叉**：run/debug 共用"用例定位 → 构建一次拿可执行文件 → 按用例拼 args"的前半段（佐证用户"构建一次，直跑或挂调试器跑"的判断）；分叉点只在最后一步是直 spawn 还是构造 launch 配置进调试会话。Neeko 的 debug 跳错面板，大概率是分叉后的"会话 → 面板"路由错，而非构建/定位错。
2. **面板路由以"会话类型"为准，而非输出内容**：VSCode 里 `TestRun` 与 debug session 是两套互不相通的 UI 归宿（RA 调试时甚至不写 `TestRun`）。Neeko 应同样让"是否经过调试启动"成为面板路由的唯一判据——直跑进 console/测试面板，调试启动进 debug 面板，不要按输出流特征二次判断。
3. **构建失败短路 + 断点注册后置**：构建失败直接短路、不进调试会话（错误归构建输出）；断点只在 target 建好后由 adapter 统一注册。Neeko 若复用此序，"无断点命中/二进制过期"类问题可先查构建门与注册时序，不用怀疑面板层。
