# Java 单测 run/debug 矩阵调研：Zed / VSCode / IDEA / GoLand

> 范围：四家对 **Java 单元测试 run/debug** 的实现链路。VSCode 侧已有 `research/test-debug-java.md`（Test Runner for Java + vscode-java-debug + JDWP + JUnit XML）完整覆盖，本文只做结论指针不重写；**重点补 IDEA / GoLand / Zed 三家的实现细节**（IDEA 与 GoLand 以 intellij-community / intellij-go 源码 + JetBrains 官方文档为主，Zed 以 zed.dev 文档 + zed-extensions/java 源码为主；web_search 限流，全部直读一手来源）。
> 方法：直读官方文档 + 一手源码（GitHub raw），每条结论附来源 URL。
> 结论先行：**Java 测试调试的「发现 / 执行 / 结果回传」四家分两派** —— VSCode、IDEA、Zed 的 Java 调试器都是同一套 `microsoft/java-debug` 血统（IDEA 用自带 JDI 调试器实现同构语义；VSCode 与 Zed 直接复用 java-debug DAP 服务器，Zed 只是换了个入口把 DAP 服务器跑在 JDTLS 里）；**run** 一派是「直接跑 JUnit runner」（VSCode、IDEA 默认），一派是「委托构建工具」（IDEA 的 Gradle 项目默认、Zed 全部、Maven 可选）；**GoLand 不提供 Java 支持**（Java 模块仅存在于 IDEA / Android Studio），只在平台机制上与 IDEA 同源。

---

## 1. IDEA（IntelliJ IDEA，JUnit 4 / JUnit 5 / TestNG）

> 源码路径：`JetBrains/intellij-community`（master）。发现逻辑在 `java/execution/impl/.../junit/JUnitUtil.java`；JUnit5 运行时在 `plugins/junit5_rt`；run/debug 编排在 `java/execution/impl/.../JavaTestFrameworkRunnableState.java` 与 `JavaTestFrameworkDebuggerRunner.java`；wire 协议在 `java/java-runtime/.../MapSerializerUtil.java`。

### 1.1 测试发现：PSI 语义分析，直接实现 JUnit5 的 `@Testable` 元注解语义（非文本）

- **类级判定 `JUnitUtil.isJUnit5TestClass()`**：命中即测试类的条件包含 `MetaAnnotationUtil.isMetaAnnotatedInHierarchy(psiClass, {org.junit.platform.commons.annotation.Testable})` —— 即 **IDEA 在语言层直接实现 JUnit5 的 `@Testable` 元注解语义**（`CUSTOM_TESTABLE_ANNOTATION = org.junit.platform.commons.annotation.Testable`），沿注解层级展开，因此 `@Test` / `@ParameterizedTest` / `@RepeatedTest` / `@TestFactory` / `@TestTemplate` 及**自定义组合注解**都能识别；另把「非 private / 非 static 且 meta 命中 `org.junit.jupiter.api.Nested` 的内部类」判为测试类（`@Nested` 建模），`@ExtendWith` 类也判为测试类。JUnit4/3 走 `@RunWith` / `TestCase` 继承 / `test*` 命名约定（`isJUnit4TestClass` / `isJUnit3TestClass`）。
- **方法级判定 `isTestMethod()`**：`isJupiterTestAnnotated(method, true)` = 对方法做 `@Testable` 元注解搜索（同样覆盖组合注解）；显式排除生命周期/配置方法（`@BeforeEach/@AfterEach/@BeforeAll/@AfterAll/@Before/@After/@Rule/@DataPoint/suite`）——它们不是用例。
- **`@ParameterizedTest` 每次调用是独立用例节点**：运行时把 JUnit Platform 的每个 `TestIdentifier`（含每个 `test-template-invocation`）当独立节点上报（见 1.4）；**重跑单次调用**由 runner 参数 `selectIteration(...)`（`valueSource <index>`）或 `selectUniqueId(...)` 精确选择（见 1.2 / `JUnit5TestRunnerHelper.createSelector`）。
- 判定需要**类型可解析**（注解在 classpath 上），本质是语义级而非源码文本级。
- 来源：`JUnitUtil.java` https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/junit/JUnitUtil.java ；框架描述符 `JUnitTestFramework.java` https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/junit/JUnitTestFramework.java

