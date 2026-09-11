# Java Debug 落地前置调研（J3）：java-debug 独立可运行性 / JUnit Console Launcher / classpath 来源

> 挂靠任务：09-04-editor-test-run-buttons。只读调研，不改代码。
> 目的：消解 `design/test-debug-go-java.md` §3.2 J3 的两个前置不确定项 —— (1) microsoft/java-debug
> 能否脱离 JDTLS 独立运行；(2) JUnit Platform Console Launcher 形态；并给出 Neeko（无 JDT）Java Debug
> 的可行路径判定（复用 java-debug vs 其他）。
> 方法：web_search 限流 → 直读一手源码 + 官方文档 + Maven Central 实测。
> 一手证据：`microsoft/java-debug` 仓库 shallow clone（v0.53.2，/tmp/java-debug）、`junit-team/junit5`
> 源码（r5.11.4 / r6.1.3）、`zed-extensions/java` 源码、官方用户指南、Maven Central 搜索 API + repo1 目录实测。
> 日期：2026-09-08。

---

## TL;DR（三点结论 + 路径判定）

1. **java-debug 没有现成的独立可运行形态**（全仓库无 `main`、无可执行 JAR、无 standalone 打包）；正常形态是
   「DAP 服务器跑在 JDTLS 的 JVM 进程里，经 LSP 命令 `vscode.java.startDebugSession` 拿端口」。**但**
   `com.microsoft.java.debug.core` 是**纯 Java 库**（0 个 Eclipse/OSGi import，仅 5 个普通 Maven 依赖），
   DAP 引擎本身可脱离 JDT 独立托管 —— Neeko 可以自写一个 ~50 行的 Java host main（复刻 `JavaDebugServer`
   的 `ServerSocket(0)` + `ProtocolServer(in,out,providerContext).run()` 循环）+ 注册最小 provider，然后
   spawn 一个 JVM 跑 DAP over TCP。`classPaths` 是唯一绕不开的外部输入：**launch 模式校验必填；attach
   模式不需要**（可先 attach-first 规避）。
2. **JUnit Platform Console Launcher**：坐标 `org.junit.platform:junit-platform-console-standalone`，
   可执行 fat jar（`Main-Class` 直接可用），**自带 Jupiter + Vintage + Suite 三个引擎**（开箱即跑 JUnit 5
   与 JUnit 4/3，不含 TestNG）。CLI 现代形态 `java -jar …jar execute -c <Class> -m 'Class#method'
   --uid 'UniqueId' -cp <项目classpath> --reports-dir <dir>`；`--reports-dir` 写 **legacy JUnit XML**
   （每 testcase 一个 `<testcase>`，与 Surefire/Gradle 同族）——正好是设计 `parseJunitXml` 要消费的格式。
3. **classpath 来源**：Maven `mvn dependency:build-classpath` 可行但**只输出依赖 jar（本地仓库路径），不含
   项目自身 `target/classes`/`target/test-classes`**，且**多模块要逐模块跑、兄弟模块必须先 `mvn install`**
   （聚合根 packaging=pom 不可用）；Gradle 无内置等价任务，标准做法是自定义 `printTestClasspath` 任务打印
   `sourceSets.test.runtimeClasspath.asPath`（**自带 main+test 输出目录**，多项目按 subproject 跑即可）。

**路径判定：优先 A（自写 host + 复用 java-debug core，首期 attach-first），原型验证为硬门槛；失败降级 D
（文档化手动 attach），不阻塞 Run 里程碑。**（详见末节）

---

## 1) microsoft/java-debug 独立可运行性

### 1.1 构建形态：Tycho（Eclipse p2）双模块，无 main、无可执行 JAR

- root `pom.xml`（v0.53.2）modules：`com.microsoft.java.debug.core`（`packaging=jar`）、
  `com.microsoft.java.debug.plugin`（`packaging=eclipse-plugin`）、`repository`、`target`。
  构建用 **Tycho 5.0.0**（Eclipse 插件工程构建器）。
  https://github.com/microsoft/java-debug/blob/master/pom.xml
