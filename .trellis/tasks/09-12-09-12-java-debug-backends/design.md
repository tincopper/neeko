# 设计：Java Debug 双后端

## 0. 第一性原理

* 调试三要素：`classpath 真值` + `JDWP 控制` + `DAP 桥`。`java-debug core` 提供桥与控制，`classpath` 是唯一外部输入。
* 真值单源：构建系统（m2e/Buildship 解析结果）为真值；JDTLS 是其缓存视图；CLI 拼串（`dependency:build-classpath` + 手拼 output）是易碎副本。复用真值优于手抄真值。
* 正确优先于轻量：classpath 错误导致静默错（断点永不停、跑错用例），不可自诊；等待是显式成本，可显示进度。默认路径必须正确，轻量作显式选项。
* 摊销成本：JDTLS 为 Java 编辑已是沉没成本（`lsp/plugin/builtins/java.rs` 命中 `pom.xml/build.gradle` 即起 session）；常用态 B' 边际增量仅一次端口直连，低于另起 host JVM。
* 无聊优先：B' 与 VSCode/Zed 同构（`startDebugSession → 端口 → launch`）；A 的自写宿主仅在宿主缺席时有存在价值。

### 0.1 两个正交轴（必须分开论证）

本方案同时变更两件**互相独立**的事，选型理由不得混用：

| 轴 | 现状 | 目标 | 驱动因素 |
| --- | --- | --- | --- |
| ① classpath 来源 | 前端 `.neeko/java-classpath.txt`（`mvn dependency:build-classpath` + 手拼 `target/*`） | JDTLS `vscode.java.resolveClasspath` | 真值单源（§0 第 2 条） |
| ② DAP 引擎 | 自写 host + `attach-first`（`tools/java-host/`） | JDTLS 进程内 `com.microsoft.java.debug.plugin` + `launch` | 能力缺口（见下） |

* 只解决 ① 的**中间档**：保留 host 引擎，把 `resolveClasspath` 结果喂给它（host 由 `attach` 转 `launch`）——可绕开全部 §2.2 传输重构，但求值/补全/HCR 仍恒降级。
* 驱动 ② 的**硬需求**是能力，不是 classpath：A 路径 `IEvaluationProvider/ICompletionsProvider/IHotCodeReplaceProvider` 由 `NoopProviders` 顶住，源码查找只有文本级 provider。R2 明确要求"栈/变量/求值全可用"→ **换引擎成立**。
* 结论：② 的理由必须在选型中显式前置（"因要求求值/跨库源码查找，需 JDTLS 进程内 DAP 引擎"），**不得**作为 classpath 论证的附赠结论。

#### 轴 ② 的需求来源与 checkpoint（第 6 轮补）

换引擎的成本几乎全部由 ② 承担，而 ② 目前的理由是**能力清单**（"VSCode 有"）而非**用户可见需求** ——
这不足以支撑 M0 + M2 的投入。必须把差异写清并做一次显式判断：

| A（现状引擎）已具备 | A 缺失（B' 才补） |
| --- | --- |
| 断点 / 步进 / 调用栈 / 变量展开（JDI 全可用） | 求值表达式（`evaluate`）与调试控制台补全 |
| 文本级源码查找（`SimpleSourceLookUpProvider` + `sourcePaths`） | JDT 语义源码查找（第三方库 / JDK 源码可跳转） |
| — | 热替换（HCR） |

* **checkpoint（并入 S0 一并确认）**：若"求值表达式"与"跨库源码查找"不是本期的真实需求，
  则**最优解是中间档**（保留 A 引擎 + 仅用 `resolveClasspath` 喂 classpath），本任务成本下降一个量级，
  M0 / M2 均可不做。
* 该判断必须**显式做出并记录**，不允许以"VSCode 有所以我们也要"默认通过。

### 0.3 与业界方案的关系与边界（第 4 轮新增，见 `research/industry-comparison.md`）

**同构部分（不构成风险）**：三家（VSCode / Zed / Neeko）都走
`initializationOptions.bundles` → `workspace/executeCommand{vscode.java.startDebugSession}` → **TCP 直连端口**
→ adapter 侧 spawn 被测 JVM。JDK21 门槛是 jdtls 自身要求（VSCode 报 "Java 21 or more recent is required"），
不是本方案过度约束。传输解耦（M0）是补齐 Neeko 自身"adapter 恒为子进程"的架构债 —— 业界调试客户端原生支持连外部端口。

**能力边界与闭合方式（第 5 轮定案，D1）**：本方案只修 **classpath 真值 + 引擎能力**，
**不引入服务端测试选择器**（那需要 vscode-java-test 的 30 个 vendored jar，且
`com.microsoft.java.test.plugin` 不在 Maven Central —— 与"零新增 vendored 依赖"姿态不相称）。
VSCode 的精度来自第二个 bundle（`vscode.java.test.junit.argument`，服务端按 `nested-class:` /
`test-template-invocation:` / `dynamic-test:` 等 part 生成参数）。

因此**选择器精度不足这一"静默错"改由不变式闭合，而非靠提升精度**：

1. **launch 前校验**：类 / 方法 / `@Nested` 链必须经 LSP 语义（`documentSymbol`）确认存在，否则硬报错；
2. **launch 后断言（仅测试目标）**：必须观察到"至少发现 1 个用例"（Console Launcher 摘要行 / `--reports-dir` XML），
   0 用例即终止会话并明确报错，**不允许留下"running 但永不命中"的静默会话**。
   *main class 调试不适用*（无"用例"概念）—— 该分支只保留 launch 前的类存在性校验。

服务端选择器（java-test bundle）作为**可选升级**记录在案（`research/industry-comparison.md` §5 D1③），
由 S0 实测成本后另立任务决策，不阻塞本任务。

### 0.2 未知项前置（第 2 轮新增）

B' 的成立依赖若干**外部事实**（bundle 能否热装并注册命令、`resolveClasspath` 在真实多模块工程的返回值、`launch` 能否起被测 JVM、`shortenCommandLine` 是否被 core 接受、WSL 回环端口是否可达、disconnect 是否杀 JVM）。这些**不能靠读源码推定**，且失败会让 M2 的全部实现作废。

→ 按本仓库既有先例（`research/java-debug-runability.md` 对 A 设"host main 原型真机冒烟"硬门槛），B' 必须先过一个**可丢弃的真机 spike（S0，go/no-go）**，再决定是否投入实现。把真机验证放在实现之后是第 2 轮修正的主要结构问题。
→ **S0 排在 M0（契约解耦）之前**：S0 零生产代码、成本最低，却是否决 M0/M1/M2 的闸门；若先做 M0 再 no-go，重构完全白做。

## 1. 架构总览

```
前端 Debug 动作（testName/FQCN/method/cwd）
 → 前端按 dap.javaBackend 分发（dispatch hint；后端权威校验同一键）
   ├── host  → debug_java_attach（既有 A 流程，零改动；仅显式可达）
   └── auto/jdtls → debug_java_start
        → DapManager::start_java_debug（唯一编排点）
          → JavaDebugCapabilityProvider::probe（窄端口，lsp 侧实现）
               Ready{port, modulePaths, classPaths} → B'：launch_session_connected(DapSession::connect(addr), launch{...})
               Warming                              → 等待（进度 + 可取消）
               Unavailable{reason, staticallyDetectable}
                       → jdtls：报错不换引擎
                       → auto ：静态 terminal → 一次性询问后（用户确认）才走 A；其他 → 报错 + 显式切换入口
          → 选择器不变式：launch 前 LSP 语义校验；launch 后 0 用例即终止并报错
 → ManagedSession（DAP 会话 + 可选 debuggee guard，单条 shutdown 路径）
 → DebugPanel（断点/栈/变量/求值/控制台既有交互不变）
```

既有复用：`DapSession/client/protocol`、`HandshakeOrder::LaunchBeforeBreakpoints`、`ManagedSession::shutdown`、`launch_support::{resolve_build_dir, build_shell_argv, windows_cmd_quote}`、`JavaDebugTarget`、`dap.adapterBinaries.<kind>` 覆盖语义。

**关键前置顺序**：① S0 真机 spike（go/no-go，零生产代码）；② S0 go 后才解耦 `spawn`/`connect` —— 见 §2.2（M0）。现有 DAP 链路把「adapter 恒为 Neeko 子进程」写死在契约里（`DapSession::start` → `process::spawn_adapter`），B' 的适配器**不是** Neeko 的子进程，不解耦则 M2 无法实现。

## 2. 契约

### 2.1 配置契约

* 键：`dap.javaBackend`，值域 `"auto" | "jdtls" | "host"`，缺省 `auto`（缺键/非法值/读取失败一律按 `auto`）。
* 读取点：**后端权威读取**在 `DapManager::start_java_debug`（每动作实时 `load_config()` + `pointer("/dap/javaBackend")`）；**前端读取同一键仅作 dispatch hint**（决定是否发 B' 探测），不作为最终路由依据。
* `load_dap_adapter_override` 的 `/dap/adapterBinaries/<kind>` 语义不变（`java` 仍指 host jar 覆盖）。
* 前端 `AppConfig` 新增可选字段并映射三选 UI；Settings 写入经既有 `save_config`。仅全局键，不设 per-project / per-click 覆盖。

### 2.2 传输与进程契约（M0，关键修订）

现状约束（逐条对应，均为解耦必须处理项）：

| 现状 | 位置 | B' 下的冲突 |
| --- | --- | --- |
| `DapSession::start` 无条件 `is_available` → `resolve_spawn` → `spawn_adapter` | `dap/session.rs:106,119-123` | B' 无子进程可 spawn |
| `AdapterSpawn { program, args, transport }` 结构体 | `dap/types.rs:443-452` | 无法表达"外部端点"，`program:""` 哨兵禁用 |
| `launch_request_command(&self)` 与 `build_launch_args` 无"后端形态"入参（后者有 cfg 但现按 attach 硬写） | `dap/adapter/plugin.rs:28-30,46` | `JavaAdapter` 无法决定 B'(launch) / A(attach) |
| `resolve_spawn(&self, target, adapter_binary)` 无 config 入参 | `dap/adapter/plugin.rs:36-40` | 若走 spawn 路径则无法决定形态 —— 本设计让 B' **不走 spawn**，该问题随之消失 |
| `spawn_adapter` 必取 stdout/stderr/stdin 并造 `ProcessGuard` | `dap/process.rs:26-49` | B' 无管道、无守卫（改由会话层传 `None`） |
| `connect_transport(spawn, stdout, stderr, stdin, kill)` 五参绑定 spawn | `dap/transport.rs:48-54` | "置 no-op" 需假管道 —— 本设计**另加**直连助手，不动它 |
| `AdapterTransport` 为 `Copy` 且按值 `match` | `dap/types.rs:435`、`dap/transport.rs:58` | 加 `String` 变体需改 derive + match —— 本设计**不新增变体**，规避该改动 |

