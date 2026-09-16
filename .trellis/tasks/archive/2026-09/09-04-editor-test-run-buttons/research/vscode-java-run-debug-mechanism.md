# VS Code Java 的 Run/Debug 是怎么实现的（一手源码实证）

> 挂靠任务：09-04-editor-test-run-buttons（按用户要求不新建任务）。
> 触发原因：`research/jdtls-runnables-probe.md` 实测证否「核心 jdt.ls 有 runnable 端点」后，
> 需要回答「那 VS Code 到底怎么做的」，再决定 Neeko 该怎么做。
> 方法：**直读一手源码**（GitHub raw + contents API），不依赖二手博客。
> 日期：2026-09-11。

---

## TL;DR —— VS Code 也不是「一个端点拿 runnable」，而是**两个扩展 + 两个 bundle 命令族**

| 场景 | 谁提供 UI | 怎么拿位置/目标 | 依赖 |
|---|---|---|---|
| **main 的 Run\|Debug** | `microsoft/vscode-java-debug`（Debugger for Java）注册 **VS Code CodeLensProvider** | jdt.ls 命令 **`vscode.java.resolveMainMethod(uri)`** → 返回 `IMainMethod[] = {mainClass, projectName, range}`；**用服务器给的 `range` 直接渲染两个 lens** | **`com.microsoft.java.debug.plugin`** bundle（OSGi，需注入） |
| **测试的 Run\|Debug Test** | `microsoft/vscode-java-test`，走 **VS Code 原生 Test API（`TestController`）**，**没有自写 CodeLens** | jdt.ls 命令 **`vscode.java.test.findTestTypesAndMethods`** 等族；启动选择器由 **`vscode.java.test.junit.argument`** 服务端生成 | **`com.microsoft.java.test.plugin`** bundle（OSGi，需注入） |

**关键结论**：VS Code 的精度来自**额外分发的 OSGi bundle**，
不是核心 jdt.ls 自带（本次探针已实测核心 31 条命令里没有 `vscode.java.*`）。
→ 想要 VS Code 同级精度，Neeko 必须**下载并注入至少一个 jar**（经 `initializationOptions.bundles`，
机制已在 `research/java-jdtls-integration.md` §2.1 证实，Zed 对 java-debug 正是这么做的）。

---

## 1) main：`vscode-java-debug` 的 `DebugCodeLensProvider`

来源：`https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/src/debugCodeLensProvider.ts`

核心逻辑（逐字）：

```ts
class DebugCodeLensProvider implements vscode.CodeLensProvider {
    public async provideCodeLenses(document, token): Promise<vscode.CodeLens[]> {
        try {
            const mainMethods: IMainMethod[] = await resolveMainMethod(document.uri, token);
            return _.flatten(mainMethods.map((method) => {
                return [
                    new vscode.CodeLens(method.range, {
                        title: "Run",  command: JAVA_RUN_CODELENS_COMMAND,   // java.debug.runCodeLens
                        arguments: [ method.mainClass, method.projectName, document.uri ],
                    }),
                    new vscode.CodeLens(method.range, {
                        title: "Debug", command: JAVA_DEBUG_CODELENS_COMMAND, // java.debug.debugCodeLens
                        arguments: [ method.mainClass, method.projectName, document.uri ],
                    }),
                ];
            }));
        } catch (ex) {
            return [];   // 失败静默 → 无 lens（与 Neeko 的「快路径兜底」同思路）
        }
    }
}
```

要点：
1. **位置完全由服务器给**（`method.range`、`method.mainClass`、`method.projectName`）——客户端不解析文本、不猜 FQCN。
2. 一个 main 出 **两个** lens（Run / Debug），图标行即 `range`。
3. **失败静默返回 `[]`**（吞异常）。与 Neeko 的 tier 兜底哲学一致。
4. 可配置开关 `java.debug.settings.enableRunDebugCodeLens`（关掉则改注册 HoverProvider）。
5. light/hybrid server mode 下延后到 `ServerMode.STANDARD` 才注册（**等服务器就绪**——与 Neeko
   「不就绪就回退快路径」是同一个问题的两种解法）。

