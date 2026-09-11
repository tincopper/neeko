# Go 单测 Run/Debug 四家对比矩阵（Zed / VSCode / IDEA / GoLand）

> 范围：Zed、VSCode、IntelliJ IDEA（Go 插件）、GoLand 四家的 Go 单测 run/debug 实现对比，
> 落盘为「每家一节 + 4 家矩阵表 + 对 Neeko 可借鉴点」。
> 关系说明：**VSCode 侧已有专文 `research/test-debug-go.md`（vscode-go + dlv-dap mode:test + go test -json），本文件只做要点引用、不重写**；
> 重点补 **GoLand**（JetBrains Go IDE，dlv 集成）与 **IDEA**（Go 插件与 GoLand 的关系），并整理 **Zed**（三模式先例见 `research/debug-zed.md` §3 + zed.dev/docs/languages/go）。
> 方法说明：web_search 当轮被限流（bot 检测），全部结论来自直读一手来源（JetBrains 官方文档站 / JetBrains 博客 / go-delve 与 go-lang-idea-plugin 开源源码 / zed.dev 文档）。
> 结论先行：**四家 debug 全部收敛到「Delve 是唯一后端」——VSCode 用 dlv-dap（mode:test 内建 `go test -c` + exec）、GoLand/IDEA 用自带的 dlv（DAP 客户端）+ 同样的 `-gcflags all=-N -l` 无优化构建、Zed 是 DAP 客户端 + `.zed/debug.json` 三 mode（debug/test/exec）**。分歧只在「谁编译测试二进制、用例级状态怎么回传」：

| 维度 | VSCode | GoLand | IDEA | Zed |
|---|---|---|---|---|
| 测试二进制由谁编译 | **delve**（`mode:test` 内部 `go test -c`） | **GoLand**（`go test` 构建，强制 `-gcflags all=-N -l`） | 同 GoLand（同引擎） | **用户/Zed task**（`build` 字段；`mode:exec` 显式 `go test -c`） |
| 调试器接入协议 | dlv-dap（DAP） | dlv（**DAP**，见 delve#3083） | 同 GoLand | dlv（DAP 客户端） |
| 用例级状态回传 | `go test -json`（test2json 结构化） | `go test -v` 文本 → 正则解析 → SM Runner | 同 GoLand | **无**（只有终端输出） |

---

## 1) VSCode（gopls + dlv-dap）——要点引用，详见 `research/test-debug-go.md`

| 问题 | 结论（详见既有文件） |
|---|---|
| 1) 测试发现 | gopls `textDocument/documentSymbol` 语义级符号 → 扩展侧 CodeLens（`run test`/`debug test`）+ Test Explorer 树（module→package→file→test）。子测试只认 `t.Run("name",` 简单形式，嵌套不识别（源码自述局限）。来源：vscode-go `goDocumentSymbols.ts` / `goRunTestCodelens.ts` |
| 2) Run 命令/输出 | 裸子进程 `go test -test.fullpath=true -timeout <X>m [-tags] -run '^TestFoo$' [-json] <pkg>`；`-run` 锚定正则 `^TestFoo$`。输出双轨：默认文本，有结构化消费方（Test Explorer）时偷偷追加 `-json` → 逐行 test2json 事件喂测试树。来源：vscode-go `testUtils.ts` |
| 3) Debug 二进制定位 + dlv | dlv-dap `launch{mode:test, program:包目录, args:["-test.run","^TestFoo$"]}` → **delve 内部 `go test -c -o __debug_bin -gcflags all=-N -l <pkg>` + exec**（`dlv test` 语义内建进 DAP）；`mode:exec` 需用户预编译二进制（也要求带 `-N -l`）。来源：delve `service/dap/server.go` / `pkg/gobuild/gobuild.go` |
| 4) 用例级状态流 | test2json `run/pass/fail/skip/output` 事件流 → TestRun `enqueued/started/passed/failed`。一次 `go test` 只能带一个子测试（Go issue #39904）。来源：`goTest/run.ts` |
| 5) 断点时序 | launch 后 delve 先构建并暂停在入口 → 客户端 `setBreakpoints`（符号已加载）→ `configurationDone` → 续跑；`-test.run` 0 命中则断点永不触发。来源：delve `service/dap/server.go` |

