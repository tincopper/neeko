# Go 单测 Run/Debug 业界实现调研（VSCode + dlv DAP + go test -json）

> 范围：VSCode（gopls + Go Test Explorer）的 Go 单测 run/debug 流程、dlv 的 DAP 支持
> （launch 配置 / mode 字段 / 测试过滤）、`go test -json` 用例级 ✓/✗ 状态流（与 Rust
> libtest JSON 对齐可能性）、断点在 Go 测试进程如何生效（dlv 断点时序）、构建
> （`go test -c`）与运行分离的业界做法。
> 结论先行：**VSCode 的 Run 是「裸 `go test` 子进程 + 结构化输出回传」；Debug 是
> 「dlv-dap `mode:test` → delve 内部 `go test -c`（关优化）+ 直接挂调试器跑测试二进制」
> ——`dlv test` 语义即「构建测试二进制 + exec 到调试器」，与 Neeko Rust 的
> `cargo test --no-run` + lldb launch 是同构的「先构建、后挂调试器」统一管线。**
> 每条结论附来源。

## 1) VSCode（gopls + Go Test Explorer）的 Go 单测 run 与 debug 流程

### 1.1 发现层：gopls document symbols + 扩展侧 CodeLens / Test Explorer

- 测试用例发现（函数名 + 源码范围）走 **gopls 的 `textDocument/documentSymbol`**：
  vscode-go 的 `GoDocumentSymbolProvider` 就是 `GoplsDocumentSymbolProvider`，经 language
  client 请求 gopls 的 DocumentSymbols（`src/goDocumentSymbols.ts`），CodeLens 与
  Test Explorer 都消费它。
  - 来源：https://github.com/golang/vscode-go/blob/master/extension/src/goDocumentSymbols.ts
- 入口一 **CodeLens**（`GoRunTestCodeLensProvider`）：对每个测试函数发 `run test` /
  `debug test` 两个 CodeLens；对 `t.Run("name", func...)` 的简单子测试再发
  `run test` / `debug test`；包级发 `run package tests` / `run file tests`。
  - 局限（Neeko 可借鉴的教训）：子测试识别只匹配 `t.Run("name",` 简单形式，**嵌套子测试
    不识别**（源码注释明言 "This should be solved once codelens is handled by gopls"）。
  - 来源：https://github.com/golang/vscode-go/blob/master/extension/src/goRunTestCodelens.ts
- 入口二 **Test Explorer**（`extension/src/goTest/`）：`TestController`（`explore.ts` +
  `resolve.ts`）建树（module → package → file → test），`run.ts` 注册三个 RunProfile：
  `Go`（Run）/ `Go (Debug)`（Debug）/ `Go (Profile)`。
  - 来源：https://github.com/golang/vscode-go/tree/master/extension/src/goTest

### 1.2 Run：裸 `go test` 子进程（命令形态 + 输出格式）

- Run 路径**不经过 dlv**：扩展 `cp.spawn('go', args, { cwd: 包目录 })` 直接跑 `go test`
  （`src/testUtils.ts::goTest`）。命令形态（`computeTestCommand`）：

  ```
  go test -test.fullpath=true -timeout <X>m [-tags ...] [-coverprofile=...]
        [-run '^TestFoo$'] [-json] <pkg>
  # benchmark: go test -benchmem -run=^$ -bench '^BenchFoo$' ...
  ```

  - 关键点：`-run` 用**锚定正则 `^TestFoo$`**（不是裸子串）；Test Explorer 多个用例时
    用 `^A|B$/^子测试$` 组合；benchmark 用 `-bench '^Name$' -run a^`（`run=^$`/`a^` 表示
    "不跑测试"）。
  - `-test.fullpath=true` 让输出带完整包路径（解决 vscode-go#3853 显示歧义）。
  - 来源：https://github.com/golang/vscode-go/blob/master/extension/src/testUtils.ts
    （`computeTestCommand` / `targetArgs` / `getTestFunctionDebugArgs`）
