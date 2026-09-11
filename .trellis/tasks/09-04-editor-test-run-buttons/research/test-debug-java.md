# Java 单元测试运行 / 调试业界调研（VSCode Test Runner for Java + vscode-java-debug）

> 范围：VSCode 侧 JUnit 单测 run/debug 的完整链路（Test Runner for Java = `vscode-java-test`，调试器 = `vscode-java-debug`，DAP 服务器源码在 `microsoft/java-debug`）。回答五个问题：run 走什么命令与用例过滤；Java DAP adapter 形态与 launch 的 JDWP 时序；JDWP 原理与 attach 衔接；JUnit 5 注解如何被检测；测试输出 / 用例级状态从哪来。
> 方法：web_search 全 providers 被限流 → 直读官方文档 + 一手源码（Microsoft 三个仓库：`vscode-java-test`（TS 客户端 + JDT 插件 + JUnit runner）、`vscode-java-debug`（TS 客户端）、`java-debug`（DAP 服务器，Java））。每条结论附来源。

---

## 1. run 与 debug 流程：命令形态与用例过滤

### 1.1 总管线：Run 与 Debug 同源，都走 DAP launch（`noDebug` 单标志分叉）

**结论：编辑器内联单测的 Run 和 Debug 走的是同一条 DAP 启动链，不是各自 spawn 两条命令。分叉点只在 launch 请求里的 `noDebug` 布尔字段。**

- `testController.ts` 用同一个 `runHandler` 创建三个 profile（`Run Tests` / `Debug Tests` / `Run Tests with Coverage`），handler 里 `isDebug = !!request.profile.label.includes('Debug')`：
  https://github.com/microsoft/vscode-java-test/blob/main/src/controller/testController.ts
- 真正的执行在 `BaseRunner.run()`：它起一个**本地 TCP socket server**（`startSocketServer()`，`127.0.0.1:0` 随机端口，结果协议回传用），然后调用 `vscode.debug.startDebugging(workspaceFolder, launchConfiguration)`——**Run 也通过 Debug API 启动**，区别是 `launchConfiguration.noDebug = !testContext.isDebug`；`console` 强制 `internalConsole`（集成终端跑会立刻终止会话，注释说明）：
  https://github.com/microsoft/vscode-java-test/blob/main/src/runners/baseRunner/BaseRunner.ts
- 结果回流：Debug 会话的 DAP `output` 事件经 `DebugAdapterTracker` 镜像进 Test Results（`appendOutput`）；用例级状态由 runner 通过 socket 回传（见 §6）。
- 与 Neeko 设计基准对比：这正是「描述统一、载体分离」的极端版——连 run 都复用 debug 会话形态，run 只是「不带调试器」的 launch。rust-analyzer 的 run/debug 分叉逻辑见 `research/debug-vscode.md` §1。

### 1.2 命令构造：不调 Maven/Gradle，直接 `java -cp …` 启动 JUnit runner

**结论：gutter 单测执行**不**走 `mvn test -Dtest=` / `gradle test --tests=`。真正执行的命令是**在 DAP launch 里由 java-debug 拼出的 `java` 命令**，`mainClass` 是 JUnit runner（Eclipse JDT 的标准 JUnit runner），classpath 由 JDT 语言服务器提供。Maven/Gradle 只贡献「classpath / 构建模型」，不参与单测的执行进程。**

三层链路：

```
vscode-java-test (TS)  ──debug.startDebugging({type:'java', request:'launch', noDebug})──►
  java-debug DAP 服务器 (JVM)  ──spawn java -cp <project classpath + runner jar> <runner mainClass> <过滤参数>──►
    被调试 JVM 内跑 Eclipse JUnit runner → socket 协议回传结果
```

- launch 配置组装在 `launchUtils.ts`：`type:'java'`、`request:'launch'`、`mainClass: launchArguments.mainClass`（来自 JDT 的 `vscode.java.test.junit.argument` 解析，§1.3）、`classPaths/modulePaths`、`args: launchArguments.programArguments`、`noDebug: !isDebug`、`vmArgs`、`cwd`、`env`；TestNG 分支显式把 mainClass 换成自家 `com.microsoft.java.test.runner.Launcher` 并追加 `com.microsoft.java.test.runner-jar-with-dependencies.jar`：
  https://github.com/microsoft/vscode-java-test/blob/main/src/utils/launchUtils.ts