> **关键教训（既有文件已给）**：vscode-go 的 Debug 不是手写 `go test -c` + `dlv exec`（那是 mode:exec），而是把 `dlv test` 语义内建进 `mode:test`。

---

## 2) GoLand（JetBrains Go IDE）——dlv 集成：run config 形态 / dlv / `-run` 过滤 / Go Test Runner

### 2.0 与 Delve 的关系（一句话）

**GoLand 的调试器就是 Delve**：GoLand 自带（bundled）Delve 二进制，并通过 **DAP 协议**驱动它；对测试的 debug，GoLand 先用 `go test` 编译出**无优化**（`-gcflags all=-N -l`）的测试二进制再挂 dlv。

- 「JetBrains Goland」位列 delve 官方编辑器集成清单：https://github.com/go-delve/delve/blob/master/Documentation/EditorIntegration.md
- **自带 Delve**：GoLand 2025.1 发布说明 "With **Delve 1.24.0 bundled out of the box**"，版本随发行同步更新：https://blog.jetbrains.com/go/2025/04/16/goland-2025-1-is-out/
- **走 DAP**：delve 上游维护者注明 "**We were told Goland explicitly issues the `ClearBreakpoints` command before exiting**"（`ClearBreakpoints` 是 DAP 请求，证明 GoLand 是 delve 的 DAP 客户端）：https://github.com/go-delve/delve/issues/3083
- **无优化构建是硬约束**：delve#4165（`nosplit` 栈溢出）复现说明 "When executed with `dlv debug`, as well as **via Goland** and VS Code using default settings… **In all cases, the binary-under-test is built with `-gcflags "all=-N -l"`**"：https://github.com/go-delve/delve/issues/4165 —— 即 GoLand 的 debug 构建与 delve `mode:test` 同一套 `-gcflags all=-N -l`。

### 2.1 测试发现：gutter + Structure，**语义级**（PSI），且**支持子测试/表格测试单跑**

- **Gutter 图标**（`GoTestRunLineMarkerProvider`）：测试函数行旁 play 图标；文件行旁 run-all 图标。图标带**上次运行状态**（灰 play=新、绿=成功、红=失败），结果以测试 URL 为键持久化。来源：GoLand 帮助《Run tests》gutter 图标四态 https://www.jetbrains.com/help/go/performing-tests.html ；实现 https://github.com/go-lang-plugin-org/go-lang-idea-plugin/blob/master/src/com/goide/runconfig/testing/GoTestRunLineMarkerProvider.java
- **入口**：gutter 点击 → `Run '<test name>'` / `Debug '<test name>'`；`Ctrl+Shift+F10`（光标在文件=全文件、在方法=该方法）；**Structure 工具窗**可多选测试方法批量运行。来源：同上 performing-tests.html（Run tests directly / Run tests from Structure）
- **语义 vs 文本**：PSI 语义级识别（函数名 + 参数形态 `func TestXxx(t *testing.T)`），不是文本正则；并且 **GoLand 支持 `t.Run` 表格测试**：gutter 可直接运行某个子测试（官方文档给了一组可识别形态：测试数据变量须为 slice/array/map 且在 `t.Run` 同函数定义、子测试名表达式可以是字符串字段/拼接/`fmt.Sprintf("%s in %s", …)`）。来源：performing-tests.html「Run individual table tests」节
  - 对比：vscode-go 只认简单 `t.Run("name",`、嵌套子测试不支持——**GoLand 在子测试发现上明显领先**（旧开源插件 README 也把 "Sub-tests support (runner, navigation, gutter actions)" 列为仅 GoLand/官方插件的功能，见 IDEA 一节）。