- **输出格式双轨**：
  - 默认：人类可读文本 → `Go Tests` 输出通道；退出码 0 = 全过（`tp.on('close', code === 0)`）。
  - 当用户设了 `-v` **或**存在结构化消费方（Test Explorer 的 `goTestOutputConsumer`）
    时，**偷偷追加 `-json`**（注释："this is not shown to the user"），逐行
    `JSON.parse` 成 `GoTestOutput{Action,Package,Test,Output}`：非 output 事件直接喂
    consumer 驱动测试树；output 事件按包路径展开文件链接回显；**非 JSON 行（构建失败等）
    原样透传**。
  - 来源：https://github.com/golang/vscode-go/blob/master/extension/src/testUtils.ts
    （`processTestResultLineInJSONMode`）
- **Test Explorer 的 run**：按「选中的用例→分到所属包」逐包跑一次 `goTest`（`run.ts`），
  每个用例先 `run.enqueued`，收到 `pass`/`fail`/`skip` 事件再 `run.passed/failed`（
  `consumeGoTestEvent`）。**一次 `go test` 只能带一个子测试**：选中多个子测试会中止
  （Go issue #39904）。
  - 来源：https://github.com/golang/vscode-go/blob/master/extension/src/goTest/run.ts

### 1.3 Debug：dlv-dap `mode:test`（delve 内部 go test -c + exec）

- Debug 入口（CodeLens `debug test` / Test Explorer `Go (Debug)`）都收敛到
  `debugTestAtCursor`，构造一个 DAP launch 配置：

  ```json
  { "name":"Debug Test", "type":"go", "request":"launch",
    "mode":"test",
    "program":"<测试文件所在包目录>",
    "args": ["-test.run", "^TestFoo$"],   // 或子测试 /^A|B$/^sub$，或基准 -test.bench ...
    "buildFlags": "<tags 等>" }
  ```

  - 来源：https://github.com/golang/vscode-go/blob/master/extension/src/goTest.ts
    （`debugTestAtCursor`）+ testUtils.ts `getTestFunctionDebugArgs`
- 然后走 **dlv-dap**（默认 debugAdapter；`debugAdapter:"dlv-dap"`）：扩展把配置转给
  `dlv dap` 服务器，delve **自己负责构建并启动**：
  - **`mode:test` = delve 内部执行 `go test -c -o <输出> -gcflags all=-N -l <pkg>` 编译出
    测试二进制（默认名 `__debug_bin`），再以 `dlv exec` 语义启动该二进制**，cwd =
    包目录（"run the test binary from the package directory like in `go test` and
    `dlv test` by default"），`args`（含 `-test.run`）透传给测试二进制
    （`ProcessArgs = [debugbinary, ...args.Args]`）。
  - 即 DAP 的 `mode:test` 就是 `dlv test` 命令：**"Compile test binary and begin debugging
    program"**——构建与挂调试器一步到位。
  - 来源（delve DAP server 实现）：
    https://github.com/go-delve/delve/blob/master/service/dap/server.go
    （launch 处理：mode test → `gobuild.GoTestBuildCombinedOutput` + `Cwd=getPackageDir`）
  - 来源（go test -c 编译命令 + 强制 `-gcflags all=-N -l`）：
    https://github.com/go-delve/delve/blob/master/pkg/gobuild/gobuild.go
  - 来源（dlv test / dlv exec 语义）：
    https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_test.md
    https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_exec.md
- **所以 Q1 的答案**：vscode-go 调试单测既不是手写 `go test -c` + `dlv exec`（那是
  `mode:exec` 手建二进制的形态），也不是 `dlv test` CLI 直调——而是**把 `dlv test` 语义
  内建进 DAP 的 `mode:test`**：delve 帮你 `go test -c` 编出测试二进制再挂上调试器。
  - `mode:exec`（对预编译二进制）：vscode-go 文档要求二进制必须带
    `-gcflags=all="-N -l"` 编译；程序参数 = 二进制路径。
    来源：https://github.com/golang/vscode-go/blob/master/docs/debugging.md（Launch 节）

### 1.4 流程小结（VSCode）