### 1.1 命令字符串（逐字）

来源：`https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/src/commands.ts`

```ts
export const JAVA_START_DEBUGSESSION  = "vscode.java.startDebugSession";
export const JAVA_RESOLVE_CLASSPATH   = "vscode.java.resolveClasspath";
export const JAVA_RESOLVE_MAINCLASS   = "vscode.java.resolveMainClass";
export const JAVA_RESOLVE_MAINMETHOD  = "vscode.java.resolveMainMethod";
export const JAVA_VALIDATE_LAUNCHCONFIG = "vscode.java.validateLaunchConfig";
export const JAVA_BUILD_WORKSPACE     = "vscode.java.buildWorkspace";
export const JAVA_EXECUTE_WORKSPACE_COMMAND = "java.execute.workspaceCommand";
// …

export function executeJavaLanguageServerCommand(...rest: any[]) {
    return executeJavaExtensionCommand(JAVA_EXECUTE_WORKSPACE_COMMAND, ...rest);
}
export async function executeJavaExtensionCommand(commandName, ...rest) {
    const javaExtension = utility.getJavaExtension();          // redhat.java (vscode-java)
    if (!javaExtension) throw new utility.JavaExtensionNotEnabledError(...);
    if (!javaExtension.isActive) await javaExtension.activate();
    return vscode.commands.executeCommand(commandName, ...rest);
}
```

调用链：
```
vscode-java-debug  →  vscode.commands.executeCommand("java.execute.workspaceCommand",
                        "vscode.java.resolveMainMethod", uri)
                   →  (vscode-java 扩展)  →  jdt.ls workspace/executeCommand
                   →  (com.microsoft.java.debug.plugin 的 delegateCommandHandler) → 返回 IMainMethod[]
```

> **纠正先前记录**：`09-04` 的旧调研笔记写「`vscode.java.resolveMainMethod` 是 VS Code **扩展侧**命令」——
> 不准确。它是 **jdt.ls 侧命令**，由 **java-debug bundle** 注册，经 vscode-java 的
> `java.execute.workspaceCommand` 转发。本次已按源码更正。

---

## 2) 测试：`vscode-java-test` 走原生 Test API + `vscode.java.test.*` 命令族

来源：`https://api.github.com/repos/microsoft/vscode-java-test/contents/src/provider`
→ `src/provider/` 只有 `JavaTestCoverageProvider.ts` / `codeActionProvider.ts` / `testSourceProvider.ts`，
**没有 CodeLensProvider** → 说明 Run|Debug Test 的 lens + gutter 由 **VS Code 原生 Testing API** 渲染
（`TestController`/`TestItem` 自带），非扩展自写。

命令族（逐字，来源 `https://raw.githubusercontent.com/microsoft/vscode-java-test/main/src/constants.ts`）：

```ts
export namespace JavaTestRunnerDelegateCommands {
    export const GET_TEST_SOURCE_PATH        = 'vscode.java.test.get.testpath';
    export const RESOLVE_JUNIT_ARGUMENT      = 'vscode.java.test.junit.argument';
    export const GENERATE_TESTS              = 'vscode.java.test.generateTests';
    export const FIND_JAVA_PROJECTS          = 'vscode.java.test.findJavaProjects';
    export const FIND_TEST_PACKAGES_AND_TYPES= 'vscode.java.test.findTestPackagesAndTypes';
    export const FIND_DIRECT_CHILDREN_FOR_CLASS = 'vscode.java.test.findDirectTestChildrenForClass';
    export const FIND_TEST_TYPES_AND_METHODS = 'vscode.java.test.findTestTypesAndMethods';
    export const RESOLVE_PATH                = 'vscode.java.test.resolvePath';
    export const NAVIGATE_TO_TEST_OR_TARGET  = 'vscode.java.test.navigateToTestOrTarget';
    export const GET_COVERAGE_DETAIL         = 'vscode.java.test.jacoco.getCoverageDetail';
}
```

测试身份是**结构化 part 序列**，而非字符串拼接：

