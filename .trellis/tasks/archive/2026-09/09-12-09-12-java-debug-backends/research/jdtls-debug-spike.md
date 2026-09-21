# S0 真机 spike：JDTLS + java-debug（结论）

> 挂靠任务：09-12-java-debug-backends。执行日期：2026-09-13。
> 方法：真机（macOS + JDK 21.0.12.1 + Homebrew jdtls 1.61.0 + Maven 3.9.16）跑一次性脚本，
> 通过 stdio LSP 驱动 jdtls，并以裸 DAP 客户端直连其 DAP 端口。脚本为一次性产物（`/tmp/neeko-s0/`），
> **不并入生产代码**。

## 结论（go / no-go）

**GO —— B' 全链路真机通过（Phase 1 + Phase 2 均 PASS）。**

| 判定对象 | 结论 |
| --- | --- |
| plugin 热装 + 命令注册 | **GO** |
| `startDebugSession` 取端口 | **GO** |
| DAP TCP 直连 + `initialize` | **GO** |
| `resolveClasspath` 真值 | **GO** |
| `shortenCommandLine` 被 core 接受 | **GO** |
| **`launch` 起 JVM + 断点命中** | **GO**（`breakpoint.verified=true` + `stopped(reason=breakpoint)`） |
| **栈 / 作用域 / 求值** | **GO**（`stackTrace` / `scopes` / `evaluate` 全部 `success=true`） |
| **`disconnect{terminateDebuggee:true}` 杀 JVM** | **GO**（真机确认 JVM 进程消失） |
| 握手顺序 | **`LaunchBeforeBreakpoints`**（launch → `initialized` → setBreakpoints → configurationDone；勿等 `initialized` 先于 launch） |

→ 因此 `AUTO_PREFERS_JDTLS` 已置 **true**（`auto` = B' 优先）；回退只需置回 `false`。

### Phase 2 过程中由真机证据确定的三条**载荷约束**（均已落入实现）

1. **`args` 必须是字符串**：传 JSON 数组会被 Gson 以
   `Expected STRING but was BEGIN_ARRAY at path $.args` 拒绝 → launch 请求被丢弃 →
   表现为 `setBreakpoints` 报 `Empty debug session` + 永无 `initialized`
   （这正是首轮 Phase 2 判 NO-GO 的真实原因）。
2. **Console Launcher 必须前置在 `classPaths` 首位**：其自带整套 `junit-platform-*` 类；
   若项目自带的旧版（实证为 5.10.2 的 `junit-platform-commons`）排在前面，JVM 会
   `NoSuchMethodError: PackageUtils.getModuleOrImplementat…` 并立即 `terminated`。
3. **`projectName` 必填**：缺它时 `evaluate` 直接失败 ——
   `Cannot evaluate, please specify projectName in launch.json.`（断点/栈/变量不受影响）。

## Phase 1：bundle / 端口 / 传输 / classpath（全部通过）

环境：`jdtls -data <tmp>`；`initializationOptions.bundles=[com.microsoft.java.debug.plugin-0.53.1.jar]`；
样例工程：Maven 单模块 + JUnit 5.10.2 + commons-lang3。

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 官方 Maven Central jar 可用 | **PASS** | `com.microsoft.java.debug.plugin-0.53.1.jar`（2.9 MB）为自包含 OSGi bundle：`Bundle-ClassPath: lib/commons-io…, ., lib/rxjava…, lib/reactive-streams…, lib/com.microsoft.java.debug.core-0.53.1.jar` |
| `vscode.java.startDebugSession` | **PASS** | 返回 `56984`（另有两次 `58247` / `59004`） |
| DAP TCP 直连 + `initialize` | **PASS** | `success=True`，能力含 `supportsConfigurationDoneRequest` / `supportsConditionalBreakpoints` / `supportsHitConditionalBreakpoints` |
| `vscode.java.resolveClasspath(com.example.CalcTest, "s0-demo", "test")` | **PASS** | `modulePaths=[]`、`classPaths=11`，含 `target/test-classes`、`target/classes`、`~/.m2/.../junit-jupiter-5.10.2.jar` |
| 就绪信号可观测性 | 观察 | 仅 `language/status`（`Starting…` → `ProjectStatus OK` → `Started`/`Ready` → **`ServiceReady`**）；**本次未出现 `$/progress`** |
| import 耗时（微型工程） | < 1s | 从 `initialize` 到 `resolveClasspath` 非空约 1s |

### 由 Phase 1 得出的两处方案修正（已落入文档与实现）

1. **就绪判据只看 `classPaths`**：普通（非模块化）Maven 工程 `modulePaths` **合法为空**。
   原 design §2.4 要求"两段均非空才 `Ready`"会让所有经典 Maven 工程永远停在 `Warming`。
2. **官方 jar 可用，Zed fork 非必需**：原方案把 Maven Central 作首选、fork 作备选的方向成立
   （Zed 改用自家 fork 并非因为官方 jar 不能加载）。→ 实现取官方 `0.53.1` 并 pin。

## Phase 2：`launch` 端到端（通过）

最终有效序列（`spike9.py`，全绿）：

