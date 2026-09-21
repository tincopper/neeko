# 业界对照：VSCode / Zed / Neeko 的 Java Debug 方案异同

> 挂靠任务：09-12-java-debug-backends。只读调研，不改代码。
> 方法：**直读一手源码 + 官方文档**，不采信二手博客。
> 一手来源：`zed-extensions/java`（`debugger.rs`）、`microsoft/vscode-java-debug`（`javaDebugAdapterDescriptorFactory.ts`、
> `languageServerPlugin.ts`、`commands.ts`）、`microsoft/vscode-java-test`（`src/utils/launchUtils.ts`、`src/constants.ts`、
> `src/debugger.api.d.ts`）、`microsoft/java-debug`（`plugin.xml`）、`redhat-developer/vscode-java`（JDK Requirements）、
> Zed Java 文档、Maven Central。
> 日期：2026-09-13。

---

## TL;DR

**三家在核心机制上完全同构**：`initializationOptions.bundles` 注入 `com.microsoft.java.debug.plugin`
→ `workspace/executeCommand{vscode.java.startDebugSession}` 取端口 → **TCP 直连**该端口跑 DAP
→ launch 由 adapter 侧注入 jdwp 并 spawn 被测 JVM。**但"谁来构造 launch 参数与 classpath"差异很大**：

| | 构造 launch 参数 | classpath 来源 | 测试选择器 |
|---|---|---|---|
| **VSCode** | **服务端**：`vscode.java.test.junit.argument` 返回 `{mainClass, programArguments, classpath, modulepath, …}` | 测试路径用上述返回；main 路径用 `resolveClasspath`（`$Auto/$Runtime/$Test`） | **服务端语义**（嵌套类/参数化/uniqueId 全支持） |
| **Zed** | 客户端（`JavaDebugLaunchConfig`）+ `resolveClassPath` | `lsp::resolve_class_path(workspace, [mainClass, projectName, scope])` | **基本没有**：只到 main class 级；测试靠 tasks 而非 DAP |
| **Neeko（本方案）** | **客户端**（自己拼 `execute -c FQCN -m 'FQCN#method'`） | `resolveClasspath(…, "test")` | **客户端文本级** + `documentSymbol` 补 `@Nested`（无参数化/uniqueId） |

→ 结论：Neeko 的 B' 在 **classpath 真值** 与 **引擎能力** 上对齐业界；在 **测试选择器精度** 上介于
VSCode（完备）与 Zed（无）之间；在 **失败/等待处理** 与 **可用性兜底** 上比两家都激进。

---

## 1) 三家机制逐项对照

| 维度 | VSCode | Zed | Neeko（本方案） |
|---|---|---|---|
| 扩展/组件数 | 3 个扩展（java / java-debug / java-test）+ 2 个 bundle | 1 个扩展 + 1 个 fork jar | 1 个内置 LSP 插件 + 1 个 bundle jar（+ A 的 host jar） |
| debug plugin 来源 | 扩展自带（随扩展版本发布） | **fork**，pin 死 URL `zed-industries/java-debug/…/com.microsoft.java.debug.plugin-0.53.2.jar`；另有未启用的官方 Maven Central 拉取代码 | 官方 Maven Central（`com.microsoft.java`），Zed fork 作备选 |
| 注入方式 | `initializationOptions.bundles` | `inject_plugin_into_options()` → `bundles` | `initialization_options.bundles`（同 Zed） |
| 端口获取 | `startDebugSession()` → `DebugAdapterServer(port)` | `workspace/executeCommand{vscode.java.startDebugSession}` → `u16` → `TcpArgumentsTemplate{port}` | 同（`lsp_request` → 端口） |
| DAP 传输 | TCP 连 adapter 端口 | TCP 连 adapter 端口 | **TCP 直连**（需新增 `AdapterSpawn::Connect`） |
| 测试 classpath | `junit.argument` 服务端返回（含 console launcher） | `resolveClassPath(scope=$Test)` | `resolveClasspath(scope="test")` + 自备 console-standalone |
| 测试选择器 | 服务端 `junit.argument` 生成 programArguments | —（无测试级 DAP 调试） | 客户端文本级拼接 |
| 多入口/多模块歧义 | `projectName` + 服务端 `resolveMainMethod` 给 range | **硬报错**：`Project have multiple entry points, you must explicitly specify "mainClass" or "projectName"` | `projectName`（前端按模块根推导） |
| 就绪/导入中 | 不等待：`resolveClasspath` 空 → 报 "Cannot resolve the modulepaths/classpaths automatically" | 不等待：`Failed to resolve classpath` 报错 | **`Warming` 三态 + 有界等待 + 用户二选一**（两家都没有） |
| 失败降级 | 无（错误提示 + 不建会话） | 无（报错） | **`auto` 回退 A**（两家都没有） |
| Run/Debug/Coverage | 同一 launch 配置 + `noDebug` 开关；Coverage 注入 jacoco agent | tasks（非 DAP）；Windows 下 tasks 不可用 | Run 走 shell、Debug 走 DAP；无 Coverage |
| jdtls 运行 JDK | **JDK 21+**（扩展报错 "Java 21 or more recent is required"） | **Java 21**（`java_home` 可覆盖） | JDK 21+（同） |
| 平台 | 全平台 | tasks 仅 Mac/Linux；debug 走 debug.json | Local 支持；WSL 待实测；SSH 不支持 |