### 2.2 Run：`go test` 子进程 + SM Runner 解析 `-v` 文本

- **Run 命令形态**（开放源码旧插件 `GoTestRunningState` 实证，为 JetBrains Go 测试运行的架构同源证据）：`go test -v <go工具参数> <target> -run <pattern>`
  - target 按 Test kind：Package → 包 import path；Directory → `./相对路径/...`；File → 文件所属包 import path。
  - `-run` 过滤 = **锚定正则**：单方法 `^TestName$`；整文件所有测试 `^Test1|Test2$`（`buildFilterPatternForFile` 把文件内所有测试名 `|` 拼接再锚定）；重跑失败用例同样拼 `^失败名单$`。
  - 来源：https://github.com/go-lang-plugin-org/go-lang-idea-plugin/blob/master/src/com/goide/runconfig/testing/GoTestRunningState.java
- **现代 GoLand run config 字段**（《Go Test》配置：Test framework = `gotest`/`gocheck`/`gobench`/`go test -fuzz`；Test kind = Directory/Package/File；**Pattern**；Working directory；Go tool arguments（如 `-tags`）；Program arguments（测试 flag 如 `-race`/`-test.failfast`/`-test.short`/`-test.benchmem`）；Before launch 任务列表）：https://www.jetbrains.com/help/go/go-test.html + performing-tests.html「Run tests with test flags」节
- **Pattern 的层级正则**（子测试过滤的关键）：文档原文 "For tests, the expression is divided by slashes (`/`)… into a series of regular expressions. Each segment of a test's identifier must align with the corresponding part"——例：`^\QTestAdd\E$/^\Qadd_positive_and_negative\E$` 精确命中表格测试 `TestAdd` 的 `add_positive_and_negative` 子用例（`\Q…\E` 是 RE2 字面量引用）。这对应 `go test -run` 的 `/` 层级语义。来源：go-test.html「Pattern」字段
- **输出格式**：`go test -v` 文本（右侧 console 显示原始输出，`ok pkg 0.123s` / `--- FAIL: TestX` 等）。来源：viewing-and-exploring-test-results.html「The console on the right shows the output…」
  - ⚠️ 与 Rust 路径不同：GoLand 的 Go 测试**不用 `-json`**，而是把 `-v` 文本喂给 `gotest` 事件转换器（见 2.4）——这是 JetBrains Go 侧与 intellij-rust（用 libtest JSON）的关键差异。

### 2.3 Debug：同一 Go Test 配置 + 自带 dlv（DAP），无优化构建测试二进制

- **入口**：同一 run config，只是 executor 换 Debug——「The debugger is attached behind the scenes… **If you are able to run your program from GoLand, you will also be able to debug it using the same configuration**」：https://www.jetbrains.com/help/go/starting-the-debugger-session.html
- **Debug 失败用例**：右键红叉 gutter 图标 → `Debug 'test name'` → 同一测试以 debug 模式重跑 → 命中断点停下检查。来源：performing-tests.html「Debug failed tests」节
- **二进制定位 + dlv 挂载**：
  1. GoLand 自带（bundled）Delve 二进制（2.0 引用的 2025.1 发布说明）；
  2. debug 前先用 `go test` 构建目标，**强制无优化 `-gcflags all=-N -l`**（2.0 引用的 delve#4165 实证：GoLand 默认设置下被测二进制就是带 `-gcflags "all=-N -l"` 编的）；
  3. GoLand 作为 delve 的 **DAP 客户端**发起会话（2.0 引用的 delve#3083：GoLand 显式发 DAP `ClearBreakpoints`）；
  4. 测试过滤来自 run config 的 Pattern/Test kind，作为测试二进制参数（`-run`/`-test.run`）传递——`mode:test` 语义（program=包目录、args=过滤）是 delve DAP 的标准形态，见 delve DAP 文档 mode 表：https://raw.githubusercontent.com/go-delve/delve/master/Documentation/api/dap/README.md
  - [INFERENCE] intellij-go 闭源，GoLand 具体发的 launch 载荷（mode:test vs 自编后 mode:exec）未开源可查；但「无优化构建 + DAP 客户端 + `-gcflags all=-N -l`」三点有上述一手实证，与 delve 官方 DAP 的 `mode:test`（"builds and tests, like `dlv test`"）完全吻合。
