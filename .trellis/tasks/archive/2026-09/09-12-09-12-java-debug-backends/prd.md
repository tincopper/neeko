# Java Debug 双后端：JDTLS 与自研 Host 可配置切换

## Goal

为 Java 单测调试提供两种可切换的 DAP 后端：JDTLS 承载 `java-debug`（标准形态，默认）与自研 `java-host.jar`（轻量降级），用户经全局配置动态选择，`auto` 模式按能力探测自动路由。全程复用既有 DAP 会话管线（断点/栈帧/变量/控制）与 DebugPanel 交互。

**两项前置**：

1. **真机原型门槛（R9）**：B' 依赖的 bundle 热装 / `resolveClasspath` / `launch` 起 JVM 等外部事实必须先经可丢弃 spike 验证，no-go 则不投入实现。
2. **环境范围（R7）**：Java 调试（A 与 B'）仅 Local 确定可用；WSL 待实测；SSH 两者均不可用。

## Background

* 现状：`DapManager::start_java_attach` + `JavaAdapter`（`attach-first`）+ `tools/java-host/` 自写 host + `JavaDebuggee` 自 spawn 测试 JVM。`core` 为 JDT-free 纯库，`attach` 无 `classPaths` 校验，首期绕开 classpath 解析；求值/补全/热替换由 `NoopProviders` 降级。
* 标准形态（VSCode/Zed 同构）：DAP 服务器长在 JDTLS JVM 内，经 `initializationOptions.bundles` 注入 `com.microsoft.java.debug.plugin`，经 `workspace/executeCommand` 取 DAP 端口（`vscode.java.startDebugSession`）与 classpath（`vscode.java.resolveClasspath`），DAP `launch` 由 adapter 注入 jdwp 并 spawn 被测 JVM。
* 约束确认：JDTLS 导入等待可接受；JDK 版本门槛与轻量偏好仍需配置覆盖。
* 结构约束：现有 DAP 链路把「adapter 恒为 Neeko 子进程」写死在 `DapSession::start` → `process::spawn_adapter` 上，B' 的适配器不是子进程，必须先解耦 spawn / connect（R8）。
* 环境约束：`dap/transport.rs:135` 在 Neeko 进程内 `TcpStream::connect(addr)`，全仓无端口转发/隧道设施 → 需要项目环境回环端口本地可达；该限制对 A 与 B' **同等生效**（A 的 host 同样在远端 `TcpListen`），SSH 下 A 也不是可用兜底。
* 不确定性约束：B' 的成立依赖 bundle 热装、`resolveClasspath` 真实返回值、`launch` 能否起被测 JVM、`shortenCommandLine` 是否被 core 接受、重复 junit 引擎行为、WSL 端口可达性等**外部事实**，不能由源码推定 → 前置 spike（R9）。

## Requirements

* R1 后端选择配置：全局键 `dap.javaBackend: "auto" | "jdtls" | "host"`，缺省 `auto`。后端为**权威**读取点（每次调试动作实时读取）；前端读同一键仅作 dispatch hint。仅全局键，不设 per-project/per-click 覆盖。
  * **三选语义（一句话可说清，均不自动换引擎）**：`auto` = B' 优先 + 静态 terminal（无 JDK21 / 未装 jdtls）时一次性询问可否改用 Host，其他不可用则报错 + 显式入口；`jdtls` = 只用 B'，任何不可用仅报错不询问；`host` = 只用 A。
  * **前端门控**：**确定走 B'**时（`jdtls`，或 `auto` 且 `AUTO_PREFERS_JDTLS=true`）跳过 `dapCheckAdapter('java')`（该判据是 host jar 存在性，会拦住 B' 的目标用户）；否则保留门控与文案；`dap_check_adapter` 的 Java 语义不变。
  * ⚠️ **S0 回退（当前实现状态）**：真机 spike 证明基础设施 GO 但 **`launch` 握手 NO-GO**（见 `research/jdtls-debug-spike.md`）→ 按"默认路径必须正确"，`auto` **暂按 host-first**：缺省行为与今天一致、无回归；B' 需显式选择 `jdtls`。恢复"B' 优先"的条件 = S0 Phase 2 通过，翻回常量 `AUTO_PREFERS_JDTLS` 即生效。
