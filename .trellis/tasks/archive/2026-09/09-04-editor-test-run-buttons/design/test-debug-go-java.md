# Neeko 单测 Run/Debug 扩展：Go + Java 方案

> 状态：设计分析（不改代码）。输入：Rust 已落地管线（design/test-run-debug.md）+ 两份调研
> `research/test-debug-go.md` / `research/test-debug-java.md`。
> 结论先行：**Go 与 Rust 完全同构，直接复用统一管线（低成本，首期可全量）；Java 是两种形态
> 拼合——Run 可复用 Task Console + 结构化报告（中等成本），Debug 需要 Java DAP 服务器
> （高成本，建议列为独立里程碑）。**

## 1. 现状基线（Rust 已打通的五要素）

| 要素 | Rust 实现 | 复用点 |
|---|---|---|
| 用例检测 | `testCases.ts` 纯函数（`#[test]` 属性行→fn 名）| `TestCaseInfo { name, line, lang }` 扩展 lang |
| 命令构造 | `testCommands.ts` 纯函数（cargo/vitest）| `buildRunCommand` 分支扩展 |
| 构建/产物 | `debug_build_test_binary`（无头管道，2MB 截断）+ artifact 解析 | 后端命令复用，换命令即可 |
| DAP 适配器 | `lldb.rs`（CodeLLDB 优先）+ `PipelinedLaunch` 握手 | 新增 adapter / 扩 mode |
| 面板/状态流 | 静态路由（run→Task Console，debug→DebugPanel）+ libtest JSON 状态机 | 状态机扩变体 |

关键既有资产：`TestLaunchSpec` 的 `mode=run|debug` 分叉位、`parseLibtestJsonLines → TestResultEvent` 状态机、
`debug_build_test_binary` 无头构建命令、adapter 二进制覆盖（`dap.adapterBinaries`）。

## 2. Go：与 Rust 同构，复用统一管线

### 2.0 四家共识（`research/test-debug-matrix-go.md`，VSCode/GoLand/IDEA/Zed）

| 维度 | VSCode | GoLand / IDEA | Zed |
|---|---|---|---|
| 测试发现 | gopls 语义符号 + CodeLens + Test Explorer；子测试只认简单 `t.Run("name",` | PSI 语义 gutter + Structure；**子测试/表格测试可单跑**（`^\QTestAdd\E$/^\Qsub\E$` 层级正则）| gopls code lens；无测试树 |
| Run | `go test -run '^Name$' [-json] <pkg>` 裸子进程 | `go test -v <pkg> -run <pattern>` + SM Runner | 任务→终端（无结构化）|
| Debug | delve `mode:test` 内建 `go test -c -o __debug_bin -gcflags all=-N -l` + exec | 自带 dlv（DAP 客户端）+ 同样 `-gcflags all=-N -l` 构建 | `.zed/debug.json` 三 mode（debug/test/exec）|
| 状态流 | **test2json 结构化** | `-v` 文本正则（`=== RUN/--- PASS`）→ SM | **无** |

**结论**：四家 debug 全部收敛到 **Delve**（唯一后端），构建命令是公开常量
`go test -c -o <out> -gcflags all=-N -l <pkg>`（delve `gobuild.go`，GoLand/Zed 一字不差复用）；
状态流选 **test2json 结构化**（GoLand 的 `-v` 文本正则是反面教材）；`-run` 必须锚定 `^Name$`；
子测试发现是分水岭（首期对齐 vscode-go 局限即可）。

### 2.1 业界事实（调研结论）

- **Run** = 裸 `go test` 子进程 + `-json`（test2json，行式 JSON：`run/pass/fail/skip/output`）。
  VSCode 默认文本、有结构化消费方时追加 `-json`。
- **Debug** = dlv-dap `mode:test`（delve 内部 `go test -c -o <out> -gcflags all=-N -l <pkg>`
  编测试二进制 + 挂调试器跑）；`mode:exec` 是显式构建 + 挂二进制的分离形态。