```
LSP  initialize(bundles=[debug-plugin-0.53.1.jar]) → ok
     startDebugSession → port 50367
     resolveClasspath(com.example.CalcTest, "s0-demo", "test") → 11 classPaths
DAP  initialize → ok
     launch{mainClass:ConsoleLauncher, classPaths:[launcher, ...11], args:"execute -c … -m …",
            projectName:"s0-demo", cwd, shortenCommandLine:"argfile"} → ok
     initialized 事件
     setBreakpoints(line 12) → ok（随后 breakpoint.verified=true）
     configurationDone → ok
     stopped(reason=breakpoint, threadId=1)          ← **断点命中**
     stackTrace → ok；scopes → ok；evaluate("a + b") → ok
     disconnect{terminateDebuggee:true} → ok，且被测 JVM 进程消失
```

被验证排除的失败路径（保留以备将来排查）：

* `args` 传数组 → Gson 拒绝 → `Empty debug session` + 无 `initialized`（见约束 1）。
* classPaths 中 launcher 排在项目 junit 之后 → `NoSuchMethodError` + `terminated`（见约束 2）。
* 缺 `projectName` → 断点/栈/变量正常，但 `evaluate` 报错（见约束 3）。

被证否的猜测：曾怀疑 java-debug 不发 `initialized`（`InitializeRequestHandler` 与
`LaunchRequestHandler` 源码内确实都没有该事件的字面量）。真机证明 **`initialized` 会发**，
前提是 launch 请求能被正确解析 —— 即上面的约束 1。故 `HandshakeOrder::LaunchBeforeBreakpoints`
对本形态成立，**不需要** pipelined 变体。

## Phase 3：JDT 项目名（现场 bug 追加验证）

**现场 bug**：`JDTLS debug backend is unavailable: LSP error (-32001): Failed to resolve classpath:
The project 'tomgs-java' is not a valid java project.` —— 我此前用 **Neeko 项目目录名**当
`projectName`；`tomgs-java` 是 Maven 聚合根，jdt.ls 直接拒。

真机追加探针（`spike10.py` / `spike11.py`）证据：

| 调用 | 结果 |
| --- | --- |
| `resolveClasspath(cls, null, "test")` | **ok**（11 条 classPaths）→ **服务器能按类解析**，不需要项目名 |
| `resolveClasspath(cls, "proj"（目录名）, "test")` | error `The project 'proj' is not a valid java project.` |
| `resolveClasspath(cls, "s0-demo"（Maven artifactId）, "test")` | **ok** |
| `java.project.getAll`（无参） | ok，返回**项目 URI**：`["file:/private/tmp/neeko-s0/proj/"]` |
| `java.project.getAll(options)` | error（jdt.ls 1.61 的该形态不接受位置参数；options 形态亦报 `includeNonJava ... option is null`） |

**结论**：

1. **JDT 项目名 = 构建系统项目名**（Maven `artifactId` / Gradle 项目名），**不是目录名**。
2. **探测不该传名字**：`null` 时由服务器按类解析，天然正确。
3. 名字只用于 **launch 的 `projectName`**（`evaluate` 的硬前置）→ 因此采用
   **"候选（artifactId / 模块目录名）→ jdt.ls 验证 → 不成立则省略该字段"**；
   候选被拒**绝不是 terminal**，必须回落到按类解析。
4. 流程教训：**spike 必须走生产取值路径** —— 上一轮 S0 里 `projectName` 是我手工硬编码的
   `"s0-demo"`（恰好等于 artifactId），正好绕过了这条推导分支，所以全绿却没发现该 bug。

## 轴 ② 需求 checkpoint（R9 要求显式判断）

B' 相对 A 的用户可见增量只有三项（断点 / 步进 / 栈 / 变量 A 全有）：**求值表达式**、
**跨库源码查找**、**热替换**。

* **判定：需要**。本任务 R2 明确要求"栈 / 变量 / **求值**全可用"，且真机已证明 B' 下
  `evaluate` 可用（A 侧由 `NoopProviders` 恒降级）。
* 因此**不走中间档**（保留 A 引擎 + 仅用 `resolveClasspath` 喂 classpath），M0/M1/M2 的投入成立。
* 若将来"求值 / 跨库源码查找"不再是需求，最优解会退回中间档（成本低一个量级）。

## 未覆盖项（本机限制）

* **WSL**：本机无 WSL 环境 → 回环端口可达性结论**待补**（design §2.6 已标注）。
  Local 已由本 spike 验证；SSH 已在实现中显式拒绝（`java_debug_unsupported`），不再是未知项。
* SSH：设计上已判定不支持（无隧道设施），未在本轮验证。

## 复现方式

一次性脚本位于 `/tmp/neeko-s0/`（**不并入仓库**）；`python3` + 本机 JDK 21 + `jdtls` 即可：

```bash
# Phase 1：bundle 注入 / startDebugSession / DAP 直连 / resolveClasspath
python3 /tmp/neeko-s0/spike.py

# Phase 2（最终有效序列，全绿）：launch 字符串 args + launcher 前置 + projectName
python3 /tmp/neeko-s0/spike9.py
```

`spike9.py` 的关键载荷（与生产实现一致）：

```jsonc
{
  "mainClass": "org.junit.platform.console.ConsoleLauncher",
  "classPaths": ["<console-standalone.jar>", "...resolveClasspath 结果"],
  "args": "execute -c com.example.CalcTest -m com.example.CalcTest#testAdd --details=summary --disable-banner",
  "projectName": "s0-demo",
  "cwd": "/tmp/neeko-s0/proj",
  "shortenCommandLine": "argfile"
}
```