### 1.2 Run 走什么：默认「直接跑自家 JUnit runner」，Gradle 项目默认委托 Gradle，Maven 默认内部 runner

- **内部 runner 路径（默认，Maven 项目/非 Gradle 项目）**：`JavaTestFrameworkRunnableState` 拼 `JavaParameters`（JDK + **模块 test classpath** + `idea_rt.jar` 打头），加 `-socket<port>` 程序参数，主类即 IDEA 的 JUnit runner（JUnit5 为 `com.intellij.junit5.JUnit5IdeaTestRunner`，`JUnit5IdeaTestRunner.startRunnerWithArgs` 用 JUnit Platform `LauncherFactory` 建 `LauncherDiscoveryRequest` 跑测试；JUnit4 入口为 junit-rt 运行时的 `com.intellij.rt.junit.JUnitStarter` [INFERENCE：JUnit4 入口类名，运行时 jar 内]）。**不是 `mvn test -Dtest=` / `gradle test --tests=`**，构建工具只贡献 classpath（Maven/Gradle 导入的模块模型）。用例过滤是 runner 自己的参数协议：`-test` 后接选择器（`@<file>` 包/类清单文件、类名、`Class,method`、`\u001B`+UniqueId、`+`+classpath root），见 `JUnit5TestRunnerHelper.buildRequest/createSelector`。`JUnitConfiguration` 的 Test kind 提供 Class / Method / **Pattern**（`包.类$内部类,方法||...`）/ Package / Directory / **UniqueId** / **Tags**（JUnit5 `@Tag` 表达式）。
- **Gradle 项目默认委托 Gradle**：「Run test using = **Gradle**（默认）｜IntelliJ IDEA｜Choose per test」——选 Gradle 则 `gradle :module:test --tests "pkg.Class.method"`，与 CI 结果一致；选 IntelliJ IDEA 才走内部 runner（更快，增量编译）。
- **Maven 项目默认内部 runner**，可选「Delegate build/run actions to Maven」委托 `mvn test`（单测可用 `-Dtest=`）。
- **断点时序相关的构建开关**：Before Launch 默认含 Build，构建失败不启动；Fork mode（Method/Class）可为每个方法/类起独立 JVM。
- 来源：`JavaTestFrameworkRunnableState.java`（createJavaParameters / configureClasspath / createServerSocket / appendForkInfo）https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/JavaTestFrameworkRunnableState.java ；`JUnit5IdeaTestRunner.java` https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/JUnit5IdeaTestRunner.java ；`JUnit5TestRunnerHelper.java` https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/JUnit5TestRunnerHelper.java ；JUnit run config 文档 https://www.jetbrains.com/help/idea/run-debug-configuration-junit.html ；Gradle 测试 runner 选择 https://www.jetbrains.com/help/idea/work-with-tests-in-gradle.html ；Maven 测试 https://www.jetbrains.com/help/idea/work-with-tests-in-maven.html

### 1.3 Debug 挂 JDWP：IDE 注入 `-agentlib:jdwp`（suspend=y）+ 自带 JDI 调试器 attach；fork 出的测试 JVM 经「fork socket」把调试端口报给 IDE 再 reattach