- 类路径来源：JDT 侧 `JUnitLaunchConfigurationDelegate.getJUnitLaunchArguments()` 复用 Eclipse `JUnitLaunchConfigurationDelegate.getVMRunnerConfiguration()`，**Maven 项目走 m2e classpath provider（`org.eclipse.m2e.launchconfig.classpathProvider`），Gradle 项目走默认 classpath provider**——即构建工具只决定 classpath 与构建，不决定测试执行方式：
  https://github.com/microsoft/vscode-java-test/blob/main/java-extension/com.microsoft.java.test.plugin/src/main/java/com/microsoft/java/test/plugin/launchers/JUnitLaunchConfiguration.java
  https://github.com/microsoft/vscode-java-test/blob/main/java-extension/com.microsoft.java.test.plugin/src/main/java/com/microsoft/java/test/plugin/launchers/JUnitLaunchConfigurationDelegate.java

最终 `java` 命令形态（run 无 jdwp，debug 带 jdwp，见 §3）：

```
java [-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<port>] \
     [-cp <runner jar + 项目 classpath>] <runner mainClass> \
     -port <socket> -test <FQCN>:<method>(<paramTypes>) [-uniqueId <id>] \
     | -testNameFile <file> [--include-tag/--exclude-tag <tag>]
```

> 说明：`mainClass` 由 Eclipse JDT 的 JUnit launch 委托给出（Eclipse 标准 JUnit runner 主类，即 `org.eclipse.jdt.internal.junit.runner.RemoteTestRunner`），JUnit 场景下 vscode-java-test 自己只额外补 `-port`（`JunitRunner.run()` 替换/追加 `-port <socketPort>`）：https://github.com/microsoft/vscode-java-test/blob/main/src/runners/junitRunner/JunitRunner.ts

### 1.3 用例过滤：runner 参数协议（`-test` / `-testNameFile` / `-uniqueId`），不是 `-Dtest` / `--tests`

**结论：编辑器内联过滤用的是「runner 自己的命令行参数」，由 JDT 把选中的 TestItem 翻译成：**

- 单方法：`-test <com.example.MyTest:testFoo>`（JUnit5 带参数的方法会拼成 `testFoo(java.lang.String,int)` 形参签名）；单 invocation 重跑再加 `-uniqueId <id>`（JUnit5 的 UniqueId，可精确定位参数化某次调用）。
- 多方法共享一个 JVM：`-testNameFile <临时文件>`（每行一个 `Class:method(params)`）；类级：`-testNameFile <临时文件>`（每行一个类名）——**刻意合并到同一 JVM 复用 `@BeforeAll/@AfterAll` 与缓存 fixture（如 Spring ApplicationContext）**，见 `testController.mergeTestMethods()` 与 `JUnitLaunchConfigurationDelegate.addTestItemArgs()`：
  https://github.com/microsoft/vscode-java-test/blob/main/src/controller/testController.ts
  https://github.com/microsoft/vscode-java-test/blob/main/java-extension/com.microsoft.java.test.plugin/src/main/java/com/microsoft/java/test/plugin/launchers/JUnitLaunchConfigurationDelegate.java
- Tag 过滤：JUnit5/6 追加 `--include-tag` / `--exclude-tag <tag>`（`java.test.config` 的 `filters.tags`）：https://github.com/microsoft/vscode-java-test/blob/main/src/utils/launchUtils.ts
- 协议边界：旧版 JDT 不支持多方法（`eclipse.jdt.ui#2975` 前的协议），`JUnitLaunchConfigurationDelegate` 抛 `MULTI_METHOD_LAUNCH_UNSUPPORTED` 前缀错误，TS 侧**静默回退成逐个方法各起一个 JVM**（`runItemInIsolatedLaunch`）：https://github.com/microsoft/vscode-java-test/blob/main/src/controller/testController.ts

**Maven `-Dtest` / Gradle `--tests` 是什么（对照，非编辑器路径）：**

- Maven Surefire 跑 test phase 时按 `-Dtest` 过滤：`mvn -Dtest=TestCircle#mytest test`（类 + 方法；`#` 方法语法仅 JUnit 4.x / TestNG，支持 `*` 通配、`!` 排除、多个逗号分隔）：
  https://maven.apache.org/surefire/maven-surefire-plugin/examples/single-test.html