设计（**第 6 轮修订：新增"外部端点会话"入口，而非改造 spawn 抽象**）：

上述冲突的共同根源是"adapter 恒为子进程"，但**不必改造共享的 spawn 抽象**——
只需给会话层加一条外部端点入口：

* `DapSession` 拆为两段：
  * `start(...)`（签名不变）= 现有前半段（`is_available` → `pre_launch_task` → `resolve_spawn` → `spawn_adapter`）+ 新增的 `start_with(io, Some(guard), …)`；
  * `start_with(io: DapIo, guard: Option<ProcessGuard>, app, project_id, project_path, config, breakpoints)` = 共享尾部（建会话、`Arc::new_cyclic`、proc_out 泵、handshake、失败清理）；
  * `connect(addr, …)` = `transport::connect_tcp_addr(addr)` + `start_with(io, None, …)`，**跳过 `is_available` 与 `pre_launch_task`**（可用性由 §2.4 能力探测负责）。
* 新增 `transport::connect_tcp_addr(addr) -> Result<DapIo, AppError>`：直连、`proc_out_rx` 空通道、`stderr_buf` 空、无 kill 信号。
  **`connect_transport`（spawn 路径）完全不动**。
* 后端形态改为**配置驱动**而非适配器实例驱动：
  * `launch_request_command(&self, cfg: &LaunchConfig)` 由 `cfg.request` 决定 `launch` / `attach`（Go / Lldb 恒 `launch`）；
  * `build_launch_args(cfg, workspace)` 已接收 cfg，据 `cfg.request` 分支。
  → 无需给 `resolve_spawn` 加 config 入参，也无需 `is_available(target, backend)`。
* `ManagedSession.debuggee` 与 `DapSession.kill` 本就是 `Option`，B' 传 `None` 即可。
* **禁止** `program:""` 哨兵与假管道占位（两条路线都不允许）。

**为什么把"`AdapterSpawn` 枚举化"（原方案甲）降为备选**：枚举化牵动
`AdapterSpawn` / `AdapterProcess` / `AdapterTransport`（`Copy` + 按值 `match`）/ `connect_transport` / `resolve_spawn` 签名
**五处共享面**，收益只是"共用同一条构造路径"。方案乙（外部端点入口）改动局限在
`session.rs`（拆函数）+ `transport.rs`（加一个直连助手）+ `adapter/*`（命令名随 cfg），
**go / lldb / A 三条既有路径逐字不动**，回归面最小 —— 符合"最小必要改动"。
若将来出现第二个外部 DAP 端点消费者（需要统一编排），再考虑枚举化。

### 2.3 适配器契约

* `resolve_spawn`：**仅 A 路径使用**（保持不变，返回 `AdapterSpawn{java -jar <host.jar>, TcpListen}`，jar 缺失 / `java` 缺失按现有错误文案）；B' 经 `DapSession::connect` 不 spawn。
* `build_launch_args(cfg, workspace)`：据 **`cfg.request`** 分支——
  * `launch`（B'）组 `launch{request:"launch", mainClass: ConsoleLauncher, classPaths: resolve + console-standalone.jar, modulePaths: resolve 首段, args:[execute -c FQCN -m 'FQCN#method' --reports-dir], cwd}`；`shortenCommandLine` 是否被 core 接受由 S0 定（见 §3）。
  * `attach`（A）组 `attach{request:"attach", hostName, port, projectName, sourcePaths:[cwd + classpath], timeout:30000}`（`AttachArguments` 无 `classPaths` 字段，classpath 经 `sourcePaths` 到达 host）。
* `launch_request_command(cfg)`：返回 `cfg.request`（Go / Lldb 恒 `"launch"`）；A 的 `entry_function_for_stop_on_entry` 保持 `None`。
* ✅ **`launch` 形态的 `handshake_order` 已由真机确认 = `LaunchBeforeBreakpoints`**
  （`research/jdtls-debug-spike.md` Phase 2）：launch → `initialized` → setBreakpoints → configurationDone
  → `stopped(reason=breakpoint)`。**不需要** pipelined 变体（此前的 NO-GO 由下面的约束 ① 造成）。
* **三条由真机确定的载荷约束（缺一即静默失败，已全部落入实现）**：
  1. **`args` 必须是字符串**：传数组会被 Gson 以 `Expected STRING but was BEGIN_ARRAY at path $.args`
     拒绝 → launch 被丢弃 → `setBreakpoints` 报 `Empty debug session`、永无 `initialized`。
  2. **Console Launcher 必须前置在 `classPaths` 首位**：其自带整套 `junit-platform-*`；项目自带的
     旧版（实证 5.10.2）排在前面会 `NoSuchMethodError: PackageUtils.getModuleOrImplementat…` 并 `terminated`。
  3. **`projectName` 必填（对 `evaluate` 而言）**：缺它时 `evaluate` 失败
     （`Cannot evaluate, please specify projectName`），断点/栈/变量不受影响。
     但**只有经验证的名字才可填**（见 §2.4 的项目名规则）——填错名字比省略更糟：
     jdt.ls 会直接拒整次 probe。
* `is_available(target)`：**语义收窄为"A 路径可用性"**（`java` + host jar）；B' 可用性由 §2.4 探测回答。
  * ⚠️ **前端门控目前只认它**：`dap_check_adapter` → `JavaAdapter::is_available`，缺 host jar 即拦，
    且文案指向 `tools/java-host/build.sh`（`src/features/debug/store/debugStore.ts:203-216`）。
    结果是 JDK21 + jdtls 但**没有 host jar** 的用户会在 B' 启动前就被拦住 —— 见 §4「前端门控修正」。

### 2.4 能力契约（第 2 轮重写）

**问题**：上一版把就绪判定写成 `JDK21 + session 存活 + plugin 已装 + import 完成 + resolve 非空` 五连判据，由 `DapManager` 逐项求值。这有两个缺陷：

1. **在 DAP 域复制 LSP 域的健康知识**（JDK/JAVA_HOME/session/import 都是 LSP 侧状态），违反单一事实源；
2. **依赖信号订阅的语义假设**（`language/status` 的 `ServiceReady` 是否等价于"可调试"、`$/progress` 的 import token `end` 是否必发），这些是外部不确定项，把不确定性引入了核心判定。

**设计**：dap 侧定义窄端口，由 lsp 侧实现，**一次带类型的探测调用**回答"这个项目现在能否用 JDTLS 调试"：

```rust
enum JavaDebugCapability {
    Ready { port: u16, module_paths: Vec<String>, class_paths: Vec<String> },
    Warming { detail: String },          // import 进行中：稍后可成
    Unavailable { reason: JavaDebugUnavailable },
}
enum JavaDebugUnavailable {
    LspUnavailable,      // 无 java session / 服务器起不来 / 运行 JDK 不足
    BundleMissing,       // debug bundle 未加载（startDebugSession 报未知命令）
    ProbeFailed(String), // startDebugSession 其他错误
}
```

探测顺序（`JavaDebugCapabilityProvider::probe(project_path, test_class, project_name)`）：

1. java LSP session 不可用 → `Unavailable(LspUnavailable)`。
2. `vscode.java.startDebugSession`：成功即**同时证明** "server 就绪 + bundle 已加载 + 端口可取"（这三件事不再需要单独判据）；报未知命令 → `Unavailable(BundleMissing)`；其他错误 → `Unavailable(ProbeFailed)`。
3. `vscode.java.resolveClasspath(test_class, project_name, "test")`：**`classPaths` 非空 → `Ready`**（`modulePaths` 合法为空 —— S0 真机实测普通 Maven 工程 `modulePaths=[]`、`classPaths=11`；要求两段都非空会让所有经典 Maven 工程永远停在 `Warming`）；`classPaths` 空 → 按下方交叉验证判定。
   * **`Warming` 必须与 LSP 侧交叉验证（第 4 轮新增）**：`classpath 空` 不等于"正在导入"。判定顺序为
     ① 无 java session / 服务器起不来 → `Unavailable(LspUnavailable)`；
     ② resolve 空 **且** LSP 侧存在进行中的 import 进度 → `Warming`；
     ③ resolve 空 **但无进行中进度** → `Unavailable(ProbeFailed)` 直接报错。
   * 理由（业界对照）：VSCode/Zed 对 resolve 空一律**硬报错**，可预测；若把空值一律当 `Warming`，
     会把**真损坏的工程**误判为"稍后可成"，把硬错误拖延成超时错误。交叉验证保留 Neeko 的体验优势又不牺牲诚实性。
   * ⚠️ **实现前提（第 6 轮补）**：LSP 侧目前**不保留** progress 状态 —— `handle_progress_notification`
     只把 begin/report/end 转发成事件（`lsp/session/notify.rs` → `push_progress` → Tauri 事件），全仓无在途 token 集合。
     故 M1 必须补：在 LSP 会话内**跟踪在途 progress token**（begin 加入 / end 移除），并暴露"该 project+language
     是否有在途 import 进度"的查询供探测使用。否则第 ③ 步无法实现，实施者只能自行发明（正是要避免的）。

* `language/status` / `$/progress` **仅用于 loading 展示**（进度文案/百分比），不再是就绪判断的硬依赖；上一版 §2.4 的就绪信号要求随之撤销。
* `modulePaths` 与 `classPaths` 两段均消费（模块化工程）；但**就绪只看 `classPaths`**（见上，S0 证据）。
* 端口为 `int`，`addr` 由 `127.0.0.1:<port>` 组合（§2.2）。
* **探测范围不含"测试选择器能力"**（第 5 轮明确）：选择器仍由客户端文本级构造，故探测**不能**保证"用例会被选中"。
  该风险由 §0.3 的两条不变式（launch 前语义校验 + launch 后 0 用例硬失败）闭合，不由探测承担。

### 2.5 路由契约（第 5 轮重写，采纳 D3：不自动切换引擎）

```
前端读 dap.javaBackend（dispatch hint；后端权威校验）
 ├ host  → debug_java_attach（既有 A 流程，不探测 B'，无额外开销）
 ├ jdtls → debug_java_start(mode=jdtls)
 │           Ready                  → B'
 │           Warming                → 等待（不降级）
 │           Unavailable(terminal)  → 报错，不换引擎
 └ auto  → debug_java_start(mode=auto)：判定与 jdtls 相同，**但不自动切换引擎**
             Ready                    → B'
             Warming                  → 等待（进度可见 + 可取消 + 重试）
             Unavailable(静态可判定)   → 一次性显式询问「改用 Host 后端（功能受限）」
                                        → 用户确认才走 A，并按项目会话记忆；拒绝则中止并保留 jdtls 配置
             Unavailable(其他/运行期)  → 报错 + 提供显式切换入口（不询问、不自动）
```