- 官方语义：**「启动 debug 会话时 IDEA 给目标进程追加一个允许调试器 attach 的 VM option」**（framework 若 fork 子进程，配置类型不对会漏掉该参数）；attach 方向用 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005`（目标监听）或 `server=n,...suspend=y`（目标连调试器）。
- 测试路径（源码）：`JavaTestFrameworkDebuggerRunner`（继承 `GenericDebuggerRunner`）`createContentDescriptor` → 打开 `ServerSocket`（fork socket）→ accept 测试子 JVM 连接 → 读一个 int（**子 JVM 自启的 JDWP 端口**）→ 构造 `RemoteConnection(true, "127.0.0.1", <port>, true)` + `DefaultDebugEnvironment` → `DebugProcessImpl.reattach(...)`。即**子测试 JVM 自带 jdwp server（suspend=y）并把端口报给 IDE，IDE 用自带 JDI（`com.intellij.debugger`）attach**。
- 也就是说 JDWP 注入是 **IDE 管**（注入到它启动的 JVM / fork 的 JVM），不是构建工具；委托 Gradle/Maven 时才是构建工具 fork 测试 JVM，调试靠用户配 `-Dmaven.surefire.debug` 或 Gradle debug 端口再 Remote attach。
- 来源：`JavaTestFrameworkDebuggerRunner.java` https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/JavaTestFrameworkDebuggerRunner.java ；调试会话文档 https://www.jetbrains.com/help/idea/starting-the-debugger-session.html ；attach 文档（agent 参数语义）https://www.jetbrains.com/help/idea/attach-to-process.html ；Maven 调试（`-Dmaven.surefire.debug=...` 端口 5005）https://www.jetbrains.com/help/idea/work-with-tests-in-maven.html

### 1.4 用例级状态流：SM Test Runner + TeamCity service messages（带 nodeId 树 + expected/actual diff），委托时走 Gradle 事件 / surefire XML

- 内部 runner 的 wire 协议是 **TeamCity service messages**（转义后 `##teamcity[...]`）：`MapSerializerUtil.asString` 生成 `testStarted / testFinished / testFailed / testIgnored / testStdOut / testSuiteStarted / testSuiteFinished / suiteTreeStarted / suiteTreeEnded / suiteTreeNode / rootName`，`|` 转义。JUnit5 运行时（`JUnit5TestExecutionListener` → `ExecutionState` → `TeamCityTestReporter` / `TestReporter`）与 JUnit4 运行时（`com.intellij.rt.execution.junit`）共用同一批常量。
- 关键字段：`testStarted/testFinished` 带 **`nodeId` / `parentNodeId`**（id-based 测试树，参数化每次调用是独立节点）、`duration`；失败 `testFailed` 带 **expected/actual comparison diff**（`ComparisonFailureData.registerSMAttributes` → `expected: <`/`actual: <`）+ 栈；套件树先 `suiteTreeNode` 打树再跑。服务消息经 stdout/`-socket` 回 IDE，`GeneralTestEventsProcessor`（平台 SM Runner）构建 `SMTestProxy` 树 → Run tool window 的 Test Runner tab + gutter 状态回写 + 失败导航。
- 委托 Gradle：IDEA 走 Gradle 测试事件（Tooling API，与 CI 同），同样渲染进 SM 树；委托 Maven：`mvn test` 生成的 **surefire JUnit XML**（`target/surefire-reports/TEST-*.xml`）被解析进同一测试树（IDEA 的 Maven 测试解析器消费 surefire XML）。两通道都到「用例级状态」，只是 wire 不同。
- 来源：`MapSerializerUtil.java`（wire 常量 + 转义 + `##teamcity[...]` 拼装）https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/java-runtime/src/com/intellij/rt/execution/junit/MapSerializerUtil.java ；`JUnit5TestExecutionListener.java` https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/JUnit5TestExecutionListener.java ；`TestReporter.java`（nodeId/expected-actual/`valueSource`）https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/report/TestReporter.java ；SM runner 平台层（`GeneralTestEventsProcessor`）见本目录 `test-execution-vscode-jetbrains.md` §2.2 ；service messages 协议 https://www.jetbrains.com/help/teamcity/service-messages.html

### 1.5 断点时序

- debug launch → IDE 注入 jdwp **suspend=y** → 测试 JVM 启动即挂起（main 加载前）→ IDE attach（fork 场景经 fork socket 拿端口后 reattach）→ 断点已注册 → resume。与 VSCode 的 java-debug `suspend=y` 语义同构，保证首行断点命中；断点为项目级持久、可 mute/disable、有日志断点（suspend=n）。
- 来源：1.3 的 `starting-the-debugger-session.html` + `attach-to-process.html`；断点语义见本目录 `debug-idea.md` §4。

---

## 2. GoLand（IDEA 同源，Java 支持差异）