| 阶段 | 命令/协议 | 载体 | 状态回传 |
|------|-----------|------|----------|
| 发现 | gopls documentSymbol（扩展侧 CodeLens / TestController） | — | — |
| Run | `go test ... -run ^Name$`（子进程） | Go Tests 输出通道 / TestRun 树 | 默认文本；`-v` 或 Explorer 时加 `-json` 流式回传 |
| Debug | dlv-dap `launch{mode:test, program:包目录, args:[…-test.run…]}` → delve 内部 `go test -c` + exec | DebugPanel（DAP） | 断点/栈帧/变量 |

## 2) dlv 的 DAP 支持

### 2.1 服务器形态

- **`dlv dap`**：单会话 DAP-only 服务器，等客户端发 launch/attach 配置（`dlv dap --listen=:port`）。
- **`dlv --headless <command> <debuggee>`**：通用服务器，客户端可走 JSON-RPC 或 DAP
  remote-attach（`--accept-multiclient`）。
- 来源：https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md

### 2.2 launch 配置：mode 字段矩阵（官方表）

| request | mode | 必填 | 可选（节选） | 含义 |
|---------|------|------|--------------|------|
| launch | `debug` | program | dlvCwd, env, backend, args, cwd, buildFlags, output, noDebug | 编译并调试 main 包 |
| launch | `test` | program | 同 debug | 编译并调试测试（= dlv test） |
| launch | `exec` | program | dlvCwd, env, backend, args, cwd, noDebug | 调试预编译二进制 |
| launch | `core` | program + corefilePath | env | 调试 core dump |
| launch | `replay` | traceDirPath | env | rr 时间旅行回放 |
| attach | `local` | processId | backend | 附加本地进程 |
| attach | `remote` | — | — | 附加 dlv --headless 服务器（target 由服务器命令行指定） |

- 另有 `substitutePath / stopOnEntry / stackTraceDepth / showGlobalVariables / showRegisters /
  showPprofLabels / hideSystemGoroutines / goroutineFilters` 等公共项。
- 来源：https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md
  （Launch and Attach Configurations 表）+ vscode-go debugging.md（launch.json 属性表）
  https://github.com/golang/vscode-go/blob/master/docs/debugging.md

### 2.3 program 语义：包路径 vs 二进制

- `debug`/`test` 模式：`program` = **包路径或包目录**（delve 用 go 编译；`program` 给
  `_test.go` 文件也会被 vscode-go 改写为 `path.dirname`）。
- `exec` 模式：`program` = **已编译二进制文件路径**。
- 来源：vscode-go debugging.md（`program` 属性：go test 模式给 program folder / 任意
  go 文件；exec 模式给 pre-built binary）。
  https://github.com/golang/vscode-go/blob/master/docs/debugging.md

### 2.4 测试过滤：`-test.run` 正则

- 过滤不是专用字段，而是**经 launch 的 `args` 数组透传给测试二进制**：
  `ProcessArgs = [debugbinary, ...args.Args]`（delve DAP server.go）。
  典型 `args: ["-test.run", "^TestFoo$", "-test.v"]`；delve 不解析这些参数，由
  `go test -c` 产物（testing 包）消费。
- `-test.run` 语义（go testing 文档）：**正则匹配测试名（未锚定时子串式命中），
  反斜杠分割支持子测试层级** `-run 'TestOuter/Inner'`；vscode-go 为精确定位用
  `^Name$` 锚定、suite 方法用 `^A|B$/^instance$`。
- 来源：go testing 包 flags 文档 https://pkg.go.dev/testing ；
  vscode-go testUtils.ts `getTestFunctionDebugArgs`（`-test.run '^Name$'`）：
  https://github.com/golang/vscode-go/blob/master/extension/src/testUtils.ts

## 3) `go test -json` 输出格式

### 3.1 test2json 事件协议（权威）

- **`go test -json` 内部就是 test2json**（`go test` 把测试输出经
  `cmd/internal/test2json` 转换；`-json` 还会给测试二进制注入 `-test.v=test2json`
  高保真 framing 标记）。多包时 `go test -json` 已是合流流。
  - 来源：https://github.com/golang/go/blob/master/src/cmd/go/internal/test/testflag.go
    （`-json` 定义 + `-test.v=test2json` 注入）与
    https://github.com/golang/go/blob/master/src/cmd/go/internal/test/test.go
    （`test2json.NewConverter`）
