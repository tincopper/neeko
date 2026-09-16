# Java Debug 改走 JDTLS（路径 B'）—— 完整接入方案调研

> 挂靠任务：09-04-editor-test-run-buttons。只读调研，不改代码。
> 目的：为「Neeko Java 单测 debug 从路径 A（自写 Java host）改走路径 B'（JDTLS 承载 java-debug，
> VSCode/Zed 同款）」给出完整接入方案，回答五点：jdtls 启动形态 / java-debug 扩展加载 / LSP 命令 /
> 项目导入 / 调试链路；并给出 Neeko 最小改动路径与对路径 A 的处置建议。
> 方法：web_search 全 providers 限流 → 直读一手源码 + 官方文档 + npm registry / download.eclipse.org /
> Homebrew 实测。每条结论附来源。
> 一手证据：`eclipse-jdtls/eclipse.jdt.ls`（main 分支：README、scripts/jdtls.py、InitHandler、
> WorkspaceExecuteCommandHandler、BundleUtils、Preferences）、`microsoft/java-debug`（plugin.xml、
> JavaDebugDelegateCommandHandler、ResolveClasspathsHandler）、`zed-extensions/java`（src/jdtls.rs、
> src/debugger.rs）、`redhat-developer/vscode-java`（src/javaServerStarter.ts、scripts/server.mjs）、
> `microsoft/vscode-java-test`（src/utils/launchUtils.ts）、npm registry（`@eclipse-wtp/jdtls` 404、
> `@vscjava/java-language-server` 0.1.2 tarball 实测）、Homebrew `jdtls` formula 1.61.0。
> 日期：2026-09-09。

---

## TL;DR（五点结论）

1. **jdtls 启动形态**：`@eclipse-wtp/jdtls` **在 npm 上不存在（404 实测）**——Neeko `java.rs` 的
   `npm install -g @eclipse-wtp/jdtls` 是死安装。JDTLS 官方发行是 download.eclipse.org 的
   tar.gz（milestone/snapshot，结构 `bin/jdtls`+`config_{linux,mac,win}`+`plugins/`+`features/`），
   macOS 用户另有 Homebrew `jdtls`（当前 1.61.0，依赖 openjdk + python）；npm 侧只有
   `@vscjava/java-language-server`（Copilot CLI 向，bin=`jdtls`，内含 proxy 包装）。
   启动 = `java -Declipse.application=org.eclipse.jdt.ls.core.id1 … -jar <equinox launcher> -data <dir>`
   （官方 python wrapper 用 `-Dosgi.sharedConfiguration.area` 级联替代 `-configuration`，并按
   **cwd 项目名哈希自动生成 per-project `-data`**）。**Java 21+ 是 JDTLS 自身运行门槛**（官方 README /
   zed / @vscjava postinstall 三方实证），项目代码可编译 1.8–25。
2. **java-debug 扩展加载**：JDTLS 用 **`initializationOptions.bundles`**（绝对路径数组）在
   `initialize` 握手时经 `BundleUtils.loadBundles()` 热装 OSGi bundle（InitHandler 实证）——
   装进去的 `com.microsoft.java.debug.plugin` 通过 **`org.eclipse.jdt.ls.core.delegateCommandHandler`**
   扩展点注册 `vscode.java.startDebugSession` 等 18 个命令。**Zed 正是这么干的**
   （`inject_plugin_into_options` → `{"bundles":[<jar>]}`）；VSCode 则把 java-debug jar 直接
   **拷进 JDTLS bundle 的 `plugins/` 目录**（两种等价加载路径，bundles 选项对 Neeko 零侵入）。
3. **LSP 命令**：`workspace/executeCommand`（标准 LSP，Zed 实证可用）→
   `vscode.java.startDebugSession`（空参数，返回 **DAP TCP 端口 int**）与
   `vscode.java.resolveClasspath`（参数 `[mainClass, projectName?, scope?]`，scope∈{test,runtime}，
   返回 `[[modulePaths],[classPaths]]`）。**Neeko 现有 `lsp_request` / `LspManager::send_request_async`
   已是通用 LSP request 发送器，直接能发 `workspace/executeCommand`，零新增协议层。**
4. **项目导入**：m2e（Maven pom.xml）+ Buildship（Gradle）**内置自动导入**，默认开启
   （`java.import.maven.enabled` / `java.import.gradle.enabled` 默认 true，Preferences 实证）；
   Gradle 经 wrapper / Tooling API 解析（首跑可能下发行版），Maven 经 m2e 依赖解析。首开大项目
   秒级~分钟级（依赖下载 + 索引 + 构建模型），进度经 `window/workDoneProgress` 通知（Neeko
   server_request.rs 已处理该通知）。**monorepo 多模块天然支持**：单 workspace 导入所有 module
   project；`resolveClasspath` 的 projectName 参数即用来在多模块中定位具体模块。
