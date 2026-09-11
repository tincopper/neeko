# jdt.ls runnable 能力探针（真机实测）

> 挂靠任务：09-04-editor-test-run-buttons（按用户要求不新建任务）。
> 目的：在写任何 Java「接入 jdt.ls 取 runnable」的代码**之前**，先确认核心 jdt.ls 到底提供什么。
> 方法：本地真机探针 —— 用手写最小 LSP 客户端连 **Zed 已安装的 jdt.ls**
> （`~/Library/Application Support/Zed/extensions/work/java-eclipse-jdtls/eclipse.jdt.ls/bin/jdtls`，
> 无需下载），在最小 Java 工程上跑 initialize → didOpen → documentSymbol → codeLens → executeCommand。
> 探针脚本与原始输出落在 `/tmp`（临时，重启即失）——**本文件已把全部决定性载荷逐字内嵌**
> （31 条命令全量列表、documentSymbol 完整层级、codeLens 形状、错误原文），故结论不依赖 /tmp 存活。
> 环境：Java 21.0.12（Homebrew），无 `pom.xml`/`build.gradle`（避免 m2e/Buildship 联网导入干扰）。
> 日期：2026-09-11。

---

## TL;DR —— **「jdt.ls 提供 runnable」这个前提不成立**

1. **没有任何 runnable 端点**：`executeCommandProvider.commands` 共 31 条，**全是 `java.*`**；
   `vscode.java.resolveMainClass` / `vscode.java.resolveClasspath` 实测直接报
   `-32601 No delegateCommandHandler for …` —— 它们属于 **`com.microsoft.java.debug.plugin` bundle**，
   需经 `initializationOptions.bundles` 额外加载一个 jar 才存在（既有调研
   `research/java-jdtls-integration.md` §2.1 已证该加载机制）。
2. **codeLens 是引用计数，不是运行按钮**：`initialize` 的 `codeLensProvider` 为 **`null`**（未声明），
   但 `textDocument/codeLens` 仍返回 4 个 lens —— 全部 `data: [uri, position, "references"]`、
   **不带 `command` 字段**（需 `codeLens/resolve` 才成形）。即「N references」装饰，与 run/debug 无关。
3. **`documentSymbol` 是唯一真正可用且有价值的产出**，但**不含注解** → 无法据此区分「测试方法」与普通方法。
4. **Zed 的交叉印证**（本机 `zed-extensions/java` 已装的 `runnables.scm`）：Zed 是成熟 jdt.ls 消费者，
   它的 Java runnable **完全由 tree-sitter 静态解析**（`main` 方法 / Java 21 隐式类 / 注解名匹配 `Test$` /
   `@Nested` 嵌套类），**没有向 jdt.ls 发任何 runnable 请求**。

**结论：Java 侧没有「tier ① = 向 LSP 要确定性 runnable」这条路可走**（除非额外分发 java-debug jar）。
真正的增量在别处（见末节「可做项」）。

---

## 1) initialize capabilities（核心 jdt.ls，无 java-debug bundle）

- 顶层 provider 键 25 个，**含 `codeLensProvider` 键但值为 `null`**，`documentSymbolProvider: true`。
- 无 `experimental` / 无任何 runnable 相关能力。
- `serverInfo: null`（jdt.ls 未填）。

### 1.1 executeCommandProvider 全量命令（31 条）

```
java.project.import              java.project.changeImportedProjects   java.navigate.openTypeHierarchy
java.project.resolveStackTraceLocation  java.edit.handlePasteEvent     java.edit.stringFormatting
java.project.getSettings         java.project.resolveWorkspaceSymbol   java.project.upgradeGradle
java.project.createModuleInfo    java.vm.getAllInstalls                java.edit.organizeImports
java.project.refreshDiagnostics  java.project.removeFromSourcePath     java.project.listSourcePaths
java.project.updateSettings      java.project.getAll                   java.reloadBundles
java.project.isTestFile          java.project.resolveText              java.project.getClasspaths
java.navigate.resolveTypeHierarchy  java.edit.smartSemicolonDetection  java.project.updateSourceAttachment
java.project.updateClassPaths    java.decompile                        java.protobuf.generateSources
java.project.resolveSourceAttachment  java.project.updateJdk          java.project.addToSourcePath
java.completion.onDidSelect
```

其中与跑测相关、且**核心自带**的三条：
| 命令 | 用途 | 实测 |
|---|---|---|
| `java.project.isTestFile` | 语义判定「该文件是否测试文件」 | 未试（需参数），命令存在 |
| `java.project.getClasspaths` | 语义 classpath（免 Maven CLI） | 传 `[]` → `-32001 Index 0 out of bounds`（**需参数**） |
| `java.project.getAll` | 已导入工程列表 | ✅ 返回 `["file:/private/tmp/neeko-jdtls-probe/.data/jdt.ls-java-project/"]` |

`vscode.java.*` 全部缺失（实测报错原文）：

```
vscode.java.resolveMainClass -> {"code":-32601,"message":"No delegateCommandHandler for vscode.java.resolveMainClass"}
vscode.java.resolveClasspath -> {"code":-32601,"message":"No delegateCommandHandler for vscode.java.resolveClasspath"}
```