- **逐行 JSON，每事件一个对象**（`src/cmd/test2json/main.go` 官方文档）：

  ```jsonc
  {"Time":"2026-...","Action":"run","Package":"mypkg","Test":"TestFoo","Elapsed":0.01}
  {"Time":"...","Action":"output","Package":"mypkg","Test":"TestFoo","Output":"=== RUN   TestFoo\n","OutputType":"frame"}
  {"Time":"...","Action":"pass","Package":"mypkg","Test":"TestFoo","Elapsed":0.012}
  {"Time":"...","Action":"output","Package":"mypkg","Output":"PASS\n"}
  {"Time":"...","Action":"pass","Package":"mypkg"}          // 包级汇总
  ```

  - `Action` 固定集合：`start`（二进制将执行）/ `run`（用例开始）/ `pause` / `cont`
    （并行用例暂停/继续）/ `pass` / `bench` / `fail` / `skip`（跳过，或"包内无测试"）/
    `output`（输出行；stdout+stderr 合并）。
  - `Test` 字段缺省 = 包级事件；子测试名带 `/` 层级（如 `TestOuter/Inner`）。
  - `Elapsed` 只在 pass/fail 事件；`OutputType` 标识 `frame` / `error` /
    `error-continue`；构建失败走 `FailedBuild`（`Action:"fail"` + 包 ID）。
  - **流式无缓冲**（"no unnecessary input or output buffering, so that the JSON stream
    can be read for 'live updates' of test status"）——天生支持前端流式 ✓/✗。
  - 来源：https://github.com/golang/go/blob/master/src/cmd/test2json/main.go
    （Output Format 节，含 TestEvent struct 与 Action 全集）

### 3.2 与 Rust libtest JSON 的对齐可能性

| 维度 | `go test -json`（test2json） | Rust libtest JSON（`--format json`） |
|------|-----------------------------|--------------------------------------|
| 载体 | 逐行 JSON，每行一事件 | 逐行 JSON，每行一事件 |
| 用例开始 | `{"Action":"run","Test":"T"}` | `{"type":"test","event":"started","name":"T"}` |
| 通过 | `{"Action":"pass","Test":"T","Elapsed":…}` | `{"type":"test","event":"ok","name":"T"}` |
| 失败 | `{"Action":"fail","Test":"T"}` | `{"type":"test","event":"failed","name":"T"}` |
| 跳过 | `{"Action":"skip","Test":"T"}` | `{"type":"test","event":"ignored","name":"T"}` |
| 输出 | `{"Action":"output","Output":"…"}` | `{"type":"test","event":"ok","name":…}` 前置 text 行 + `{"type":"test","event":"stdout"}` |
| 层级 | 包字段 + 子测试 `/` 路径 | 全限定名 `mod::test`，消费方按 `::` 重建树 |
| 汇总结束 | `{"Action":"pass","Package":…}`（包级） | `{"type":"suite","event":"started"/"ok"}` |

- **结论：结构同族，对齐成本低**。两者都是"行式 JSON + 用例级 run/pass/fail/skip 状态机 +
  流式输出"，可归一到一个统一 `TestResultEvent{ status, name, output?, duration? }`，
  前端一份状态机消费 Go / Rust 双栈（vscode-go 的 `consumeGoTestEvent` 与 intellij-rust
  的 libtest 解析器本就是同一思路的两个实现）。差异点：
  1. Go 的事件自带 `Package` 与 `Elapsed`，天然支持多包一次跑 + 耗时；
  2. Go 的 `output` 事件带 `Test` 归属，Rust 需靠行缓冲推断归属；
  3. Go 子测试是 `/` 扁平路径、Rust 是 `::` 层级——**层级重建逻辑照搬 Rust 侧即可**。
- 来源：test2json 官方文档（同上）；Rust libtest JSON：rustc book
  https://doc.rust-lang.org/rustc/tests/index.html#json-format

## 4) 断点在 Go 测试进程如何生效（dlv 断点时序）