- **core 模块 pom**：`packaging=jar`，`maven-compiler-plugin source/target=11`，依赖仅
  commons-lang3 3.18.0 / gson 2.8.9 / rxjava 2.2.21 / reactive-streams 1.0.4 / commons-io 2.14.0
  （test 另加 junit4 + easymock）——**全普通 Maven 依赖，无 maven-shade、无 `<mainClass>`、无可执行 JAR**。
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.core/pom.xml
- **全仓库 `public static void main` 搜索**：仅 mvnw 的下载器 + `com.microsoft.java.debug.test` 下
  一个演示 fixture 的 main —— **业务代码零 main 入口**。
- **plugin 模块**是 Eclipse OSGi bundle（Tycho `eclipse-plugin`）：
  `META-INF/MANIFEST.MF` 的 `Require-Bundle` 列出 `org.eclipse.jdt.ls.core` / `org.eclipse.jdt.core` /
  `org.eclipse.jdt.debug` / `org.eclipse.debug.core` / OSGi 等（**必须跑在 Eclipse/JDT 运行时里**）；
  `Bundle-ClassPath` 把 `lib/com.microsoft.java.debug.core-0.53.2.jar` 等嵌套 jar 打进去。
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/META-INF/MANIFEST.MF

### 1.2 DAP 服务器正常启动路径：JDTLS 进程内 + LSP 命令拿端口

```
VSCode/Zed 侧 → LSP workspace/executeCommand { command: "vscode.java.startDebugSession" }
  → JDTLS 进程加载 java-debug plugin（OSGi bundle）
  → JavaDebugServer（单例）new ServerSocket(0) 绑随机端口
  → 每来一个连接：new ProtocolServer(in, out, JdtProviderContextFactory.createProviderContext()).run()
  → 端口经 LSP 回给 DAP 客户端，客户端连该端口跑 DAP
```
- 入口类：`com.microsoft.java.debug.plugin.internal.JavaDebugServer`（单例，`ServerSocket(0)`，accept 后
  `executor.submit(createConnectionTask(connection))`；`createConnectionTask` 内
  `new ProtocolServer(in, out, JdtProviderContextFactory.createProviderContext()).run()`）。
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/JavaDebugServer.java
- LSP 命令注册在 plugin.xml：`org.eclipse.jdt.ls.core.delegateCommandHandler` 绑定
  `vscode.java.startDebugSession` / `vscode.java.resolveClasspath` / `vscode.java.resolveMainClass` /
  `vscode.java.buildWorkspace` 等 18 个命令。
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/plugin.xml
- **JDT 依赖只在 plugin 侧**：`JdtProviderContextFactory.createProviderContext()` 注册 5 个
  JDT-backed provider：`ISourceLookUpProvider` / `IVirtualMachineManagerProvider` /
  `IHotCodeReplaceProvider` / `IEvaluationProvider` / `ICompletionsProvider`。
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/JdtProviderContextFactory.java

### 1.3 core 是 JDT-free 纯库（关键结论）

- **`com.microsoft.java.debug.core` 全模块 `import org.eclipse.*|org.osgi.*` 搜索 = 0 命中**。
  其 `adapter` 包（`ProtocolServer` / `DebugAdapter` / `DebugAdapterContext` / 全部 handler）是纯
  DAP↔JDI 桥，`com.sun.jdi`（JDK 内置）与目标 JVM 通信。
