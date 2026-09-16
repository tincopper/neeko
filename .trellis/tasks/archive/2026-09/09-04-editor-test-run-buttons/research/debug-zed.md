# Zed 测试运行 / 调试架构调研

> 方法说明：公共 web_search 当日全提供商被限流（bot 检测），本报告全部事实来自直读一手来源：Zed 官方文档站（zed.dev/docs）与 zed GitHub 主干源码。每条结论后附来源链接。

## 0. 先回答前提：Zed 有测试调试能力吗？

**有，且是开箱即用的。** Rust（CodeLLDB/GDB）文档写明 "supports debugging Rust binaries and tests out of the box"；Go（Delve）"supports zero-configuration debugging of Go tests and entry points (`func main`)"。所以本报告不是"缺环分析"，而是"已打通方案的拆解"——Neeko 要学的是它的衔接方式。

- Rust 调试：https://zed.dev/docs/languages/rust （Debugging 节）
- Go 调试：https://zed.dev/docs/languages/go （Debugging 节）
- 调试器总览：https://zed.dev/docs/debugger

## 1. task 启动管线与 debugger 会话：两套系统 + 两个衔接点

**结论：底层是两套独立系统，但在 UX 层通过同一入口 + 两个机制衔接。**

### 1a. Task 系统（Run 路径）

`tasks.json` 定义 → `task: spawn` modal / `task: rerun` → 在集成终端 tab 里 spawn 命令 → 输出进终端。

- 任务来源四类：全局 `tasks.json`、worktree 本地 `.zed/tasks.json`、oneshot 临时任务、语言扩展提供。来源：https://zed.dev/docs/tasks （Task templates 节）
- 输出去向是**终端面板**（terminal pane/tab），`reveal`（always/no_focus/never）控制是否抢焦点、`hide`（never/always/on_success）控制结束后是否收起。来源：https://zed.dev/docs/tasks （顶部 schema 注释）
- 行内运行按钮（runnables 指示器）默认绑定语言提供的 tag 任务，可用 `tags: ["rust-test"]` 等覆盖默认动作；`cmd-.` code action 也路由到同一任务。来源：https://zed.dev/docs/tasks （Binding runnable tags / Keybindings to run tasks bound to runnables 两节）
- Go 的 gutter "run test / run benchmark" 即 gopls code lens，走的也是这条 Run 路径（非调试）。来源：https://zed.dev/docs/languages/go （Code Lens 节）

### 1b. Debugger 系统（Debug 路径）

Zed 只实现 DAP **客户端**，各语言 debug adapter 实现服务端（CodeLLDB / Delve / debugpy / 内置或扩展提供）。来源：https://zed.dev/docs/debugger （首节 + Supported Languages）

- 入口 `debugger: start`（F4）打开 **new process modal**，列出基于当前项目的预配置 debug 任务（从 tests / entry point 如 `main` 自动生成）。来源：https://zed.dev/docs/debugger （Getting Started）
- 配置源：项目 `.zed/debug.json`（优先）→ 回落 `.vscode/launch.json` → 全局 `debug.json`。来源：https://zed.dev/docs/debugger （Getting Started / Global debug configurations）

### 1c. 两个衔接点（这就是"同一管线感"的来源）

1. **`build` 字段**：debug 配置可内嵌一个 Zed task（内联 `{command, args}` 或按 label 引用已有任务），debugger 启动前先跑构建。来源：https://zed.dev/docs/debugger （Build tasks 节，含 `cargo build` 示例）
2. **Debug locators（扩展机制）**：把已有用户任务（如 `cargo run`）自动转换为 debug 场景（如 `cargo build` + 以 `target/debug/xxx` 为 program 启动调试）。两阶段：`dap_locator_create_scenario`（任务→场景，静态可定则一次完成）+ `run_dap_locator`（构建产物名事先未知时，build 成功后再解析真实 program 路径）。来源：https://zed.dev/docs/extensions/debugger-extensions （Defining Debug Locators 节）
3. 源码佐证同一入口、两条路由：`NewProcessModal` 有 `NewProcessMode::Task` / `::Debug` 两种模式与 `ActivateTaskTab` / `ActivateDebugTab` 切换；`debugger::Start` action 直接 `NewProcessModal::show(..., NewProcessMode::Debug, ...)`，而 `task::Spawn` 走 `spawn_task_or_modal`（ByName/ByTag 直接 spawn，ViaModal 进同一 modal 的 Task 模式）。来源：
   - https://github.com/zed-industries/zed/blob/main/crates/debugger_ui/src/new_process_modal.rs
   - https://github.com/zed-industries/zed/blob/main/crates/debugger_ui/src/debugger_ui.rs （`spawn_task_or_modal` 定义）

### 对应 Neeko 用户判断的映射

用户判断"run 与 debug 应走同一管线（构建一次，差异只在 launch 方式与面板路由）"——Zed 的实现正是此形状：**构建复用同一 task 定义**（`build` 字段引用），launch 方式分支（DAP launch vs 终端直跑），输出路由分支（见 §2）。

## 2. Run 输出面板与 Debug 面板的切换规则

**结论：两个独立 dock 面板，按"启动动作"决定去向，无自动互跳；切换靠显式 focus 动作。**