- **Go Remote**（远端/容器形态）：Go Remote 配置连远端 Delve 端口（默认例 `2345`），断开时可选停/留远端 Delve 进程：https://www.jetbrains.com/help/go/go-remote.html

### 2.4 用例级状态流：SM Runner（服务消息）+ Test Runner 树

- 管线：`go test -v` 文本 → **`GotestEventsConverter` 正则逐行解析**（`^=== RUN\s+(name)` 开用例；`--- PASS`/`--- FAIL`/`--- SKIP` 结用例；`^PASS$`/`^FAIL$` 收尾）→ 翻译成 TeamCity 风格 **service messages**（`testStarted`/`testFinished`/`testFailed`…）→ 平台 SM Runner 建 **SMTestProxy 树** → Run 工具窗 Test Runner 标签页渲染。
  - 来源（开源同源实现）：https://github.com/go-lang-plugin-org/go-lang-idea-plugin/blob/master/src/com/goide/runconfig/testing/frameworks/gotest/GotestEventsConverter.java （正则即证据）＋ 平台层 `platform/smRunner`（见 `research/test-execution-vscode-jetbrains.md` §2）
- **用例状态图标全集**：error（被测代码抛异常）/ failed / ignored / in-progress / passed / terminated。**传播规则**：任一子用例失败 → 其所有父级标记 failed；任一测试被停 → 未完成用例及父级标记 terminated。来源：viewing-and-exploring-test-results.html「status icon」表
- **结果操作**：Show Passed / Show Ignored 过滤；按 Duration / 声明顺序 / 字母排序；**Rerun Failed**（Shift+点击可改 Debug 重跑失败）；**最近 10 次会话历史**；导出 HTML/XML、导入 XML（自定义 XSL）；「Track Running Test」实时高亮当前执行用例。来源：同页 managing/sorting/export-import 各节

### 2.5 断点时序

- 断点是**项目级持久**的（跨会话保留，仅 temporary 命中一次即删）——见 `research/debug-idea.md` §4（同一平台机制）。
- 时序：先在源里设断点 → Debug（同一配置）→ **Before launch 构建**（GoLand 侧先 build）→ 启动 dlv DAP 会话 → 命中断点挂起。行为开关：默认勾选 **「Show debug window on breakpoint」**（命中断点才激活 Debug 工具窗；若想会话启动即开窗则配合配置的 Activate tool window）；「Focus application on breakpoint」命中时把编辑器带到断点行。来源：https://www.jetbrains.com/help/go/settings-debugger.html
- 挂起后可查 goroutine（delve 映射 thread）→ 见 GoLand 帮助《Examining suspended program》。

---

## 3) Zed —— gopls code lens + 任务/终端；DAP 三模式先例

> 详细架构见 `research/debug-zed.md` §1-§3；本节聚焦 Go 语言侧（zed.dev/docs/languages/go）并回答问题 1-5。

### 3.1 测试发现：gopls code lens（语义级），无 Test Explorer

- Zed 默认开启 gopls 的 `test` code lens：在 `*_test.go` 的 `Test`/`Benchmark` 函数上方显示 **"run test" / "run benchmark"** 链接（需 `"code_lens": "on"` 设置）。来源：https://zed.dev/docs/languages/go （Code Lens 节）
- **无测试树/Test Explorer/状态图标**——发现 = gopls 语义符号，但结果无结构化 UI（见 3.4）。来源：同上 + `research/debug-zed.md` §1a（Go 的 gutter "run test" 即 gopls code lens，走任务 Run 路径）。