5. **调试链路**：Neeko 由「spawn 自写 Java host」改为「**连 JDTLS 的 DAP 端口**」——`startDebugSession`
   返回端口后，DAP 客户端直接 `TcpStream::connect`（**新增 `TcpConnect` transport**，无 spawn、无 kill、
   disconnect 即 detach）。launch vs attach：**标准路径 B' 是 launch**（classPaths 来自 resolveClasspath，
   mainClass=JUnit runner，adapter 注入 `-agentlib:jdwp=…,suspend=y` 自行 spawn+attach）；attach 仍是
   fallback。断点时序：launch 后 JVM 挂 main 前（suspend=y）→ `InitializedEvent` → 客户端 setBreakpoints →
   `configurationDone` → 放行，首行断点天然命中；与现有 `HandshakeOrder::LaunchBeforeBreakpoints` 完全同构。

**路径判定**：**B'（JDTLS + java-debug，业界标准）作为 Java debug 正式形态**；路径 A（自写 Java host）
**保留为降级 fallback**（见「对路径 A 的处置」）。

---

## 1) jdtls 启动形态

### 1.1 @eclipse-wtp/jdtls npm 包：**不存在**（Neeko 现状是死配置）

- npm registry 实测：`https://registry.npmjs.org/@eclipse-wtp/jdtls` → **404**；
  `@eclipse-wtp%2Fjdtls` → "Not Found"；unscoped `jdtls` → "Not found"；`eclipse-wtp` scope 搜索无
  任何包。**Neeko `lsp/plugin/builtins/java.rs` 的 `LspInstallMethod { command: ["npm","install","-g","@eclipse-wtp/jdtls"] }` 指向一个不存在的包，`jdtls` 根本装不上。**
- 现有 java.rs 声明（真实现状）：`server_binary:"jdtls"`、`server_command:["jdtls"]`、root markers
  `pom.xml/build.gradle/build.gradle.kts`、detect_priority 40 —— 依赖 PATH 上有 `jdtls` 可执行。
  来源：`src-tauri/src/lsp/plugin/builtins/java.rs`。

### 1.2 JDTLS 真实发行渠道

| 渠道 | 说明 | 证据 |
|---|---|---|
| **download.eclipse.org 官方 tar.gz** | milestone/snapshot：`https://download.eclipse.org/jdtls/milestones/<ver>/jdt-language-server-<ver>-<ts>.tar.gz`；版本解析 `…/milestones/<ver>/latest.txt`；解包即 `bin/jdtls` + `config_{linux,mac,win}` + `plugins/`（含 equinox launcher）+ `features/` | eclipse.jdt.ls README；zed `download_jdtls_milestone()` |
| **Homebrew `jdtls`（macOS）** | 当前 1.61.0；依赖 `openjdk`（Java 21+）+ `python@3.14`；装出 `bin/jdtls`（python wrapper） | formulae.brew.sh/api/formula/jdtls.json 实测 |
| **npm `@vscjava/java-language-server`** | 0.1.2，55MB unpacked，`bin:{"jdtls":"bin/jdtls.js"}`（node LSP proxy）；分平台 `@vscjava/java-ls-config-{win32,darwin,linux}` 提供 config；postinstall 校验 Java≥21 并自动注册 Copilot CLI | npm registry tarball 实测 |
| Linux 包管理器 / vscode-java 内嵌 | vscode-java 下载 `jdt-language-server-latest.tar.gz` 到 `server/` | vscode-java `scripts/server.mjs` |

> 对 Neeko 的建议：**修正 install 方法**——要么依赖用户已装 `jdtls`（Homebrew / 手动），要么
> 走 download.eclipse.org 下载并托管启动参数（见 1.3 直连 java 形态），要么接 `@vscjava` npm
> （node 依赖 Neeko 已有，但 proxy 与 Neeko 自管 initialize 握手有重叠，需评估）。

### 1.3 启动命令与参数（官方 wrapper 实证）

官方 `bin/jdtls` 是 **python wrapper**（`org.eclipse.jdt.ls.product/scripts/jdtls.py`），最终拼出的
java 命令（= Neeko 若直连 java 需复刻的参数全集）：

