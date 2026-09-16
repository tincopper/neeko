# JetBrains 系（IDEA / RustRover / CLion）单元测试运行 / 调试架构调研

> 范围：Run/Debug Configurations 模型、gutter 运行入口、SM Test Runner、调试器挂载（重点 Rust/cargo test）、Run/Debug tool window 分流、断点与进程 lifespan、构建失败处理。
> 结论先行：**Run 与 Debug 共享同一 Configuration**，差异仅是 executor（Run vs Debug）+ 调试器挂载；Rust 路径是"先 `cargo test --no-run` 构建、再直跑/挂 LLDB 跑产物二进制"，与"构建一次，目标进程要么直跑、要么挂调试器跑"的统一管线判断一致。

## 1) Run 与 Debug 是否共享同一 Configuration

**是。同一 `RunConfiguration`，Run / Debug / Coverage 只是不同 executor。**

- IDEA/CLion 文档明确：IDE 用 run/debug configurations 来 run、debug、test 代码；每个 configuration 是"命名好的启动属性集合"（执行什么、用什么参数和环境）。无论 run、debug 还是 test 代码，IDE 要么用已有的 permanent configuration，要么新建 temporary one。
  - 来源：https://www.jetbrains.com/help/idea/run-debug-configuration.html
  - 来源（CLion 同模型）：https://www.jetbrains.com/help/clion/run-debug-configuration.html
- 启动调试会话"与普通运行非常相似，调试器在幕后 attach，无需额外配置；只要能从 IDE 里 run，就能用同一 configuration 来 debug"。
  - 来源：https://www.jetbrains.com/help/idea/starting-the-debugger-session.html
- 对 Java/JVM 系，debug 模式的差异就是 IDE 给目标进程追加调试 agent VM 参数（`-agentlib:jdwp=transport=dt_socket,...`，attach 或 listen），由所选 configuration 类型负责注入；文档强调要用"与应用类型匹配的 configuration"，否则 fork 出的子进程可能拿不到该 VM 参数。
  - 来源：https://www.jetbrains.com/help/idea/attach-to-process.html （Debug agent 节 + starting-the-debugger-session "framework may fork the process" 段）
- Rust 侧源码佐证：`RsExecutableRunner(executorId, ...)` 以 `executorId` 区分实例（run/debug 各一个），`canRun` 只看 profile 类型与构建配置是否可用，不区分 run/debug 逻辑；`CargoTestCommandRunner.canRun` 限定 `executorId == DefaultRunExecutor.EXECUTOR_ID`（纯 run 路径）。
  - 来源：https://github.com/intellij-rust/intellij-rust/blob/master/src/main/kotlin/org/rust/cargo/runconfig/RsExecutableRunner.kt
  - 来源：https://github.com/intellij-rust/intellij-rust/blob/master/src/main/kotlin/org/rust/cargo/runconfig/CargoTestCommandRunner.kt
- 调试能力是"有没有 debugger 集成"的问题，不是 configuration 模型问题：旧开源 Rust 插件的 debugger 只在 CLion（及装 Native Debugging Support 插件的 IDEA Ultimate 等，LLDB only）可用。
  - 来源：https://github.com/intellij-rust/intellij-rust （README Compatible IDEs 表格 Debugger 行）

**对 Neeko 的含义**：run/debug 共用一份"启动描述"（命令、参数、环境、工作目录、before-launch 构建步骤），debug 只是在同一管线上多一个"挂调试器"分支——用户"原理相通，走同一管线"的判断与 IDEA 模型一致。

## 2) 调试测试时如何启动目标进程并挂上调试器（Rust/cargo test）

分两条路径（新旧并存），共同点是**构建与运行分离**：

### 路径 A（legacy runner，直跑测试）：两阶段 `cargo test --no-run` + 运行

`CargoTestCommandRunner.execute` 流程（源码实证）：

1. 先以 `--no-run` 补齐参数构建测试二进制（`buildTests`：把当前命令 copy 并 `prependArgument("--no-run")`，起一个 build 进程等退出码）；
2. 仅当退出码为 0 且不是纯 `--no-run` 调用时，才 `state.execute(...)` 真正运行测试。
   - 来源：`CargoTestCommandRunner.kt`（`buildTests` + `execute`，见上节链接）

### 路径 B（build-tool-window 路径，run 与 debug 共用）：读 compiler-artifact 拿产物二进制直跑/挂调试器跑

`RsExecutableRunner.doExecute` 流程（源码实证）：