- **过滤**：`-test.run '^TestName$'`（锚定正则，透传给测试二进制）；0 命中则断点永不触发。
- **状态流**：test2json 与 Rust libtest JSON 同族，可共享一份 `TestResultEvent` 状态机。

### 2.2 Neeko 方案（直接复用 Rust 管线）

| 要素 | Go 实现 |
|---|---|
| 检测 | `isTestFile`: `*_test.go`；`parseGoCases`: `func TestXxx(t *testing.T)` / `func BenchmarkXxx` 行（文本正则，无 AST；嵌套 `t.Run` 子测试首期不支持，对齐 vscode-go 局限）|
| Run 命令 | `go test -run '^Name$' -json <pkg>`（pkg = 文件所在包目录，member 定位复用）|
| Debug 构建 | 复用 `debug_build_test_binary` 命令形态 → **`go test -c -o <out> -gcflags all=-N -l <pkg>`**（命令是 delve 公开常量，`-o` 显式产物路径，比 Rust 的 compiler-artifact 解析更简单——解析 `<out>` 即可）|
| DAP | 扩 `GoAdapter`：`mode:test`（program=包目录，delve 自编+挂）或 `mode:exec`（program=构建产物）。GoAdapter 已是 dlv/TcpListen + `LaunchBeforeBreakpoints`，launch args 已有 `mode` 透传 → **build_launch_args 微调** |
| 状态流 | 新增 `parseTest2JsonLines`（`go test -json` → `TestResultEvent`），共享 `testResults` store 与 ✓/✗ 装饰 |
| 过滤精度 | debug args `["-test.run", "^TestName$"]`（锚定，避免 0 命中）|

**成本评估**：低——新增检测/命令/解析三个纯函数 + GoAdapter 微调 + 测试；后端 `debug_build_test_binary`
零改动（换命令字符串 + 产物路径解析）。

## 3. Java：两种形态拼合

### 3.0 四家现状（`research/test-debug-matrix-java.md`，VSCode/IDEA/GoLand/Zed）

| 维度 | VSCode | IDEA | GoLand | Zed |
|---|---|---|---|---|
| 测试发现 | 语义（JDT `@Testable` 元注解 + invocation 级）| 语义（PSI `@Testable`，参数化每次调用独立节点，可 `selectIteration`/`selectUniqueId`）| **无 Java 能力**（`com.intellij.modules.java` 仅存在于 IDEA/Android Studio，模块表决定性证据）| 文本（tree-sitter 注解名正则 `Test$` + `@Nested` 相等；无 `@Testable` 语义，参数化整方法跑）|
| Run 载体 | 直接 `java -cp … <JUnit runner>`（同 DAP launch，`noDebug` 分叉）| 默认内部 runner（`JUnit5IdeaTestRunner`，`-socket -test <selectors>`）；**Gradle 默认委托 Gradle `--tests`**，Maven 默认内部 | — | 构建工具任务（`mvn test -Dtest=Class#method` / `gradle --tests`）→ 终端 |
| Debug | **adapter 管**：java-debug（DAP 服务器，JDTLS JVM 内）注入 `-agentlib:jdwp=server=y,suspend=y` + JDI attach | **IDE 管**：注入 jdwp（suspend=y）+ fork socket 报端口 → reattach | — | **adapter 管**：java-debug fork（同 jar/协议）；但 **无测试调试场景**（自动场景生成排除 Java，调试测试需手写 debug.json attach）|
| 状态流 | runner socket 事件帧 / JUnit XML | TeamCity service messages（nodeId 树 + diff）| — | **无**（纯终端）|