### 2.1 平台同源确认（机制层）

- GoLand 与 IDEA 同属 IntelliJ Platform，**测试 run/debug 的平台机制完全一致**：RunConfiguration + Executor（Run/Debug 同一配置，差异只是 executor 与调试器挂载）+ SM Test Runner（service messages → `GeneralTestEventsProcessor` → 测试树）。这部分与 `research/debug-idea.md`（JetBrains 系）结论完全复用，无需为 Go 单独重述。
- 来源：JetBrains 平台文档（run/debug configuration 模型）https://www.jetbrains.com/help/idea/run-debug-configuration.html ；本目录 `debug-idea.md` / `test-execution-vscode-jetbrains.md` §2。

### 2.2 Java：不提供（决定性证据）

- **`com.intellij.modules.java`（Java PSI + Test Framework，含 JUnit/TestNG）仅存在于 IntelliJ IDEA 与 Android Studio**；GoLand 分发的语言模块是 `org.jetbrains.plugins.go`（Go PSI + Test Framework）。Java 功能 2019.2 起从平台抽出为独立插件后，非 IDEA 系 IDE 不携带，Java 插件对 GoLand 也不兼容（插件加载按模块依赖判定）。
- 结论：**GoLand 无 JUnit gutter、无 Java 测试 runner、无 JDWP 集成** —— Java 单测 run/debug 在 GoLand 上「不可用」；这是分发层差异，不是平台能力差异（同一平台源码，只是没带 Java 模块）。
- 来源：IntelliJ Platform Plugin SDK 官方「Plugin Compatibility」模块表（`com.intellij.modules.java` → *IntelliJ IDEA, Android Studio*；`org.jetbrains.plugins.go` → *GoLand*）https://plugins.jetbrains.com/docs/intellij/plugin-compatibility.html

### 2.3 若 Java 存在会是怎样（机制推断）

- 同平台同源码，若 GoLand 加载 Java 模块，则其 JUnit run/debug 会与 IDEA 逐字节一致（1.1–1.5 全部适用）——但实际不提供，无实际意义。**对 4 家矩阵而言 GoLand 的 Java 行 = 「无 Java 能力」**。

### 2.4 对照：GoLand 的 Go 单测 run/debug（非 Java，仅作机制对照）

- 发现：Go 插件语义解析 `func TestXxx(t *testing.T)`（Go PSI）；Run：Go Test 配置（`gotest` 框架）直接 `go test`，**Pattern 字段即 `-run` 正则**（「表达式按 / 分成一系列正则」= Go `-run` 语义）；Debug：调试器是 **Delve**（`dlv`），GoLand 编译测试二进制或 `dlv` 启动并 attach（远端 `dlv --listen=:2345 --headless=true --api-version=2 exec ./myApp`），**无 JDWP（非 JVM）**；状态流：SM Test Runner + `go test -json` 解析；断点时序由 Delve 管理。
- 来源：GoLand Go Test 配置（gotest/gocheck/gobench + Pattern 正则）https://www.jetbrains.com/help/go/go-test.html ；Debugging https://www.jetbrains.com/help/go/debugging-code.html ；Delve attach（`dlv --headless --api-version=2`、DWARF 要求）https://www.jetbrains.com/help/go/attach-to-running-go-processes-with-debugger.html

---

## 3. Zed（Java 由扩展提供）

> 一手来源：zed.dev 文档 + `zed-extensions/java` 仓库（Rust 扩展：JDTLS 语言服务器 + 测试 runnables/tasks + 调试器 = `microsoft/java-debug` 的 fork）。

### 3.1 测试发现：tree-sitter 文本匹配（注解名正则 `Test$` + `Nested` 相等），非语义 `@Testable`