1. 从构建阶段收集的 compiler-artifact 消息（`ExecutionEnvironment.artifacts`）取第一个 artifact 的可执行文件路径；
2. 校验：零个/多个 artifact 或 binary 直接弹错误对话框并终止（`checkErrors` → `showErrorDialog`，返回 null）；
3. 用 `toolchain.createGeneralCommandLine(binaries.single().toPath(), ...)` 构造**直接执行产物二进制**的命令行（参数来自原 cargo 命令行经 `parseArgs` 拆出的 executableArguments；`bench` 额外加 `--bench`；`test`/`bench` 时工作目录取包根）；
4. run 与 debug 的差异只在 executor：debug executor 下同一 `GeneralCommandLine` 由 CLion 原生调试器（LLDB）承载启动——`patchToRemote = false` 注释明示"debugger/profiler/valgrind 的 patch 由 CLion 侧按需执行"。
   - 来源：`RsExecutableRunner.kt`（`doExecute` 全函数，见上节链接）

调试器侧约束（工具链必须配对，否则直接拒掉、不进调试）：`Utils.kt` 的 `BuildResult.ToolchainError` 列出 MSVC/GNU/WSL 调试器与 Rust 工具链错配时的各条错误（`UnsupportedMSVC`、`MSVCWithRustGNU` 等）。
  - 来源：https://github.com/intellij-rust/intellij-rust/blob/master/src/main/kotlin/org/rust/cargo/runconfig/Utils.kt

JVM 系的通用原理（类比用）：本地调试= IDE 启动时给目标进程注入 debug agent（JDWP over socket）；attach 到已运行进程= 该进程启动时已带 agent，IDE 侧 `Run | Attach to Process` 连过去；无 agent 也可 attach 但只读（看调用栈/变量，无完全功能）。
  - 来源：https://www.jetbrains.com/help/idea/attach-to-process.html

测试输出协议：`cargo test` 侧 IDE 通过给测试命令注入 `-Z unstable-options --format json --show-output`（`CargoTestRunState.patchArgs`，nightly/dev 或 <1.70-beta 时附 `RUSTC_BOOTSTRAP=1`）把 libtest 输出变成结构化 JSON，再由 SM Test Runner 解析渲染；这与 TeamCity Service Messages（`##teamcity[testStarted/testFailed/testFinished ...]`）是同一家族的协议。
  - 来源：https://github.com/intellij-rust/intellij-rust/blob/master/src/main/kotlin/org/rust/cargo/runconfig/CargoTestRunState.kt
  - 来源（Service Messages 协议）：https://www.jetbrains.com/help/teamcity/service-messages.html

**一句话总结**：Rust 调试测试 = 构建（`--no-run` / artifact 收集）→ 取产物二进制 → 直跑（run）或经 LLDB 启动（debug）；`--no-run` 构建 + 运行二进制挂调试器正是官方插件的实现。

## 3) Run tool window 与 Debug tool window 如何分流 / 自动切换（焦点规则）

- **分流规则**：用什么 executor 启动，就进哪个窗口——Run 进 Run tool window（含 Test Runner tab），Debug 进 Debug tool window。测试结果展现在"该 run configuration 的 tab"上（Run tool window 内按 configuration 分 tab）。
  - 来源：https://www.jetbrains.com/help/idea/running-applications.html （"Every run/debug configuration creates a separate tab"）
  - 来源：https://www.jetbrains.com/help/idea/performing-tests.html （测试结果在 Run tool window 的 configuration tab；console 在右侧）
  - 来源：https://www.jetbrains.com/help/idea/viewing-and-exploring-test-results.html
  - 来源：https://www.jetbrains.com/help/idea/debug-tool-window.html （启动调试会话即打开 Debug tool window；多会话按 tab 分）
- **自动切换/焦点规则**（per-configuration 可配，CLion 文档最明确）：
  - `Activate tool window`（默认勾选）：启动 configuration 时打开对应 tool window；取消则隐藏（运行时仍可手动 `Alt+4`/`Alt+5` 打开）。
  - `Focus tool window`：启动时自动把焦点移到 tool window。
  - 来源：https://www.jetbrains.com/help/clion/run-debug-configuration.html （Before launch 表下 Activate/Focus tool window 两行）
- **Debug 窗口的 breakpoint 规则**：默认"程序命中bit breakpoint 时打开 Debug tool window，会话结束不自动隐藏"（`Show debug window on breakpoint`）；若希望"命中前保持隐藏"，则清掉对应 configuration 的 `Open run/debug tool window when started`。
  - 来源：https://www.jetbrains.com/help/idea/debug-tool-window.html （首节 Note 下两段）