```
java
  -Declipse.application=org.eclipse.jdt.ls.core.id1
  -Dosgi.bundles.defaultStartLevel=4
  -Declipse.product=org.eclipse.jdt.ls.core.product
  -Dosgi.checkConfiguration=true
  -Dosgi.sharedConfiguration.area=<jdtls_base>/config_<linux|mac|win>
  -Dosgi.sharedConfiguration.area.readOnly=true
  -Dosgi.configuration.cascaded=true
  -Xms1G
  --add-modules=ALL-SYSTEM
  --add-opens java.base/java.util=ALL-UNNAMED
  --add-opens java.base/java.lang=ALL-UNNAMED
  [Java≥24: -Djdk.xml.maxGeneralEntitySizeLimit=0 -Djdk.xml.totalEntitySizeLimit=0]
  -jar <jdtls_base>/plugins/org.eclipse.equinox.launcher_*.jar
  -data <dir>
  […透传 LSP stdio 或 CLIENT_PORT]
```

- **`-data`**：wrapper 按 **`<cache>/jdtls/jdtls-<sha1(cwd名)>`** 自动生成（macOS cache=`~/Library/Caches/jdtls`，
  Linux=`~/.cache/jdtls`，Win=`%APPDATA%\jdtls`）——**per-project 唯一**（README 也要求「unique per
  workspace/project」）。Neeko 用 `spawn_lsp_process` 时 `current_dir=workspace_root`，wrapper 的 cwd
  即项目根 → 自动 per-project，无需 Neeko 计算。
- **`-configuration` vs `-Dosgi.sharedConfiguration.area`**：官方 README 命令行形态用 `-configuration
  ./config_linux`；新版 wrapper 改用 `sharedConfiguration.area` + `cascaded=true`（config 只读共享、
  OSGi 级联生成可写本地配置）。**Neeko 直连 java 时两者任一均可**，推荐对齐 wrapper 的级联形态。
- **Java 版本**：JDTLS **运行需 Java 21+**（wrapper `--validate-java-version` 检查 <21 报错；README
  "requires a runtime environment of Java 21 (at a minimum)"；zed `JAVA_VERSION_ERROR`；@vscjava
  postinstall 同）。项目代码编译目标 1.8–25（README "compiling projects from Java 1.8 through 25"）。
- **LSP 传输**：默认 **stdio**（不设 `CLIENT_PORT` 环境变量即回落 stdin/stdout）——与 Neeko
  `spawn_lsp_process` 的 stdio 桥天然兼容；亦可 `CLIENT_PORT`/`CLIENT_HOST` 走 socket。
- **`--version` 探测问题**：Neeko `session/instance.rs` 对每个 server 跑 `cmd[0] --version`
  （`run_command_blocking`）→ `jdtls --version` 会把 `--version` 透传给语言服务器本体（非 CLI 选项），
  大概率打错/空——`parse_server_version_output` 对空输出有容错（`LspServerInfo::unknown()`），**非阻塞**，
  但可考虑对 java 跳过该探测。

### 1.4 与 Neeko lsp/process.rs 的对接要点

- `spawn_lsp_process(target, cmd, args, current_dir)` 已支持任意 `cmd`+`args`、cwd、本地/WSL/SSH
  （`ExecTarget`）——jdtls 走本地 `java`（wrapper）即可，**spawn 层零改动**。
- 需要补的是**安装与启动形态**：`server_command=["jdtls"]`（wrapper，-data 自动）或
  `server_command=[java 全参…]`（直连，需 per-project `-data`——见第 6 节 LspPlugin 扩展点）。
- `initialization_options` 已存在且实例化时插入 `initialize` 请求（instance.rs 311-314）——java-debug
  加载 + jdtls settings 都走它（见第 2/6 节）。

---

## 2) java-debug 作为 JDTLS 扩展加载

### 2.1 加载机制一：`initializationOptions.bundles`（**Neeko 走这条，零侵入**）

- JDTLS `InitHandler.handleInitializationOptions()` 从 `initialize` 请求读
  `initializationOptions["bundles"]`（`Collection<String>` 绝对 jar 路径），调
  `BundleUtils.loadBundles()` → OSGi `context.installBundle(location)` + start。
  来源：`org.eclipse.jdt.ls.core/.../handlers/InitHandler.java`（`BUNDLES_KEY="bundles"`）、
  `handlers/BundleUtils.java`。
- **Zed 实证**：`zed-extensions/java/src/debugger.rs` 的
  `inject_plugin_into_options()`：`None → json!({"bundles":[<jar 绝对路径>]})`，并入既有
  `initializationOptions`；jar 经 `get_or_download_fork()` 下载
  `https://github.com/zed-industries/java-debug/releases/download/0.53.2/com.microsoft.java.debug.plugin-0.53.2.jar`
  （或用户 `java_debug_jar` 配置，或 Maven Central `com.microsoft.java:com.microsoft.java.debug.plugin`
  坐标拉取）。