- 依赖面收敛：core 只需 5 个普通 Maven 依赖即可独立跑（见 1.1）。
- `ProviderContext.getProvider(clazz)` 对未注册 provider **抛 IllegalArgumentException**
  （不是返回 null）→ 独立托管必须把「handler 实际会调用的 provider」注册齐。
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/ProviderContext.java
- 常见最小调试流程（initialize → launch/attach → setBreakpoints → configurationDone → threads /
  stackTrace / scopes / variables / step / continue / disconnect）中，handler 强依赖的 provider 只有：
  - `IVirtualMachineManagerProvider`（`LaunchWithDebuggingDelegate` / `AttachRequestHandler` /
    `ConfigurationDoneRequestHandler` 经 `VMHandler` 使用）——独立实现 = `com.sun.jdi.Bootstrap.virtualMachineManager()`，几行搞定；
  - `ISourceLookUpProvider`（`SetBreakpointsRequestHandler`）——独立实现 = 相对 cwd/项目根解析 `sourcePath`。
  - `IEvaluationProvider` / `ICompletionsProvider` / `IHotCodeReplaceProvider` 只在对应请求到来时
    才取 → 不注册即不可用（**评估/补全/热替换降级**），首期不需要。

### 1.4 launch 模式的 classPaths 校验（必须外部提供）

`LaunchRequestHandler` 校验：`mainClass` 非空 **且** `(modulePaths 非空 || classPaths 非空)`，否则
`ARGUMENT_MISSING` 错误。JDT 正常经 `vscode.java.resolveClasspath` 算 classpath 填进 launch 配置；
**Neeko 无 JDT 就必须自己算（§3）**。但 **attach 模式（`AttachRequestHandler` → `SocketAttachingConnector`
连已运行 JVM 的 jdwp 端口）没有 classPaths 校验** —— 这是 attach-first 能绕开 classpath 的原因。
https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/LaunchRequestHandler.java
https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.core/src/main/java/com/microsoft/java/debug/core/adapter/handler/AttachRequestHandler.java

### 1.5 获取途径（Maven Central 实测）

- `com.microsoft.java:com.microsoft.java.debug.core` 与 `com.microsoft.java:com.microsoft.java.debug.plugin`
  **均已发布到 Maven Central**（search.maven.org 实测 latest 0.53.1；GitHub master 为 0.53.2）。
  坐标：https://central.sonatype.com/artifact/com.microsoft.java/com.microsoft.java.debug.core
- Zed 的 fork（`zed-industries/java-debug`）把 plugin jar 发布到 GitHub releases 供下载。

### 1.6 对照证据：VSCode / Zed 都不是「独立进程」跑 java-debug

- VSCode：`JavaDebugAdapterDescriptorFactory` 调 `startDebugSession()`（= `vscode.java.startDebugSession`
  命令）拿端口 → `new DebugAdapterServer(port)`，DAP 服务器在 **JDTLS JVM 内**。
- **Zed 也一样**：`zed-extensions/java/src/debugger.rs` 虽然下载独立的 fork jar
  （`com.microsoft.java.debug.plugin-0.53.2.jar`），但 `start_session()` 仍发
  `workspace/executeCommand { command: "vscode.java.startDebugSession" }` 给 **JDTLS** 拿端口。
  https://github.com/zed-extensions/java/blob/main/src/debugger.rs
- **结论：全生态（VSCode / Zed / IDEA 自带 JDI）的 Java DAP 服务器都长在「IDE/LS 宿主 JVM」里，
  没有现成的可 spawn 的独立 Java DAP 可执行文件。** Neeko 想复用 java-debug 只有「自写 Java host 托管
  core」这一条路（见末节路径 A）。

---

## 2) JUnit Platform Console Launcher

### 2.1 坐标 / 版本（Maven Central 实测）

- 坐标：`org.junit.platform:junit-platform-console-standalone`。
- 版本两系（repo1.maven.org 目录实测）：
  - **1.x**（JUnit 5 平台，运行时需 **Java 8+**）：最新稳定 **1.14.4**，另常见 1.13.x / 1.12.2。
  - **6.x**（JUnit 6，运行时需 **Java 17+**）：最新 **6.1.3**。
- 直接下载 URL：`https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/<v>/junit-platform-console-standalone-<v>.jar`

### 2.2 形态：可执行 fat jar，自带三个引擎（jar 实测 1.14.4）