* R2 JDTLS 后端（B'）：经**能力探测**（R4）取得端口与 `test` scope classpath（`modulePaths` / `classPaths` 两段均消费）；DAP 经 `DapSession::connect` 直连端口（不 spawn，见 R8）；`JavaAdapter` 以 `launch{mainClass: ConsoleLauncher, classPaths, modulePaths, args, cwd}` 启动；断点时序 `Initialized → setBreakpoints → configurationDone → resume`；JDT 源码查找使栈/变量/求值全可用。仅 Local（WSL 待实测）生效；运行期失败不回退（R4）。`shortenCommandLine` 与 classpath 去重规则以 R9 spike 结论为准。
  * **多模块/多入口歧义必须硬报错**（对齐 Zed：入口点 >1 时要求显式指定 `mainClass`/`projectName`），禁止静默取第一个候选。
  * **项目名规则（第 9 轮，现场 bug 修正）**：JDT 项目名 = **构建系统项目名**（Maven `artifactId` / Gradle 项目名），**不是目录名**。
    候选（`artifactId` → 模块目录名）必须经 jdt.ls **验证**才采信；候选被拒**不是 terminal** ——
    必须回落到 `resolveClasspath(cls, null, "test")`（真机实证：null 时服务器按类解析成功）。
    launch 的 `projectName` **只填验证过的值**，未验证到就**省略字段**（`evaluate` 降级，断点/栈/变量不受影响），
    绝不发猜值或空串。
  * **选择器不变式（本任务闭合"静默错"的方式）**：
    * launch 前：`test_class` / `method` / `@Nested` 链须经 LSP 语义（`documentSymbol`）确认存在，否则硬报错、不建会话；
    * launch 后（**仅测试目标**；main class 调试无"用例"概念，不适用）：须观察到"至少发现 1 个用例"（Console Launcher 摘要行 / `--reports-dir` XML），0 用例即终止会话 + 明确报错（附请求的选择器），**不允许留下 running 但永不命中的会话**。
  * **启动参数构造单点化**：用例身份 → Console Launcher 参数收敛为唯一纯函数，Run / Debug 共用（Run 追加 `--reports-dir`，Debug 注入 jdwp）；本期只做单点化，不改变 Run 现有行为。
  * **能力边界（明确声明）**：本需求只修 classpath 真值与引擎能力，**不引入服务端测试选择器**（那需 vscode-java-test 的 30 个 vendored jar 且 `com.microsoft.java.test.plugin` 不在 Maven Central，见 `research/industry-comparison.md` §5 D1）。选择器仍为客户端文本级 + `documentSymbol` 补 `@Nested`，其精度风险由上述两条不变式闭合。