* **为什么取消自动降级（D3 最优解）**：自动换引擎 = 用户以为在用 B'，实际拿到能力不同（无求值）+ classpath 易碎（A 无校验）的 A，
  属于**静默改变语义**，与 §0"正确优先于轻量"冲突。业界（VSCode / Zed）均为"一条正确路径 + 硬报错"。
* **保留可用性出口**：A 仍可到达，但必须**用户显式发起**（确认一次即等价于显式选择 `host`）。
* **静态 vs 动态判定**：无 JDK21 / jdtls 未安装属**事前可静态判定**的 terminal，可安全地一次性询问；
  bundle 未加载 / resolve 失败 / 运行期失败可能瞬时或需诊断，一律报错 + 显式入口，不替用户决定。
* **降级后的 UI**（保留第 2 轮可见性要求）：常驻标注 `host (fallback)` + 求值输入禁用提示 + 「重试 JDTLS」恢复入口。
* **记忆范围**：仅按项目会话记忆（不写全局配置）—— 避免把一次临时选择固化成长期配置。
* **探测不阻塞 IPC**（第 2 轮结论保留）：`debug_java_start` 立即返回
  `session` / `warming` / `unavailable{ reason, staticallyDetectable }`；绝不在一次 invoke 内长时间等待 import。
  * `warming` 重试触发 = 既有 LSP 进度提示（仅作 UI 提示与重试时机，**不作正确性判据**）+ 手动「重试」；**不做高频轮询**。
  * 取消 = 前端停止重试并关闭 loading，无需中断后端（后端本就无挂起调用）。