- manifest `Main-Class: org.junit.platform.console.ConsoleLauncher`，**无 `Class-Path`** →
  可直接 `java -jar`；`java -jar` 时 JVM 忽略命令行 `-cp`，项目 classpath 必须走 launcher 自己的
  `-cp/--class-path` 选项（见 2.4）。
- 内含（官方文档 + jar 内 class 实测）：junit-jupiter(api/engine/params)、**junit-vintage(engine)**、
  junit-platform-suite-engine、junit:junit:4.13.2、opentest4j、hamcrest-core、apiguardian →
  **开箱即跑 JUnit 5（Jupiter）与 JUnit 4/3（Vintage），不含 TestNG**。
  https://docs.junit.org/6.1.3/running-tests/console-launcher.html

### 2.3 命令行（1.11+ 与 6.x 统一；证据：6.1.3 用户指南 help + 5.11.4 源码）

```
java -jar junit-platform-console-standalone-<v>.jar execute <OPTIONS>
```
- 现代形态有 `execute`（也有 `discover` / `engines` 子命令）；1.11+ 的旧平铺形态
  （`java -jar …jar -c Foo`）仍可用但会打 **deprecation warning**（源码 `MainCommand.call()` 委托到
  `execute` 并打印 WARNING），建议直接用 `execute`。
- 选择器：
  - `-c, --select-class <FQCN>`（可重复）
  - `-m, --select-method <NAME>`：方法选择语法 **`com.acme.Foo#m`**；带参/重载需附全限定形参类型，
    如 `com.acme.Foo#m(java.lang.String)`；`@ParameterizedTest` 用 `-m Class#m()` 选整个方法（全部 invocation）
  - `--uid, --select-unique-id <UNIQUE-ID>`：JUnit5 UniqueId，如
    `[engine:junit-jupiter]/[class:com.acme.Foo]/[method:m()]`；参数化单次调用可到
    `[test-template-invocation:#N]`
  - `-i, --select-iteration method:com.acme.Foo#m[1..2]`：按 invocation 索引区间选参数化某几次
- 过滤：
  - `-n, --include-classname <REGEX>`：**默认正则 `^(Test.*|.+[.$]Test.*|.*Tests?)$`** ——
    类名不匹配默认规则（如类名不以 Test 结尾）会被排除，必要时显式 `-n '.*'` 放开（注意：Neeko 的
    `parseJavaCases` 若匹配到 `XxxTest` 之外的类，CLI 侧要对应放开）
  - `-t/-T, --include-tag/--exclude-tag`；`-e/-E, --include-engine/--exclude-engine`
- 运行时配置：
  - **`-cp, --class-path=PATH`**（可重复）：额外 classpath 条目。`java -jar` 下项目 classpath 只能
    走这里 —— 源码 `ConsoleTestExecutor.createCustomClassLoader()` 把 `-cp` 条目装进 URLClassLoader。
  - `--config=KEY=VALUE` / `--config-resource`
- 报告：**`--reports-dir=DIR`**（自动建目录）→ 注册 **`LegacyXmlReportGeneratingListener`**
  （legacy JUnit XML，1.x 与 6.x 的 console `--reports-dir` 均如此，源码实证）→ 每用例一个
  `<testcase>`，与 Surefire/Gradle JUnit XML 同族，**`parseJunitXml` 可直接消费**。
  注：JUnit 6 新增的 Open Test Reporting（`org.opentest4j.reporting`）是独立 opt-in 监听器，
  `--reports-dir` 不走它。
- 其它：`--fail-fast`、`--fail-if-no-tests`（无用例且指定时退出码 2）、`@argfile`（参数文件，长命令/
  超长 classpath 用，规避系统命令行长度限制）、`--details=none|summary|flat|tree|verbose|testfeed`。
  退出码：0=成功，1=有用例/容器失败，2=无用例+`--fail-if-no-tests`，3=输入非法。
- **建议固定 1.x 线**（如 1.12.2 / 1.13.x）：(a) Java 8+ 运行时下限更宽（6.x 要求 17+，用户机器 JVM
  版本不可控）；(b) `--reports-dir` 同为 legacy XML，无格式差异；(c) 生态主流量（Surefire/IDE）对齐 1.x。