**结论**：
1. **Java 调试器可整包复用**——VSCode/Zed 都是 `microsoft/java-debug`（Java 写 DAP 服务器，JDWP 注入+attach 全管），IDEA 用自带 JDI 同语义。Neeko 最小路径 = spawn **JUnit Platform Console Launcher**（run）+ 复用 **java-debug DAP 服务器**（debug）。
2. **状态流必须结构化**（SM/service messages / runner 帧 / JUnit XML），Zed 无状态流是明显短板。
3. 文本级发现（Zed 式 tree-sitter）能覆盖 `@Test`/`@ParameterizedTest` 方法级，代价是漏组合注解与 invocation 建模——Neeko 首期接受。
4. GoLand 无 Java；Zed Java 只能 debug main 不能 debug 测试——这两家不值得作为 Neeko Java 参照，参照 VSCode/IDEA。

### 3.1 业界事实（调研结论）

- **Run/Debug 同源 DAP launch，`noDebug` 单标志分叉**（VSCode Java 极端版：连 run 都走调试会话形态）。
- **编辑器内联不调 `mvn test -Dtest=`**：直接 `java -cp <classpath> <JUnit runner> <过滤参数>`
  （classpath 由 JDT 语言服务器提供；Maven/Gradle 只贡献 classpath）。