- Task 输出 → **终端面板**（terminal pane/tab），由任务自身的 `reveal`/`hide` 控制显隐与焦点。来源：https://zed.dev/docs/tasks
- Debug 会话 → **DebugPanel**（独立面板，`debugger.dock`: bottom（默认）/left/right）。来源：https://zed.dev/docs/debugger （Settings/Dock 节）
- 面板动作：`debug_panel::Toggle` / `ToggleFocus`（开关/聚焦调试面板）与终端聚焦相互独立；源码中 debugger action renderer 按线程状态（Running→Pause，Stopped→StepInto/Over/Out/Continue 等）挂载按键，无"输出切面板"逻辑。来源：https://github.com/zed-industries/zed/blob/main/crates/debugger_ui/src/debugger_ui.rs （`init` 注册部分）
- 会话级操作：Restart / RerunSession / Rerun（重跑上次会话）/ Stop / Detach，全部作用于 DebugPanel 内的 active session，不碰终端。来源：同上（actions! 块）
- 例外/细节：Delve `tcp_connection` attach 模式下 Zed 不 spawn 新实例、**无终端**，直接与远端 Delve 交互。来源：https://zed.dev/docs/languages/go （Attaching 节）——说明"面板路由"取决于 launch/attach 形态，这与 Neeko"差异只在 launch 方式与面板路由"的判断一致。

**Neeko 落点**：Neeko 当前 bug（debug 跳错面板、落到 console）正好是 Zed 用"面板归属由启动路径静态决定"避开的坑——Zed 从不按"输出内容类型"动态选面板。

## 3. 测试二进制如何构建 + 挂调试器（以 Rust / Go 为例）

**结论：build task 编出带调试符号的 test 二进制 → DAP `launch` 该二进制（可带 `-test.run` 级过滤）。**

### Rust（CodeLLDB）

- `cargo build` / `cargo test` 可直接做 `build` 命令，Zed 能**从构建命令推断产物二进制路径**（无需手写 `program`）。来源：https://zed.dev/docs/languages/rust （"Automatically locate a debug target based on build command" 节）
- 手写版：`build: {command: cargo, args: [build]}` + `program: $ZED_WORKTREE_ROOT/target/debug/binary` + `"sourceLanguages": ["rust"]`（CodeLLDB 必需，GDB 不需）。来源：同上（Build binary then debug 节）

### Go（Delve 三种 mode，正交表达"怎么拿到被调程序"）

| mode | 含义 | 测试调试示例 |
|------|------|-------------|
| `debug` | 调包（program=包名） | `program: $ZED_FILE` 调当前包 |
| `test` | 调测试（program 仍是包名） | `program: "."` + `args: ["-test.run", "$ZED_SYMBOL"]` 即"只调光标所在的那个测试" |
| `exec` | 调预编译二进制 + 独立 `build` | `build: {go test -c -gcflags"all=-N -l" -o __debug_unit ./pkg/...}`（注意 `-N -l` 关优化，调测试二进制的必要条件），`program: __debug_unit`，`args: [-test.v, -test.run=${ZED_SYMBOL}]` |

来源：https://zed.dev/docs/languages/go （Debug Go Packages / Debug Go Tests / Build and debug separately 三节）

### "缺的一环"在哪里出现

Zed 的打通覆盖 **Rust / Go / Python / JavaScript / TypeScript** 的自动场景生成（"Automatic scenario creation … powers our scenario creation from gutter"）。来源：https://zed.dev/docs/debugger （Automatic scenario creation 节）。反之：

- C / C++ 及部分扩展语言**没有预配置 debug 任务**，用户必须手写 `.zed/debug.json`。来源：https://zed.dev/docs/debugger （Getting Started 第二段）
- 构建产物名不可静态预知时，必须走 locator 两阶段（`run_dap_locator`），否则 program 指不到真实二进制。这是"构建→调试"链条上唯一需要 adapter 作者介入的环。来源：https://zed.dev/docs/extensions/debugger-extensions

**Neeko 落点**：Neeko 的 Rust 单测场景对标 Zed 的 Rust/Go 路径即可——`cargo test --no-run`（或 `test -c` 等价物）产出 test 二进制 + 按测试名过滤（`--exact <name>` / `--test-args`）+ DAP launch；产物路径解析是必须显式处理的一环（Zed 为此做了"从 build 命令推断"和"两阶段 locator"两层机制）。

## 4. 对 Neeko 的可借鉴点（3 条）

1. **构建定义只写一次，debug 配置引用它**：Zed 的 `build` 字段可按 label 引用已有 task——Neeko 统一 run/debug 管线时，test 二进制的构建命令应是 run 与 debug 共享的同一定义，debug 只追加"挂调试器 + 面板路由"，这正是用户"构建一次"判断的直接实现。（来源：debugger Build tasks 节）
2. **面板归属由启动路径静态决定，不按输出内容动态路由**：task→终端面板，debug→DebugPanel，启动瞬间即定。Neeko 修"debug 落到 console"时，应检查 launch 分支是否错误复用了 run 的面板路由，而不是在输出层做启发式分流。（来源：tasks reveal/hide + debugger dock + `spawn_task_or_modal` 源码）
3. **测试过滤下沉到"单个测试"粒度**：Delve `args: ["-test.run", "$ZED_SYMBOL"]` / exec 模式 `-test.run=${ZED_SYMBOL}` 把"调光标处测试"做成一等能力。Neeko gutter 的 Debug 按钮应同样携带测试名过滤（`cargo test <name> -- --exact` 类语义），而不是笼统"调整个 test 二进制"。附带：关优化编测试二进制（`-N -l` / `debug=true`）是正确性前提。（来源：Go 调试三节）