```ts
export namespace JUnitTestPart {
    export const CLASS = 'class:';
    export const NESTED_CLASS = 'nested-class:';      // ← 嵌套类是一等公民
    export const SUITE = 'suite:';
    export const METHOD = 'method:';
    export const TEST_FACTORY = 'test-factory:';
    export const PROPERTY = 'property:';              // jqwik
    export const TEST_TEMPLATE = 'test-template:';
    export const TEST_TEMPLATE_INVOCATION = 'test-template-invocation:';
    export const DYNAMIC_CONTAINER = 'dynamic-container:';
    export const DYNAMIC_TEST = 'dynamic-test:';
}
```

要点：
1. **测试发现是服务端语义**（`findTestTypesAndMethods`），不是客户端正则。
2. **启动选择器由服务端生成**（`vscode.java.test.junit.argument`），客户端不拼 `Class#method`。
   → 这正好解释了 Neeko 现状为何在 `@Nested` / 参数化 / 动态测试上会错：**我们自己拼选择器**。
3. `nested-class:` / `test-template-invocation:` / `dynamic-test:` 是**显式建模的 part** ——
   而 Neeko 的 `parseJavaCases` 注解行正则**明确声明**不覆盖参数化/嵌套（见 `utils/testCases.ts` 头注释）。
4. 存在多方法启动协议兼容标记（`MULTI_METHOD_LAUNCH_UNSUPPORTED`），说明服务端会按 jdt.ls 版本降级。

---

## 3) 对 Neeko 的含义（决策依据）

| 方案 | 精度 | 代价 |
|---|---|---|
| 走 VS Code 路线：注入 `com.microsoft.java.debug.plugin`（main）+ `com.microsoft.java.test.plugin`（测试） | **与 VS Code 同级**（服务端语义 range/mainClass/选择器，覆盖 `@Nested`/参数化/动态） | **必须分发 jar**（下载 + 版本管理 + 失败降级）；两条命令族都要；且需 jdt.ls 已 import 完成（大项目秒级~分钟级） |
| 只做 J-A（用核心 `documentSymbol` 的嵌套层级修正 `@Nested` FQCN） | 修掉嵌套类这个硬伤；注解/参数化仍靠文本 | **零新增依赖**（核心自带 `documentSymbolProvider: true`，实测有层级）；纯前端 |
| 不做 | — | 嵌套类测试继续跑不了 |

**诚实的取舍陈述**：
- VS Code 的能力**不是**「jdt.ls 送上门」，而是**两个官方扩展主动分发 bundle + 自建 Test API 层**的结果。
  Neeko 要对齐 = 引入**外部 jar 供给面**（下载/校验/版本/jdt.ls 版本兼容），这在本项目的
  「零新增 npm 依赖 / 不引入 vendor 补丁」语境下属于**需要单独决策**的新依赖。
- J-A 是**用核心能力修一个真 bug**，不新增依赖，与本任务既有的「快路径 + 可选 tier ①」架构同构。

---

## 来源（全部为一手）

- `vscode-java-debug/src/debugCodeLensProvider.ts`
  https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/src/debugCodeLensProvider.ts
- `vscode-java-debug/src/languageServerPlugin.ts`
  https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/src/languageServerPlugin.ts
- `vscode-java-debug/src/commands.ts`
  https://raw.githubusercontent.com/microsoft/vscode-java-debug/main/src/commands.ts
- `vscode-java-test/src/constants.ts`
  https://raw.githubusercontent.com/microsoft/vscode-java-test/main/src/constants.ts
- `vscode-java-test/src/provider` 目录（无 CodeLensProvider → 原生 Test API）
  https://api.github.com/repos/microsoft/vscode-java-test/contents/src/provider
- `vscode-java-test/src/utils` 目录（无文档/注解解析器）
  https://api.github.com/repos/microsoft/vscode-java-test/contents/src/utils
- 本仓库内相关既有调研：`research/java-jdtls-integration.md`（bundle 注入机制）、
  `research/jdtls-runnables-probe.md`（核心 jdt.ls 实测）