- Gradle `Test` 任务过滤用 `--tests`：`./gradlew test --tests "com.mygreeting.app.SomeTest.someMethod"`（FQCN 类名或 `类名.方法名`，支持 `*`）：
  https://docs.gradle.org/current/userguide/java_testing.html（"Test filtering" 节）
- 二者都是「构建工具整包跑测试」场景的过滤；编辑器内联单测走 §1.2 的直接 spawn runner 路径。

---

## 2. Java DAP adapter 形态：Java 写的 DAP 服务器（JVM 内进程 + TCP socket）

**结论：`vscode-java-debug` 的调试器（debug adapter）是 Java 编写的 DAP 服务器（`com.microsoft.java.debug.core`，仓库 `microsoft/java-debug`，官方描述 "The debug server implementation for Java. It conforms to DAP"），它**不是** VSCode spawn 的一个独立可执行文件，而是运行在** Java 语言服务器（JDT.LS）的 JVM 进程里**，DAP 走 TCP socket。**

- TS 侧 `JavaDebugAdapterDescriptorFactory.createDebugAdapterDescriptor()`：调 `startDebugSession()`（= 向语言服务器发 `java.startDebugSession` 命令），拿到端口后返回 `new DebugAdapterServer(debugServerPort)`——即 DAP 客户端（VSCode 内核）连到这个端口，adapter 是**服务端**：
  https://github.com/microsoft/vscode-java-debug/blob/main/src/javaDebugAdapterDescriptorFactory.ts
  https://github.com/microsoft/vscode-java-debug/blob/main/src/languageServerPlugin.ts
- Java 侧 `JavaDebugServer`（plugin 模块内单例）：`new ServerSocket(0)` 绑随机端口，accept 后每连接跑一个 `ProtocolServer`（DAP 协议循环）；端口经 LSP 回给 TS 客户端：
  https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/JavaDebugServer.java
- 依赖 JVM：DAP 服务器本体是 Java（`com.microsoft.java.debug.core`），随 JDT.LS 语言服务器 JVM 运行，因此**必然需要 JVM 运行时**；它用 `com.sun.jdi`（JDK 自带的 JDI）作为与目标 JVM 通信的 API——JDI 是 JDWP 之上的 Java 客户端接口（见 §4）。

> 对 Neeko 的形态参考：Java 的方案不是「spawn 一个 DAP adapter 子进程」，而是「调试能力长在语言服务器进程里 + DAP over socket」。这与 Neeko 现有的 lldb adapter（独立进程）形态不同，但契约面（DAP）一致。

---

## 3. launch 请求的 JDWP 时序：adapter 自己注入 `agentlib:jdwp`（suspend=y），再 attach