---

## 2) 同（收敛点）——这些部分不必再怀疑

1. **引擎选型**：三家都宿主 JDTLS 进程内的 `java-debug`，不 spawn 独立 DAP 可执行文件。
   Neeko §0.1 的结论与业界一致（自写 host 只在对"无 jdtls"场景有价值）。
2. **注入机制**：`initializationOptions.bundles` 是唯一官方路径；Zed 与 Neeko 的做法逐字等价。
3. **端口获取与传输**：`vscode.java.startDebugSession` + TCP 是唯一路径（VSCode 用 `DebugAdapterServer`，
   Zed 用 `TcpArgumentsTemplate`，Neeko 计划用 `AdapterSpawn::Connect`）。
4. **JDK 21 门槛**：不是 Neeko 的过度约束，而是 jdtls 本身的要求（VSCode/Zed 同样要求）。
5. **classpath 真值来自服务端**：三家都调 `resolveClasspath` 或服务端 `junit.argument`，没有人自己拼。
   Neeko 放弃前端 `mvn dependency:build-classpath` 副本的方向正确。

---

## 3) 异（差异）与优缺点

### D1 测试选择器精度：Neeko 明显弱于 VSCode

* VSCode 向服务端要 `vscode.java.test.junit.argument`，服务端按 JUnit part 序列
  （`class:` / `nested-class:` / `test-template:` / `test-template-invocation:` / `dynamic-test:`）
  生成 programArguments，天然覆盖 `@Nested`、参数化、动态测试，并可只重跑单次 invocation（uniqueId）。
* Neeko 自己拼 `-c FQCN -m 'FQCN#method'`，仅用 `documentSymbol` 补了嵌套类 `$` 链。
* **代价（原估"只多一个 bundle"偏低，此处按实测修正）**：
  * vscode-java-test 的 `package.json` 声明 `javaExtensions` 共 **30 个 jar**：
    `./server/com.microsoft.java.test.plugin-0.43.1.jar` + `junit-jupiter-api/engine/params`
    的 **5.14.4 与 6.0.1 双线** + `junit-platform-{commons,engine,launcher,runner,suite-*}` 双线 +
    `junit-vintage-engine` + `org.eclipse.jdt.junit4/5/6.runtime` + `org.jacoco.core` + `org.objectweb.asm*` +
    `org.opentest4j`。全部经 jdt.ls `bundles` 注入。
  * `com.microsoft.java.test.plugin` **不在 Maven Central**（实测 `repo1.maven.org/maven2/com/microsoft/java/`
    仅含 `com.microsoft.java.debug.core` / `com.microsoft.java.debug.plugin` / `java-debug-parent`）→
    只能从 VSIX 提取，或自 `microsoft/vscode-java-test` 源码构建（Tycho）。
  * → 真实代价 = **~30 个 vendored jar + 无 Maven 坐标的发行通道 + 与 jdt.ls / JUnit 版本强耦合**。