### 2.4 classpath 需求小结

- launcher 自身：fat jar 自足，无需外部引擎依赖。
- 项目测试：经 **`-cp`** 传入（`target/classes:target/test-classes:<依赖classpath>`，Windows 用 `;`）。
- 引擎版本一致性：standalone 自带引擎（如 1.14.4 带 Jupiter/Vintage 5.14.4）。若项目自身 classpath
  上带了不同版本的 junit-jupiter-api/engine，可能出现引擎与测试编译 API 的版本偏差 —— 建议以
  standalone 引擎版本为基准或显式统一版本（已知风险，首期可接受）。

---

## 3) Maven / Gradle test classpath 来源（Neeko 无 JDT 的最小路径）

### 3.1 Maven：`mvn dependency:build-classpath`

- 官方 goal：`org.apache.maven.plugins:maven-dependency-plugin:3.11.0:build-classpath`
  （since 2.0-alpha-2，默认绑定 generate-sources 阶段）。
  https://maven.apache.org/plugins/maven-dependency-plugin/build-classpath-mojo.html
- 行为：**输出「本地仓库中依赖的 classpath 字符串」到文件或日志**；默认按 test scope 解析
  （`includeScope` 缺省 = 全部依赖，含 compile/runtime/test/provided 语义）。
  - `-Dmdep.outputFile=cp.txt` → 写文件；不设则 INFO 打到终端。
  - 其它：`-Dmdep.outputAbsoluteArtifactFilename=true`、`-Dmdep.pathSeparator=:`、
    `-Dmdep.fileSeparator=/`（跨平台分隔符控制）。
- **可行性与局限**：
  1. **只含依赖 jar，不含项目自身 `target/classes` / `target/test-classes`** —— 必须手工前置拼接
     （`target/classes:target/test-classes:$(cat cp.txt)`）。
  2. **多模块**：goal 按单个 Maven 项目解析，输出指向「本地仓库」→ 兄弟模块必须先 `mvn install`
     （或 `-pl <mod> -am` 把上游模块拉进 reactor）才能解析；**聚合根（packaging=pom）无 classpath，
     直接不可用** → 需逐模块跑。
  3. **不编译**：直跑 goal 不触发 compile/test-compile → 用例未编译时 classes 是旧/缺的，需先
     `mvn test-compile`。
  4. 需要 mvn 可用 + 依赖图可解析（网络/本地缓存）。
- 单模块最小链路：
  ```
  mvn -q test-compile
  mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt
  CP="$(pwd)/target/classes:$(pwd)/target/test-classes:$(cat cp.txt)"   # Windows 分隔符为 ';'
  ```

### 3.2 Gradle：无内置等价任务，自定义 `printTestClasspath`

- `./gradlew dependencies --configuration testRuntimeClasspath` 只给**人读的依赖树**，不是 classpath 串
  → 不可直接用。
- 标准做法 = 自定义任务打印 `sourceSets.test.runtimeClasspath.asPath`（**自带 main+test 输出目录 +
  全部依赖**，比 Maven 的 deps-only 更省心）：
  ```groovy
  // build.gradle
  tasks.register('printTestClasspath') {
      doLast { println sourceSets.test.runtimeClasspath.asPath }
  }
  // 跑：./gradlew -q printTestClasspath
  ```
  ```kotlin
  // build.gradle.kts
  tasks.register("printTestClasspath") {
      doLast { println(sourceSets.test.get().runtimeClasspath.asPath) }
  }
  ```
- 依据：Gradle SourceSet DSL —— `runtimeClasspath` = `sourceSet.output + project.configurations.testRuntimeClasspath`。
  https://docs.gradle.org/current/dsl/org.gradle.api.tasks.SourceSet.html