- 另有 `java.reloadBundles` delegate 命令可热重载 bundles（运行时替换扩展）。
  来源：`JDTDelegateCommandHandler.java` case `"java.reloadBundles"`。

### 2.2 加载机制二：拷进 JDTLS `plugins/` 目录（VSCode 形态）

- vscode-java 把下载的 JDTLS 解到 `server/`，发布时把 java-debug / java-test 的 OSGi bundle jar
  放进 `server/plugins/`（`.vscodeignore` 不忽略 `server/**` → 随 VSIX 打包；server 目录不入 git，
  CI 阶段 `scripts/server.mjs` 下载 tar.gz 填充）。JDTLS 作为 Equinox OSGi 框架启动时自动加载
  `plugins/` 下所有 bundle。
- 两条路等价（OSGi bundle 同一份 jar），`bundles` 选项对 Neeko 更干净：不用改动 jdtls 安装目录。

### 2.3 bundle 内部：delegateCommandHandler 扩展点注册

- `com.microsoft.java.debug.plugin` 的 `plugin.xml` 声明
  `org.eclipse.jdt.ls.core.delegateCommandHandler`，注册 18 个命令：`vscode.java.startDebugSession` /
  `vscode.java.resolveClasspath` / `vscode.java.resolveMainClass` / `vscode.java.buildWorkspace` …。
  来源：`microsoft/java-debug` `com.microsoft.java.debug.plugin/plugin.xml`。
- JDTLS 侧 `WorkspaceExecuteCommandHandler`（单例）读该扩展点：
  `workspace/executeCommand`（标准 LSP `WorkspaceService.executeCommand`）→ 按 commandId 找
  descriptor → 实例化 `IDelegateCommandHandler` 并 `executeCommand(commandId, args, monitor)`。
  来源：`handlers/WorkspaceExecuteCommandHandler.java`、`handlers/JDTLanguageServer.java`（`executeCommand` 643 行）。
- 命令处理实现：`JavaDebugDelegateCommandHandler.executeCommand` ——
  `startDebugSession → JavaDebugServer.getInstance().start(); return getPort()`；
  `resolveClasspath → new ResolveClasspathsHandler().resolveClasspaths(arguments)`。
  来源：`microsoft/java-debug/.../internal/JavaDebugDelegateCommandHandler.java`。

### 2.4 Zed 全链路（非 VSCode 客户端的标准参照，Neeko 抄作业）

```
初始化: initializationOptions.bundles = [<java-debug plugin jar>]
        → JDTLS 握手时热装 bundle → delegateCommandHandler 注册 18 命令
调试:   DAP 适配器描述 start_session() → lsp "workspace/executeCommand"
        {command:"vscode.java.startDebugSession"} → 返回 u16 端口 → TcpArgumentsTemplate{port}
        inject_config() → resolveMainClass + resolveClasspath 注入 classPaths/mainClass
```
来源：`zed-extensions/java/src/debugger.rs`（start_session / inject_config /
inject_plugin_into_options）、`src/jdtls.rs`（launch args 构建）。

---

## 3) LSP 命令：startDebugSession / resolveClasspath

### 3.1 命令名与参数（java-debug 侧实证）

| 命令 | 参数（arguments 列表） | 返回 | 备注 |
|---|---|---|---|
| `vscode.java.startDebugSession` | `[]`（忽略） | **`int` DAP TCP 端口**（`JavaDebugServer.getInstance().getPort()`，`ServerSocket(0)` 随机端口） | 单例，进程内起 DAP 服务；每连接一个 `ProtocolServer` |
| `vscode.java.resolveClasspath` | `[mainClass, projectName]` 或 `[mainClass, projectName, scope]`，scope∈`"test"`/`"runtime"` | **`String[][]` = `[modulePaths[], classPaths[]]`**（每条目绝对路径） | projectName 用于多模块消歧；scope="test" 含测试源码/依赖（JUnit 场景必用） |
| `vscode.java.resolveMainClass` | `[]`（或 projectName 过滤） | mainClass 候选列表 | launch 需要 mainClass；Neeko 用 Console Launcher 主类则可跳过 |

来源：`JavaDebugDelegateCommandHandler.java`；`ResolveClasspathsHandler.resolveClasspaths()` /
`computeClassPath(mainClass, projectName, scope)`（scope "test" → `excludeTestCode=false` 含测试）。

### 3.2 传输层：标准 `workspace/executeCommand`（Neeko 现成能力）