### 3.2 Run：code lens → 任务系统 → 终端（无结构化回传）

- gopls code lens 点击 → Zed 任务系统（`tasks.json`/oneshot/语言扩展任务）→ **集成终端** spawn `go test`，输出进终端面板（`reveal`/`hide` 控制显隐焦点）。来源：`research/debug-zed.md` §1a/§2；https://zed.dev/docs/tasks
- 任务模板用 **`$ZED_SYMBOL`** 插值当前光标符号（测试名）做过滤，如 `go test $ZED_SYMBOL`；变量缺失的任务从模态框过滤掉 →「光标在测试函数内才出现该测试任务」。来源：https://zed.dev/docs/tasks （变量插值节）

### 3.3 Debug：DAP 客户端 + `.zed/debug.json` 三 mode（dlv test/exec + `$ZED_SYMBOL` 过滤）

Zed 是 **DAP 客户端**，Go 的 adapter 是 **Delve**（"supports zero-configuration debugging of Go tests and entry points (`func main`) using Delve"）；`debugger: start`（F4）列出预配置调试任务；配置源 `.zed/debug.json` → 回落 `.vscode/launch.json`。来源：https://zed.dev/docs/languages/go （Debugging 节）+ https://zed.dev/docs/debugger

三模式（zed.dev/docs/languages/go「Debug Go Packages / Debug Go Tests / Build and debug separately」）：

| mode | program | 测试过滤 | 构建 |
|---|---|---|---|
| `debug` | 包名（例 `$ZED_FILE` / `./cmd/server`） | `args`/`buildFlags` | delve 自编 |
| `test` | 仍是包名（例 `"."`） | `args: ["-test.run", "$ZED_SYMBOL"]`（调光标所在测试）；`buildFlags: ["-tags", "integration"]` | delve 内建 `go test -c` |
| `exec` | **预编译二进制**（`${ZED_WORKTREE_ROOT}/__debug_unit`） | `args: ["-test.v", "-test.run=${ZED_SYMBOL}"]` | 独立 `build` 任务：`go test -c -tags unit -gcflags"all=-N -l" -o __debug_unit ./pkg/...` |

- **与 vscode-go 完全同构**：`mode:test` = delve 内部 `go test -c`（`-gcflags all=-N -l`）+ exec；`mode:exec` = 显式「构建与调试分离」（Zed 文档明示这是 "Build and debug separately" 形态）。`$ZED_SYMBOL` = 光标符号插值（面包屑末级符号）。来源：同上 + `research/debug-zed.md` §3
- attach 形态：`tcp_connection {host, port}` 连已运行的 Delve，此时 Zed 不 spawn 新实例、无终端。来源：zed.dev/docs/languages/go「Attaching」节

### 3.4 用例级状态流：**无**（任务模型的代价）

- Run 与 Debug 的测试结果**都没有用例级 ✓/✗ 状态**：Run 是终端文本（不可编程消费），Debug 是 DAP 会话。Zed 无测试树、无失败导航、无结果持久化。来源：`research/debug-zed.md` §1a + `research/test-execution-zed-others.md` §1.2（得失表：无用例状态 / 结果不可回传）。

### 3.5 断点时序

- 走 DAP 客户端标准时序：debug 配置若带 `build` 字段先跑构建（`mode:exec` 时构建 `__debug_unit`）→ DAP `launch`（Delve 编/exec 目标并**暂停在入口**）→ `setBreakpoints` → `configurationDone` → 续跑命中。来源：`research/debug-zed.md` §1c（build 字段）+ delve DAP 时序（见 `research/test-debug-go.md` §4）。
- 对 `mode:test` + `-test.run` 过滤同理：**过滤 0 命中则测试二进制直接退出，断点不触发**。

---

## 4) IDEA —— Go 插件与 GoLand 是同一引擎；「IDEA 是否支持 Go」的准确答案