- 注意：需要 `java` 插件（sourceSets 来自它；Kotlin/Groovy/Scala 插件同样提供 test sourceSet）；
  `runtimeClasspath` 依赖 `testClasses` 任务 → 会触发 test 编译；**多项目按 subproject 跑即可**
  （`./gradlew :sub:printTestClasspath`），Gradle 自动解析兄弟模块产物；Android 项目类路径模型不同。

---

## Neeko Java Debug 可行路径判定（A/B/C 选路依据）

对 `design/test-debug-go-java.md` §3.2 J3 的路径 C（捆绑现成 Java DAP 服务器）给出实证结论与选路：

- **A. 自写 Java host 托管 java-debug core，spawn JVM 跑 DAP over TCP —— 推荐**（即 design 路径 C 的落地形态）
  - 依据：core 是 JDT-free 纯库（§1.3，0 个 Eclipse import）；契约面（DAP）与 Neeko 既有 lldb adapter
    完全同构，可复用 `dap.adapterBinaries` 机制把「adapter 二进制」换成 java host jar；core jar 可从
    Maven Central 直接取（§1.5）；**首期 attach-first 可绕开 launch 必需的 classPaths 校验**（§1.4）：
    Neeko 自己 spawn 测试 JVM 时拼 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<port>`
    （就是 Run 命令加一行参数），java-debug 走 DAP attach（SocketAttachingConnector，无 classPaths 校验），
    断点/步进/栈/变量（JDI）全可用；source lookup 用一个「相对 cwd/项目根解析」的简单 provider 顶住。
  - 成本/风险：要维护一个小 Java host（~100 行 main + VM manager / source lookup 两个 provider shim）
    并随 app 打包 core jar + 5 个依赖（或打成 fat host jar）；evaluation/completions/HCR 降级（首期
    不需要）；与 Console Launcher 同理需要用户机器有 JVM（core 编译目标 Java 11，宿主 JRE ≥11）。
  - **J3 硬验收门槛：host main + attach + 断点命中 + 变量展开的真机冒烟必须先原型验证通过。**
- **B. 捆绑 JDTLS + java-debug plugin（官方形态，VSCode / Zed 一致）—— 不推荐首期**
  - 依据：这是唯一「现成」的跑法（§1.2 / §1.6），classPaths / source lookup / evaluation 全免费；但
    JDTLS 是秒级启动 + 数百 MB 内存 + 工作区导入/索引 + Java 21 要求（Zed 文档实证）的重型依赖，与
    Neeko「无 JDT」定位和 gutter 轻量 Debug 里程碑不匹配；且其 classpath provider（m2e/gradle）仍要求
    项目被 JDT 识别。
- **C. Rust 自研 JDWP 桥 —— 不做**
  - 依据：JDWP 是大协议、无成熟 Rust crate，工程量≈写一个调试器后端（design 已判，维持）。
- **D. 降级（文档兜底，不阻塞 Run）**
  - 若 A 原型失败：J3 收敛为「Run-only + 文档说明」——Neeko spawn Console Launcher + jdwp，把调试
    attach 交给用户侧 jdb/JetBrains；或只交付 Run 里程碑（Console Launcher + JUnit XML 状态流）。

**选路结论**：**优先 A（attach-first 原型验证）**。理由：现成独立 Java DAP 可执行文件不存在（全生态都
宿主在 JDTLS/IDE 里），复用的唯一途径就是自写 host 托管 core；契约与既有 DAP 管线同构、成本最低；
classPaths 先经 attach 模式绕过、后随 §3 classpath 解析成熟再上 launch 模式；A 失败可降级 D，不阻塞
Run。A 的成立条件是「host main 原型通过真机 attach 冒烟」，应作为 J3 的硬验收门槛。

---

## 来源链接

**microsoft/java-debug（shallow clone v0.53.2，/tmp/java-debug；仓库 https://github.com/microsoft/java-debug）**
- README（"works with Eclipse JDT Language Server as an add-on"，Usage 即 bundles + startDebugSession）：
  https://github.com/microsoft/java-debug/blob/master/README.md
- root pom.xml（Tycho 5.0.0，四模块）：https://github.com/microsoft/java-debug/blob/master/pom.xml
- core pom.xml（packaging=jar、Java 11、5 依赖）：https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.core/pom.xml
- plugin pom.xml（eclipse-plugin/Tycho）：https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/pom.xml
- plugin.xml（18 个 delegateCommand 含 vscode.java.startDebugSession / resolveClasspath）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/plugin.xml
- MANIFEST.MF（Require-Bundle JDT 系、Bundle-ClassPath 嵌套 core jar）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/META-INF/MANIFEST.MF
- JavaDebugServer.java（ServerSocket(0)+ProtocolServer 循环）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/JavaDebugServer.java
- JdtProviderContextFactory.java（5 个 JDT provider）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/JdtProviderContextFactory.java
- ProviderContext.java（未注册抛 IAE）：…/adapter/ProviderContext.java
- DebugAdapter.java / DebugAdapterContext.java / LaunchRequestHandler.java（mainClass+classPaths 校验、
  jdwp 注入 `-agentlib:jdwp=…,server=%s,suspend=y,address=%s`）…/adapter/handler/LaunchRequestHandler.java
- AttachRequestHandler.java（SocketAttachingConnector，attach 无 classPaths 校验）…/adapter/handler/AttachRequestHandler.java

**Maven Central（search.maven.org + repo1.maven.org 实测）**
- com.microsoft.java:com.microsoft.java.debug.core / …debug.plugin（latest 0.53.1）
- org.junit.platform:junit-platform-console-standalone（1.x 最新 1.14.4；6.x 最新 6.1.3；jar 实测
  Main-Class + Jupiter/Vintage/Suite 引擎）

**VSCode / Zed 对照**
- vscode-java-debug：JavaDebugAdapterDescriptorFactory（startDebugSession → DebugAdapterServer）：
  https://github.com/microsoft/vscode-java-debug/blob/main/src/javaDebugAdapterDescriptorFactory.ts
- zed-extensions/java `src/debugger.rs`（下载 fork jar + start_session 走 JDTLS startDebugSession）：
  https://github.com/zed-extensions/java/blob/main/src/debugger.rs ；fork：https://github.com/zed-industries/java-debug
- Zed Java 文档（JDTLS Java 21、debug 走 fork）：https://zed.dev/docs/languages/java

**JUnit Platform Console Launcher**
- 6.1.3 用户指南 Console Launcher（subcommand、全部选项、退出码、@argfile、--reports-dir）：
  https://docs.junit.org/6.1.3/running-tests/console-launcher.html
- 6.1.3 用户指南 Discovery Selectors（-c/-m/--uid/-i 语法）：
  https://docs.junit.org/6.1.3/running-tests/discovery-selectors.html
- 5.11.4 源码 MainCommand.java（execute 子命令 + 旧平铺形态 deprecation）：
  https://github.com/junit-team/junit5/blob/r5.11.4/junit-platform-console/src/main/java/org/junit/platform/console/options/MainCommand.java
- 5.11.4 / 6.1.3 源码 ConsoleTestExecutor.java（LegacyXmlReportGeneratingListener + createCustomClassLoader）：
  https://github.com/junit-team/junit5/blob/r5.11.4/junit-platform-console/src/main/java/org/junit/platform/console/tasks/ConsoleTestExecutor.java
  https://github.com/junit-team/junit-framework/blob/r6.1.3/junit-platform-console/src/main/java/org/junit/platform/console/command/ConsoleTestExecutor.java
- JUnit 5.11.4 用户指南（§1.2 Java 8+ 运行时要求）：https://junit.org/junit5/docs/5.11.4/user-guide/

**Maven / Gradle classpath**
- maven-dependency-plugin build-classpath mojo 文档：
  https://maven.apache.org/plugins/maven-dependency-plugin/build-classpath-mojo.html
- Gradle SourceSet DSL（runtimeClasspath = output + testRuntimeClasspath）：
  https://docs.gradle.org/current/dsl/org.gradle.api.tasks.SourceSet.html