- 发送走 **标准 LSP `workspace/executeCommand`**（Zed 实证：
  `lsp::request::<u16>(workspace, "workspace/executeCommand", json!({"command":"vscode.java.startDebugSession"}))`）。
  JDTLS `JDTLanguageServer.executeCommand` 即标准 WorkspaceService 实现（见 2.3）。
- **Neeko 现有 `lsp_request(project_path, language_id, method, params)`（commands.rs）→
  `LspManager::send_request_async`（manager.rs）→ `do_send_request`（session/request.rs）已能发送任意
  LSP request**，`workspace/executeCommand` 只是其中一个 method——**零新增协议层，前端直接
  `invoke('lsp_request', { projectPath, languageId:'java', method:'workspace/executeCommand', params:{...} })`**。
- 注意点：
  - session 必须先存活（java 插件 `onFirstFile` auto-start；调试时确保项目已 open/import 完成——
    首开大项目 import 可能未就绪，`resolveClasspath` 会失败/空，需等待 import 完成信号）。
  - `server_request.rs` 已应答 `window/workDoneProgress` / `$/progress`（import 进度），前端可据此
    感知 JDTLS 就绪。

### 3.3 launch 配置映射（resolveClasspath → DAP launch）

vscode-java-test 的 launch 配置形态（`launchUtils.ts` 实证）：`{ type:'java', request:'launch',
projectName, mainClass, classPaths:[...resolveClasspath 的 classPaths], modulePaths:[...],
args:[runner 参数], vmArgs, cwd, noDebug:!isDebug }`。
Neeko 用 JUnit Platform Console Launcher 时：`mainClass=org.junit.platform.console.ConsoleLauncher`，
`classPaths = resolveClasspath(testClass, projectName, "test") + console-standalone.jar 路径`，
`args = execute -c <FQCN> -m '<FQCN#method>' --reports-dir=…`。

---

## 4) 项目导入（m2e / buildship / 索引 / monorepo）

### 4.1 自动导入机制（内置、默认开启）

- JDTLS 基于 Eclipse：**m2e**（Maven，`pom.xml`）与 **Buildship**（Gradle，`build.gradle(.kts)`）
  **随发行版内置**（README "based on M2Eclipse / Buildship"），workspace 打开后自动导入项目。
- 开关（初始化 settings，全部默认 true，Preferences.java 实证）：
  - `java.import.maven.enabled`（默认 true，960 行 `importGradleEnabled=true`/970 行 `importMavenEnabled=true`）
  - `java.import.gradle.enabled`；`java.import.gradle.wrapper.enabled`（默认用 wrapper）、
    `java.import.gradle.version` / `home` / `user.home` 等
  - `java.autobuild.enabled`（默认 true，JDT 增量编译；`vscode.java.buildWorkspace` 可强制全量）
  - `java.import.exclusions`（默认 `**/node_modules/**` 等）
- 来源：`preferences/Preferences.java`（IMPORT_GRADLE_ENABLED / IMPORT_MAVEN_ENABLED /
  AUTOBUILD_ENABLED_KEY 常量与默认值）；eclipse.jdt.ls README。

### 4.2 首次索引时间（大项目）

- 首开 = 依赖解析（m2e 走本地仓库 + 网络下载；Gradle 走 wrapper 下载发行版 + Tooling API 构建模型）
  + 项目导入 + JDT 索引（二进制/源码索引）+ 增量编译。**小项目 ~数秒~十几秒；大项目（数百模块 /
  大型依赖树）可达 30s~数分钟**。
- 进度对客户端经 `window/workDoneProgress` / `$/progress` 推送（"Initializing Java…"）；
  就绪信号可监听 stderr 的 `>> initialization job finished` / `>> build jobs finished`
  （@vscjava proxy 实证：依赖这两条 stderr 判定 project ready）。
- 对 Neeko 的影响：**debug 前必须先等 import 完成**（否则 `resolveClasspath` 无 project）；
  建议「lazy：用户首次点 Java debug 时确保 jdtls session 存活 + import 完成 + 构建产物存在
  （mvn test-compile / gradle testClasses 或 `vscode.java.buildWorkspace`）」。

### 4.3 monorepo 多模块

- **天然支持**：单 workspace（项目根）内 m2e/buildship 会导入全部模块（`<modules>` / settings.gradle 子项目），
  每个 module 是一个独立 Eclipse Java project。
- `resolveClasspath` 的 **`projectName` 参数即多模块消歧手段**（`getJavaProjectFromName`；
  缺省时按 mainClass 全 workspace 搜索，多命中报错要求传 projectName）。monorepo 下
  `projectName` = 具体 module 名（JDTLS 的 project 名 = 模块目录名）。
- Neeko 现状：root markers 命中项目根即开一个 java session —— 与 JDTLS 单 workspace 多 project 模型一致，
  不需要为每模块开 session。