- `languages/java/runnables.scm`：方法声明带注解名匹配 `#match? @annotation_name "Test$"` —— 只要注解名以 `Test` 结尾（`@Test` / `@ParameterizedTest` / `@TestFactory` / `@RepeatedTest` 全命中）就出 gutter play 按钮；`@Nested` 内部类用 `#eq? @nested_annotation "Nested"` 显式匹配并拼 `Outer$Inner` 的 `$` 连接 FQCN。**不做 `@Testable` 元注解语义**（无法识别自定义组合注解；不区分参数化每次调用）。
- **`@ParameterizedTest` 不建模到调用级**：单测任务整方法跑（surefire `-Dtest=Class#method` / gradle `--tests Class.method`），树里无 invocation 子节点；`@Nested` 有专门 tag（`java-test-method-nested` / `java-test-class-nested`）。
- 来源：`runnables.scm` https://raw.githubusercontent.com/zed-extensions/java/main/languages/java/runnables.scm

### 3.2 Run 走什么：构建工具整包过滤（tasks.json shell 脚本），输出进集成终端

- `languages/java/tasks.json` 定义四个标签任务：`java-main`（`mvn compile exec:exec -Dexec.args="-classpath %classpath <主类>"` / `gradle :module:run -PmainClass=...`）、`java-test-method`（**`mvn test -Dtest="pkg.Class#method"`** / **`gradle test --tests "pkg.Class.method"`**）、`java-test-class`（`-Dtest="pkg.Class"` / `--tests "pkg.Class"`）、`java-test-all`（`mvn test` / `gradle :module:test`）。**classpath 完全来自构建工具**（Maven 的 `%classpath`、Gradle 模块模型），没有直接 JUnit runner。
- 输出 = 任务 → **集成终端**（`reveal: "always"`），**无测试树、无用例级状态 UI**。Windows 官方明示 shell 脚本仅 Mac/Linux（`/bin/sh`），Windows 需自写任务脚本。
- 来源：`tasks.json` https://raw.githubusercontent.com/zed-extensions/java/main/languages/java/tasks.json ；Java 语言页（tasks/Debug/Windows 说明）https://zed.dev/docs/languages/java ；Tasks 文档 https://zed.dev/docs/tasks

### 3.3 Debug 挂 JDWP：adapter 管（复用 java-debug fork，DAP 服务器跑在 JDTLS JVM 内），Zed 只做 DAP 客户端