**结论：launch 模式是「adapter 把 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<port>` 拼进被调试 JVM 的命令行 → spawn 进程 → 用 JDI 连接」；`noDebug`（run）则完全不加 jdwp。attach 模式才是连已经跑起来的 JVM。**

证据链（`LaunchRequestHandler`）：

1. 入口 `handle()`：`noDebug` → `LaunchWithoutDebuggingDelegate`；否则 `LaunchWithDebuggingDelegate`：
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/LaunchRequestHandler.java
2. 命令拼装 `constructLaunchCommands()`，**jdwp 注入是显式的**：
   ```java
   if (StringUtils.isNotEmpty(address)) {
       launchCmds.add(String.format(
           "-agentlib:jdwp=transport=dt_socket,server=%s,suspend=y,address=%s",
           serverMode ? "y" : "n", address));
   }
   ```
   即 debug 时**总是 `suspend=y`**（硬编码），`server` 方向取决于用哪种 JDI 连接器（见下）。
   同一文件。⚠️ **`suspend=y` 不是交给用户/构建工具配置的，是 adapter 每次注入的**——JVM 一启动就挂在 main 类加载前，等 adapter attach。
3. 默认 `internalConsole` 路径：`LaunchWithDebuggingDelegate.launch()` → `DebugUtility.launch()` → 走 JDI **`LaunchingConnector`**（`arguments.get(SUSPEND).setValue("true")`，显式 suspend=true）。Oracle 文档：CommandLineLaunch connector「launching the VM and specifying the necessary debug options are handled by the connector」——**连接器负责拼调试选项、spawn、并在 JVM 就绪后建立连接**：
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/LaunchWithDebuggingDelegate.java
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/DebugUtility.java
4. `integratedTerminal`/`externalTerminal` 路径：`launchInTerminal()` 走 JDI **`ListeningConnector`**：`startListening()` 拿 adapter 侧端口 → `constructLaunchCommands(serverMode=false, address)` 生成 **`server=n,suspend=y,address=<adapterPort>`**（JVM 是 JDWP 客户端，主动连回 adapter）→ `runInTerminal` 在终端里启动 → `listenConnector.accept()` 等 JVM 连入：
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/LaunchWithDebuggingDelegate.java
5. `noDebug`（run）路径：`LaunchWithoutDebuggingDelegate.launch()` → `constructLaunchCommands(…, /*address=*/null)` → **无 jdwp agent**，纯 `Runtime.exec` spawn，stdout/stderr 经 `ProcessConsole` 转 DAP `output` 事件；`postLaunch` 不发 `InitializedEvent`（避免前端发断点请求）：
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/LaunchWithoutDebuggingDelegate.java
6. 断点时序（JDWP 侧）：debug launch 后 `postLaunch` 发 DAP `InitializedEvent` → VSCode 发 `setBreakpoints` / `setExceptionBreakpoints` → 前端发 `configurationDone` → adapter 让 VM 继续。`suspend=y` 保证了「JVM 停在 main 加载前 → 断点注册 → 放行」的顺序，断点天然命中第一行：
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/LaunchWithDebuggingDelegate.java
7. attach 模式：`AttachRequestHandler` → `DebugUtility.attach()` → JDI **`SocketAttachingConnector`**（`hostname` + `port`）连已运行 JVM 的调试端口：
   https://github.com/microsoft/java-debug/blob/main/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/DebugUtility.java

**一句话时序（internalConsole，launch）：**
```
DAP launch 请求
  → adapter 选 LaunchingConnector，拼 java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<ephemeral> -cp … <mainClass> …
  → spawn JVM（JVM 起 jdwp agent，main 加载前挂起）
  → adapter 经 JDI attach（或 accept）到该端口，VM 连接建立
  → adapter 发 InitializedEvent；VSCode 下发断点；configurationDone → VM 开始跑