---

## 5) 调试链路改造（JavaAdapter）

### 5.1 现状路径 A（Neeko 已有）

- `DapManager::start_java_attach`（manager.rs）spawn 测试 JVM（Console Launcher +
  `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0`）→ 解析 jdwp 端口 →
  起 **JavaAdapter**（`java -jar ~/.neeko/java-host/neeko-java-host.jar`，自写 host，`TcpListen`
  transport，host 自报端口）→ DAP **attach**（`AttachRequestHandler`，无 classPaths 校验）。
- 自写 host 是路径 A 的产物（`tools/java-host/`，复刻 `JavaDebugServer` 的
  `ServerSocket(0)+ProtocolServer` 循环 + 5 个最小 provider）。

### 5.2 目标路径 B'（对接 JDTLS DAP 端口）

```
Neeko → lsp_request "workspace/executeCommand" {command:"vscode.java.startDebugSession"} → 端口 P
      → (可选) lsp_request "workspace/executeCommand" {command:"vscode.java.resolveClasspath",
          arguments:[<testClass>, <projectName>, "test"]} → [[modulePaths],[classPaths]]
      → DapManager 新增 TcpConnect 传输：TcpStream::connect(127.0.0.1:P)，不再 spawn adapter 进程
      → DAP launch {type:"java", request:"launch", mainClass:ConsoleLauncher,
          classPaths:[resolveClasspath + console-standalone.jar], args:[...], cwd}
        （或保持 attach：spawn 测试 JVM + attach —— 见 5.4 取舍）
      → 断点：adapter 注入 -agentlib:jdwp=…,suspend=y → JVM 挂 main 前 → InitializedEvent →
         setBreakpoints → configurationDone → resume
```

### 5.3 launch vs attach（classPaths 来自 resolveClasspath）

- **launch（B' 标准形态）**：`LaunchRequestHandler` 校验 `mainClass 非空 && (modulePaths 非空 ||
  classPaths 非空)`（`ARGUMENT_MISSING` 否则）。JDT 正常路径就是 `resolveClasspath` 产出
  classPaths 填进 launch 配置——**classPaths 因此从「自建 mvn/gradle CLI 解析」升级为「JDTLS 语义模型」**，
  覆盖测试依赖、多模块、source lookup（`ISourceLookUpProvider` 由 JDT 提供 → 栈帧/变量/求值全可用，
  不再需要路径 A 的 no-op provider）。
- **attach（fallback）**：`AttachRequestHandler` → `SocketAttachingConnector`，无 classPaths 校验
  （可先 attach-first 上线，类同路径 A，只是 DAP 服务器换成 JDTLS 内的 JavaDebugServer）。
- **Neeko 建议**：直接上 launch（classPaths 免费且更完整）；若想渐进，可先「launch 前 resolveClasspath
  失败时降级 attach」。

### 5.4 断点时序（suspend=y attach-before-resume）

- launch 模式 adapter **每次注入 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<端口>`**
  （硬编码 suspend=y，`LaunchRequestHandler`/`LaunchWithDebuggingDelegate` 实证），JVM 起于
  **main 加载前整机挂起** → adapter（JDI LaunchingConnector）attach/accept → 发 DAP `InitializedEvent`
  → 客户端 setBreakpoints → `configurationDone` → VM 继续。**断点天然先于首行执行就位**。
- 与 Neeko 现有 DAP 握手完全同构：JavaAdapter 的 `HandshakeOrder::LaunchBeforeBreakpoints`（launch 先行、
  挂起后设断点）语义不变；仅 DAP 服务器从「自写 host 进程」换成「JDTLS 进程内的 JavaDebugServer」。

### 5.5 Neeko DAP 层改动点（最小集）

1. **新增 `AdapterTransport::TcpConnect { addr: String }`**（types.rs）：
   `connect_transport` 分支直接 `TcpStream::connect(addr)`，无 stdout/stderr 泵、无 `kill_tx`（kill
   回调置 no-op / 仅断开 TCP）。现有 `Stdio` / `TcpListen` 不动（lldb / dlv / 路径 A host 继续用）。
2. **JavaAdapter**（adapter/java.rs）：
   - `resolve_spawn` 不再返回 `java -jar <host.jar>`，而是返回「连接已存在端口」的 spawn 描述
     （`program:""` + `transport:TcpConnect{addr}`）——或由 manager 直接走 TcpConnect 分支。
   - `build_launch_args` 从 `attach` 切 `launch`：`mainClass`（Console Launcher）+ `classPaths`
     （resolveClasspath + console-standalone jar）+ `args`（runner 参数）+ `cwd`。
   - `launch_request_command()` 由 `"attach"` 改 `"launch"`；`handshake_order` 保持 `LaunchBeforeBreakpoints`。