### 4.1 结论：IDEA 支持 Go，但靠 JetBrains Go 插件，且与 GoLand 同源

- **IntelliJ IDEA Ultimate 通过 JetBrains 官方 Go 插件（plugin id `9568`）获得完整的 Go 支持**，插件市场页面原文："This plugin extends IntelliJ IDEA with Go-specific coding assistance and tool integrations, and has **everything you could find in GoLand**. Please note that the **only compatible IDE is IntelliJ IDEA Ultimate**."（4.8M 下载，build compatibility 与 GoLand 同步 `262.x`）。来源：https://plugins.jetbrains.com/plugin/9568-go
- **即：GoLand = IDEA Ultimate + 该 Go 插件预装形态**，二者同一闭源引擎（intellij-go）；delve 官方 EditorIntegration 也把「JetBrains Goland」与「Golang Plugin for IntelliJ IDEA」并列两个集成：https://github.com/go-delve/delve/blob/master/Documentation/EditorIntegration.md
- **历史**：开源 go-lang-idea-plugin（曾在 IDEA/WebStorm/PyCharm/CLion/Android Studio 2016.1+ 安装）已官方弃用；其 README 明确「以下能力只有 GoLand 或 JetBrains 维护的插件有、开源插件没有：**Sub-tests support（runner/navigation/gutter actions）、Debugging tests**、Step out、100x 调试性能」，即现代 Go 测试运行/调试（含子测试与测试调试）是 intellij-go 独占，开源插件缺。来源：https://github.com/go-lang-plugin-org/go-lang-idea-plugin （README「Deprecation notice」+「not in this plugin」清单）
- 平台模型（RunConfiguration + Executor + ProgramRunner + SM Runner）与 Rust/JVM 同构，见 `research/debug-idea.md`。

### 4.2 五个问题的答案（**= GoLand，同一引擎**）

| 问题 | IDEA（Go 插件）答案 |
|---|---|
| 1) 测试发现 | 同 GoLand：PSI 语义级 gutter（RunLineMarkerContributor）+ Structure 窗；支持子测试/表格测试。来源：go-lang-idea-plugin `GoTestRunLineMarkerProvider.java` + performing-tests.html |
| 2) Run 命令/输出 | 同 GoLand：`go test -v <target> -run <pattern>`，`-v` 文本 → gotest 事件转换器 → SM Runner。来源：旧插件 `GoTestRunningState.java` / `GotestEventsConverter.java`（GoLand 同源） |
| 3) Debug 二进制定位 + dlv | 同 GoLand：自带 dlv + DAP 客户端；`-gcflags all=-N -l` 无优化构建测试二进制。来源：delve#3083 / delve#4165 / EditorIntegration.md |
| 4) 用例级状态流 | 同 GoLand：Test Runner 树（error/failed/ignored/in-progress/passed/terminated，父子传播）+ Rerun Failed + 会话历史。来源：viewing-and-exploring-test-results.html |
| 5) 断点时序 | 同 GoLand（项目级持久断点 + Debug 会话挂起 + Show debug window on breakpoint）。来源：settings-debugger.html + debug-idea.md §4 |

> 唯一实质差异：**仅限 IDEA Ultimate**，且插件闭源（配置导出等与 GoLand 相同，但无 GoLand 的「独立 IDE 发行」）。对 Neeko 而言，GoLand 与 IDEA 可合并看待（同引擎），矩阵中并作一行。

---

## 5) 4 家对比矩阵表