```

---

## 4. JDWP 调试原理与 attach 衔接

**结论：JDWP 是调试器与目标 JVM 之间的线协议，目标 JVM 侧由 `-agentlib:jdwp` 加载的 agent 实现（基于 JVM TI/JNI），调试器侧用 JDI（`com.sun.jdi`，JDK 内置 API）。`server`/`suspend`/`address` 三个子选项决定连接方向与挂起时机。**

官方语义（Oracle JDPA 文档原文要点）：

- `-agentlib:jdwp=[transport,][server,][suspend,][address,][timeout,…]`：加载 JPDA 参考实现的 JDWP agent；`transport` 必填（`dt_socket` / `dt_shmem`）。
- `server=y`：**目标 VM 监听**，等调试器来 attach；`server=n`（默认）：目标 VM **主动连**指定 `address`（调试器是服务端）。
- `suspend`（默认 `y`）：`y` → VMStartEvent 的 suspendPolicy 为 SUSPEND_ALL，**main 类加载前整机挂起**；`n` → SUSPEND_NONE。
- 官方例子：`-agentlib:jdwp=transport=dt_socket,server=y,address=8000` → 在 8000 端口监听（仅 loopback），main 加载前挂起，调试器连接后可发 JDWP 命令 resume。
- 连接器（JDI 侧）：`CommandLineLaunch`（spawn + attach，`suspend` 默认 true）、`SocketListen`（调试器监听，目标 `server=n` 连入）、`SocketAttach`（attach 已运行 VM）、`ProcessAttach`（按 pid attach，Java 6+）：
  https://docs.oracle.com/en/java/javase/17/docs/specs/jpda/conninv.html

**与 java-debug 的衔接映射：**

| 方向 | JDWP 子选项 | 谁当服务端 | java-debug 用法 |
|---|---|---|---|
| launch（internalConsole） | `server=y, suspend=y, address=<ephemeral>` | 目标 JVM | JDI `LaunchingConnector` spawn + attach（§3.3） |
| launch（terminal console） | `server=n, suspend=y, address=<adapterPort>` | DAP adapter | JDI `ListeningConnector` + `accept()`（§3.4） |
| attach 已运行进程 | `server=y` 已开着的端口 | 目标 JVM | JDI `SocketAttachingConnector`（§3.7） |
| run（noDebug） | 无 jdwp | — | 纯 spawn（§3.5） |

**构建工具对照（印证同一 agent 语法）**：Maven Surefire 调试即注入同一串参数——`mvn -Dmaven.surefire.debug="-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=localhost:8000" test`（缺省端口 5005，fork 的测试 JVM 自动挂起等远程调试器）：
https://maven.apache.org/surefire/maven-surefire-plugin/examples/debugging.html

> 对 Neeko：Java 的 launch=「注入调试 agent + spawn + attach」与 Rust 的 lldb `launch`（program + args）在**契约上同构**——都是「adapter 构造完整命令并负责让被调试进程停到断点就位」。差别只是 Java 的 agent 注入参数是 `-agentlib:jdwp`，Rust 是 lldb 接管进程；真正「attach」在两边都是「连已运行进程」。

---

## 5. 用例检测：JUnit 5 注解由谁解析

**结论：VSCode 不做文本/正则扫描，测试发现（test discovery）全部委托给 JDT 语言服务器（Eclipse JDT）做「类型解析后的语义分析」。JUnit5 的判定核心是 `@Testable` 元注解（`@Test` / `@ParameterizedTest` / `@RepeatedTest` / `@TestFactory` / `@TestTemplate` 都（间接）标注它），并沿注解层级展开支持组合注解与 `@Nested`。**

- TS 侧只发 workspace command（`java.execute.workspaceCommand` + `vscode.java.test.*`），不碰 AST：
  - `findJavaProjects` → 项目根；`findTestPackagesAndTypes` / `findDirectTestChildrenForClass` / `findTestTypesAndMethods` / `resolvePath` → 包 / 类 / 方法级 TestItem：
  https://github.com/microsoft/vscode-java-test/blob/main/src/controller/utils.ts
  https://github.com/microsoft/vscode-java-test/blob/main/src/constants.ts（命令名常量）
- JDT 侧 `JUnit5TestSearcher`：
  - `isTestMethod(IMethodBinding)`：排除 abstract / static / private / 构造器；方法注解命中 `org.junit.platform.commons.annotation.Testable`（`JUNIT_PLATFORM_TESTABLE`）即判为测试方法。
  - `findAnnotation()` 会递归查注解的注解层级（`matchesNameInAnnotationHierarchy`）→ **自定义组合注解 / `@Nested` 也能识别**。
  - `isTestClass(IType)` 直接调 Eclipse JDT 自带 `org.eclipse.jdt.internal.junit.launcher.JUnit5TestFinder`。
  - `@DisplayName` 用作展示名；**生命周期注解（`@BeforeEach` / `@BeforeAll` / `@AfterEach` / `@AfterAll`）不单独作为用例**——它们是类级执行钩子，随测试类一起跑，不是"测试方法"：
  https://github.com/microsoft/vscode-java-test/blob/main/java-extension/com.microsoft.java.test.plugin/src/main/java/com/microsoft/java/test/plugin/searcher/JUnit5TestSearcher.java
- JUnit4 同理走 `JUnit4TestSearcher`（判定 `org.junit.Test`、`org.junit.runner.RunWith` 等），TestNG 走 `TestNGTestSearcher`。JDT 侧的 `JUnit5TestFinder` 需要**类型绑定可解析**（注解在 classpath 上），所以是语义级而非源码级检测。

> 对 Neeko：Java 需要语言服务器级别的解析才能把 `@ParameterizedTest` 这类「方法即多个用例」正确建模（方法级 TestItem 之下还有 Invocation 级子项，见 §6）；Neeko 的 TS/Rust 文本检测（`test(` / `#[test]` 属性行）只适合语法简单、用例与方法一一对应的场景——这正是 rust-analyzer 走语义（LSP `runTest`）而 Neeko 首期走文本的原因之一。Java 若要接，最小可行路径是「正则找 `@Test` 类方法」但会漏 `@ParameterizedTest`/`@TestFactory`/`@Nested` 的精确用例建模。

---

## 6. 测试输出与用例级状态：runner socket 协议（编辑器内）+ JUnit XML（构建工具/CI）

### 6.1 VSCode 编辑器内：runner 的 socket 事件协议（不是 JUnit XML）

**结论：用例级状态（start / pass / fail / skip + 耗时 + 失败详情）来自「runner 进程 → VSCode 的 TCP socket 事件流」，`JUnitRunnerResultAnalyzer` 按帧解析并驱动 `TestRun.started/passed/failed/skipped`。**

- 传输：`BaseRunner` 起本地 socket，端口以 `-port` 传给 runner；runner 把事件帧写回 socket（`Launcher.java` 里 `TestOutputStream` 连 `127.0.0.1:<port>`）。失败帧的栈与 expected/actual 负载也走同一 socket。
  https://github.com/microsoft/vscode-java-test/blob/main/java-extension/com.microsoft.java.test.runner/src/main/java/com/microsoft/java/test/runner/Launcher.java
- 解析：`JUnitRunnerResultAnalyzer.processData()` 按 `@`-前缀控制帧分派——`testTree` / `testStart` / `testEnd` / `testFailed` / `testError` / `traceStart-End` / `expectStart-End` / `actualStart-End`；`testEnd` 时按帧内容定 Passed / Skipped（`@Ignore`、assumption failure）/ Failed / Errored，并算耗时（`@RepeatedTest` 多次执行分别计时）；失败附 stacktrace 与 expected/actual diff（`TestMessage.diff`）：
  https://github.com/microsoft/vscode-java-test/blob/main/src/runners/junitRunner/JUnitRunnerResultAnalyzer.ts
- JUnit5 用例 id（协议里识别谁是谁）：`[engine:junit5]/[class:com.example.MyTest]/[method:myTest]/[test-template:myTest(String\, int)]` 以及 `[nested-class:…]` / `[test-factory:…]` / `[test-template-invocation:…]` / `[dynamic-test:…]` ——即**参数化测试的每次调用、`@Nested` 内类、`@TestFactory` 动态用例在协议里都是独立用例节点**（对应 TestItem 的 Invocation 级子项）：
  https://github.com/microsoft/vscode-java-test/blob/main/src/constants.ts（`JUnitTestPart`）

### 6.2 构建工具报告：Surefire / Gradle 的 JUnit XML（用例级结果标准）

**结论：`mvn test` / `gradle test` 把「每个用例一个节点」写进 JUnit XML，是跨工具（JUnit 4/5 + TestNG）的用例级结果标准格式，编辑器/CI 均可消费。**

- **Maven Surefire**：test phase 生成两类报告（纯文本 `.txt` + XML），默认 `${basedir}/target/surefire-reports/TEST-*.xml`（每测试类一个文件），有官方 XSD schema（`surefire-test-report.xsd`）；XML 内含每用例 `<testcase name= classname= time=>` 与失败 `<failure type= message=>` / `<error>` / `<skipped>` 节点：
  https://maven.apache.org/surefire/maven-surefire-plugin/（"It generates reports in two different file formats: Plain text files (*.txt), XML files (*.xml)… `${basedir}/target/surefire-reports/TEST-*.xml`"，schema 链接同页）
- **Gradle**：`Test` 任务默认生成「与 Ant JUnit report 兼容」的 XML（官方称为 "JUnit XML" pseudo standard，CI 常用），**默认 `build/test-results/<taskName>/`、每测试类一个文件**；可配 `outputPerTestCase`（输出按用例归属）、`mergeReruns`、`includeSystemOutLog/Err`：
  https://docs.gradle.org/current/userguide/java_testing.html（"Communicating test results to CI servers and other tools via XML files" 节）
- 关系：VSCode 编辑器内走的是 §6.1 的 socket 协议（实时、带 diff/栈定位），构建工具的 XML 是「整包跑测试 / CI 归档」场景的用例级结果；两者都提供用例级状态，只是通道不同。对 Neeko 的启示：**用例级状态必须有机器可读通道**（事件流或结构化 XML），human-parse 终端文本只适合展示不适合断言。

---

## 来源清单

**VSCode Test Runner for Java（`microsoft/vscode-java-test`）**
- TS 客户端：`src/controller/testController.ts`、`src/controller/utils.ts`、`src/runners/baseRunner/BaseRunner.ts`、`src/runners/junitRunner/JunitRunner.ts`、`src/runners/junitRunner/JUnitRunnerResultAnalyzer.ts`、`src/utils/launchUtils.ts`、`src/constants.ts`
- JDT 插件 / runner（`java-extension/`）：`com.microsoft.java.test.plugin/…/searcher/JUnit5TestSearcher.java`、`…/launchers/JUnitLaunchConfiguration.java`、`…/launchers/JUnitLaunchConfigurationDelegate.java`、`com.microsoft.java.test.runner/…/Launcher.java`
- 统一 base：https://github.com/microsoft/vscode-java-test

**Java DAP 调试器**
- TS 客户端（`microsoft/vscode-java-debug`）：`src/javaDebugAdapterDescriptorFactory.ts`、`src/languageServerPlugin.ts` —— https://github.com/microsoft/vscode-java-debug
- DAP 服务器（`microsoft/java-debug`）：`com.microsoft.java.debug.core/…/handler/LaunchRequestHandler.java`、`LaunchWithDebuggingDelegate.java`、`LaunchWithoutDebuggingDelegate.java`、`DebugUtility.java`、`com.microsoft.java.debug.plugin/…/internal/JavaDebugServer.java` —— https://github.com/microsoft/java-debug

**官方文档**
- Oracle JDPA Connection and Invocation Details（JDWP/JDI 连接器与 `-agentlib:jdwp` 子选项语义）：https://docs.oracle.com/en/java/javase/17/docs/specs/jpda/conninv.html
- Maven Surefire：单测过滤 https://maven.apache.org/surefire/maven-surefire-plugin/examples/single-test.html ；报告/概述 https://maven.apache.org/surefire/maven-surefire-plugin/ ；调试 https://maven.apache.org/surefire/maven-surefire-plugin/examples/debugging.html
- Gradle Java 测试（过滤 / 报告 / JUnit XML）：https://docs.gradle.org/current/userguide/java_testing.html

---

## 对 Neeko 的可借鉴点（3 条）

1. **run/debug 同源 DAP launch、`noDebug` 单标志分叉**：Java 把「Run」也做成 `noDebug:true` 的 DAP launch（同一 launch 配置、同一 runner 进程、结果同一通道回传），分叉点只在是否带调试器——比 rust-analyzer 的「run 走任务 / debug 走调试会话」更极端地贴合 Neeko 设计基准 C1（描述统一、载体分离）。Neeko 的 `TestLaunchSpec` 里 `mode=run|debug` 分叉位与此完全同构；若未来把 run 也纳入 DAP（run 时 adapter 不加 jdwp、纯 spawn + output 事件），可得「run/debug 零差异的落点一致性」。
2. **用例过滤走「runner 参数协议」而非构建工具过滤**：编辑器内联单测**不**经过 `mvn test -Dtest=` / `gradle test --tests=`——只借构建工具的 classpath，执行是直接 `java -cp … <JUnit runner> <过滤参数>`。这印证 Neeko 的「构建与运行分离、产物定位走结构化输出」方向；对 Java 的启示是：若要接 Java，最小侵入路径是直接 spawn **JUnit Platform Console Launcher**（`java -jar junit-platform-console-standalone.jar -c <Class> -m <Class#method> --unique-id <…>`），而不是每次调 mvn/gradle 整包过滤（慢、且用例级状态要重新解析 XML）。
3. **用例级状态必须走结构化事件/XML，不解析 human 输出**：VSCode 编辑器内用 runner 的 socket 事件帧（testStart/End/Failed + duration + expected/actual diff + JUnit5 UniqueId 精确到参数化某次调用），构建工具用 JUnit XML（每用例一个 `<testcase>` 节点）。两套通道的共同点是**用例级状态是「数据」不是「文本」**——Neeko 若做用例级 ✓/✗ 状态流，应自定义等价事件协议（或直接消费 JUnit XML / surefire XML），避免从终端 human 输出反推用例状态（正是 `debug-vscode.md` 里已踩过的「解析 PTY 合流输出」类问题）。
