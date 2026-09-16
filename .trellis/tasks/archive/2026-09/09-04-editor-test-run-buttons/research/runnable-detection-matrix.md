# Runnable 检测机制调研（Run/Debug 按钮从哪里来）

> 任务：`09-04-editor-test-run-buttons`。日期：2026-09-11。
> 输入：VS Code / IDEA 系 / Zed 的官方文档与 LSP 扩展规范；Neeko 现有实现实证。
> 结论先行：**四家主流 IDE 没有一家用「手写逐行正则」做 runnable 检测**——Rust/Go/Java
> 分别交给 rust-analyzer / gopls / jdt.ls，Zed 是「tree-sitter + LSP」双路，IDEA 系走 PSI。
> Neeko 现状是正则；它适合做**零依赖快路径**，但不该是唯一事实源。

---

## 1. 四家 × 检测机制矩阵

| 维度 | VS Code | IDEA / RustRover / GoLand | Zed | Neeko（现状） |
|---|---|---|---|---|
| Rust 入口/测试 | **rust-analyzer**（LSP 扩展 `experimental/runnables`；codelens 由 RA 提供） | **PSI**：从 caret 的 `RsFunction`（`fn main` / `#[test]`）产出 `RunConfiguration`（`RunConfigurationProducer` 家族） | **tree-sitter + RA LSP 双路**：`enable_lsp_tasks`（默认开）走 RA runnables，通用 task 走 tree-sitter 查询 | 逐行正则（`mainEntries.ts` / `testCases.ts`） |
| Go 入口/测试 | **gopls**：codelens `test` 源（每个 Test/Benchmark 一条运行命令） | **PSI**：Go 插件的 run configuration producer | 同上（Go 的 tree-sitter 查询 + gopls） | 正则 + `go.mod` 探测 |
| Java 入口 | **jdt.ls**：Java 扩展命令 `vscode.java.resolveMainMethod`（服务端语义解析） | **PSI**：`ApplicationConfigurationProducer` | tree-sitter（无测试调试场景） | 正则 + 路径推导 FQCN |
| 检测产物形状 | `{label, kind, args{cargoArgs, executableArgs, cwd, environment, workspaceRoot}, location}` | `RunConfiguration`（可持久化、可编辑、可分享） | `Runnable` / task（可执行 + 参数） | `{name, line, lang}`（只有名字与行号） |
| 唯一事实源 | 语言服务器 | PSI | 语言服务器（Rust）+ 语法树（通用） | 各自手写正则 |

> IDEA 一列为**插件架构层面**的结论（PSI + `RunConfigurationProducer`），未逐行核对
> intellij-rust / Go 插件源码；如需精确到类名，实现阶段再拉源码核对。

---

## 2. LSP 扩展规范摘录（可直接落地的部分）

### 2.1 rust-analyzer `experimental/runnables`