- 调试器形态：`zed-extensions/java` 注册 `[debug_adapters.Java]`（`extension.toml` 无 `[debug_locators.*]`），`src/debugger.rs` 下载 **`com.microsoft.java.debug.plugin` 的 fork**（`zed-industries/java-debug`，v0.53.2 jar），`start_session()` 向 JDTLS 发 LSP 命令 **`vscode.java.startDebugSession`** 拿到 TCP 端口，Zed 作为 DAP 客户端连该端口 —— **DAP 服务器 = java-debug，运行在 JDTLS 的 JVM 进程里**（与 VSCode 的 JavaDebugServer 完全同一血统）。
- launch 配置即 java-debug 的 launch：`mainClass` / `projectName` / `args` / `vmArgs` / **`classPaths`（`$Test` 作用域）** / `stopOnEntry` / **`noDebug`** / `console`；attach 配置：`hostName` + `port`（用户先 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005` 起 JVM 再 attach）。**JDWP 注入 + attach 由 adapter（java-debug）管**，与 VSCode 相同：launch 时 `-agentlib:jdwp=...,suspend=y` 注入 + JDI attach。
- **测试调试现状**：Zed 的「automatic scenario creation」只覆盖 Rust/Go/Python/JS/TS，**不含 Java**；Java 无 gutter 调试按钮，调试测试需手写 `.zed/debug.json`（launch 主类 / 对 surefire 或 Gradle fork 的测试 JVM attach）。Gradle 项目有 `gradle-bridge`（protobuf over JSON-RPC）喂 Gradle 项目模型给语言服务器。
- 来源：`src/debugger.rs` https://raw.githubusercontent.com/zed-extensions/java/main/src/debugger.rs ；`extension.toml` https://raw.githubusercontent.com/zed-extensions/java/main/extension.toml ；`debug_adapter_schemas/Java.json`（launch/attach 字段、`$Test` scope、`noDebug`）https://raw.githubusercontent.com/zed-extensions/java/main/debug_adapter_schemas/Java.json ；Zed Debugger 文档（adapter 由扩展提供、automatic scenario 语言清单、`.zed/debug.json`）https://zed.dev/docs/debugger ；Debugger Extensions 文档 https://zed.dev/docs/extensions/debugger-extensions ；Java 语言页 Debugging 节 https://zed.dev/docs/languages/java

### 3.4 用例级状态流：无（纯终端任务输出）；Debug 会话走 DAP

- 测试 run 结果 = 终端里的 surefire/Gradle 文本输出（含 `.txt/.xml` 报告落盘），**无逐用例状态回传 API、无测试树、无失败导航**；debug 会话的状态（线程/栈/断点/变量）走 DAP，与测试协议无关。这是 Zed 相对 VSCode/IDEA 的主要取舍（成本低，但用例级 ✓/✗ 与失败跳转缺失）。
- 来源：Tasks 文档（「spawn commands using its integrated terminal to output the results」）https://zed.dev/docs/tasks ；本目录 `test-execution-zed-others.md` §1.2

### 3.5 断点时序

- launch 调试 = java-debug 注入 `suspend=y` → JVM 挂起 → DAP attach → 断点下发 → resume，与 VSCode 完全一致；测试调试（attach surefire/Gradle 调试端口）则完全由用户起 JVM 的时机决定（suspend=n 常见，需用户自己卡时机）。`stopOnEntry` 等价「入口断点」。
- 来源：`debug_adapter_schemas/Java.json`（`stopOnEntry` / `suspend` 语义由 java-debug 实现，见 VSCode 调研 §3）

---

## 4. VSCode（结论指针，详见 `research/test-debug-java.md`）

- 发现：JDT 语言服务器语义分析，JUnit5 判定 `org.junit.platform.commons.annotation.Testable` 元注解（递归注解层级），`@Nested`/`@ParameterizedTest` 建模到 invocation 级；TestItem 树由 TS 客户端建。
- Run：与 Debug 同一条 DAP launch 链，`noDebug` 单标志分叉；命令是 `java -cp <runner jar + 项目 classpath> <JUnit runner> -port <socket> -test/-testNameFile/-uniqueId ...`，**不调 mvn/gradle**（classpath 由 JDT 从 m2e/默认 provider 给）。
- Debug：`vscode-java-debug` 的 DAP 服务器（Java 写的 `com.microsoft.java.debug.core`）跑在 JDTLS JVM 里，DAP over TCP；launch 时 adapter 注入 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<port>` 再 JDI attach。
- 状态流：编辑器内走 runner→IDE 的 **socket 事件帧**（testStart/End/Failed + duration + expected/actual diff + JUnit5 UniqueId），构建工具走 **surefire/Gradle JUnit XML**（每用例一个 `<testcase>`）。
- 断点时序：`suspend=y` 保证 attach 先于执行。

---

## 5. 四家对比矩阵表