* **顺带解释了一个副作用**：VSCode 的测试 classpath 由服务端给出（含其自带的 junit 双线引擎），
  因此不存在"Neeko 自备 standalone vs 项目自带 junit"的版本偏差 —— 权威 classpath 才是这套设计的真正收益。
* **优点（Neeko）**：零新增 vendored 依赖、零新增发行通道。**这一点在 Neeko 的依赖姿态下权重很高。**
* **已声明**：prd Out of Scope 明确不做语义级用例发现。**但"静默错"必须另行闭合**——见 §5 采纳结论 D1。

### D2 失败与等待：Neeko 比两家都"厚"

* VSCode/Zed 都是**硬失败**：import 未完 → `resolveClasspath` 空 → 直接报错让用户重试。
  可预测，但大项目首开会反复失败。
* Neeko 的 `Warming` 三态 + 有界等待 + 用户二选一 + 降级粘滞，是三家唯一对"导入中"做产品化处理的。
* **优点**：大项目首开体验更好；**风险**：把"classpath 空"一律解释为"import 中"可能把**真损坏的工程**
  误判为 Warming，把硬错误拖延成超时错误 —— 可预测性下降。VSCode 的硬报错在这点上更诚实。
* **建议**：`Warming` 判定需与 LSP 的进度/状态**交叉**（有 import 进度才 Warming），
  无进度却 resolve 空 → 直接 `Unavailable(ProbeFailed)` 报错，不要等到超时。

### D3 双后端 + auto 降级：业界没有

* VSCode/Zed 都只有一条路径，"不可用就报错"。Neeko 的 `auto` 回退 A 是**唯一**的可用性兜底设计。
* **优点**：JDK<21、非 Maven/Gradle、jdtls 起不来的场景仍有 Java 调试（A 的 JDK 下限 11）。
  注意：JDK<21 用户在三家里**连 Java 编辑都没有**（redhat.java 直接报 JDK 21 要求），所以这是真实差异化。
* **代价**：两条 classpath 来源、两种 spawn 模型、两种传输、两套失败语义 → 维护面与测试矩阵翻倍；
  且 A 的求值/补全/HCR 恒降级（`NoopProviders`），用户体验不一致。
* **判断**：可接受，但**必须**保持"临时"属性 —— 方案已有 M5 删除触发条件，符合"有界复杂度"。

### D4 传输重构是 Neeko 的内部债，不是业界差异

* VSCode/Zed 的调试客户端原生支持"连到已存在的端口"，所以它们的 Java 方案不需要改传输层。
* Neeko 的 DAP 层把"adapter 恒为子进程"写死（`DapSession::start` → `spawn_adapter`），才需要 M0 解耦。
* **结论**：M0 的性质是**补齐 Neeko 自身的架构债**（对齐业界客户端的通用能力），不应记在"Java 双后端"的
  复杂度账上；也说明 M0 的价值独立于 Java（对"任何外部 DAP 端点"都成立）。

### D5 plugin 来源：Zed 选择了 fork，Neeko 计划用官方

* Zed **pin 死自己的 fork**（0.53.2），源码里虽有从 Maven Central 拉官方版的路径（`maven-metadata.xml`）但**未启用**。
  这暗示上游在 Zed 的使用路径上可能不完全够用（否则没必要 fork）。
* Neeko 计划以官方 Maven Central 为主、Zed fork 为备选 —— 与 Zed 的实际取舍相反。
* **风险**：若官方 jar 在 `launch` 路径上有 Zed 已修的问题，Neeko 会被迫自建 fork（成本远超本任务）。
* **已落入 S0**：spike 应先验证官方 jar；失败则切 fork，并记录差异。这是 go/no-go 的一部分。

### D6 `java.configuration.updateBuildConfiguration` 取值差异

* VSCode 默认 `interactive`（Zed 文档示例同样），Neeko 方案写 `automatic`。
* `automatic` 会在构建文件变化时**自动更新构建配置并触发重建** —— 这只影响调试，也改变整个 Java 编辑会话行为。
* **建议**：明确这是**有意的全局行为变更**并给理由（调试前 classpath 需新鲜），否则对齐 `interactive` 只影响 debug 路径。