来源：[RA LSP Extensions](https://rust-analyzer.github.io/book/contributing/lsp-extensions.html)

**客户端必须先声明能力**（否则服务端不应答）：

```
Server capability: { "runnables": { "kinds": string[] } }
```

**请求**：`experimental/runnables`

```ts
interface RunnablesParams {
  textDocument: TextDocumentIdentifier;
  position?: Position;   // 省略 = 整文件
}
```

**响应**：`Runnable[]`

```ts
interface Runnable {
  label: string;
  location?: LocationLink;   // 关联的函数/模块位置（行号区间）
  kind: string;              // 必须是客户端声明过的 kind
  args: any;                 // 形状由 kind 决定；执行由客户端负责
}
```

**kind 与 args（RA 目前只有两种 kind）**：

```ts
// kind = "cargo"
{
  environment?: Record<string, string>;
  cwd: string;
  workspaceRoot?: string;
  cargoArgs: string[];        // 例：["test", "--package", "api", "--lib", "--no-run"]
  executableArgs: string[];   // 例：["--exact", "module::tests::foo"]
  overrideCargo?: string;
}
// kind = "shell"
{ environment?: Record<string, string>; cwd: string; program: string; args: string[] }
```

要点：
- **测试不是独立 kind**——测试表现为 `kind:"cargo"` 的 runnable（带相应 `cargoArgs`）。
- 另有 `rust-analyzer/relatedTests`（`TextDocumentPositionParams` → `TestInfo[]`，每个含
  `runnable`）与 Test explorer 扩展（`TestItem` 内嵌 `Runnable`），可用于「这一行有哪些测试」。
- 这意味着 package / target / 完整测试路径 / `--exact` / cwd / env **全部由 RA 给出**，
  客户端不需要猜清单、也不需要猜 `--lib|--bin|--test`。

### 2.2 gopls codelens

来源：[gopls codelenses](https://go.googlesource.com/tools/+/master/gopls/doc/codelenses.md)

- codelens 源共 8 个（`generate` / `regenerate_cgo` / `test` / `run_govulncheck` / `tidy` /
  `upgrade_dependency` / `vendor` / `vulncheck`），由 `codelenses` 设置逐项开关。
- `test` 源：为 `*_test.go` 中每个 Test / Benchmark 生成运行命令；CLI 形态
  `gopls codelens -exec file.go:123 "run test"`。
- **`test` 默认关闭**，官方理由原文：VS Code 有 client-side 自定义测试 UI，且进度通知
  不适合流式测试输出。→ Neeko 若走这条路，需在 gopls 插件设置里显式打开。

### 2.3 jdt.ls（待核实）

- VS Code Java 的 Run/Debug 走扩展命令 `vscode.java.resolveMainMethod`（缺 handler 时报
  `No delegateCommandHandler for vscode.java.resolveMainMethod`）。
- **待核实**：jdt.ls 侧的**请求名**与返回结构（`java/resolveMainMethod`？）需按 Neeko 打包的
  jdt.ls 版本核对后再落地。

---

## 3. Neeko 现状：正则清单（逐条原文）

| 位置 | 用途 | 正则 |
|---|---|---|
| `src/features/editor/utils/testCases.ts:31` | Rust 测试函数名 | `/^(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/` |
| `src/features/editor/utils/testCases.ts:40` | Go 测试函数 | `/^func\s+(Test[A-Za-z0-9_]*)\s*\(/` |
| `src/features/editor/utils/testCases.ts:51` | Java 测试注解 | `/^@([\w$]*Test)\b/` |
| `src/features/editor/utils/testCases.ts:56` | Java 测试方法 | `/^(?:(?:public\|protected\|private\|static\|final\|synchronized\|native\|strictfp)\s+)*(?:<\s*[^>]*\s*>\s+)?void\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/` |
| `src/features/editor/utils/mainEntries.ts:17` | Go main | `/^func\s+main\s*\(/` |
| `src/features/editor/utils/mainEntries.ts:27` | Rust main | `/^(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+main\s*\(/` |
| `src/features/editor/utils/mainEntries.ts:35` | Java main | `/^(?:(?:public\|protected\|private\|final\|synchronized\|native)\s+)*static\s+void\s+main\s*\(\s*String\s*(?:\[\]\s*\|\s*\.\.\.\s*)[A-Za-z_$][A-Za-z0-9_$]*\s*\)/` |
| `src/features/editor/utils/mainEntries.ts:43` | 注释行判定（每种语言共用） | `trimStart()` 后以 `//` `#` `/*` `*` 开头即跳过 |
| `src/features/editor/utils/testCommands.ts:634` | Rust target 锁定 | `resolveTestTargetFlag(filePath, hasLib): string`（`''` = 不锁定） |

---

## 4. 正则方案的能力边界

### 4.1 漏报（false negative，表现为「没有按钮」）

- Rust main：`async fn main`（**2026-09-11 线上 bug**）、`pub(crate) async fn main`
  （`pub\s+` 不匹配带括号的可见性）、`macro_rules!` / `include!` 生成的 `main`、
  属性与 `fn` 同一行（`#[tokio::main] async fn main() {}`——属性行以 `#` 开头被当注释跳过）。
- Rust 测试：`#[test_case]` / `#[rstest]` 等宏属性、`cfg_attr` 条件属性、属性与函数同行。
- Go：子测试 `t.Run("name", ...)`（当前明确不支持）、`TestMain(m *testing.M)`。
- 所有语言：多行签名形态（入口识别只看声明行，`fn main(` 换行后仍可识别，但 `fn\nmain` 不行）。

### 4.2 误报（false positive，表现为「按钮点了没用」）

- Rust：`#[cfg(feature = "cli")] fn main` —— 当前构建下不存在的 `main` 也会出按钮。
- 任何语言：字符串字面量 / 宏体 / `include!` 内容里的伪代码行。
- 共用 `isCommentLine` 的启发式副作用：以 `*` 开头的**代码**行（如 `*ptr = x;`）会被当注释跳过。

### 4.3 语义缺失（最致命，且无法用「再补一条正则」解决）

正则只知道「有个 `main` / 有个 `TestXxx`」，**不知道**：

| 缺失信息 | 后果（Neeko 现状） |
|---|---|
| 属于哪个 package / target | Rust 需要 `--package` / `--bin` / `--lib` / `--test`；靠 `resolveTestTargetFlag` + `hasLibTarget` 探测 `src/lib.rs` 猜 |
| 清单位置 | 靠 `resolveCargoManifestDirForFile` 向上找 `Cargo.toml` 猜 `--manifest-path` |
| 测试的**完整路径** | 只能用 libtest **子串**过滤（`testCommands.ts` 注释已声明「子串命中会多跑」）；无法用 `--exact` |
| cwd / env | 无从得知（RA 的 `cargo` runnable 会给出） |
| 当前构建配置（feature/cfg） | 无法判断该 `main`/test 是否真的会被编译 |

**最危险的一条（实测修正）**：**Run 链路从不锁定 target**（`buildRustRunCommand` 不传
`--lib/--bin/--test`），因此「猜错 target」不是 Run 的失效路径。真实缺陷是**零命中静默**：
命令 exit 0 却一个用例都没跑到（用例位于 `examples/`、自定义 `[[test]] path`、
`test = false` 的目标、名称未对齐等），此时用户只看到 Task Console 有输出、gutter 无状态，
无从判断。→ 治理方式见 `design/runnable-detection.md` §5 P0.2（`shouldReportNoMatch` 显式告警）。
Debug 链路的 target 锁由产物解析兜住（`binary_not_found` / `binary_ambiguous` 均明确报错），无需改造。

---

## 5. 内部漂移实证（本次 bug 的根因）

同一份语言知识被写了两遍，已经漂移：

| 文件 | 正则 | 是否支持 `async` |
|---|---|---|
| `testCases.ts:31`（测试函数名） | `^(?:async\s+)?fn\s+…` | ✅ |
| `mainEntries.ts:27`（main 入口） | `^fn\s+main\s*\(`（修复前） | ❌ → 线上 bug |

即「Rust 函数声明」这一件事有两套写法，其中一套漏了 `async`。这正是仓库
`AGENTS.md` 反复强调的「单一事实源」问题：**语言词汇必须有唯一落点**。

---

## 6. 结论

1. 正则**适合**做「同步、零依赖、离线可用的快路径」——gutter 需要立即出图标，不能等 LS。
2. 正则**不适合**做唯一事实源——语义（package/target/完整路径/`--exact`/cwd/env）只有 LS 有。
3. 主流做法是「结构化数据优先，语法层兜底」：Zed 官方文档原话「Zed provides tasks using
   **tree-sitter**, but rust-analyzer has an **LSP extension method** for querying
   file-related tasks via LSP」；VS Code 的 codelens 则完全依赖 LS（就绪后才出现）。
4. **按钮可用性不能绑在 LS 上**：执行只依赖工具链（cargo/go/java/vitest）——Neeko 今天不装
   jdtls/gopls/RA 也能 Run/Debug。用「LS 就绪」当开关会把今天可用的能力藏起来；
   应改用「**参数是否确定性**」当开关（详见 `design/runnable-detection.md`）。
5. Neeko 已有接 LS 的全部条件：三家 LS 均已接入（`lsp/plugin/builtins/{rust_lang,go,java}.rs`）、
   通用请求通道 `lsp_request`（`lsp/commands.rs:66`，前端门面 `src/features/lsp/api/lspApi.ts`）、
   LSP→UI 先例（symbol-nav）、gutter 异步刷新通道（`refreshRunCodelensEffect`）。
   唯一缺口：`build_client_capabilities()`（`lsp/session/instance.rs:528`）**未声明**
   `experimental.runnables.kinds`。

## 7. 出处

- rust-analyzer LSP Extensions（`experimental/runnables` / `relatedTests` / Test explorer）：
  https://rust-analyzer.github.io/book/contributing/lsp-extensions.html
- gopls code lenses（`test` 源、默认关闭及官方理由）：
  https://go.googlesource.com/tools/+/master/gopls/doc/codelenses.md
- Zed Rust 文档（tree-sitter + RA LSP tasks，`enable_lsp_tasks` 默认开）：
  https://zed.dev/docs/languages/rust
- Debugger for Java（`vscode.java.resolveMainMethod`）：
  https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug
- IDE 既有三份调研（本任务内）：`research/debug-vscode.md`、`debug-idea.md`、`debug-zed.md`