| 维度 | VSCode（Test Runner for Java） | IDEA（IntelliJ IDEA） | GoLand | Zed（Java 扩展） |
|---|---|---|---|---|
| **① 测试发现** | 语义：JDT 语言服务器；JUnit5 判 `@Testable` 元注解（递归注解层级）+ `@Nested`/`@ParameterizedTest` 建模到 invocation 级（UniqueId） | 语义：PSI；`JUnitUtil.isJUnit5TestClass` 直接查 `@Testable` 元注解（`MetaAnnotationUtil` 沿注解层级），`@Nested` 内部类、`@ExtendWith`、JUnit4 `@RunWith`/`TestCase`/`test*`；参数化每次调用独立节点，可 `selectIteration`/`selectUniqueId` 单跑 | **无 Java（模块不存在）**；Go 走 Go PSI 语义（`func Test*`） | 文本：tree-sitter `runnables.scm` 注解名正则 `Test$` + `@Nested` 相等；**无 `@Testable` 语义**；参数化整方法跑、不建模 invocation |
| **② Run 载体** | 直接 `java -cp … <JUnit runner>`（同一 DAP launch，`noDebug` 分叉）；不调 mvn/gradle | 默认内部 JUnit runner（`JUnit5IdeaTestRunner`/junit-rt，`-socket<port> -test <selectors>`）；**Gradle 项目默认委托 Gradle**（`test --tests`），Maven 默认内部 runner、可委托 `mvn test -Dtest=` | 无 Java；Go 直接 `go test`（Go Test 配置，`-run` 正则） | 构建工具任务（tasks.json shell）：`mvn test -Dtest=Class#method` / `gradle test --tests Class.method`，输出进终端 |
| **③ classpath 来源** | JDT（m2e classpath provider / 默认 provider，取自 Maven/Gradle 模型） | 模块 test classpath（Maven/Gradle 导入的模块模型）+ `idea_rt.jar`；委托时构建工具管 | — | 构建工具（Maven `%classpath` / Gradle 模块模型，经 gradle-bridge） |
| **④ Debug 挂 JDWP** | **adapter 管**：java-debug（Java 写的 DAP 服务器，跑在 JDTLS JVM 里）注入 `-agentlib:jdwp=...,server=y,suspend=y,address=<port>` + JDI attach | **IDE 管**：注入 debug agent VM option（suspend=y）；fork 的测试 JVM 经 fork socket 报端口 → `DebugProcessImpl.reattach`（自带 JDI）；attach 模式连已起 agent 的 JVM | 无 Java；Go 用 Delve（非 JDWP） | **adapter 管**：java-debug fork（同一 jar/协议，DAP 服务器跑在 JDTLS JVM 内，经 `vscode.java.startDebugSession` LSP 取端口）；launch 注入 + attach 同 VSCode |
| **⑤ 用例级状态流** | runner→IDE **socket 事件帧**（testStart/End/Failed + duration + diff + UniqueId）；构建工具走 surefire/Gradle JUnit XML | **TeamCity service messages**（`##teamcity[testStarted/testFailed/testFinished/...]`，nodeId/parentNodeId id-based 树 + expected/actual diff + duration）→ SMTestProxy 树；委托时走 Gradle 事件 / surefire XML | 无 Java；Go 走 SM runner + `go test -json` | **无**（纯终端文本输出；debug 会话走 DAP 状态） |
| **⑥ 断点时序** | `suspend=y` → attach → 断点下发 → resume（首行命中） | 同左（suspend=y + reattach） | —（Delve 管理） | 同左（java-debug）；但测试调试需手动 launch/attach，无 gutter 调试 |

> 共同点：**Java 断点时序四家（有 Java 能力的三家）完全一致 —— JDWP `suspend=y` 注入 + attach 先于执行**；差异只在「谁注入」（adapter vs IDE 自带调试器）。

---

## 6. 对 Neeko 的可借鉴点（3 条）

1. **测试发现的「语义 vs 文本」分界决定用例建模上限**：IDEA/VSCode 用语言层 `@Testable` 元注解语义（PSI/JDT），把 `@ParameterizedTest`/`@Nested`/组合注解精确建模到调用级；Zed 用 tree-sitter 文本（注解名正则 `Test$` + `Nested` 相等），代价是漏组合注解、且无法区分参数化每次调用（整方法跑）。**Neeko 若接 Java：首期可学 Zed 的文本/语法方案（成本最低、能覆盖 `@Test`/`@ParameterizedTest` 方法级），但要明确放弃 invocation 级建模；要精确必须上语言服务器（jdtls）/编译器语义** —— 这与 rust-analyzer 语义发现、Neeko 文本检测的既有判断一致。
2. **Java 调试器可整包复用，不必自研 JDWP**：VSCode、Zed 都直接复用 `microsoft/java-debug`（Java 写的 DAP 服务器，随语言服务器 JVM 跑，`vscode.java.startDebugSession` 取端口）；IDEA 只是用自带 JDI 实现同样语义。**Neeko 若给 Java 加 run/debug 按钮，最小路径是 spawn JUnit Platform Console Launcher（run）+ 复用 java-debug DAP 服务器（debug），JDWP 注入与 attach 全交给它**，与既有 lldb adapter 形态（adapter 管 launch/attach）同构。
3. **用例级状态流必须走结构化通道**：IDEA 内部 runner 用 TeamCity service messages（nodeId 树 + expected/actual diff），VSCode 用 runner socket 帧，委托构建工具时都收敛到 JUnit XML；**Zed 没有用例级状态（纯终端）是明显短板**。Neeko 若做 Java 用例级 ✓/✗，直接消费 surefire/Gradle JUnit XML 或自定义等价事件协议即可，避免从 human 终端输出反推用例状态 —— 与既有 `test-debug-java.md` 可借鉴点 3 结论一致。