* R3 自研 Host 后端（A，瘦身保留）：维持 `TcpListen + attach{hostName, port, sourcePaths}`；仅修复 `target/classes + target/test-classes` 自动前置（**产物缺失时触发一次 `test-compile`，失败即阻断报错**）；多模块聚合根（`packaging=pom`）直接拒绝并指引；Gradle 自定义任务注入与复杂构建模型不做，超范围提示切换 B'。A 已判死缓（M5），本任务内**只修"静默错"类缺陷，不做形态增强**。
* R4 能力探测与失败语义：
  * 单一探测入口（dap 侧窄端口，lsp 侧实现）返回三态：`Ready{port, modulePaths, classPaths}` / `Warming`（import 进行中）/ `Unavailable{LspUnavailable | BundleMissing | ProbeFailed}`。
  * 判定依据 = `startDebugSession` 成功（同时证明 server 就绪 + bundle 已加载）与 `resolveClasspath` 非空；不依赖 `language/status` 等通知语义（该通知仅供 loading 展示）。
  * **`Warming` 需交叉验证**：`classpath` 空 **且** LSP 侧存在进行中的 import 进度 → `Warming`；`classpath` 空 **但无进行中进度** → `Unavailable(ProbeFailed)` 直接报错（对齐 VSCode/Zed 硬报错的可预测性，避免把损坏工程拖成超时错误）。
  * `Warming` → **探测立即返回**（不阻塞 IPC、不需要后端取消）；前端显示 loading + 可取消，重试时机由既有 LSP 进度提示与用户手动重试驱动（**不做高频轮询**）。
  * `Unavailable` 携带 `staticallyDetectable` 标记，**后端不自动切换引擎**：
    * `staticallyDetectable = true`（无 JDK21 / jdtls 未安装）→ 前端**一次性显式询问**「改用 Host 后端（功能受限）」，用户确认才走 A，并按**项目会话**记忆；拒绝则中止并保留 jdtls 配置；
    * 其他（bundle 未加载 / resolve 失败 / 运行期失败）→ 报错 + 提供**显式切换入口**，不询问、不自动。
  * 降级后不可静默：即时 notification + DebugPanel 常驻标注（`host (fallback)`）+ 求值输入禁用提示 + 「重试 JDTLS」；记忆仅限项目会话，**不写全局配置**。
  * **`Warming` 的实现前提**：LSP 侧须**跟踪在途 progress token**（begin 加入 / end 移除）并暴露"该 project+language 是否有在途 import 进度"的查询 —— 现有实现只转发事件、不保留状态（`lsp/session/notify.rs`），须在 M1 补齐。
  * **失败诊断入口**：B' 的服务器与 bundle 均在 jdtls 进程内，无 adapter stderr 可聚合 → 错误文案必须指向既有 LSP 服务器日志，否则用户无从排查。
  * 取消自动降级的理由：自动换引擎 = 用户以为在用 B'，实际拿到无求值、classpath 无校验的 A，属静默改变语义，与"正确优先"冲突。
  * 运行期失败（launch / DAP 握手）不降级，报错进 DebugPanel console + notification。
  * A 路径 host jar 缺失指引 `tools/java-host/build.sh`，JDK 缺失指引安装。
* R5 前端：Settings → Debug/Java 三选（Auto/JDTLS/Host，说明行注明 Auto 语义、JDK21 门槛、SSH 不支持 Java 调试、host 能力受限）；`debugJavaStart` 仅承载 B'（A 的 `command`/`classpath` 不进新命令，`host` 或用户确认降级后走既有 `debug_java_attach`）；DebugPanel 副标题显示当前后端（`jdtls | host | host (fallback)`）；`Warming` 显示 loading + 可取消 + 「重试 / 改用 Host」；`Unavailable` 按 `staticallyDetectable` 分流为一次性询问或错误 + 切换入口。
* R6 非功能：命令层保持极薄（参数接收 + 调度）；进程 spawn 经 `core::exec` + `ExecTarget`；`mod.rs` 保持声明层；IPC DTO ≤2MB；跨平台 shell 经既有 `launch_support`；全程 TDD。
* R7 环境范围：Local 确定支持；WSL 需真机实测回环端口可达性（不通则归入不支持）；**SSH 下 A 与 B' 均不支持**（端口在远端、无隧道设施）→ 显式报错 + 指引，不得静默降级到 A。SSH 支持（端口转发）为后续独立任务。
* R8 前置契约（M0，**S0 go 后执行**，进入 B' 实现的硬门槛）：为会话层新增**外部 DAP 端点入口**，而非改造 spawn 抽象 ——
  `DapSession` 拆为 `start_with(io, Option<ProcessGuard>, …)`（共享尾部）+ 新增 `connect(addr, …)`（跳过 `is_available` / `pre_launch_task`）；
  新增 `transport::connect_tcp_addr`；后端形态改由 `cfg.request` 驱动（`launch_request_command(cfg)`）。
  **不得改动** `AdapterSpawn` / `AdapterProcess` / `AdapterTransport` / `connect_transport` / `resolve_spawn` 签名
  （原"枚举化"方案降为备选，仅在出现第二个外部端点消费者时再议）；禁止 `program:""` 哨兵与假管道占位。