- **测试 gutter 状态回写**：gutter 图标按测试状态变化（new / success / failed / 复用 run-all），debug 失败测试的流程是"在失败 gutter 点 Debug → 同一测试以 debug 模式重跑→ 命中bit breakpoint 停住检查状态"。
  - 来源：https://www.jetbrains.com/help/idea/performing-tests.html （gutter 图标四态 + Debug failed tests 节）

**对 Neeko 的含义**：面板路由 = "启动模式决定目标面板"（run→console/测试面板，debug→debug 面板），外加 per-launch 的 activate/focus 开关；Neeko 当前"debug 落到 console"的 bug，本质就是缺了这一层"按启动模式选面板"的路由。

## 4) 断点绑定与测试进程的 lifespan 管理

- **断点是项目级、跨会话持久**：断点一旦设置就留在项目里，直到显式删除（仅 temporary breakpoint 命中bit一次即删）；文件被外部修改导致行号变化时 IDE 跟随移动断点（IDE 运行中才感知）。
  - 来源：https://www.jetbrains.com/help/idea/using-breakpoints.html （首节 + Types/Manage 章节）
- **断点可 mute/disable 而不丢失配置**：Mute Breakpoints 让程序正常跑而不停；disable 保留参数稍后恢复；还有条件断点、日志断点（suspend=n 只打日志不停）、pass count、trigger（disable-until-hit）等"不停住"的轻量形态。
  - 来源：同上（Mute/Enable-disable/Logging/Pass count 章节）
- **进程 lifespan**：
  - 每次 run/debug 启动一个独立进程/会话；Run tool window 可 Stop（先软杀 SIGINT/再次点击硬杀 SIGKILL）或 Exit（优雅退出，走 shutdown hooks）；测试同样 Stop/Exit。
    - 来源：https://www.jetbrains.com/help/idea/run-tool-window.html （Run toolbar 表 Stop/Exit 行）
    - 来源：https://www.jetbrains.com/help/idea/performing-tests.html （Stop tests 节）
  - Debug 会话可 Pause/Resume（但文档明确"pause 不是 breakpoint 的替代品，功能受限，如不能求值表达式"）、Rerun（重跑同一 configuration）、Stop；多会话可并行，各占 Debug tool window 一个 tab，关 tab 即终止对应会话；session tab hover 显示 PID。
    - 来源：https://www.jetbrains.com/help/idea/starting-the-debugger-session.html （Pause/Resume/Restart/Terminate/PID 四节）
    - 来源：https://www.jetbrains.com/help/idea/debug-tool-window.html （Sessions 节）
  - 远端/attach 会话 detach 后目标进程继续跑（与本地会话 stop 即杀掉不同）。
    - 来源：https://www.jetbrains.com/help/idea/attach-to-process.html （Detach/Terminate 两节）

## 5) 构建失败处理

- **Before launch 构建是显式步骤**：每个 configuration 有 `Before launch` 任务列表（默认含 Build），按序执行；"跳过构建"=“从列表里删掉 Build”。
  - 来源：https://www.jetbrains.com/help/clion/run-debug-configuration.html （Create from template 第 6 步 + Before launch 表）
- **Rust 插件的两处失败短路**（源码实证）：
  1. `CargoTestCommandRunner`：`--no-run` 构建退出码非 0（或本来就是 `--no-run` 调用）→ 直接返回 null，**不进入运行阶段**。
  2. `RsExecutableRunner`：构建产物为 0 个或多个 artifact/binary → 弹错误对话框并返回 null，**不启动目标进程**（"Can't find a binary" / "More than one binary…specify --bin/--lib/--test/--example explicitly"）。
  - 来源：同第 2 节两个源码链接
- **通用构建错误排查入口**：运行期异常 → 看栈 trace 跳文档/挂调试器看状态/跑静态分析；与性能相关则上 profiler。
  - 来源：https://www.jetbrains.com/help/idea/running-applications.html （Investigate errors 节）

## 对 Neeko 的可借鉴点（3 条）

1. **同一启动描述 + executor 分支**：run/debug 共用一份配置（命令/参数/环境/工作目录/before-launch 构建），debug 只多"产物二进制经调试器启动"分支与"路由到 Debug 面板"；Neeko 修 bug 时优先补"启动模式→面板"路由，而不是另起调试管线。
2. **构建与运行分离、失败短路**：先 `--no-run`/check 拿产物，构建失败（退出码非 0 / 产物歧义）直接停、不进运行/调试阶段，并把构建输出留在原面板供排查。
3. **断点项目级持久 + Non-suspend 形态**：断点不随会话结束清除；提供 mute / 日志断点等"不断住"的轻量形态，减少"为看一眼就被停住"的打扰。