- **调试**：adapter 注入 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<port>`
  （JVM 挂到 main 加载前）→ spawn → JDI attach → 断点注册 → configurationDone 放行。
- **Java DAP 服务器**是 Java 编写的（`com.microsoft.java.debug.core`），随 JDT.LS JVM 运行
  （非独立可执行），**依赖 JVM 运行时**；classpath 由 JDT 语义模型给。
- **用例检测**需语义级（`@Testable` 元注解 + JUnit5 UniqueId），文本正则漏 `@ParameterizedTest`/`@TestFactory`/`@Nested`。
- **用例级状态**：编辑器内走 runner socket 事件帧；构建工具走 JUnit XML（Surefire `surefire-reports/TEST-*.xml`、
  Gradle `build/test-results/*/TEST-*.xml`，每用例一个 `<testcase>` 节点）。

### 3.2 Neeko 方案（两级：Run 先行，Debug 独立里程碑）

**Run（中等成本，Task Console + JUnit XML 状态流）**：

| 要素 | Java 实现 |
|---|---|
| 检测 | `isTestFile`: `*Test.java` / `*Tests.java` / 含 `@Test`；`parseJavaCases`: `@Test` 注解下 `void testXxx()`（文本级，**声明局限**：`@ParameterizedTest`/`@Nested` 首期当单方法处理，方法名做用例名）|
| Run 命令 | **JUnit Platform Console Launcher**：`java -jar junit-platform-console-standalone.jar -c <FQCN> -m <FQCN#method> --reports-dir=<dir>`（最小侵入；不调 mvn/gradle 整包）。classpath 解析：Maven `pom.xml` / Gradle `build.gradle` → 依赖 classpath（新增 `resolveJavaClasspath`，MVP 用 `mvn dependency:build-classpath` / gradle 等价任务，产物缓存）|
| 状态流 | 消费 Console Launcher 的 **JUnit XML**（`--reports-dir`）→ 新 `parseJunitXml`（每 `<testcase>` 一个用例）→ 共享 `TestResultEvent` 状态机 |

**Debug（高成本，独立里程碑）**：

- 调试原理：JDWP 注入 + attach（见 §3.1），DAP 服务器必须是 Java 的。
- **关键架构决策**（三条路）：
  - **A. 捆绑 Java DAP 服务器**：把 `com.microsoft.java.debug.core` 的独立可运行形态（或
    JUnit Console Launcher 的 `--launcher` 调试）作为 adapter spawn `java -jar ...` → TCP DAP。
    **问题**：java-debug 的 `LaunchRequestHandler` 需要 launch 配置含 `classPaths`（JDT 提供）——
    Neeko 无 JDT，classpath 需自建（`resolveJavaClasspath`），且 java-debug 独立运行形态未验证。
  - **B. JDWP 直调**：Rust 侧实现/引入 JDWP 客户端（JDI 等价），spawn JVM 带
    `-agentlib:jdwp=server=y,suspend=y` → attach + 自研 DAP↔JDWP 桥。
    **问题**：Rust 无成熟 JDWP crate，工程量等同写一个调试器后端。
  - **C. 通用 DAP 网关**：spawn JVM 带 jdwp + 用现成 DAP adapter（如 **vscode-java-debug 的可运行
    分发**或独立 **JDB-based** 网关）桥接。需调研现成可 spawn 的 Java DAP 服务器。
- **建议**：首期 **Run 全量**（Console Launcher + JUnit XML）；Debug 列为独立里程碑，落地前先验证
  路径 C 的现成 Java DAP 服务器可 spawn（调研项）。

### 3.3 Java 检测的语义局限（必须声明）

文本级 `@Test` 检测会漏：`@ParameterizedTest`（一个方法多个用例）、`@TestFactory`（动态用例）、
`@Nested`（内嵌类）、自定义组合注解。业界靠 JDT 语义解析。Neeko 文本级 MVP 接受"方法级粒度"，
参数化/嵌套按方法名单用例处理（状态流中 `method:param` 无法精确区分）——文档声明为已知限制。

## 4. 状态流统一（Go + Java + 既有 Rust/TS）

| 源 | 解析器 | 用例字段 |
|---|---|---|
| Rust libtest JSON | `parseLibtestJsonLines`（既有）| `name`（`mod::case`）|
| Go test2json | 新增 `parseTest2JsonLines` | `name`（`TestXxx` / 子测试 `/` 扁平）|
| JUnit XML | 新增 `parseJunitXml` | `name`（`Class#method`）|
| Vitest JSON | `parseVitestJsonReport`（既有）| `name` |

全部归一为 `TestResultEvent { status, name, output?, duration? }` → `testResults` store → gutter ✓/✗。
差异在解析层消化（层级/耗时/输出归属），消费方零改动。

## 5. 里程碑（TDD，Red-Green-Refactor）

| M | 内容 | 验收 |
|---|---|---|
| G1 | Go 检测 + Run 命令 + test2json 解析纯函数 | 单测：`_test.go` 识别、`go test -json` 行→事件、`^Name$` 命令 |
| G2 | Go Debug：`debug_build_test_binary` 换 go 命令 + GoAdapter `mode:test` + 断点 | 单测 + dlv 真机（`#[ignore]`）|
| J1 | Java 检测 + Run 命令（Console Launcher）+ classpath 解析 | 单测：`@Test` 检测、命令、pom 解析 |
| J2 | JUnit XML 状态流 + Task Console 集成 | 单测：XML→事件；真实 JUnit 项目冒烟 |
| J3 | Java Debug（调研后定路径 A/C）| DAP 会话 + 断点命中（真机）|

## 6. 风险与不做

- **Java Debug 是最大不确定**：Java DAP 服务器需 JVM 运行时 + classpath 语义；不做捆绑前先调研
  `com.microsoft.java.debug.core` 独立可运行性（路径 C）。若不可行，Java Debug 降级为
  "JDWP 手动 attach"（用户自己 `mvn -Dmaven.surefire.debug test` 后 attach）文档说明。
- **不做**（YAGNI）：Java 语义级用例检测（JDT 集成）、参数化/嵌套精确建模、Go 子测试 `t.Run` 识别、
  Maven/Gradle 整包过滤路径、Java Debug 首期。
- **Windows**：go/java 命令 quoting 复用既有 POSIX 模型 + 已修 Windows cmd 转换。

## 7. 验收（Go 全量 / Java Run 全量 + Debug 里程碑）

- [ ] Go：`_test.go` gutter Run/Debug；`go test -json` ✓/✗ 状态流；dlv 断点命中测试函数。
- [ ] Java：`@Test` gutter Run；JUnit XML 用例级状态流；Console Launcher 输出进 Task Console。
- [ ] 全量门禁（type-check / test:run / lint / cargo test）+ 真机冒烟。