---

## 2) documentSymbol：能拿到什么、拿不到什么

夹具 `AppTest.java`：顶层 `@Test testAdd()` + `@Nested class InnerCases { @Test testNested() }`。

返回**层级化**符号（节选）：

```jsonc
{ "name": "com.example", "kind": 4, "range": {0,0 → 0,20} }          // 4 = Package
{ "name": "AppTest", "kind": 5, "range": {5,0 → 18,1},               // 5 = Class
  "children": [
    { "name": "testAdd()", "kind": 6, "range": {6,4 → 9,5},           // 6 = Method
      "selectionRange": {7,9 → 7,16}, "detail": " : void" },
    { "name": "InnerCases", "kind": 5, "range": {11,4 → 17,5},       // 嵌套类（语义识别）
      "children": [
        { "name": "testNested()", "kind": 6, "range": {13,8 → 16,9},
          "selectionRange": {14,13 → 14,23}, "detail": " : void" } ] } ] }
```

**能拿到**：
- 语义**层级**（package → class → 嵌套 class → method），带 `range` 与 `selectionRange`
- method 的 `detail`（返回类型，形如 `" : void"`）
- 构造器（`kind` 9）与 Java 21 隐式类（无 class 声明）结构

**拿不到（关键）**：
- **注解**。`testAdd()` 与一个普通 `void helper()` 在 documentSymbol 里**完全同形** ——
  `@Test` / `@Nested` / `@ParameterizedTest` **均不出现**。
  → 因此「哪一个是测试方法」**仍必须读源码文本**，与现有 `parseJavaCases` 的行正则同等依赖文本。

---

## 3) 与现状对比：documentSymbol 能修的唯一硬伤是 `@Nested`

现状（`utils/testCases.ts::parseJavaCases` + `utils/testCommands.ts::deriveJavaFqcn`）：

- 用例检测 = 行正则：`@<名字以 Test 结尾>` 注解行 → 向下找 `void <name>(`。
- FQCN = **文件路径推导**（`src/test/java/<pkg>/<Name>.java` → `<pkg>.<Name>`）。
- 运行 = `java -jar <launcher> -m '<FQCN>#<method>'`。

**硬伤（`@Nested`）**：对 `@Nested class InnerCases { @Test void testNested() }`，
现状会**检测到** `testNested`（注解行可达），但组合出 `com.example.AppTest#testNested`
—— 该方法**不在** `AppTest` 而在嵌套类里，JUnit 选择器实际应为
`com.example.AppTest$InnerCases#testNested`（或对应的 UniqueId）。
结果：点击运行 → 选择器不匹配 → 跑 0 个用例（P0 的零命中告警会报出来，但用户拿到的是「跑不了」）。

> *证据强度标注*：`$` 嵌套类选择器这一条是**由 JUnit 选择器语义 + documentSymbol 实测层级推理**得出，
> **未**在真机上跑过 Console Launcher 验证（本机未安装 `junit-platform-console-standalone`）。
> documentSymbol 提供嵌套层级本身是实测事实。

`documentSymbol` 恰好提供修正所需数据：**方法 → 其所属 class 链**（可按 `range` 含包关系）。

---

## 4) 可做项（按「证据支持 × 增量 ÷ 成本」排序）

| # | 项 | 证据 | 增量 | 成本 |
|---|---|---|---|---|
| **J-A** | 用 `documentSymbol` 修正 `@Nested` 的 FQCN 组合（保留文本注解匹配） | 实测层级 + 推理的选择器语义 | **修一个真 bug**（嵌套测试当前跑不了） | 中：新增 docSymbol 拉取 + 行→class 链映射；纯前端（`lspRequest` 现成） |
| **J-B** | 用 `java.project.isTestFile` 替换文件名启发式 | 命令实测存在 | 小-中：测试文件判定更准（`*Test.java` 之外） | 低：一次 `executeCommand`；需参数（待补探） |
| **J-C** | 用 `java.project.getClasspaths` 替换 `mvn dependency:build-classpath` | 命令实测存在（需参数） | **大**：免 Maven CLI / 逐模块 install，Gradle 同受益 | 中-高：需探参数形态；触及现有 classpath 链路（`resolveJavaClasspath`） |
| **J-D** | 接 java-debug bundle 拿 `vscode.java.resolveMainClass`/`resolveClasspath` | 既有调研已证加载机制；本次证实核心无此命令 | 中：main class 语义解析 + 真 classpath | **高**：需下载并分发一个 jar（Zed fork / Maven Central），属新依赖供给面 |
| ❌ | 「向 jdt.ls 要 runnable 列表」 | **本次实测证否** | — | — |

**建议**：先做 **J-A**（唯一「证据充分 + 修真 bug」的项）；J-B/J-C 单独立项（前者小、后者价值大但改动面到 classpath 链路）；J-D 除非同时要迁移整个 Java debug 到 jdt.ls（路径 B'，既有调研已设计），否则不划算。
**不做**：Zed 式的 tree-sitter 静态方案 —— 我们已有行正则覆盖同类信息，换 tree-sitter 属净增依赖（3 套语法 + 体积），与 `design/runnable-detection.md` §8「不做 tree-sitter」既定决策一致。