3. **DapManager::start_java_attach** → 改名/新增 `start_java_debug`：先 `lsp_request`
   startDebugSession 拿端口 + resolveClasspath 拿 classPaths，再起 DAP 会话（TcpConnect）。
   `java_test_procs`（测试 JVM 生命周期）仅在 attach 形态需要；launch 形态 debuggee 由 adapter 管，
   断开会 detach（`java.debug` 默认 disconnect 不杀进程，需确认/兜底清理）。

---

## 6) Neeko 最小改动路径（汇总）

### 6.1 LspPlugin / java.rs

- **修 install 方法**（阻塞项）：`@eclipse-wtp/jdtls` 不存在（§1.1）。改为：
  (a) 依赖系统 `jdtls`（Homebrew / download.eclipse.org 解包后 PATH）；或
  (b) Neeko 托管：首次用时下载官方 tar.gz → `~/.neeko/jdtls/` → spawn `java` 全参；
  (c) `@vscjava/java-language-server` npm（需评估 proxy 与 Neeko 握手冲突）。
- **`initialization_options` 填 jdtls settings**（已有字段，实例化时已插入 initialize，零新增机制）：
  ```json
  {
    "bundles": ["<绝对路径>/com.microsoft.java.debug.plugin-0.53.2.jar"],
    "settings": {
      "java.import.maven.enabled": true,
      "java.import.gradle.enabled": true,
      "java.configuration.updateBuildConfiguration": "automatic"
    }
  }
  ```
  - `bundles` = java-debug 扩展加载（§2.1）；jar 下载：Maven Central
    `com.microsoft.java:com.microsoft.java.debug.plugin` 或 Zed fork GitHub release
    `com.microsoft.java.debug.plugin-0.53.2.jar`。
- **`server_command` 扩展（可选但推荐）**：若直连 java（不走 wrapper），需 per-project `-data`。
  两种做法：
  - 保持 `["jdtls"]` + 要求 wrapper（cwd 派生 -data，§1.3）——**零 LspPlugin 改动**；
  - 新增 `LspPlugin` 字段（如 `workspace_data_dir: Option<String>` 或 `extra_args_fn`），spawn 时
    用 `~/.neeko/lsp/<lang>/<hash(project_path)>` 生成 `-data` 参数。**推荐后者**（不依赖外部 wrapper、
  Windows/Linux/macOS 一致）。
- `--version` 探测对 java 跳过或容错（§1.3，非阻塞）。

### 6.2 JavaAdapter / DAP（§5.5 三点）

- `AdapterTransport::TcpConnect`（新变体）+ `connect_transport` 分支。
- JavaAdapter `build_launch_args` 切 launch + classPaths；`launch_request_command` 改 "launch"。
- DapManager 新增「startDebugSession + resolveClasspath → DAP launch(TcpConnect)」编排。

### 6.3 前端

- Java Debug 按钮 → `debug_java_attach` 换/加 `debug_java_start`（或复用同一命令，后端分派）：
  传 `projectName`（模块名，monorepo 需要）+ `testClass`（FQCN）+ `method`。
- 等待 JDTLS 就绪：项目首次 debug 若 jdtls 未 import 完，给 loading/重试（消费
  `window/workDoneProgress` 进度已有基础）。

### 6.4 时序（一次 Java 单测 debug，B'）

```
点击 Debug
  → 确保 jdtls session 存活（auto-start）＋项目 import 完成＋测试已编译
      （mvn test-compile / gradle testClasses，或 vscode.java.buildWorkspace）
  → lsp_request startDebugSession → 端口 P
  → lsp_request resolveClasspath [<TestClass>, <projectName>, "test"] → classPaths
  → DAP connect P → launch {mainClass:ConsoleLauncher, classPaths:…, args:…}
  → 断点/栈/变量/求值（JDT source lookup 全可用）→ 结束 disconnect（detach）
```

---

## 对路径 A（自写 Java host）的处置建议

- **保留为降级 fallback，不删除**。理由：
  1. 路径 A 已落地且通过真机冒烟（java-host/ + JavaAdapter attach-first，见
     `research/java-debug-runability.md`），是「无 JDTLS / jdtls 未装 / import 太慢」时的可用兜底
     （attach-first，classPaths 自建）。
  2. B' 依赖 Java 21+ JDTLS + 秒级~分钟级 import；用户机器 jdtls 缺失或项目过大 import 慢时，
     A 仍是唯一可 debug 的形态。