* **运行期失败不降级**：launch 请求或 DAP 握手失败 → 报错进 console + notification，不切 A（避免半开状态与孤儿 JVM）。
* ✅ **`auto` = B' 优先（第 8 轮转正）**：S0 Phase 2 真机全绿（bundle → 端口 → DAP → launch →
  **断点命中** → 栈/作用域/**求值** → `terminateDebuggee` 杀掉 JVM），故 `AUTO_PREFERS_JDTLS = true`。
  回退只需把该**单个常量**置回 `false`（`auto` 立即退化为 host-first，行为与此前一致）。

### 2.6 环境契约（第 2 轮修正）

依赖前提：**Neeko 进程必须能直连项目环境的回环端口**（`dap/transport.rs:135` 在 Neeko 进程内 `TcpStream::connect(addr)`，全仓无端口转发/隧道设施：`tunnel` / `direct-tcpip` / `forward_port` 检索为空）。

| 环境 | B' | A | 说明 |
| --- | --- | --- | --- |
| Local | 支持 | 支持 | 确定可达 |
| WSL | 待 S0 实测 | 待 S0 实测 | 依赖 WSL2 localhost forwarding；不通过则同样归入不支持 |
| SSH | **不支持** | **不支持** | 端口在远端 |

* **修正点**：上一版把 A 当作 SSH 的兜底。事实上 A 同受限 —— `JavaDebuggee` 在远端 spawn 测试 JVM、host jar 也在远端 `TcpListen`，而 connect 发生在本机（`transport.rs:135`）→ SSH 下 A 同样连不上。
* 因此 SSH 项目必须**显式报错 + 指引**（说明 Java 远程调试需另行方案），不得静默降级到 A 后失败在一个更难懂的错误上。
* 备查：host 改走 stdio 可使其在 SSH 可用（去掉 TcpListen 需求）；但 A 已判死缓（M5）→ 不做，仅记录。
* 支持 SSH 需要新增端口转发能力 → **独立任务**，不在本期。

### 2.7 领域依赖契约

* 问题：B' 需要 LSP 域的状态与命令；若 `dap::manager` 直接调用 `AppStateWrapper.lsp_manager`（`app_state.rs:60`），则 dap 域直接依赖 lsp 域内部。
* 设计：dap 侧定义窄端口 `JavaDebugCapabilityProvider`（§2.4），由 lsp 侧提供适配实现，`AppStateWrapper` 注入。dap 单测注入 fake，不构造 LSP 运行时；LSP 生命周期策略（是否自动启动 session 等）留在 LSP 域内部，dap 只消费结果。

### 2.8 断点源路径契约（第 11 轮新增）

**问题**：JDK / 依赖源码上的断点在 B' 下**永不命中**。真机证据
`[DAP] adapter did not resolve 1 breakpoint(s) in jdt:/java.base/java/io/PrintStream.java: lines 1167`。

**根因（反编译 java-debug 0.53.1 实证）**：断点类名的唯一来源是
`JdtSourceLookUpProvider.getBreakpointLocations` → `asCompilationUnit(sourceUri)`，它只接受两种形态：

1. **真实存在的文件路径**（`AdapterUtils.toPath` 成功且 `Files.isRegularFile`）——类名由 JDT AST 推出
   （`ValidBreakpointLocationLocator`，**不需要** project bindings，故工作区外的 JDK 源码同样可用）；
2. `jdt://contents/<module>/<pkg>/<Name>.class?<JDT handle>`（`resolveClassFile` 要求 scheme/authority/query 三者齐备）。

Neeko 前端把「JDK 缓存路径」与「`jdt://` 虚拟页」统一归一为 tab 身份 `jdt:/<module>/<pkg>/<Name>.java`
（`fileRef.tabIdentityOf`），而这个身份**两者都不满足**（`Paths.get(URI)` 抛 `FileSystemNotFoundException`；
authority 为 null ≠ `contents`）→ 无 `className` → 适配器回 `verified:false` → 静默不命中。
handle 无法取得（LSP `jdt://…?<attrs>` 的 query 是 jdtls 属性编码，不是 JDT handle），故只能走形态 1。

**契约**：

* **身份唯一**：`jdt:/…` 仍是 tab / 断点 key / 黄线 / 导航历史的规范身份（`.neeko/breakpoints.json` 不迁移）；
* **形态 1 为唯一下发形态**：翻译发生在 **DAP 边界且仅此一处**（`dap/java_source_path.rs` 定义端口，
  `lsp/java_source_materializer.rs` 实现，组合根注入）——落到真实文件：缓存命中即复用，
  缺失则从 `<JDK>/lib/src.zip`（JDK）或同目录 `<stem>-sources.jar`（依赖）解压到 host 既有布局；
* **两个后端收敛到同一形态**：host（A）与 jdtls（B'）都收到真实路径，**host 的 `jdt:/` 私有解析分支随之删除**
  （改为明确拒绝）—— 规范向 java-debug 收敛，不反向适配；
* **绝不下发伪路径**：不可解析的断点被剔除并在 Debug Console 给出可操作原因（宁可不下发，也不发一个
  必然被适配器静默丢弃的路径）；
* **歧义拒绝**：依赖源码按 (包, 文件名) 命中多个 stem 时不下发（错源码 → 错类错行，比不命中更难排查）。

## 3. 后端设计

* `commands.rs`：新增 `debug_java_start`（薄调度，仅 B' 入口）；保留 `debug_java_attach`（**A 的唯一入口，且是显式入口**：`host` 配置或用户在降级询问中确认后才调用，不存在自动调用路径）；新命令只做参数接收 + 调度（D3 定案）。
* `manager.rs`：新增 `start_java_debug(target, mode)`；既有 `start_java_attach` 更名下沉为 `start_java_via_host`（逻辑不变）；新增 `start_java_via_jdtls(capability)`（直接用探测结果里的 port/classPaths 建 `LaunchConfig{request:"launch"}` → `launch_session_connected(...)` → `DapSession::connect(addr, …)`）。
* **多模块/多入口歧义 → 硬报错（第 4 轮新增，对齐 Zed）**：Zed 在入口点 >1 时报
  `Project have multiple entry points, you must explicitly specify "mainClass" or "projectName"`，绝不猜。
  Neeko 的 `projectName` 由前端按模块根推导，**歧义或推导失败时必须报错并指引用户显式指定**，
  禁止静默取第一个候选 —— 静默取错模块等于又一次"静默错"（§0）。
* **选择器不变式（第 5 轮新增，D1 最优解）**：不引入服务端选择器，改用两道不变式把"静默错"变成"显式错"：
  * **launch 前**：`test_class` / `method` / `@Nested` 链必须经 LSP 语义（`documentSymbol`）确认存在，
    不存在即硬报错、不建会话（现有 `withJavaNestedClassPath` 已是该方向，需补"存在性校验"而非仅补层级）。
  * **launch 后（仅测试目标；main class 调试不适用）**：必须观察到"至少发现 1 个用例"（Console Launcher 摘要行 / `--reports-dir` XML），
    0 用例即终止会话 + 明确报错（含请求的选择器与可能原因），**不允许留下 running 但永不命中的会话**。
* **启动参数构造单点化（第 5 轮新增，D8 方向）**：把"用例身份 → Console Launcher 参数"收敛为**唯一纯函数**，
  Run 与 Debug 共用（Run 追加 `--reports-dir`，Debug 额外注入 jdwp），消除两份选择器逻辑的漂移。
  本期先完成单点化且**不改变 Run 的现有行为**；Run 走同一来源属后续里程碑。
* `java_debuggee.rs`：仅 A 用；B' 不创建 `JavaDebuggee`。
* B' 的 debuggee 生命周期：测试 JVM 由 adapter 侧 `LaunchRequestHandler` 注入 jdwp 后 spawn，**不是 Neeko 子进程**，`ManagedSession.debuggee = None`，`shutdown` 退化为 `session.stop()`：
  * 必须发 `disconnect{terminateDebuggee: true}`，否则测试 JVM 残留；
  * 远端无法兜底 kill，只能依赖 adapter 侧清理 → S0 实测 disconnect 后 JVM 是否退出。
* `adapter/java.rs`：按 §2.3 切双形态；`host_jar_path[_in]`、`JAVA_HOST_JAR_ENV`、`install_hint` 保留给 A。
* `lsp/plugin/builtins/java.rs`：`initialization_options` 追加 `bundles:[<debug plugin 绝对路径>]` 与 `settings{java.import.maven.enabled, java.import.gradle.enabled, java.configuration.updateBuildConfiguration}`；install 链保持 `brew → 官方 tar.gz`（`java_install.rs`），删除残留 npm 指引；`tuning{skip version, JAVA_HOME}` 不动。
  * **`updateBuildConfiguration` 取值（第 5 轮定案，D6）**：**默认 `interactive`，对齐 VSCode / Zed**——
    该键作用于**整个 Java 编辑会话**（构建文件变化即自动更新配置并触发重建），不应为调试便利而全局放开。
    classpath 新鲜度改由**按需刷新**解决：调试前在需要时显式调用 `vscode.java.buildWorkspace`
    （java-debug bundle 已提供，见 `plugin.xml`），把成本限制在调试路径内。
    `automatic` 仅在 S0 实测"`resolveClasspath` 返回陈旧结果"时作为最后手段启用，并记录理由。
  * **bundle 版本必须 pin + 校验（第 5 轮新增，D5）**：debug plugin 与 jdtls 版本强耦合，
    禁止 `latest` / 浮动版本；下载后校验（hash 或固定 URL + 版本号），失败即 `BundleMissing` 报错。
  * `bundles` 仅在 `initialize` 读取 → 已存在的 jdtls session 不会加载新 bundle；`BundleMissing` 被探测到时显式重启一次 session（或提示重启），不得静默失败。
* **待 S0 定论（不在实现前写死）**：
  * `shortenCommandLine`（`none|argfile|jarmanifest|auto`）是否被 `com.microsoft.java.debug.core` 接受；接受则固定 `argfile` 以规避 OS 命令行上限（Windows 约 32KB）。
  * `classPaths` 同时含 `junit-platform-console-standalone`（自带 Jupiter/Vintage 引擎）与项目自带 junit 引擎的实际行为（重复引擎/版本偏差）；定论后确定去重或优先规则。
  * **plugin 来源（D5）**：官方 Maven Central 版与 Zed fork（pin 0.53.2）在 `launch` 路径上的行为差异；
    判据是**行为**而非"官方优先"；不可用则直接采用 fork，禁止自建 fork。
  * **classpath 新鲜度（D6）**：`resolveClasspath` 是否需要 `vscode.java.buildWorkspace` 预刷新；
    不需要则不调用（避免无谓全量构建）。
  * **服务端选择器成本（D1③）**：记录引入 java-test bundle 的真实代价（~30 jar、无 Maven 坐标、
    需自 VSIX 提取或自建），作为**独立后续任务**的决策输入，不阻塞本任务。
* A 侧自动 `test-compile`（第 2 轮收窄）：**仅在编译产物缺失时触发一次**，失败即阻断并报错；不得无条件前置构建（避免掩盖用户意图与无谓耗时）。
* 错误矩阵：B' 前置不可用 → `AppError::Dap` 细分文案 + DebugPanel console + notification；A 缺失（jar / JDK / 空 command / cwd）→ 既有文案；SSH → 显式不支持文案；构建目录非法 → `launch_support` 既有校验。
* **失败诊断入口（第 6 轮补）**：B' 的 DAP 服务器与 bundle 都长在 jdtls 进程内，其错误不以 adapter stderr 形式出现
  （A 有 `stderr_buf` 聚合，B' 没有）。故错误文案必须**指向既有 LSP 服务器日志**（`get_server_logs` / 服务器日志面板），
  否则用户面对 `startDebugSession` 失败时无从排查。此点列入 M2 的 UX 收尾项。

## 4. 前端设计

* API：`features/dap/api` 新增 `debugJavaStart`；既有 `debugJavaAttach` 保留且**零改动**；`invoke` 不出 `api/` 目录。
* **命令契约（第 5 轮修订）**：
  * `debugJavaStart{project_id, cwd, test_class, method, project_name, mode: "auto"|"jdtls"}` →
    `{ kind: "session", session } | { kind: "warming", detail } | { kind: "unavailable", reason, staticallyDetectable }`
  * **无 `fallbackToHost`（D3 定案）**：后端不替用户换引擎。`unavailable` 只携带原因与
    "是否属可静态判定的 terminal"标记，前端据此决定是**一次性询问**还是**报错 + 显式切换入口**。
  * A 的输入（`command` / `classpath`）**不进新命令**：`mode=host` 或用户在降级询问中确认后，
    前端直接走既有 `debug_java_attach`。避免"参数并集"，也避免在 B' 路径上无谓触发
    `ensureJavaClasspathFile`（`mvn dependency:build-classpath`）的成本。
  * 上一版的 `command?`/`classpath?` 参数、`fallbackToHost` 结果与 `degraded` 会话字段均不上线。
* **dispatch**：前端读 `dap.javaBackend` 决定是否发起 B' 探测（hint）；后端在同一次调用内权威复核该键，两者不一致以后端为准。
* **前端门控修正（第 6 轮，关键）**：现有 `launchSession` 在起会话前**无条件**调 `dapCheckAdapter(projectId, config.type)`
  （`src/features/debug/store/debugStore.ts:203-216`），Java 的判据是"`java` 存在 + **host jar 存在**"，
  文案指向 `tools/java-host/build.sh`。B' 不需要 host jar →
  **该门控会让目标用户（JDK21 + jdtls，无 host jar）在能力探测之前就被拦住，B' 根本到不了后端**。
  修正：
  * `dap.javaBackend ∈ {jdtls, auto}` → **跳过** `dapCheckAdapter('java')`（可用性由 §2.4 探测回答，错误文案由探测结果给出）；
  * `dap.javaBackend = host` → 保留门控与现有文案；
  * `dap_check_adapter` 的 Java 语义**不变**（它回答的是"A 路径可用性"），避免影响其他调用方；
  * 单测：三种后端取值下的门控行为（跳过 / 保留）与跳过时不再出现 host jar 文案。
  * **跳过后的兜底**：用户确认降级走 A 时，若 host jar 确实缺失，由后端 `is_available` 报出与现有 A 相同的错误文案
    （门控只是"不再提前拦 B'"，不放弃 A 自身的可用性校验）。
* **`auto` 与 `jdtls` 的语义边界（第 6 轮明确）**：两者都**不自动换引擎**，差异仅在静态 terminal 的 UX：
  * `auto`：静态 terminal（无 JDK21 / 未装 jdtls）→ 一次性询问是否改用 Host；其他不可用 → 报错 + 显式入口；
  * `jdtls`：任何不可用都只报错（不询问）；
  * `host`：只用 A。
  → 三选语义可一句话说清，不存在"auto 悄悄换了后端"的解读空间。
* Settings：Debug/Java 分区三选 radio（Auto/JDTLS/Host）+ 说明行（Auto 语义、JDK21 门槛、SSH 不支持 Java 调试、host 能力受限）；即时保存语义与既有 ProjectPanel 一致。
* DebugPanel：副标题显示 `Java · jdtls | host | host (fallback)`；`Warming` 期间显示 loading + 可取消 + 「重试 / 改用 Host」；
  `unavailable` 时按 `staticallyDetectable` 分流为一次性询问或错误 + 切换入口；降级后为**常驻标注** + 求值输入禁用提示 + 「重试 JDTLS」。
* 类型：`shared/types` 新增 `JavaDebugBackend = "auto"|"jdtls"|"host"`、`JavaDebugStartResult`（三态）；`DapSessionInfo` 增 `backend`（展示用）；`TestCaseInfo`/`TestLaunchSpec` 扩展沿用既有 `lang` 分支模式。

## 5. 启动形态与发行

* JDTLS：`java -Declipse.application=org.eclipse.jdt.ls.core.id1 … -jar equinox.launcher -data <per-project>`（wrapper 按 cwd 哈希派生 `-data`；直连 java 时 Neeko 生成 `~/.neeko/jdtls/data/<hash>`）；运行需 JDK21+；stdio 即 LSP。
* debug plugin jar：`com.microsoft.java:com.microsoft.java.debug.plugin`（Maven Central 已发布，实测可获取；Zed fork release 作备选）；经 `bundles` 热装（`BundleUtils.loadBundles`），与拷进 `plugins/` 等价。生效时机见 §3。
  * **必须 pin 版本 + 校验**（禁止 `latest`/浮动版本）：bundle 与 jdtls 版本强耦合；来源取舍以 S0 实测行为为准（D5）。
  * **不引入 vscode-java-test 的测试 bundle**：`com.microsoft.java.test.plugin` 不在 Maven Central，
    且其 `javaExtensions` 依赖闭包共 30 个 jar（实测）→ 与"零新增 vendored 依赖"姿态不相称，
    选择器问题改由 §0.3 / §3 的两道不变式闭合（D1）。
* console-standalone jar：双后端共用（B' 作 `classPaths` 一项；A 作 `-jar` 被测体）；版本固定 1.x 线（Java 8+ 下限宽，`--reports-dir` 同为 legacy XML）。

## 6. 取舍与兼容

* 双路维护成本有界的前提是 §2.2 契约先解耦；否则每次后端差异都会渗进 session/process。
* **A 的定位收窄为「显式可选后端 + bugfix」**（第 5 轮，D3）：不再是自动兜底路径（无自动调用者），
  已被 M5 判死缓，M3 只修"静默错"类缺陷，不投入形态增强。
* **M0 的性质是通用 DAP 能力补齐**（第 5 轮，D4）："adapter 恒为子进程"是 Neeko 自身的架构债，
  解耦后对**任何外部 DAP 端点**都成立，价值独立于 Java。故 M0 应独立评审（建议独立提交/独立小任务），
  不记入"Java 双后端"的复杂度账；但仍由 S0 go 触发，不提前做。
* **不 vendor 测试 bundle**（第 5 轮，D1）：不为对齐 VSCode 的测试调试精度而引入 30 个 jar 与
  自建发行通道；同一类"静默错"用两道不变式以零依赖成本闭合。
* **启动参数构造单点化**（第 5 轮，D8 方向）：Run 与 Debug 共用同一份参数构造纯函数
  （Run 追加 `--reports-dir`，Debug 注入 jdwp）；本期只做单点化不改 Run 行为，完整统一列后续里程碑。
* 不做：Rust JDWP 桥；SSH 端口转发；host 改 stdio（A 待删）；Gradle Tooling API 直问；A 侧多模块 `-pl -am` 全自动、init 脚本注入（超单模块即指引 B'）；服务端测试选择器（java-test bundle）。
* 回滚：**S0 spike no-go → 跳过 M0/M1/M2**（不做契约重构、不做能力探测、不投 B' 实现），本任务收敛为「A 既有能力 + A 的 bugfix + 文档 + 显式不支持声明」；M2 实现后未达标 → `auto`/`jdtls` 一律**报错并给显式切换入口**（不自动换引擎，D3），配置缺省即 `auto`。

## 7. 风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| **选择器不精确（文本级构造）** | 会话 running 但断点永不命中（**静默错**） | **两道不变式**（D1）：launch 前 LSP 语义校验类/方法/`@Nested` 链；launch 后 0 用例即终止 + 报错 |
| bundle 无法热装 / 版本配对不兼容 | 无 `startDebugSession` | **S0 前置验证**；pin 版本 + 校验；失败显式报错 + 提示重启 session |
| `resolveClasspath` 在真实工程返回不可用 | B' 无法起 JVM | **S0 前置验证**；no-go 即停止 M2 |
| `shortenCommandLine` 不被 core 接受 | 大工程超长 classpath 启动失败 | S0 定论；不接受则记录并限制适用规模 |
| 重复 junit 引擎 / 版本偏差 | 用例重复执行或 `NoSuchMethodError` | S0 实测；定去重/优先规则 |
| B' 被测 JVM 生命周期 | disconnect 后 JVM 残留（非 Neeko 子进程） | 明确 `disconnect{terminateDebuggee:true}`；S0 实测 |
| WSL 回环端口不可达 | WSL 用户 B'/A 均不可用 | S0 实测；不通过则 WSL 归入不支持并同步 §2.6 |
| 首开大项目导入分钟级 | Debug 点击长时间阻塞 | `Warming` 等待 + 进度 + 可取消（不自动换引擎，D3） |
| 用户降级后忘记回到 B' | 长期停留在能力受限的 A | 常驻标注 + 「重试 JDTLS」入口；记忆仅限项目会话（不写全局配置） |
| Windows 无 POSIX 回退 | jdtls/debug bundle 安装受限 | 复用 `NO_FALLBACK`，手动指引 |

## 8. 修订说明

### 第 11 轮（2026-09-13，现场 bug ③：JDK / 依赖源码断点永不命中）

**现场现象**：在 `java.io.PrintStream.println` 上打断点，会话跑起来但永不命中；
`~/.neeko/neeko.log` 两次 `[DAP] adapter did not resolve … jdt:/java.base/java/io/PrintStream.java: lines 1167`。

1. **根因**：断点以**前端 tab 身份** `jdt:/<module>/<pkg>/<Name>.java` 原样下发，而 java-debug 的
   `asCompilationUnit` 只认「真实存在的文件」或「`jdt://…?<JDT handle>`」——详见 §2.8。
   这不是"行号错"，是**路径形态不可解析**（日志里行号 1167 与源码一致）。
2. **决策（用户给定优先级）**：以 java-debug 的标准为第一优先级；**host 规范向之收敛**，而非让
   java-debug 适配 host。故 `SimpleSourceLookUpProvider` 的 `jdt:/` 私有分支由"解析"改为
   **明确拒绝**（按文件名猜默认包会得到错类，比不解析更难排查）。
3. **实现**：新增 dap 侧端口 `JavaSourcePathProvider`（§2.7 同构）+ lsp 侧实现
   （`java_source_materializer.rs`：`resolve_java_home` → `lib/src.zip` 解压；依赖走同目录
   `-sources.jar`），在 `launch_session` / `set_breakpoints` 两处边界翻译；落盘复用 host 布局
   （`java-src-cache/jdk-src-<ver>/<module>/<pkg>/<Name>.java`），前端 `jdtIdentityOfJdkCachePath`
   会把该真实路径映射回同一 `jdt:/…` 身份 → 不产生第二种 tab 身份。
4. **顺带修正**：`session.rs` 的未解析提示原本举 `fn main`（Delve 场景）并把 Java 的路径形态问题
   归因成"代码没编进去"，改为语言中立且不臆测原因；`tools/java-host/test.sh` 原先把**测试**编译到
   旧的 host classes 上（可在源码已改时验证旧字节码），改为 host+测试一起从源码重编译。

### 第 10 轮（2026-09-13，现场 bug ②：`expand_config` 把"拷贝"写成"清空"）

**现场错误**：`DAP error: Java launch requires "mainClass" (the class to run under the debugger)`。

1. **根因**：`dap/config.rs::expand_config` 是**逐字段拷贝**，但为让新增字段编译通过，
   我在该站点把 `main_class` / `project_name` / `module_paths` 填成了 `None`/空 ——
   **把传播写成了重置**。每次 launch 都过 `expand_config`，于是 B' 的 `mainClass`
   在到达适配器前就被抹掉。（同一处还会连带抹掉 `project_name` → `evaluate` 必失败，
   只是被更早的 mainClass 错误挡住没暴露。）
2. **同类全域排查**（三个字段的全部构造站点）：

   | 站点 | 语义 | 判定 |
   | --- | --- | --- |
   | `config.rs::expand_config`（逐字段拷贝） | **传播** | ❌ 本次根因 → 已改为 `cfg.*.clone()` |
   | `discover.rs::entry_to_launch_config`（发现 Go/Rust 入口） | 真无值 | ✅ |
   | `adapter/go.rs`、`adapter/java.rs`、`adapter/registry.rs` 的测试 helper | 测试数据 | ✅ |
   | `manager.rs::start_java_via_host`（attach 配置） | attach 载荷不用 mainClass | ✅ |
   | `manager.rs::plan_java_debug`（B' launch 配置） | 正确赋值 | ✅ |

   → 全仓**仅此一处**是"拷贝被写成清空"。
3. **测试补口**：新增两条回归 —— `config.rs::expand_config_propagates_java_transport_fields`
   与 **跨模块** `java.rs::launch_payload_survives_expand_config`（`expand_config` ×
   `build_launch_args`）。此前只有"plan 输出"的单测、没有"展开后"的断言，
   而生产链路必经 `expand_config` —— 这就是缺口。
4. **流程教训（与第 9 轮同源）**：新增结构体字段时，**先按语义分类站点**
   （传播 / 真无值 / 测试），再改动；机械式补 `None` 会把拷贝静默变成重置。
   单测必须覆盖"生产链路经过的每一跳"，而不是只覆盖链路首尾。

### 第 9 轮（2026-09-13，现场 bug：项目名被当成目录名）

1. **根因**：`plan_java_debug` 用 **Neeko 项目目录名**兜底 `projectName`；聚合根场景下
   jdt.ls 报 `The project 'tomgs-java' is not a valid java project`，而错误文案却引导用户
   "等语言服务器就绪 / 切 host"（与真因无关）。
2. **修正**：删除该兜底；`projectName` 只作**候选**（前端从模块 `pom.xml` 取 `artifactId`，
   无 pom 时用模块目录名）→ jdt.ls 验证 → 不成立则**回落按类解析**（`null`）；launch 的
   `projectName` 只填验证过的值，未验证到**省略字段**（原来会发空串）。
3. **测试**：`decide_classpath` 决策不变式的 5 条单测（含"候选被拒必须回落"回归）、
   `plan_java_debug_never_invents_project_name`（后端不得造名字）、TS `mavenArtifactId`
   （含 `<parent>` 剥离）3 条。
4. **流程**：spike 必须覆盖生产取值路径（上一轮硬编码 `projectName` 恰好绕过了 bug 分支）。

### 第 8 轮（2026-09-13，S0 Phase 2 通过 → B' 转正）

1. **S0 Phase 2 全绿**：断点 `verified=true` + `stopped(reason=breakpoint)` + `stackTrace`/`scopes`/
   `evaluate` 全部成功 + `disconnect{terminateDebuggee:true}` 杀掉被测 JVM。握手确认
   `LaunchBeforeBreakpoints`（无需 pipelined）。
2. **三条载荷约束**（真机实证，均已落入实现）：`args` 必须是字符串；Console Launcher 必须前置在
   `classPaths` 首位；`projectName` 必填（evaluate 硬前置）。
3. **`auto` 转正**：`AUTO_PREFERS_JDTLS = true`；回退为单常量翻转。
4. **就绪判据**维持"只看 `classPaths`"（Phase 1 证据）。

### 第 7 轮（2026-09-13，S0 真机结论与回退）

真机 spike（`research/jdtls-debug-spike.md`）结果：

1. **GO（基础设施）**：官方 Maven Central `com.microsoft.java.debug.plugin-0.53.1.jar` 经 `bundles`
   热装可用；`vscode.java.startDebugSession` 返回端口；DAP TCP 直连 + `initialize` 成功；
   `resolveClasspath("...","test")` 返回 11 条 classPaths；`shortenCommandLine: "argfile"` 被 core 接受。
2. **NO-GO（`launch` 握手）**：`launch` 发出后 `initialized` 事件未出现（`LaunchRequestHandler`
   源码内亦不发送该事件），`setBreakpoints` 得到 `Empty debug session.`，未取得断点命中证据。
3. **由此产生的两处修正**：① 就绪判据只看 `classPaths`（`modulePaths` 合法为空）；
   ② `launch` 形态的 `handshake_order` 仍属**未验证假设**。
4. **回退（按本设计核心不变式）**：未验证的引擎不得成为默认 → `auto` 暂按 host-first，
   B' 需显式 `jdtls`；由单个常量 `AUTO_PREFERS_JDTLS` 控制，Phase 2 通过后翻回即恢复。
5. **B' 上线前阻塞项**：确定 `initialized` 的发送点与门控方向 → 复跑 Phase 2（断点/变量/求值）→
   必要时为 launch 形态引入 `HandshakeOrder::PipelinedLaunch` → 验证 `terminateDebuggee`
   与重复 junit 引擎行为。

### 第 6 轮（2026-09-13，实现前提复核）

逐条追到实现层后，发现 **1 个会让方案直接失效的缺陷** + 3 项前提缺失：

1. **前端门控阻断 B'（关键缺陷）**：`launchSession` 无条件调 `dapCheckAdapter(projectId, 'java')`，
   而 Java 判据是 `JavaAdapter::is_available` = "`java` + **host jar**"（`debugStore.ts:203-216`，文案指向 `build.sh`）。
   → JDK21 + jdtls 但没 host jar 的用户（B' 的目标用户）在能力探测前就被拦住，B' 永不启动。
   修正：`jdtls` / `auto` 跳过该门控，`host` 保留。
2. **M0 重新设计（缩小 5 处共享面）**：原"`AdapterSpawn` 枚举化"牵动
   `AdapterSpawn` / `AdapterProcess` / `AdapterTransport`（`Copy` + 按值 `match`）/ `connect_transport` / `resolve_spawn` 签名。
   改为**新增外部端点会话入口**：`DapSession` 拆 `start_with(io, Option<guard>, …)` + 新增 `connect(addr, …)`、
   `transport::connect_tcp_addr`；后端形态改由 `cfg.request` 驱动。**go / lldb / A 三路径逐字不动**。
3. **LSP 需补在途 progress token 状态**：现有实现只把 begin/report/end 转发为事件，不保留状态
   → `Warming` 的"有进行中 import 进度"判据无法实现。M1 必须补状态跟踪 + 查询接口。
4. **轴 ② 的需求 checkpoint**：写明 A 与 B' 的**用户可见差异**（求值 / 跨库源码查找 / HCR），
   并要求在 S0 显式判断是否为本期真实需求；若否，最优解是中间档（成本下降一个量级）。
5. **`auto` / `jdtls` 语义边界明确**（两者都不自动换引擎，差异仅在静态 terminal 的 UX）。
6. **失败诊断入口补齐**：B' 无 adapter stderr 可聚合（服务器在 jdtls 内），错误文案须指向既有 LSP 服务器日志。

### 第 5 轮（2026-09-13，D1–D8 逐项采纳）

一手实测推翻了两条此前的判断，其余 6 项按最优解落入文档：

1. **D1（关键）**：实测 `com.microsoft.java.test.plugin` **不在 Maven Central**，且 VSCode 的
   vscode-java-test `javaExtensions` 依赖闭包共 **30 个 jar** → "引入第二个 bundle 换精度"的代价远高于原估，
   与"零新增 vendored 依赖"姿态不相称。改为：**不引入测试 bundle**，用两道**选择器不变式**
   （launch 前 LSP 语义校验 + launch 后 0 用例硬失败）以零依赖成本闭合同一类静默错；
   服务端选择器降级为独立后续任务（记入 S0 成本测量）。
2. **D3**：取消自动换引擎。`auto` 与 `jdtls` 共用可用性判定但不自动降级；
   `Unavailable` 携带 `staticallyDetectable` 标记 —— 静态 terminal 一次性询问后由用户确认才走 A，
   其他一律报错 + 显式切换入口。删除 `fallbackToHost` 结果与粘滞状态机（记忆仅限项目会话）。
3. **D6**：`updateBuildConfiguration` 默认 **`interactive`**（对齐业界），classpath 新鲜度改用
   按需 `vscode.java.buildWorkspace`；`automatic` 仅作 S0 实测后的最后手段。
4. **D5**：bundle 必须 **pin 版本 + 校验**，来源取舍以 S0 实测行为为准（不预设"官方优先"）。
5. **D7**：多入口歧义硬报错（已在第 4 轮），本轮补充"有服务端能力时用候选列表"的可选升级路径。
6. **D4**：M0 明确定位为**通用 DAP 能力补齐**（价值独立于 Java，建议独立评审/独立提交），但仍由 S0 go 触发。
7. **D8**：启动参数构造**单点化**（Run/Debug 共用，Run 追加 `--reports-dir`、Debug 注入 jdwp）；
   本期只做单点化不改 Run 行为。
8. **D2**：维持第 4 轮的 `Warming` 交叉验证，未再调整。

### 第 4 轮（2026-09-13，业界对照）

一手源码对照 VSCode / Zed 后（`research/industry-comparison.md`），补 4 项：

1. 新增 §0.3「与业界方案的关系与边界」：同构部分（bundles / startDebugSession / TCP / JDK21 门槛）不再存疑；
   **显式声明能力边界** —— 只修 classpath 真值与引擎能力，不修测试选择器精度。
2. §2.4 探测顺序增 **`Warming` 交叉验证**：`classpath` 空 **且** 有进行中 import 进度才 Warming；
   无进度则直接 `Unavailable(ProbeFailed)`（对齐 VSCode/Zed 硬报错的可预测性）。
3. §3 增 **多模块/多入口歧义硬报错**（对齐 Zed，禁止静默取第一个）；`updateBuildConfiguration`
   从写死 `automatic` 改为**有意决策项**并说明其作用于整个编辑会话。
4. S0 增 **plugin 来源验证**：先验官方 Maven Central jar，失败则切 Zed fork 并记录差异
   （Zed 弃用官方改用自家 fork 是"上游可能不够用"的一手证据）。

### 第 3 轮（2026-09-13，里程碑顺序）

1. **里程碑顺序修正**：S0（真机 spike）提到 M0（契约解耦）之前 —— S0 零生产代码、成本最低，是否决 M0/M1/M2 的闸门；先做 M0 再 no-go 会让重构白做。no-go 分支明确为"跳过 M0/M1/M2，仅保留 A 的 bugfix + 文档收敛"（§0.2、§6、implement）。
2. **§2.5 补"探测不阻塞 IPC"**（详见第 2 轮第 7 项；第 3 轮确认其与 S0/M0 的顺序无关）。

### 第 2 轮（2026-09-13）

1. **§2.4 能力契约重写**：撤销"JDK21 + session + plugin + import + resolve"五连判据与 `language/status` 硬依赖，改为一次带类型的探测（`Ready` / `Warming` / `Unavailable`）——消除 DAP 域对 LSP 健康状态的重复推导，也消除对通知语义的假设（`startDebugSession` 成功本身即充分证据）。
2. **§2.5 路由重写**：`FallbackToHost` 改为无副作用的类型化结果；"重试一次"改为有界等待 + 用户二选一；降级由"模态确认"改为"通知 + 常驻标注 + 粘滞 + 重试入口"（避免常见路径摩擦）。
3. **§4 命令契约简化**：A 的 `command`/`classpath` 不再进新命令（撤销参数并集与 `degraded` 字段），避免 B' 路径上无谓触发 maven classpath 准备。
4. **§2.6 环境契约修正**：A 在 SSH 上**同样不可用**，不再是兜底；SSH 显式报错不静默降级。
5. **§0.2 / S0 新增**：把真机未知项前置为 go/no-go spike，避免以 M2 全量实现赌外部事实。
6. **§3 收窄**：A 的自动 `test-compile` 限定"产物缺失时触发一次"；`shortenCommandLine` 与重复引擎降级为 spike 待定项，不再写成既定契约。
7. **§2.5 补"探测不阻塞 IPC"**：`debug_java_start` 立即返回三态之一，`warming` 的重试由既有 LSP 进度提示 + 手动触发驱动（不做高频轮询），取消即停止重试 —— 修正上一版"有界等待"隐含的长挂起 invoke 与不可取消问题。

### 第 1 轮（2026-09-13）

1. 新增 §2.2「传输与进程契约（M0）」——`spawn` 与 `connect` 解耦（第 1 轮方案为 `AdapterSpawn` 枚举化；**第 6 轮改为外部端点会话入口**，不再触碰共享 spawn 面，见该轮说明）。
2. 新增 §2.6 环境契约、§2.7 领域依赖契约（dap→lsp 改窄端口注入）。
3. §0.1 拆出「classpath 来源」与「DAP 引擎」两个正交轴，记录被放弃的中间档。
4. §3 补 `modulePaths`、`bundles` 生效时机与 debuggee 生命周期。

---

## 9. 语言无关 DAP 架构重构（第一性原理 + 可执行方案）

> 2026-09-14 追加。本任务（Java 双后端）已完成，但实现把**大量 Java 专属编排平铺进了通用 DAP 层**。
> 本章从第一性原理重述"调试链路中什么是语言无关的、什么是语言差异的"，定位现状的抽象缺口，
> 给出可执行的渐进重构方案。**本文档不推翻既有正确骨架**（`DebugAdapterPlugin` / `SessionRoute` /
> `DapSession::connect` / external_source 授权模型），只补齐缺失的"语言后端"抽象层。

### 9.1 第一性原理：调试链路的结构

无论调试什么语言，DAP 链路的结构是**固定的**（语言无关层）：

```
目标解析 (discover / 前端测试用例)
 → 构建 (无头构建：cargo test --no-run / mvn test-compile)
 → 适配器解析 (该语言的 DAP 适配器：dlv / lldb-dap / java-host / jdtls 内嵌 server)
 → 能力探测 (该后端在项目环境中是否就绪)
 → 会话形态 (spawn 子进程 | connect 外部端点)
 → 断点翻译 (规范身份 → 适配器可读的真实路径)
 → 会话启动 (握手 / setBreakpoints / launch)
 → 交互 (栈/变量/求值/控制)
 → 源码 (项目内 + 外部第三方/JDK)
 → 生命周期 (debuggee 进程清理 / 会话停止)
```

**语言差异点只有一处**：适配器（它是"该语言调试语义"的载体）。其余各层——会话、传输、
断点存储、外部源码授权、无头构建服务——**都应是语言无关的通用设施**。

### 9.2 语言差异点拆解（第一性原理）

把"该语言的调试"再往下拆，差异点全集：

| 差异点 | Java | Go | Rust/lldb | 现状归属 |
| --- | --- | --- | --- | --- |
| 适配器二进制 + spawn 形态 | `java -jar host.jar` / 直连 jdtls | `dlv dap` | `lldb-dap` | ✅ 已在 `DebugAdapterPlugin::resolve_spawn` |
| launch 载荷形态 | `mainClass/classPaths/args` / `port/attach` | `mode/program` | `program/args` | ✅ 已在 `build_launch_args` |
| 握手顺序 | `LaunchBeforeBreakpoints` | 同左 | 同左 | ✅ 已在 `handshake_order` |
| **能力探测** | LSP 三态（JDTLS 就绪/classpath/端口） | `command_exists(dlv)` | `command_exists(lldb)` | ❌ 平铺在 manager + 组合根 |
| **断点源路径翻译** | `jdt://…` → 真实文件 | 原样 | 原样 | ❌ 平铺在 manager + 组合根 |
| **环境支持性** | SSH 不支持（端口在远端） | 通用 | 通用 | ❌ `java_debug_unsupported` 硬编码在 manager |
| **附属 debuggee 策略** | A: attach-first JVM；B': 无 | 无 | 无 | ⚠️ `SessionRoute.debuggee` 已通用，但**谁决定**没抽象 |
| **错误文案** | `describe_unavailable`（LSP 日志指引） | `install_hint` | `install_hint` | ❌ Java 文案在 manager |

结论：`DebugAdapterPlugin` 只抽象了**协议层**（怎么和适配器说话），没抽象**编排层**
（怎么为这种语言做完整调试）。于是 Java 的编排（探测/翻译/支持性/文案）全部以**具名函数**
平铺进 `DapManager` 与组合根——新增 Go/Rust/TS 时会逐一复制这套平铺。

### 9.3 现状证据（对照 §9.2）

1. **`types.rs::LaunchConfig`（通用 DTO + launch.json 磁盘格式）含 3 个 Java 专属字段**：
   `main_class` / `project_name` / `module_paths`。所有非 Java adapter 的测试 helper 都要
   显式填 `None`/空（`adapter/go.rs:131-133`、`registry.rs:141-144`）——**通用类型被语言污染**。
2. **`manager.rs`（1785 行）塞满 Java 编排**：
   `start_java_via_host`（A 全流程）、`start_java_debug` + `plan_java_debug` + `JavaDebugPlan`（B' 全流程）、
   `load_java_backend`、`describe_unavailable`、`java_debug_unsupported`、`unsupported_remote_error`、
   `adapter_source_path` / `translated_source_path`（断点翻译）。新增语言必然再堆一组 `start_go_*` / `plan_ts_*`。
3. **`app_state.rs`（组合根）为 Java 开两个洞**：`java_debug_capability` + `java_source_path`
   （两个 `Arc<dyn …>` 字段）。每新增语言再开洞。
4. **`external_source.rs`（声称通用的授权模块）被 Java 语义渗透**：`FrameSource.resolved`
   经 `java_source_path` 翻译，模块文档通篇 `jdt://` 语义。
5. **语言专属文件散落 `dap/` 根**：`java_debuggee.rs` / `java_capability.rs` / `java_source_path.rs`
   在 `dap/` 根，只有 `adapter/java.rs` 在 `adapter/`。语言没有聚合点。

**判断**：用户论断"Java 相关 DAP 功能与更上层模块耦合、无抽象、新增语言会耦合严重"——
**方向成立**（§9.3 五项证据）；但"没有抽象"不准确——已有 `DebugAdapterPlugin`（正确协议抽象）与
两个 DIP 端口（正确方向）。真正缺的是 **语言编排层抽象**：差异点 4–8 没进 trait。

### 9.4 抽象目标：协议层与编排层分离（方案 C，2026-09-14 定案）

> **选型修订**：上一版（§9.4 原稿）倾向把编排并入 `DebugAdapterPlugin`（方案 B）。经用户质疑与
> 技术复核，**改采方案 C**：独立 `LanguageBackend`（编排层）组合 `DebugAdapterPlugin`（协议层）。
> 决定性理由见下。

**两个 trait，职责严格分离（实现定稿，2026-09-14）：**

```rust
// ── 协议层（现有，保持 static 零大小单例，方法不变）──
pub trait DebugAdapterPlugin: Send + Sync {
    // kind / matches_type / adapter_id / handshake_order / launch_request_command
    // resolve_spawn / is_available / build_launch_args / entry_function_for_stop_on_entry / install_hint
    // （全部现状保留，零改动）
}

// ── 编排层（新，承载有状态依赖）──
#[async_trait]
pub trait LanguageBackend: Send + Sync {
    /// 对应语言的协议层（spawn / launch args 走它）。
    fn plugin(&self) -> &dyn DebugAdapterPlugin;

    /// 环境支持性（Java: SSH 不支持；默认 true）。
    fn supported_on(&self, target: &ExecTarget) -> bool { true }
    /// `supported_on == false` 的错误文案（默认通用，Java 覆盖为 SSH 指引）。
    fn unsupported_error(&self) -> AppError;

    /// 断点源路径翻译（Java: jdt 翻译；默认原样）。
    async fn adapter_source_path(&self, state: &AppStateWrapper, target: &ExecTarget,
        classpath: &[String], identity: &str) -> SourcePathResolution;

    /// 会话形态规划：三态（`Launch` / `Warming` / `Unavailable`）。
    /// Java A: attach + debuggee；Java B': connect；默认 = spawn + 通用载荷。
    async fn plan(&self, state: &AppStateWrapper, request: &DebugRequest)
        -> Result<SessionPlan, AppError>;
}
```

**实现偏差（相对原设计，诚实记录）：**

1. **无独立 `probe`**：探测并入 `plan` 三态（`SessionPlan::Warming` / `Unavailable` 已覆盖
   "稍后可成 / 不可用"，避免重复抽象；`JavaBackend::plan_jdtls` 内部调 `self.capability.probe`）。
2. **无 trait 级 `describe_unavailable`**：`Unavailable.message` 在 plan 内直接构造 —— 结构化
   reason（`JavaDebugUnavailable`）无法经 `&str` 透传，且它只服务 Java 一处。
3. **`SessionRoutePlan` 替代直接 `SessionRoute`**：`SessionPlan::Launch.route` 是 owned
   `SessionRoutePlan { Spawn{debuggee, debuggee_output} | Connect{endpoint} }`（避免借用生命周期；
   `debuggee_output` 供 manager 挂载附属进程输出泵）。`SessionPlan::Launch.config` 装箱
   （`Box<LaunchConfig>`，避免 large-enum-variant clippy）。
4. **registry 从"双表 static"改为"组合根实例注册"**：`JavaBackend::new(capability, source_path)`
   在 `AppStateWrapper::new_with_storage_and_library` 构造并 `dap_manager.register_backend("java", …)`；
   `backend_for` 收敛为 `DapManager` 方法（`self.backend_for(kind)`）。协议层 `plugin_for` static 单例不变。

**为什么方案 C 优于方案 B（技术证据）：**

1. **依赖方向冲突（决定性）**：协议层无状态 → 现状 `static JAVA: JavaAdapter` 零大小单例是正确设计；
   编排层必须持端口（capability / source_path）→ 必须有状态。并入一个 trait 后，JavaAdapter
   要么带字段破坏 static 单例（协议方法也连带要端口），要么用 `state` 参数绕（端口又回组合根，
   回到原点）。方案 C 用 `JavaBackend { plugin, capability, source_path }` 让依赖只在编排层发生。
2. **可选增强，非双类样板**：Go/Lldb 现状零编排需求，**不实现 LanguageBackend**。
   组合根只注册 Java backend；`backend_for(kind)` 未命中走通用 spawn 路径 ——
   **不存在"每个语言两个类"的样板**，YAGNI 之忧被化解（§9.7）。
3. **改动面更小**：方案 B 要重构 registry 单例结构与全部 adapter；方案 C 协议层逐字不动，
   Go/Lldb 路径行为零漂移。
4. **SRP 落地**：协议层回答"怎么和这个语言的 DAP 适配器说话"，编排层回答"怎么为这个语言做完整调试"，
   两者变更原因不同（适配器升级 vs 工具链集成）、依赖不同（无状态 vs LSP 端口）。

**关键配套类型（实现定稿）：**

- **`SessionPlan`**（统一 plan 输出，三态）：`Launch { route: SessionRoutePlan, config: Box<LaunchConfig>, notes: Vec<String> }` /
  `Warming { detail }` / `Unavailable { message, statically_detectable }`。`launch_session` 消费
  `SessionPlan::Launch`（`*config` + 由 `SessionRoutePlan` 构造 `SessionRoute`）。
- **`SessionRoutePlan`**：`Spawn { debuggee, debuggee_output }` / `Connect { endpoint }`（owned，
  避免借用；不 `derive(Debug)` —— `ProcessGuard` 无 Debug）。
- **`DebugRequest`**（统一请求面，带 kind）：`JavaAttach { project_id, target }` /
  `JavaJdtls { project_id, target }`（project_id 随请求携带，plan 需解析执行环境）。Go/Lldb 不经过。
- **`DebugStartOutcome`**（manager → 命令层 → IPC，三态对齐 `JavaDebugStartOutcome`）：
  `Session { session }` / `Warming { detail }` / `Unavailable { message, statically_detectable }`。
- **registry**：协议层 `plugin_for(type_)` static 单例不变；编排层经 `DapManager::register_backend(kind, backend)` /
  `DapManager::backend_for(kind)`（std `Mutex`，短临界区同步锁）。

### 9.5 目标目录结构（实现定稿）

```
dap/
├── mod.rs              # 声明 + 模块别名重导出（java_capability / java_source_path，A-3 后待清）
├── manager.rs          # 通用编排（瘦身后）：会话生命周期 / 断点 / 控制 / 外部源码授权 / 语言后端注册
├── session.rs          # 通用 DAP 会话（不变）
├── transport.rs        # 通用传输（不变）
├── client.rs / protocol.rs  # 通用 DAP 客户端（不变）
├── build.rs            # 无头构建服务（通用，不变）
├── discover.rs         # 入口发现 Go/Rust（通用，不变）
├── external_source.rs  # 外部源码授权（语言中立：FrameSource raw+resolved + 授权纯函数）
├── types.rs            # 通用类型（LaunchConfig 含 Java 字段但标注 adapter 专属）
├── launch_support.rs   # 通用 launch 助手 + pump_output（debuggee 输出泵，原 java_debuggee.rs 迁入）
└── adapter/
    ├── plugin.rs       # DebugAdapterPlugin（协议层，不变）
    ├── backend.rs      # LanguageBackend trait + SessionPlan / SessionRoutePlan / DebugRequest / DebugStartOutcome
    ├── registry.rs     # plugin_for（协议层 static 单例）；编排层注册收敛到 DapManager
    ├── go.rs           # Go 协议层单例（不变，无编排后端）
    ├── lldb.rs         # Rust/lldb 协议层单例（不变，无编排后端）
    └── java/           # Java 语言后端聚合点
        ├── mod.rs      # 声明 + re-export（JavaAdapter / JavaBackend / 端口类型）
        ├── protocol.rs # JavaAdapter（协议层，保留 build_launch_args 双形态；原 adapter/java.rs，改名避 module_inception）
        ├── backend.rs  # JavaBackend（编排层：plan A/B' / supported_on / unsupported_error / adapter_source_path）
        ├── debuggee.rs # JavaDebuggee（原 dap/java_debuggee.rs）
        ├── capability.rs # JavaDebugCapabilityProvider（原 dap/java_capability.rs）
        └── source_path.rs # JavaSourcePathProvider（原 dap/java_source_path.rs）
```

组合根 `AppStateWrapper` 不再持有 Java 专属字段：`new_with_storage_and_library` 构造
`JavaBackend::new(LspJavaDebugCapability, LspJavaSourcePath)` 并
`dap_manager.register_backend("java", …)`；组合根只保留通用 `dap_manager` 一个字段
（构造点触碰 Java 类型属一次性装配，不持有字段）。

### 9.6 可执行里程碑（TDD，每步独立验收可回滚）

> 顺序按"最小行为改动 + 最大内聚收益"排列。A-1 纯结构、A-2 核心抽象、A-3 收口组合根、
> A-4 收敛通用类型。**不预先实现"未来语言"的编排后端**——需要编排差异的语言才写 `LanguageBackend`。

**A-1：语言文件归位（纯结构，行为零漂移）**
- 把 `dap/java_debuggee.rs` / `dap/java_capability.rs` / `dap/java_source_path.rs` 移到 `dap/adapter/java/`
  （路径仅 `use` 调整），`mod.rs` 相应收敛。
- 验收：`cargo test` 全绿；`git diff --stat` 无逻辑改动。

**A-2：LanguageBackend trait + Java 编排下沉 + manager 瘦身（核心）**
- 新建 `adapter/backend.rs`：`LanguageBackend` trait（§9.4）+ `SessionPlan` / `ProbeResult` /
  `DebugRequest`。trait 默认实现 = 通用行为（spawn / is_available / 原样翻译 / install_hint 文案）。
- 新建 `adapter/java/backend.rs`：`JavaBackend`（组合 `JavaAdapter` + 两个端口），从 manager
  搬运 `start_java_via_host` / `plan_java_debug` / `load_java_backend` / `describe_unavailable` /
  `java_debug_unsupported` / `adapter_source_path`（逻辑零改动）。
- `DapManager`：新增 `start_language_debug(state, request)` —— `backend_for(kind)` 命中 → 调
  `backend.plan` → `launch_session(SessionPlan)`；未命中 → 既有通用 spawn 路径（Go/Lldb 现状）。
  删除 Java 专属方法；断点翻译改调 `backend.adapter_source_path`。
- 验收：Go / Lldb / Java-A / Java-B' 四条路径行为与文案不变（既有单测 + 真机冒烟）；manager 显著变薄。

**A-3：组合根瘦身 + registry 双表**
- `registry.rs`：加 `backends` 表（`plugin_for` 签名不变）；`JavaBackend` 在组合根装配时注册。
- `AppStateWrapper`：删 `java_debug_capability` / `java_source_path` 字段；构造 `DapManager` 时
  装配 Java backend。dap 单测 fake 注入点从"组合根字段"改为"registry backends 注入"。
- 验收：`AppStateWrapper` 无 Java 字段；单测全绿。

**A-4：通用类型收敛**
- `LaunchConfig` 的 Java 字段标注 `#[doc(hidden)]` / 注释"adapter 专属，通用层不得消费"，
  并**只允许**在 `adapter/java/` 构造站点赋值；`expand_config` 已用 `..cfg.clone()` 天然透传。
- 非 Java adapter 测试 helper 不再填 Java 字段（字段移到 Java 专属 target / 构造站点）。
- `external_source.rs` 去掉对 `java_source_path` 类型的直接引用（`FrameSource.resolved` 由调用方
  经 `backend.adapter_source_path` 预翻译后传入）。
- 验收：`grep -rn "main_class\|project_name\|module_paths" src-tauri/src/dap --include=*.rs`
  仅剩 `adapter/java/` 与 `types.rs` 定义。

### 9.7 明确不做（YAGNI 边界）

- **不为 Go/Lldb 写 `LanguageBackend` 实现**：它们现状零编排差异，走通用 spawn 路径
  （`backend_for` 未命中即既有行为）。等真实编排需求（如 Go `test` 形态 / TS node 调试）进来
  再补 —— 此时只新增一个 backend 类 + registry 注册，通用层零改动。
- 不合并 `debug_java_attach` / `debug_java_start` 命令面（前端强约定，命令面保持显式是特性非缺陷）。
- 不迁移 `.neeko/breakpoints.json` / launch.json 磁盘格式（§2.8 单一身份不变式）。
- 协议层 `DebugAdapterPlugin` **零改动**（除 java.rs 按 A-2 从 manager 接收搬运来的载荷组装，
  若有则收敛到 JavaBackend 而非协议层）。

### 9.8 回滚

- A-1 可独立回滚（纯 move，`git revert` 即恢复）。
- A-2 若导致任一既有路径行为/文案漂移 → 在 A-2 处暂停，回到"Java 编排留在 manager"的现状
  （`LanguageBackend` trait 保留但 manager 不迁移），不强行推进 A-3/A-4。
- A-3 / A-4 各自独立可回滚；任何一步未达验收即停，不叠加后续。

---

## 10. 前端 `features/runner` 域设计（2026-09-14）

> 后端 DAP 语言无关重构（§9）完成后，用户指出**前端目录同样割裂**：`features/debug` 与后端
> 不对位、只含调试侧，Run 编排埋在 `features/editor`（runner/ / utils/ / syntax/ / runnables/ /
> gutter/ 五处散落）。本章定稿前端统一"运行"域：`features/runner`。
> **命名**：`runner` 对应 VSCode Test API 的 `TestRunProfile` / `runHandler` 概念（"执行器"），
> 天然涵盖 Run / Debug / 构建 / 其他运行形态（用户定案；`dap` 是协议名不适用，`test` 太窄排除
> main 程序运行，`run-debug` 冗长）。
> **参考**：VSCode "入口统一（Run and Debug 视图 / TestRunProfileKind.Run|Debug）、内核分离
> （Tasks 进程执行 / Debuggers DAP）" —— 前端 runner 是编排层，task 保留进程执行。

### 10.1 问题定义（现状证据）

后端一个 `dap` 域（构建 / 发现 / 调试协议），前端拆成 4 处：

| 前端位置 | 承载 | 后端对应 |
|---|---|---|
| `features/debug/` | DAP 会话、断点、DebugPanel | `dap`（会话/断点侧）|
| `features/editor/runner/` | 语言前置 + 执行编排（launch/java/native/registry）| `dap`（构建/发现）|
| `features/editor/utils/` | 命令构造（testCommands/runLanguages/…）| `dap`（载荷构造）|
| `features/editor/syntax/` | 用例发现 AST | `dap`（discover）|
| `features/task/` | 进程执行 + console | `task`（Run 输出通道）|

割裂证据：`debugStore` 内部直接调 `useTaskStore.runTask`（entry-run）；`useRunActions` 注释自述
"跨 feature 边界：debug 经其 store/ 直导 + api/ 门面" —— Run 与 Debug 是同一动作的两项，却跨 feature 交互。

### 10.2 边界原则（用户定案 + 代码实证）

1. **gutter 是 editor 概念**：全部 8 个 gutter 文件（含 `debug/gutter/breakpointContribution`）
   import `@codemirror`，是 CodeMirror 渲染扩展 → **留 editor**（含通用框架 `contribution`/`registry`）。
2. **runner 是纯逻辑域（零 CodeMirror 渲染）**：api / exec / store / utils / syntax / runnables /
   components（非 gutter UI）/ 纯函数 hooks。渲染装配（`useUnifiedGutter` / `useEditorBreakpoints` /
   `useEditorViewSnapshot` / `useCurrentLineHighlight` / `useBreakpointGutter`）留 editor。
3. **`runner/exec` 命名**（替代 `runner/runner`）：原 `editor/runner` 执行编排迁入。
4. **依赖方向**：editor（渲染层）→ runner（数据/动作），经 runner 门面 + store 直导。**无反向**。

### 10.3 目标结构

```
src/features/runner/
├── api/              # ← debug/api（debugApi、debugBuildApi）
├── exec/             # ← editor/runner（launch/java/native/registry/results/context/debugConsole/index）
├── store/            # ← debug/store/debugStore + editor/store/testResults
├── utils/            # ← editor/utils 命令构造（runLanguages/testCases/testCommands/testResultParsers/
│                     #   javaDocumentSymbol/cargoManifest）+ shared/utils 误置件（javaClasspath/
│                     #   javaConsoleSummary）+ debug/utils/consoleFilter
├── syntax/           # ← editor/syntax（用例发现 AST：contract/go/goTable/java/lezer/parsers/rust/ts）
├── runnables/        # ← editor/runnables（用例数据源，LSP 驱动：provider/runnable）
├── components/       # ← debug/components 非 gutter（DebugPanel/DebugRunButton/DebugRunDropdown/
│                     #   LaunchConfigDialog/PanePrimitives/Debug*Pane 等）
├── hooks/            # ← 仅纯动作 hooks（useRunActions）
├── index.ts          # 门面
├── types.ts          # ← debug/types
└── 根纯函数           # navigate/openStopSource/sourceContent/stackFrames/statusMeta/variableTree

src/features/editor/   # 保留渲染层 + 装配点
├── gutter/           # 全留：contribution/registry + run* + testStatusContribution
│                     #   + breakpointContribution（从 debug/gutter 迁入）
├── hooks/            # useUnifiedGutter/useEditorBreakpoints/useEditorViewSnapshot
│                     #   + useCurrentLineHighlight/useBreakpointGutter（从 debug/hooks 迁入）
├── navigateCaret.ts / navigationHistory.ts / editorStore.ts
└── components/FileEditor.tsx 等（run 挂载点改指 runner 门面）
```

### 10.4 迁移清单与消费方

| 源 | 目标 | 消费方改指 |
|---|---|---|
| `features/debug/` 非渲染部分（api/components/store/types/根）| `features/runner/` | `app/panels/TitleBarActions`、`app/panels/registry`、`status-bar/items/DebugItem` |
| `features/debug/gutter/breakpointContribution` | `features/editor/gutter/` | `useUnifiedGutter`（editor 内）|
| `features/debug/hooks/useCurrentLineHighlight` + `useBreakpointGutter` | `features/editor/hooks/` | `useEditorBreakpoints` 等 |
| `features/editor/runner/*` | `features/runner/exec/` | `useRunActions`（迁 runner/hooks）|
| `features/editor/utils/{testCommands,runLanguages,testCases,testResultParsers,javaDocumentSymbol,cargoManifest}` | `features/runner/utils/` | `editor/syntax`、`editor/gutter/run*`、`FileEditor` |
| `features/editor/syntax/*` | `features/runner/syntax/` | 内部 |
| `features/editor/runnables/*` | `features/runner/runnables/` | `gutter/run*`（editor 内）|
| `features/editor/store/testResults.ts` | `features/runner/store/` | `gutter/testStatusContribution`、`exec/results` |
| `features/editor/hooks/useRunActions.ts` | `features/runner/hooks/` | `FileEditor` |
| `shared/utils/javaClasspath.ts` + `javaConsoleSummary.ts` | `features/runner/utils/` | editor/runner（已迁）|

**保留 shared/utils**：`jdt.ts`（lsp+editor 跨 feature）、`javaDebugBackend.ts`（settings+editor+debug 跨 feature）。

### 10.5 实施顺序（R-0..R-4，每步验证）

| 步骤 | 内容 | 验证 |
|---|---|---|
| R-0 | 建骨架 + 迁移 debug 非渲染部分 | `tsc` + vitest 绿 |
| R-1 | 迁移 exec + utils 命令构造 + syntax | 同上 |
| R-2 | 迁移 runnables + testResults + useRunActions | 同上 |
| R-3 | gutter 归位（breakpointContribution → editor/gutter；渲染 hooks → editor/hooks）| 同上 |
| R-4 | shared/utils 误置件 + 全部消费方改指 + 删 features/debug + 门面收敛 | `grep "features/debug"` 为空 + 全量门禁 |

### 10.6 风险

1. **editor → runner 依赖**：editor 渲染层消费 runner 数据，需 runner 门面导出 store（白名单 `store/` 直导）。无反向依赖。
2. **`useRunActions` 被 FileEditor 装配**：FileEditor 改指 runner 门面（`@/features/runner`），避免深导。
3. **exec/ 与 utils/ 互相引用**：同域内直接 import（feature 内部无防火墙），比现状跨 feature 绕行更简单。
4. **纯前端重构，后端零改动**；回归面 = 前端测试 + tsc + lint。

### 10.7 边界定案（由 §10.2 原则推导，代码实证，无需再确认）

1. **`useRunActions` → runner/hooks**：零 `@codemirror` import，纯动作装配（菜单/回调）。由"runner 是纯逻辑域（零渲染）"推导确定。`FileEditor.tsx` 的挂载点从 `@/features/runner` 门面引。
2. **`DebugRunButton`（标题栏按钮）→ runner/components**：被 `app/panels/TitleBarActions` 消费、非 gutter（零 codemirror），属"运行 UI"非"编辑器渲染"。由同原则推导确定。
3. **`useCurrentLineHighlight` / `useBreakpointGutter` → editor/hooks**：均含 `@codemirror` import（渲染扩展），由"gutter 是 editor 概念"推导确定。与 `useEditorBreakpoints` / `useUnifiedGutterExtension` / `useEditorViewSnapshot` 同留 editor。

**附带实证（补充分析）**：
- `shared/store` 仅 `taskStore` 属运行相关（跨 feature 通用进程执行）→ 保留 shared，不迁。
- `testCommands` / `runLanguages` / `runnables/runnable` 消费方**全部**在 run 域内部（gutter/run*、exec/*、utils/*），无 editor 核心引用 → 整块迁入无泄漏。
- `FileEditor.tsx` 同时挂 `useRunActions`（→runner 门面）与 `useUnifiedGutterExtension`（→editor 渲染装配），两个 hook 分属两域，迁移后从各自门面引，无循环依赖。