### D7 多模块歧义处理：应对齐 Zed 的硬报错

* Zed：入口点 >1 时**报错要求用户显式指定** `mainClass`/`projectName`，绝不猜。
* Neeko 目前靠前端模块根推导 `projectName`，未定义歧义行为。
* **建议**：歧义时硬报错并指引（对齐 Zed），禁止静默取第一个 —— 静默取错模块 = 又是一次"静默错"。

### D8 Run/Debug/Coverage 统一

* VSCode：同一 launch 配置 + `noDebug` 决定 Run/Debug；Coverage 注入 jacoco agent。一套配置三种用途。
* Zed：Run/Debug 走 tasks（Windows 不可用），debug 走 `debug.json`。
* Neeko：Run（shell + ConsoleLauncher）与 Debug（DAP）是两条路径，无 Coverage。
* **判断**：不在本任务范围（prd 已限定），但 Run/Debug 的分叉意味着**同一用例两份选择器构造逻辑**，
  长期应统一到同一份参数构造（VSCode 的 `noDebug` 模式值得借鉴）。

---

## 4) 第 4 轮由调研得出的方案修正（已被 §5 部分取代）

> 说明：本表是第 4 轮的落点记录；其中第 1 项（能力边界声明）已被 §5 D1 **取代**——
> 不再只是"声明不做"，而是追加两道**选择器不变式**把静默错显式化。保留此表以留痕。

| # | 修正 | 落点 |
|---|---|---|
| 1 | 显式声明"B' 只修 classpath 真值，不修测试选择器精度；与 VSCode 测试调试能力仍有差距" | design §0.1 / §6 对照说明 |
| 2 | `Warming` 需与 LSP 进度/状态交叉判定；无进度却 resolve 空 → 直接报错，不拖延到超时 | design §2.4 探测顺序、prd R4 |
| 3 | 多模块/多入口歧义 → 硬报错要求显式指定，禁止静默取第一个（对齐 Zed） | design §2.3、prd R2、implement M2 |
| 4 | `java.configuration.updateBuildConfiguration` 从 `automatic` 降为**有意决策项**并说明其全局影响；S0 增列"官方 jar vs Zed fork 差异"验证 | design §3、implement S0 |

---

## 5) D1–D8 逐项最优解与采纳结论（第 5 轮）

> 判据统一为：**能否消除"静默错"**（§0 第一性原理）＋ **代价是否与 Neeko 的依赖姿态相称**。

| # | 问题 | 最优解 | 采纳结论 |
|---|---|---|---|
| **D1** | 选择器精度不足 → 静默错（会话 running、断点永不命中） | ①**不变式**：选择器可验证 —— launch 前校验类/方法/嵌套链存在，launch 后断言"至少发现 1 个用例"，0 用例即硬失败终止会话；②classpath 保持服务端权威（`resolveClasspath`）；③服务端选择器（java-test bundle）作为**可选升级** | **采纳 ①+② 为本任务必做**（零 vendored 依赖即闭合静默错）；**③ 因 ~30 jar + 无 Maven 坐标 + 版本强耦合，降级为独立后续任务**，由 S0 记录实际成本后决策 |
| **D2** | `Warming` 可能把损坏工程拖成超时错误 | `Warming` 必须与 LSP 进度交叉验证；无进度即硬报错 | **已采纳**（第 4 轮，design §2.4 / prd R4） |
| **D3** | 双后端 + 自动降级 = 业界没有的"静默换引擎" | **不自动切换引擎**：事前可判定的 terminal（无 JDK21 / 未安装 jdtls）→ 一次性显式询问 + 记忆；不确定/运行期 → 报错 + 显式切换入口。A 定位为**显式选项**而非自动兜底 | **采纳**（替换第 2 轮的 `FallbackToHost` 自动降级 + 粘滞状态机） |
| **D4** | M0 传输重构被算作"Java 双后端"的复杂度 | 正确定位为**通用 DAP 能力补齐**（对任何外部 DAP 端点成立），独立价值、独立评审 | **采纳**：建议拆为独立小任务/独立提交；仍由 S0 go 触发，不提前做 |
| **D5** | 官方 vs Zed fork 取舍未定、未 pin | 判据 = 以 S0 实测行为为准（不预设"官方优先"）；**pin 版本 + 校验**，禁止浮动/latest | **采纳**（design §5、S0 项） |
| **D6** | `updateBuildConfiguration=automatic` 改变了整个编辑会话 | 默认 **`interactive` 对齐业界**；classpath 新鲜度改用**按需刷新**（`vscode.java.buildWorkspace`）解决；`automatic` 仅作实测后的最后手段 | **采纳**（design §3、S0 项） |
| **D7** | 多入口/多模块歧义未定义行为 | **硬报错**要求显式指定（对齐 Zed）；有服务端能力时用服务端候选列表供选，无则指引 | **采纳**：本期硬报错（零成本）；服务端候选随 D1③ 可选升级 |
| **D8** | Run 与 Debug 两套选择器构造 → 双份逻辑 | **选择器构造单点化**：一个纯函数产出启动参数，Run/Debug 共用（Run 追加 `--reports-dir`，Debug 注入 debugger，等价 VSCode 的 `noDebug` 同配置思路） | **采纳方向**：本期先做"单点化"（不改变 Run 现有行为）；完整统一列为后续里程碑 |