---

## 来源清单

**IDEA / JetBrains 平台**
- `JUnitUtil.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/junit/JUnitUtil.java
- `JUnitTestFramework.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/junit/JUnitTestFramework.java
- `JavaTestFrameworkRunnableState.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/JavaTestFrameworkRunnableState.java
- `JavaTestFrameworkDebuggerRunner.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/execution/impl/src/com/intellij/execution/JavaTestFrameworkDebuggerRunner.java
- `JUnit5IdeaTestRunner.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/JUnit5IdeaTestRunner.java
- `JUnit5TestRunnerHelper.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/JUnit5TestRunnerHelper.java
- `JUnit5TestExecutionListener.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/JUnit5TestExecutionListener.java
- `CollectInvocationsInterceptor.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/CollectInvocationsInterceptor.java
- `TestReporter.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/plugins/junit5_rt/src/com/intellij/junit5/report/TestReporter.java
- `MapSerializerUtil.java`：https://raw.githubusercontent.com/JetBrains/intellij-community/master/java/java-runtime/src/com/intellij/rt/execution/junit/MapSerializerUtil.java
- IDEA 文档：JUnit 配置 https://www.jetbrains.com/help/idea/run-debug-configuration-junit.html ；Gradle 测试 https://www.jetbrains.com/help/idea/work-with-tests-in-gradle.html ；Maven 测试 https://www.jetbrains.com/help/idea/work-with-tests-in-maven.html ；调试会话 https://www.jetbrains.com/help/idea/starting-the-debugger-session.html ；attach https://www.jetbrains.com/help/idea/attach-to-process.html ；run/debug 配置模型 https://www.jetbrains.com/help/idea/run-debug-configuration.html
- TeamCity service messages：https://www.jetbrains.com/help/teamcity/service-messages.html

**GoLand**
- IntelliJ Platform 模块兼容表（`com.intellij.modules.java` → IDEA/Android Studio；`org.jetbrains.plugins.go` → GoLand）：https://plugins.jetbrains.com/docs/intellij/plugin-compatibility.html
- GoLand Go Test 配置：https://www.jetbrains.com/help/go/go-test.html ；Debugging：https://www.jetbrains.com/help/go/debugging-code.html ；Delve attach：https://www.jetbrains.com/help/go/attach-to-running-go-processes-with-debugger.html

**Zed**
- Java 语言页（JDTLS、Debugging、Windows 任务限制）：https://zed.dev/docs/languages/java ；Debugger：https://zed.dev/docs/debugger ；Debugger Extensions：https://zed.dev/docs/extensions/debugger-extensions ；Tasks：https://zed.dev/docs/tasks
- `zed-extensions/java`：`runnables.scm` https://raw.githubusercontent.com/zed-extensions/java/main/languages/java/runnables.scm ；`tasks.json` https://raw.githubusercontent.com/zed-extensions/java/main/languages/java/tasks.json ；`src/debugger.rs` https://raw.githubusercontent.com/zed-extensions/java/main/src/debugger.rs ；`debug_adapter_schemas/Java.json` https://raw.githubusercontent.com/zed-extensions/java/main/debug_adapter_schemas/Java.json ；`extension.toml` https://raw.githubusercontent.com/zed-extensions/java/main/extension.toml

**VSCode / 关联调研**
- 本文引用的 VSCode 侧完整调研：`research/test-debug-java.md`（同目录）
- JetBrains 平台执行链 / SM runner / service messages：`research/test-execution-vscode-jetbrains.md` §2、`research/debug-idea.md`
- Zed 任务式执行与结果协议横评：`research/test-execution-zed-others.md`