* R9 真机原型门槛（S0，最先执行，go/no-go，不写生产代码）：验证 bundle 热装后 `startDebugSession` 可取端口、`resolveClasspath` 在 Maven 单/多模块工程返回可用 classpath、`launch` 能起被测 JVM 且断点命中/变量/求值可用、`shortenCommandLine` 是否被 core 接受、`classPaths` 含 standalone + 项目 junit 的实际行为、WSL 回环端口可达性、disconnect 后测试 JVM 是否退出；并增：
  * **plugin 来源**：官方 Maven Central 版 vs Zed fork（pin 0.53.2）在 `launch` 路径的行为差异（判据是行为，不预设官方优先）；
  * **classpath 新鲜度**：`resolveClasspath` 是否需要 `vscode.java.buildWorkspace` 预刷新（不需要则不调用）；
  * **选择器不变式可行性**："0 用例"的可观测证据（Console Launcher 输出 / `--reports-dir` XML）是否可靠；
  * **服务端选择器成本测量**：记录引入 java-test bundle 的真实代价（30 jar、无 Maven 坐标、需自 VSIX 提取或自建），作为独立后续任务的决策输入。
  * **轴 ② 需求 checkpoint（必须显式判断并记录）**：B' 相对 A 的用户可见增量只有"求值表达式 / 跨库源码查找 / HCR"三项（断点、步进、栈、变量 A 全有）。若这三项不是本期真实需求 → 最优解是**中间档**（保留 A 引擎 + `resolveClasspath` 喂 classpath），M0/M2 可不做。禁止以"VSCode 有"默认通过。
  **S0 先于 R8/M0（契约解耦）执行**（最便宜的否决闸门）；no-go → 跳过 M0/M1/M2，保留 A 的 bugfix（R3）+ 文档收敛 + 显式不支持声明。

## Out of Scope

* TS/JS debug（node DAP）、Go dlv `test` 形态变更、测试结果内联渲染之外的状态流改造。
* Java 语义级用例发现（`@Nested`/参数化 UID 精确建模）——沿用既有文本级方法粒度；精度风险由 R2 的两条选择器不变式闭合，而非提升精度。
* **引入 vscode-java-test 测试 bundle（服务端选择器）**：`com.microsoft.java.test.plugin` 不在 Maven Central，其依赖闭包共 30 个 jar（实测）→ 与"零新增 vendored 依赖"姿态不相称；仅由 S0 记录成本，另立任务决策。
* per-project 后端覆盖、`launch.json` 内 `backend` 字段（有明确需求时另起任务）。
* Rust 自研 JDWP 桥。
* SSH 端口转发 / 远程 Java 调试支持（R7 已限定）。
* host 改走 stdio 以使 A 在 SSH 可用（A 已判死缓，仅记录备查）。
* 中间档方案：保留 host 引擎 + 仅用 `resolveClasspath` 喂 classpath（可绕开传输重构，但求值/补全/HCR 仍降级）——因 R2 要求求值可用而不采用，记录备查。
* Run 路径完整切到单点化参数构造（本期只做单点化，Run 行为不变）。

## Acceptance Criteria