**否决项（明确不做）**：为对齐 VSCode 而 vendor 30 个 jar 与自建 VSIX 提取通道 ——
与 Neeko"零新增 vendored 依赖"的姿态不相称；且 D1① 已用极低成本闭合了同一类静默错。

---

## 来源

**一手源码**
- `zed-extensions/java` `src/debugger.rs`（fork URL、`inject_plugin_into_options`、`start_session`、
  `resolveClassPath`、`JavaDebugLaunchConfig`、多入口硬报错）：
  https://raw.githubusercontent.com/zed-extensions/java/main/src/debugger.rs
- `microsoft/vscode-java-debug` `src/javaDebugAdapterDescriptorFactory.ts`（`startDebugSession` → `DebugAdapterServer`）：
  https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/src/javaDebugAdapterDescriptorFactory.ts
- `microsoft/vscode-java-test` `src/utils/launchUtils.ts`（服务端 `junit.argument` 构造 launch 配置、`noDebug`、
  TestNG runner jar、jacoco agent）：https://raw.githubusercontent.com/microsoft/vscode-java-test/main/src/utils/launchUtils.ts
- `microsoft/vscode-java-test` `src/constants.ts`（`vscode.java.test.*` 命令族）
- `microsoft/java-debug` `com.microsoft.java.debug.plugin/plugin.xml`（`vscode.java.startDebugSession` /
  `resolveClasspath` / `resolveMainMethod` 等 18 条 delegate command）：
  https://raw.githubusercontent.com/microsoft/java-debug/master/com.microsoft.java.debug.plugin/plugin.xml
- `microsoft/vscode-java-debug` `src/configurationProvider.ts`（`$Auto/$Runtime/$Test` 与 `resolveClasspath(mainClass, projectName, scope)`）：
  deepwiki 引用的 `resolveClasspath` 签名与返回 `[modulePaths, classPaths]`

**文档 / 元数据**
- Zed Java 文档（Java 21 要求、`java_home`、自动下载 JDTLS、debug 用 fork、`bundles` 初始化项、Windows tasks 限制）：
  https://zed.dev/docs/languages/java
- `redhat-developer/vscode-java` JDK Requirements 与 "Java 21 or more recent is required" 报错：
  https://github.com/redhat-developer/vscode-java/wiki/JDK-Requirements
- Maven Central `com.microsoft.java.debug.plugin`（Neeko 的默认来源）：
  https://central.sonatype.com/artifact/com.microsoft.java/com.microsoft.java.debug.plugin
- 本仓库既有调研：`research/java-debug-runability.md`、`research/vscode-java-run-debug-mechanism.md`、
  `research/java-jdtls-integration.md`（同目录上游任务 09-04）