| 维度 | VSCode | GoLand | IDEA（Go 插件） | Zed |
|---|---|---|---|---|
| **后端调试器** | dlv-dap（Delve DAP） | 自带 dlv，DAP 客户端 | 同 GoLand | dlv（DAP 客户端） |
| **1) 测试发现** | gopls documentSymbol 语义符号 + CodeLens + Test Explorer 树；子测试只认简单 `t.Run("name",` | PSI 语义 + gutter（带上次运行状态绿/红）+ Structure 窗；**子测试/表格测试可单跑** | = GoLand | gopls code lens（run test / run benchmark）；**无测试树** |
| **发现载体** | 语义（LSP 符号） | 语义（PSI/macro） | = GoLand | 语义（gopls） |
| **2) Run 命令** | `go test … -run '^Name$' [-json] <pkg>`（裸子进程） | `go test -v <pkg/…> -run <pattern>`（`-v` 强制） | = GoLand | code lens → 任务系统 → 终端 `go test …`（task 模板） |
| **2) 输出格式** | 默认文本；有结构化消费方时追加 `-json`（test2json 流） | `-v` 文本 → 正则解析 → service messages → SM Runner 树 | = GoLand | **纯终端文本，无结构化** |
| **3) Debug 二进制定位** | delve `mode:test` 内部 `go test -c -o __debug_bin -gcflags all=-N -l <pkg>` + exec；`mode:exec` 用户预编译 | GoLand 构建 + 强制 `-gcflags all=-N -l`，再挂自带 dlv（DAP） | = GoLand | `.zed/debug.json`：`mode:debug`/`test`（delve 自编）/`mode:exec`（`build` 任务 `go test -c -gcflags"all=-N -l" -o __debug_unit`） |
| **3) -test.run 过滤** | `args: ["-test.run", "^TestFoo$"]`（锚定） | Pattern 字段（含 `/` 层级子测试正则 `^\QTestAdd\E$/^\Qsub\E$`）→ `-run`/`-test.run` | = GoLand | `args: ["-test.run", "$ZED_SYMBOL"]`（光标符号插值） |
| **4) 用例级状态流** | test2json 事件 → TestRun enqueued/started/passed/failed | SM Runner 树（passed/failed/error/ignored/in-progress/terminated + 父子传播 + 历史 10 次 + Rerun Failed） | = GoLand | **无**（终端文本，无用例状态/失败导航） |
| **5) 断点时序** | launch 暂停窗口 setBreakpoints → configurationDone 续跑；过滤 0 命中断点不触发 | 项目级持久断点 → Before launch 构建 → DAP 会话 → 命中挂起（Show debug window on breakpoint） | = GoLand | DAP 客户端时序：build（可选）→ launch → setBreakpoints → configurationDone；过滤 0 命中断点不触发 |
| **独特点** | `-json` 双轨（文本⇄结构化）；子测试识别受限 | 表格测试/子测试语义级单跑；结果持久化回填 gutter | 仅限 IDEA Ultimate | 零配置三 mode；`build` 字段引用任务复用；无测试 UI（最简形态） |

---

## 6) 对 Neeko 的可借鉴点（≤3 条）

1. **Go debug 的「无头构建测试二进制 + 挂 dlv」是四家共同事实，构建命令是公开常量**：`go test -c -o <out> -gcflags all=-N -l <pkg>`（delve `pkg/gobuild/gobuild.go`；GoLand 与 Zed `mode:exec` 的 build 任务一字不差地复用同一命令）。Neeko 若做 Go debug，直接复用 Rust 的 `debug_build_test_binary` 命令形态——只换命令字符串，且 `-o` 显式产物路径，比 Rust 解析 compiler-artifact 更简单；`-gcflags all=-N -l` 无优化是断点/变量正确性前提（delve#4165 正是没关优化导致 `nosplit` 栈溢出，GoLand/VSCode/Zed 默认全带）。来源：delve gobuild.go / delve#4165 / zed.dev/docs/languages/go。
2. **用例级状态流「结构化协议优先」，别学 GoLand 的文本正则**：VSCode 用 `-json`（test2json 流式事件），GoLand 还在用 `-v` 文本 + `=== RUN/--- PASS/--- FAIL` 正则解析（`GotestEventsConverter`）→ 脆弱、与 Rust 侧 intellij-rust 的 libtest JSON 解析不统一。Neeko 应新增 `parseTest2JsonLines`（与既有 `parseLibtestJsonLines` 共享同一 `TestResultEvent` 状态机），test2json 与 libtest JSON 同族（run/pass/fail/skip + 输出归属），差异（Go 带 `Package`/`Elapsed`、子测试 `/` vs `::`）在解析层消化。来源：test2json 官方文档 / vscode-go `goTest/run.ts` / GoLand `GotestEventsConverter.java`。
3. **子测试发现是三家分水岭，首期对齐 vscode-go 局限即可，但过滤必须锚定**：GoLand 语义级支持 `t.Run` 表格测试单跑（Pattern 用 `^\QTestAdd\E$/^\Qsub\E$` 层级正则）；vscode-go 只认简单 `t.Run("name",` 并自述局限；Zed 依赖 gopls。Neeko 文本级检测（`func TestXxx`）首期可接受 vscode-go 式局限，但 **Run/Debug 的 `-run` 必须锚定 `^TestName$`**（GoLand `-v -run` 与 vscode-go `^TestFoo$` 都是锚定）——否则子串命中多跑，且 debug 时 0 命中则断点永不触发。来源：go-test.html Pattern 字段 / vscode-go testUtils.ts / performing-tests.html。