- **DAP 时序（delve `service/dap/server.go`）**：
  1. 客户端发 `launch` → delve 先构建（`mode:test` = `go test -c`；构建失败在 Debug
     Console 报 "Build Error"，不发 visible 弹窗）→ 启动测试二进制并**暂停在入口**；
  2. delve 发 `initialized` + `launch` 响应 → 客户端此时发 `setBreakpoints`（源码级
     断点，测试二进制已加载、符号可解析，立即生效）；
  3. 客户端发 `configurationDone` → `onConfigurationDoneRequest`：`stopOnEntry=false`
     时 `runUntilStopAndNotify(api.Continue)` **恢复执行**——此后命中断点。
  - 即：**断点在测试进程启动前（暂停窗口内）设好，`-test.run` 过滤后的测试一执行就命中**；
    运行中再设断点走 `stopToSetBreakpoints`（halt → 设 → 续跑）。
  - 来源：https://github.com/go-delve/delve/blob/master/service/dap/server.go
    （launch / `onConfigurationDoneRequest` / `stopToSetBreakpoints`）
- **Go/测试特有注意点**：
  1. **关优化是正确性前提**：delve 内部编译测试二进制强制 `-gcflags all=-N -l`
    （gobuild.go），`mode:exec` 自建二进制也必须手带 `-gcflags=all="-N -l"`
    （vscode-go 文档）。否则断点/步进/变量不可靠。
  2. **`-test.run` 过滤决定断点是否走到**：正则匹配 0 个用例时测试二进制直接
    "no tests to run"，测试函数断点永不命中——所以 debug 必须带精确 `^Name$` 过滤。
  3. **执行顺序**：包内 `init` → `TestMain(m)` → 各测试（每个测试在自己的 goroutine 跑）。
    断点可能先落在 `testing` 框架/`TestMain` 而非目标用例；delve DAP 把 goroutine 映射为
    thread（`threads` 请求），调试器可切 goroutine（vscode-go Call Stack 注记 goroutine id）。
  4. **并行测试**：`t.Parallel()` 用例并发跑，普通文件:行断点照常命中（停所有 goroutine），
    条件断点可加 goroutine 条件（`cond bp runtime.curg.goid == N`）。
  - 来源：delve CLI docs（break/condition）https://github.com/go-delve/delve/blob/master/Documentation/cli/README.md ；
    vscode-go debugging.md（Call stack 节）https://github.com/golang/vscode-go/blob/master/docs/debugging.md

## 5) 构建（`go test -c`）与运行分离的业界做法

- **形态 A（默认，内建）**：`mode:test` / `dlv test` —— delve **一条命令完成
  "`go test -c` 编测试二进制 + 挂调试器跑"**；`-o` 默认 `__debug_bin`，会话结束删除
  （`binaryToRemove`）。这是"构建与调试的衔接是显式状态机"的最常见形态。
  - 来源：delve dap server.go + gobuild.go + dlv_test.md
- **形态 B（显式分离，mode:exec + preLaunchTask）**：vscode-go 文档为 root/自定义构建场景
  给出标准模板：tasks.json 里 `go test -c -o ${fileDirname}/__debug_bin` 构建任务 +
  launch.json `mode:exec, program:"${fileDirname}/__debug_bin", preLaunchTask:"go test (debug)"`。
  构建参数（`buildFlags/env/cwd`）在 task 里、运行参数（`args/cwd/env`）在 launch 里——
  **构建与运行参数分离，正是 Neeko 设计文档 §2 的 C1 共识**。
  - 来源：vscode-go debugging.md（"Debug a package test as root" 节：go test (debug)
    task + mode:exec launch）https://github.com/golang/vscode-go/blob/master/docs/debugging.md
- **形态 C（手工脚本）**：`go test -c -gcflags "all=-N -l" -o __debug_unit ./pkg` 编二进制，
  再 `dlv exec __debug_unit -- -test.run ^TestX$ -test.v` 调试（Zed Go 文档示范；
  Zed 用 debug config 的 `build` 字段引用同一 task 定义 → `program` + `-test.run`）。
  - 来源：https://zed.dev/docs/languages/go （"Build and debug separately" / "Debug Go Tests"）；
    已见 Neeko `research/test-execution-zed-others.md`