* [x] R9 spike 产出明确 go/no-go 结论并记录（bundle 加载 / resolveClasspath / **launch 命中** / plugin 来源 / classpath 新鲜度 / 选择器不变式可行性），并**显式记录轴 ② 需求 checkpoint 的判断**（判定：需要求值 → 继续 B'）。WSL 与 SSH 见下条。
* [x] R8 前置契约落地且**未触碰共享 spawn 面**：`DapSession::start_with` / `connect`、`transport::connect_tcp_addr`、`launch_request_command(cfg)`；`AdapterSpawn` / `AdapterProcess` / `AdapterTransport` / `connect_transport` / `resolve_spawn` 签名保持原样；B' 会话无进程守卫、无假管道；go/lldb/Java-A 回归全绿。
* [x] **前端门控不阻断 B'**：确定走 B' 时（`jdtls`，或 `auto` 且 `AUTO_PREFERS_JDTLS=true`）不调用 `dapCheckAdapter('java')`，且不出现 host jar 文案；`host` 保留原门控；三种取值均有单测。
* [x] `dap.javaBackend` 缺省 `auto`；显式 `jdtls`/`host` 强制走对应后端；配置修改下一次调试即生效；前后端读取不一致以后端为准。
* [x] **S0 通过 → `auto` = B' 优先**（`AUTO_PREFERS_JDTLS = true`，有真机证据）；回退为单常量翻转（置 `false` 即退化为 host-first，行为与既有 A 路径一致）。
* [x] 能力探测三态正确：`Ready` 走 B'；`Warming` **立即返回**（探测不阻塞 IPC，故无挂起调用可取消）；**空 classpath 无 import 进度时不得判为 `Warming`**，该判据由 LSP 侧**在途 progress token 状态**支撑；`Unavailable` **不自动切换引擎**，携带 `staticallyDetectable` 并据此分流（一次性询问 / 报错 + 显式入口）。
* [x] B' 失败时错误可排查：文案指向既有 **LSP 服务器日志**入口。
* [x] B'：单模块 Java 单测可设断点命中、栈帧/变量展开、**求值可用**（真机验证：`breakpoint.verified` + `stopped` + `stackTrace`/`scopes`/`evaluate` 全成功）；`projectName` 仅填**经 jdt.ls 验证**的值（候选经服务器确认；未验证到则省略并让 `evaluate` 降级，绝不猜目录名）；失败时错误进 DebugPanel console + notification 且不启动会话；运行期失败不降级。
* [x] **选择器不变式生效**：① launch 前符号表存在性校验（方法不存在即报错且不建会话）；② 测试目标下 Console Launcher 汇总"0 用例"即**终止会话 + 明确报错**，不存在"running 但断点永不命中"的静默会话。
* [x] **启动参数构造单点化**：选择器唯一构造点为 `javaMethodSelector`（Run / Debug / B' 共用），Run 现有行为逐字节不变（测试覆盖）。
* [x] A：单模块标准布局可用；`target/classes` 自动前置（既有）；**产物缺失时触发一次 `test-compile`**（失败即阻断）；聚合根拒绝并指引；host jar 缺失/JDK 缺失报错指引正确；A 实现零改动且**不存在自动调用路径**。
* [x] 环境：Local 已完成 B' 真机冒烟（含 disconnect 后 JVM 退出验证）；SSH 项目**显式报不支持**、不静默降级；**WSL 待补**（本机无 WSL 环境，为显式声明的已知限制 —— 需在有 WSL 的机器跑一次 B' 冒烟后补验，见 prd 末「唯一未达成项」）。
* [x] 降级不可静默：经用户确认后走 A 时，notification + 常驻后端标注 + 求值输入禁用 + 「重试 JDTLS」均可用；记忆仅限项目会话且不写全局配置。
* [x] bundle 版本已 pin + 下载后 SHA-256 校验（并做结构性校验）；`updateBuildConfiguration` 保持 `interactive`。
* [x] `pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` / `pnpm lint`（cargo fmt + clippy）/ `cargo test` 全绿；新增纯函数与分支单测覆盖。

> 唯一未达成项：**WSL 环境结论**（需在有 WSL 的机器上跑一次 B' 冒烟）；Local 已由 S0 spike 验证，SSH 已显式拒绝而非静默降级。