---

## 附：核心来源索引

- GoLand 帮助：《Go Test 配置》https://www.jetbrains.com/help/go/go-test.html ｜《Run tests》https://www.jetbrains.com/help/go/performing-tests.html ｜《Explore test results》https://www.jetbrains.com/help/go/viewing-and-exploring-test-results.html ｜《Debugger 设置》https://www.jetbrains.com/help/go/settings-debugger.html ｜《Start the debugger session》https://www.jetbrains.com/help/go/starting-the-debugger-session.html ｜《Go Remote》https://www.jetbrains.com/help/go/go-remote.html
- GoLand 发布说明（自带 Delve 1.24.0）：https://blog.jetbrains.com/go/2025/04/16/goland-2025-1-is-out/
- Delve：EditorIntegration（GoLand + IDEA Go 插件在列）https://github.com/go-delve/delve/blob/master/Documentation/EditorIntegration.md ｜ DAP 接口（mode 矩阵）https://raw.githubusercontent.com/go-delve/delve/master/Documentation/api/dap/README.md ｜ issue #3083（GoLand 发 DAP ClearBreakpoints）https://github.com/go-delve/delve/issues/3083 ｜ issue #4165（GoLand/VS Code 默认 `-gcflags all=-N -l` 构建）https://github.com/go-delve/delve/issues/4165
- IDEA Go 插件（plugin 9568，= GoLand 一切能力，仅 IDEA Ultimate）：https://plugins.jetbrains.com/plugin/9568-go ｜ 弃用的开源插件（同源架构证据 + 功能差异清单）：https://github.com/go-lang-plugin-org/go-lang-idea-plugin
- 开源同源实现（JetBrains Go 测试运行架构）：`GoTestRunningState.java`（`go test -v … -run <pattern>`）https://raw.githubusercontent.com/go-lang-plugin-org/go-lang-idea-plugin/master/src/com/goide/runconfig/testing/GoTestRunningState.java ；`GotestEventsConverter.java`（`=== RUN/--- PASS/--- FAIL` 正则）…/frameworks/gotest/GotestEventsConverter.java
- Zed：Go 语言页（Code Lens + Debug Go Packages/Tests/Build-and-debug-separately/Attaching）https://zed.dev/docs/languages/go ｜ Tasks https://zed.dev/docs/tasks ｜ Debugger https://zed.dev/docs/debugger
- 仓库内既有调研（本文件引用不重写）：`research/test-debug-go.md`（VSCode + dlv-dap + test2json）、`research/debug-zed.md` §1-§3（Zed 任务/调试架构）、`research/debug-idea.md`（JetBrains 平台 Run/Debug 配置模型 + 断点生命周期）、`research/test-execution-vscode-jetbrains.md`（SM Runner/service messages）