- **业界统一结论**：Go 生态默认把"编译测试二进制"（`go test -c`，等价 Rust
  `cargo test --no-run`）做成调试前置的**独立构建动作**，产物路径（`__debug_bin` /
  `__debug_unit`）显式落盘，再由 dlv 以 `exec` 挂载；vscode-go 把这两步折叠进
  `mode:test` 免去用户手写，但**底层仍是同一管线**——与 Neeko Rust 的
  `cargo test <name> --no-run`（或 `--message-format=json` 取 `compiler-artifact.executable`）
  完全同构。

## 6) 对 Neeko 的可借鉴点（≤3 条）

1. **Go 的 Debug 也走"无头构建 + 挂调试器"统一管线，且构建命令是公开常量**：
   `go test -c -o <out> -gcflags all=-N -l <pkg>`（delve gobuild.go）。Neeko 若后续接
   Go debug，直接复用 Rust 的 `debug_build_test_binary` 命令形态（换命令即可），
   产物解析比 Rust 更简单（`-o` 显式指定路径，无需解析 compiler-artifact）。
   构建与运行参数分离（mode:exec + preLaunchTask）是 vscode-go 官方推荐的"特殊构建"
   逃生口——印证 Neeko 设计文档 C1/C2 铁律。来源：delve gobuild.go / vscode-go
   debugging.md。
2. **`go test -json` 与 Rust libtest JSON 是同族协议，可归一为一份用例级状态机**：
   两者都是"行式 JSON + run/pass/fail/skip 流式事件 + 输出带归属"。Neeko 的
   `parseLibtestJsonLines → TestResultEvent` 纯函数可直接加一个 `parseTest2JsonLines`
   变体，共享同一 `TestResultEvent` 消费方与 ✓/✗ 装饰；差异点（Go 带 `Package`/`Elapsed`、
   子测试 `/` vs `::`）在解析层消化即可。来源：test2json 官方文档 / rustc book。
3. **断点生效的关键不是"进程启动时刻"而是"过滤后的用例确实被执行"**：
   dlv 在 launch 暂停窗口内设断点（`configurationDone` 前），`-test.run ^Name$` 匹配 0 个
   用例时断点永不命中。Neeko 的 Rust debug（lldb launch args=[用例名]）同理——用例过滤
   必须精确（`^Name$` 或 `--exact`），且关优化编译（`-N -l` / Cargo `debug=true`）是断点/
   步进正确性前提。来源：delve dap server.go / vscode-go debugging.md。

---

## 附：核心来源索引

- vscode-go 调试文档（launch.json 属性表 / mode / program / preLaunchTask / root 调试）：
  https://github.com/golang/vscode-go/blob/master/docs/debugging.md
- vscode-go 源码：`src/goTest.ts`、`src/testUtils.ts`、`src/goRunTestCodelens.ts`、
  `src/goDocumentSymbols.ts`、`src/goTest/{explore,run,resolve}.ts`、`src/goTest/test_events.md`
  （均 https://raw.githubusercontent.com/golang/vscode-go/master/...）
- Delve DAP 接口（mode 矩阵 / dlv dap / dlv --headless）：
  https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md
- Delve `dlv test` / `dlv exec`：
  https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_test.md 、
  .../dlv_exec.md
- Delve DAP 实现（mode:test → go test -c + exec、断点暂停窗口）：
  https://github.com/go-delve/delve/blob/master/service/dap/server.go ；
  构建命令（`-c -o <out> -gcflags all=-N -l`）：.../pkg/gobuild/gobuild.go
- `go test -json` / test2json 事件协议：
  https://github.com/golang/go/blob/master/src/cmd/test2json/main.go ；
  `-json` 标志与 `-test.v=test2json` 注入：.../src/cmd/go/internal/test/testflag.go
- `-test.run` 过滤语义：https://pkg.go.dev/testing
- Zed Go 调试三节：https://zed.dev/docs/languages/go （cross-ref
  `research/test-execution-zed-others.md`）