- **优先级**：B' 作为默认（业界标准，classPaths/source/求值免费、与 VSCode/Zed 同构）；
  `JavaAdapter` 在 B' 可用时走 TcpConnect+launch，探测/命令失败时回退 A 的 attach-first。
  两套共用同一 `JavaAdapter` 插件（`kind=Java`）、同一 DAP 会话/断点/变量管线，切换点收敛在
  `resolve_spawn` / `build_launch_args` / `launch_request_command` 三处。
- **不维护第三条路**：`java-debug-runability.md` 的「自建 Rust JDWP 桥」维持不做（工程量≈调试器后端）。

---

## 来源链接

**eclipse-jdtls/eclipse.jdt.ls（main）**
- README（Java 21 门槛、`-configuration`/`-data`、m2e/buildship）：
  https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/README.md
- 官方启动 wrapper：`org.eclipse.jdt.ls.product/scripts/jdtls.py`
  （`-data` cwd 哈希、`-Dosgi.sharedConfiguration.area` 级联、Java≥21 校验、Java≥24 XML limit）：
  https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.product/scripts/jdtls.py
- InitHandler（`initializationOptions.bundles` → `BundleUtils.loadBundles`）：
  https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/InitHandler.java
- BundleUtils（OSGi installBundle/start）：
  https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/BundleUtils.java
- WorkspaceExecuteCommandHandler（delegateCommandHandler 扩展点分发；`java.reloadBundles`）：
  https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/WorkspaceExecuteCommandHandler.java
- JDTLanguageServer.executeCommand（标准 `workspace/executeCommand`）：
  https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/JDTLanguageServer.java
- Preferences.java（`java.import.maven.enabled` / `java.import.gradle.enabled` / `java.autobuild.enabled`
  默认 true）：…/preferences/Preferences.java

**microsoft/java-debug**
- plugin.xml（`org.eclipse.jdt.ls.core.delegateCommandHandler` 18 命令）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/plugin.xml
- JavaDebugDelegateCommandHandler（startDebugSession→port / resolveClasspath）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/JavaDebugDelegateCommandHandler.java
- ResolveClasspathsHandler（`[mainClass, projectName, scope]` → `[[modulePaths],[classPaths]]`，
  scope=test 含测试类路径）：
  https://github.com/microsoft/java-debug/blob/master/com.microsoft.java.debug.plugin/src/main/java/com/microsoft/java/debug/plugin/internal/ResolveClasspathsHandler.java

**zed-extensions/java（非 VSCode 客户端标准参照）**
- src/jdtls.rs（JDTLS 下载/启动参数/Java21）：
  https://github.com/zed-extensions/java/blob/main/src/jdtls.rs
- src/debugger.rs（fork jar 下载 + `workspace/executeCommand` startDebugSession + `bundles` 注入 +
  resolveClasspath inject_config）：
  https://github.com/zed-extensions/java/blob/main/src/debugger.rs
- README（`java_debug_jar` / `jdtls_launcher` 配置）：
  https://github.com/zed-extensions/java/blob/main/README.md

**redhat-developer/vscode-java / microsoft/vscode-java-test**
- javaServerStarter.ts（`-configuration`/`-data`、Java24 XML、launcher 查找）：
  https://github.com/redhat-developer/vscode-java/blob/main/src/javaServerStarter.ts
- server.mjs（下载 `jdt-language-server-latest.tar.gz` → `server/`）：
  https://github.com/redhat-developer/vscode-java/blob/main/scripts/server.mjs
- launchUtils.ts（launch 配置：type=java/request=launch/classPaths/modulePaths/noDebug）：
  https://github.com/microsoft/vscode-java-test/blob/main/src/utils/launchUtils.ts

**发行渠道实测（2026-09-09）**
- npm registry：`@eclipse-wtp/jdtls` → 404（不存在）；`@vscjava/java-language-server` 0.1.2
  （bin=`jdtls`，postinstall 校验 Java≥21）：https://registry.npmjs.org/@vscjava/java-language-server
- Homebrew `jdtls`（1.61.0，depends openjdk+python@3.14）：
  https://formulae.brew.sh/api/formula/jdtls.json ；Formula：
  https://github.com/Homebrew/homebrew-core/blob/master/Formula/j/jdtls.rb
- 官方发行：https://download.eclipse.org/jdtls/milestones/ ；snapshot：
  https://download.eclipse.org/jdtls/snapshots/
- Zed fork java-debug release（`com.microsoft.java.debug.plugin-0.53.2.jar`）：
  https://github.com/zed-industries/java-debug/releases/download/0.53.2/com.microsoft.java.debug.plugin-0.53.2.jar
