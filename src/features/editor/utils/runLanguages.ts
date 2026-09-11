/**
 * 可运行语言注册表 —— 「文件名/扩展名 → 语言能力」的唯一事实源。
 *
 * 收编此前散落 4 处、且已发生漂移的谓词（`isTestFile(name) || .rs || .java [|| .go]`）：
 * - `runContribution.when`（含 .go）
 * - `testStatusContribution.when`（曾漏 .go → 漂移）
 * - `useUnifiedGutter` 进列门控
 * - `runContribution.buildTestCodelensMarkers` 的 isMainLang 后缀判断
 *
 * 各语言能力集中为表项；新增语言 = 本表加一行（+ 对应解析器），不再改动任何
 * 贡献的 `when` 分支，从结构上杜绝再一次漂移。
 *
 * 数据表（非 `dyn`/继承）：语言集合固定且已知，用判别联合 + 查表即可。
 */
import type { LspRunnable } from '../runnables/runnable';
import type { RunLang, SyntaxDoc, MainEntry, MainLang } from '../syntax/contract';
import { discoverGoMains, discoverGoTests } from '../syntax/go';
import { discoverJavaMains, discoverJavaTests } from '../syntax/java';
import type { SyntaxTree } from '../syntax/lezer';
import { parserFor } from '../syntax/parsers';
import { discoverRustMains, discoverRustTests } from '../syntax/rust';
import { discoverTsTests } from '../syntax/ts';

import type { ExistsProbe } from './cargoManifest';
import { isTsTestFile, type TestCaseInfo } from './testCases';
import {
  buildGoMainDebugBuildCommand,
  buildGoMainRunCommand,
  buildGoRunCommand,
  buildJavaMainRunCommand,
  buildJavaRunCommand,
  buildRustMainDebugBuildCommand,
  buildRustMainRunCommand,
  buildRustRunCommand,
  buildTsRunCommand,
  defaultRunContext,
  goPkgDir,
  junitLauncherJarName,
  resolveJavaClasspath,
  type JavaRunEnv,
  type MainDebugBuildInput,
  type MainRunInput,
  type RunCommandInput,
  type RunContext,
} from './testCommands';

/** 参与 run/测试状态 gutter 的语言 id（与 `TestCaseInfo.lang` 同集合）。 */
/** 类型定义已下沉到 `syntax/contract.ts`；此处再导出以保持既有导入路径。 */
export type { RunLang } from '../syntax/contract';

/** 语言能力声明：驱动 UI 与动作分流，替代散落的 `lang === 'ts'` 之类字符串判断。 */
export interface RunCapabilities {
  /** 用例点击直跑（不弹菜单）；`false` → 弹 Run/Debug 菜单。 */
  readonly directRun: boolean;
  /** Debug 通道：`attach`（Java attach-first）/ `native`（lldb·dlv）/ `null`（无 Debug）。 */
  readonly debug: 'attach' | 'native' | null;
}

/** 结果读取通道：决定 Run 结束后用哪个报告解析器（与命令侧产物格式同源）。 */
export type ResultsSource = 'libtest-json' | 'test2json' | 'junit-xml' | 'vitest-json';

/** `RunLanguage.resolveContext` 的输入：各语言自取所需字段（避免未用参数）。 */
export interface RunContextInput {
  filePath: string;
  runRoot: string | null | undefined;
  probe?: ExistsProbe;
  javaEnv?: JavaRunEnv;
}

/** 单一语言的能力表项。 */
interface RunLanguage {
  readonly id: RunLang;
  /** 文件是否属于本语言（扩展名/命名判定，无文档内容）→ 进列门控。 */
  isRunnableFile(fileName: string): boolean;
  /** 文件是否承载**测试用例**（比 `isRunnableFile` 更窄：Go 仅 `_test.go`）。 */
  isTestCaseFile(fileName: string): boolean;
  /** 是否解析并显示 main 入口。 */
  readonly hasMain: boolean;
  /**
   * 用例名是否以 `/` 表达**层级**（运行时语义，不是文案）。
   *
   * 存在理由：静态子测试的「父子关系」只能按该语言的层级语义推导。Go 的 `t.Run` 子测试由
   * `go test -run` / delve `-test.run` **逐层锚定**（见 `goTestRunPattern`），故 `/` 即层级；
   * 而 TS 用例标题含 `/` 极常见（`test('GET /users')`）却是**平凡文本** —— 按前缀猜层级会
   * 产出伪造的父子关系（F15）。本能力位即该差异的**唯一事实源**（§7.8.4）。
   */
  readonly hierarchicalTestNames: boolean;
  /**
   * **用例发现（AST）**：语法树 → 用例。**必填** —— 四语言已全部迁移、文本正则实现已删除；
   * 必填使「新增语言必须提供 AST 实现」由编译器强制（不可能再退回逐行正则机制）。
   */
  discoverTests(sd: SyntaxDoc): TestCaseInfo[];
  /** **main 入口发现（AST）**，与 `discoverTests` 同级；无 main 概念的语言返回 `[]`。 */
  discoverMains(sd: SyntaxDoc): MainEntry[];
  /**
   * 解析该语言的**运行环境事实**（IO）。注册表集中声明「哪种语言要解析什么」，
   * 新增语言只加本项，`resolveRunContext` 不再需要 `if lang === …` 分支；
   * 无 IO 的语言省略本项（得到默认上下文）。
   */
  resolveContext?(input: RunContextInput): Promise<Partial<RunContext>>;
  /** 构造该语言的 run 命令（纯；IO 事实在 `input.ctx`）。 */
  buildRunCommand?(input: RunCommandInput): string;
  /** 构造该语言的 main 运行命令（无 main 概念的语言省略）。 */
  buildMainRunCommand?(input: MainRunInput): string;
  /** 构造该语言的 main Debug 前置构建命令（不支持的语言省略）。 */
  buildMainDebugBuildCommand?(input: MainDebugBuildInput): string;
  /** 能力声明（UI/动作分支的唯一依据）。 */
  readonly capabilities: RunCapabilities;
  /** 结果读取通道（Run 结束后解析哪个报告）。 */
  readonly results: ResultsSource;
}

const TS: RunLanguage = {
  id: 'ts',
  // TS/JS 只有 `*.test.*` / `*.spec.*` 参与（无 main 概念）。必须用 TS 专属命名
  // 判定：跨语言的 `isTestFile` 会把 `*Test.java` / `_test.go` 也判真，从而被
  // 本表项抢先吞掉，其它语言永远匹配不到（顺序查找）。
  isRunnableFile: isTsTestFile,
  isTestCaseFile: isTsTestFile,
  hasMain: false,
  hierarchicalTestNames: false,
  // 已迁移 AST（`syntax/ts.ts`）：不再提供正则实现（避免机制分叉）
  discoverTests: discoverTsTests,
  discoverMains: () => [],
  buildRunCommand: buildTsRunCommand,
  capabilities: { directRun: true, debug: null },
  results: 'vitest-json',
};

const RUST: RunLanguage = {
  id: 'rust',
  isRunnableFile: (name) => name.endsWith('.rs'),
  // 测试/ main 均由内容（属性 / `fn main`）判定，解析器自然返回空。
  isTestCaseFile: (name) => name.endsWith('.rs'),
  hasMain: true,
  hierarchicalTestNames: false,
  // 已迁移 AST（`syntax/rust.ts`）：不再提供正则实现
  discoverTests: discoverRustTests,
  discoverMains: discoverRustMains,
  buildRunCommand: buildRustRunCommand,
  buildMainRunCommand: buildRustMainRunCommand,
  buildMainDebugBuildCommand: buildRustMainDebugBuildCommand,
  capabilities: { directRun: false, debug: 'native' },
  results: 'libtest-json',
};

const GO: RunLanguage = {
  id: 'go',
  // 进列含 main.go（有 main 入口）；用例解析再收窄到 `_test.go`。
  isRunnableFile: (name) => name.endsWith('.go'),
  isTestCaseFile: (name) => name.endsWith('_test.go'),
  hasMain: true,
  // Go 是唯一以 `/` 表达层级的语言（t.Run）——见能力位定义
  hierarchicalTestNames: true,
  // 已迁移 AST（`syntax/go.ts`）：不再提供正则实现
  discoverTests: discoverGoTests,
  discoverMains: discoverGoMains,
  // 包目录需向上探测 go.mod（嵌套 module 取相对 module 根）。
  resolveContext: async ({ filePath, runRoot, probe }) => ({
    goPkg: await goPkgDir(filePath, runRoot, probe),
  }),
  buildRunCommand: buildGoRunCommand,
  buildMainRunCommand: buildGoMainRunCommand,
  buildMainDebugBuildCommand: buildGoMainDebugBuildCommand,
  capabilities: { directRun: false, debug: 'native' },
  results: 'test2json',
};

const JAVA: RunLanguage = {
  id: 'java',
  isRunnableFile: (name) => name.endsWith('.java'),
  isTestCaseFile: (name) => name.endsWith('.java'),
  hasMain: true,
  hierarchicalTestNames: false,
  // 已迁移 AST（`syntax/java.ts`）：不再提供正则实现
  discoverTests: discoverJavaTests,
  discoverMains: discoverJavaMains,
  // Maven 依赖 classpath 读产物文件；launcher 走注入路径（缺省 bare jar 名）。
  resolveContext: async ({ runRoot, javaEnv }) => ({
    javaDeps: javaEnv?.readText ? await resolveJavaClasspath(runRoot ?? '', javaEnv.readText) : '',
    javaLauncher: javaEnv?.launcherPath ?? junitLauncherJarName(),
  }),
  buildRunCommand: buildJavaRunCommand,
  buildMainRunCommand: buildJavaMainRunCommand,
  // Java main Debug 走 attach-first（buildJavaDebugCommand），无独立构建命令。
  capabilities: { directRun: false, debug: 'attach' },
  results: 'junit-xml',
};

/** 语言表（查找序即优先级；扩展名互斥，顺序无歧义）。 */
const RUN_LANGUAGES: readonly RunLanguage[] = [TS, RUST, GO, JAVA];

/** 文件名 → 语言能力（无匹配 → null）。 */
export function runLanguageFor(fileName: string): RunLanguage | null {
  return RUN_LANGUAGES.find((lang) => lang.isRunnableFile(fileName)) ?? null;
}

/**
 * run / 测试状态 gutter 的进列门控 —— **唯一事实源**。
 * 两个贡献与装配层都调本函数，`when` 语义不可能再各自漂移。
 */
export function isRunnableFile(fileName: string): boolean {
  return runLanguageFor(fileName) !== null;
}

/**
 * **一次解析、两次发现**（gutter 的批量入口）。
 *
 * 存在理由：`discoverTests` 与 `discoverMains` 若各自整篇解析，同一文档会被**解析两遍**
 * （实测在 179 KB Go 文件里占一半以上成本）。本入口保证**最多解析一次**：调用方若已持有
 * 覆盖全文的树（如编辑器增量树）则零解析。
 *
 * 门控语义与各语言能力位一致：`tests` 受 `isTestCaseFile` 约束、`mains` 受 `hasMain` 约束，
 * 故非目标文件自然得到空数组（单一来源，避免调用方各自判一遍）。
 */
export function discoverRunTargets(
  fileName: string,
  docText: string,
  tree?: SyntaxTree,
): { tests: TestCaseInfo[]; mains: MainEntry[] } {
  const lang = runLanguageFor(fileName);
  if (!lang) return { tests: [], mains: [] };
  // **先门控、后解析**：两路都不需要时不解析（避免「用不上也白解析全文」）。
  // 现有四语言在 gutter 调用点必有一路命中（TS 的 isRunnableFile ≡ isTestCaseFile，
  // Rust/Go/Java 的 hasMain ≡ true），但这是**语言集合的巧合**，不该固化为契约。
  const wantsTests = lang.isTestCaseFile(fileName);
  const wantsMains = lang.hasMain;
  if (!wantsTests && !wantsMains) return { tests: [], mains: [] };
  const sd = { tree: tree ?? parserFor(lang.id).parse(docText), docText, fileName };
  return {
    tests: wantsTests ? lang.discoverTests(sd) : [],
    mains: wantsMains ? lang.discoverMains(sd) : [],
  };
}

/** 文件是否可能有 main 入口（供 markers 合并判定，替代散落的 `.go/.rs/.java`）。 */
export function hasMainEntries(fileName: string): boolean {
  return runLanguageFor(fileName)?.hasMain ?? false;
}

/** 该文件的语言是否以 `/` 表达用例层级（决定静态子测试能否按名归组；§7.8.4）。 */
export function hasHierarchicalTestNames(fileName: string): boolean {
  return runLanguageFor(fileName)?.hierarchicalTestNames ?? false;
}

/**
 * 该文件的**静态子测试索引**：父用例名 → 已有静态按钮的子测试全名（设计 §7.8.4）。
 *
 * 用途：菜单据此与运行时动态发现求差，使两条路线互补 —— 静态只覆盖字符串字面量表格，
 * 动态补 `Sprintf` / 变量 / 净化后重名的组。
 *
 * **门控内置（不接受裸 `tests`）**：`/` 只在**声明了层级用例名**的语言里表示父子关系
 * （`RunLanguage.hierarchicalTestNames`）。TS 标题含 `/` 极常见（`test('GET /users')`）
 * 却是平凡文本，按前缀猜层级会产出**伪造的父子关系**；而菜单去重正是靠本索引判定
 * 「已有静态按钮」，假数据会让去重错杀。判定放在函数内，使调用方**结构上无法**忘记门控
 * —— F15 的根因正是「产出方猜层级、靠消费方兜住」。
 *
 * **对每一层祖先都登记**：`t.Run` 可再嵌 `t.Run`，深层子测试相对每层父级都是可运行目标
 * （与 `-run` 的层级锚定同构），故 `T/a/b` 必须同时进 `T` 与 `T/a` 的桶。
 *
 * 无子测试的用例**不建键** —— 调用方以「键是否存在」判定有无静态按钮；建空数组会让
 * 「有静态按钮但全被去重」与「无静态按钮」两种情形无法区分。
 */
export function staticSubtestsForFile(
  fileName: string,
  tests: TestCaseInfo[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!hasHierarchicalTestNames(fileName)) return index;
  for (const { name } of tests) {
    for (let slash = name.indexOf('/'); slash !== -1; slash = name.indexOf('/', slash + 1)) {
      const parent = name.slice(0, slash);
      const children = index.get(parent);
      if (children) children.push(name);
      else index.set(parent, [name]);
    }
  }
  return index;
}

/** 按语言 id 查表（`resolveRunContext` 用；无匹配 → null）。 */
export function runLanguageById(id: RunLang): RunLanguage | null {
  return RUN_LANGUAGES.find((lang) => lang.id === id) ?? null;
}

/**
 * Run/Debug 命令链路唯一的 IO 边界 —— 按**语言注册表**解析环境事实。
 *
 * 分发是表驱动的：新增语言只加注册表一项（`resolveContext`），无需在此处新增
 * `if lang === …`。返回值直接喂给各 `build*Command` 纯函数。
 */
export async function resolveRunContext(
  lang: RunLang,
  filePath: string,
  runRoot: string | null | undefined,
  opts: { probe?: ExistsProbe; javaEnv?: JavaRunEnv } = {},
): Promise<RunContext> {
  const entry = runLanguageById(lang);
  if (!entry?.resolveContext) return defaultRunContext();
  const partial = await entry.resolveContext({
    filePath,
    runRoot,
    probe: opts.probe,
    javaEnv: opts.javaEnv,
  });
  return { ...defaultRunContext(), ...partial };
}

/** 构造 run 命令（**表驱动**分发：按 `testCase.lang` 取注册表实现，无 lang 分支）。 */
export function buildRunCommand(
  testCase: TestCaseInfo,
  relPath: string,
  cargoManifestDir: string | null | undefined,
  runRoot: string | null | undefined,
  ctx: RunContext,
  lsp: LspRunnable | null = null,
): string {
  const entry = runLanguageById(testCase.lang);
  if (!entry?.buildRunCommand) {
    throw new Error(`No run command builder registered for language: ${testCase.lang}`);
  }
  return entry.buildRunCommand({ testCase, relPath, cargoManifestDir, runRoot, ctx, lsp });
}

/** 构造 main 运行命令（表驱动分发）。 */
export function buildMainRunCommand(
  lang: MainLang,
  filePath: string,
  runRoot: string,
  ctx: RunContext,
  opts: { manifestDir?: string | null; lsp?: LspRunnable | null } = {},
): string {
  const entry = runLanguageById(lang);
  if (!entry?.buildMainRunCommand) {
    throw new Error(`No main run command builder registered for language: ${lang}`);
  }
  return entry.buildMainRunCommand({
    filePath,
    runRoot,
    manifestDir: opts.manifestDir ?? null,
    ctx,
    lsp: opts.lsp ?? null,
  });
}

/** 构造 main Debug 前置构建命令（表驱动分发）。 */
export function buildMainDebugBuildCommand(
  lang: 'go' | 'rust',
  ctx: RunContext,
  opts: { manifestDir?: string | null; lsp?: LspRunnable | null } = {},
): string {
  const entry = runLanguageById(lang);
  if (!entry?.buildMainDebugBuildCommand) {
    throw new Error(`No main debug build command registered for language: ${lang}`);
  }
  return entry.buildMainDebugBuildCommand({
    manifestDir: opts.manifestDir ?? null,
    ctx,
    lsp: opts.lsp ?? null,
  });
}

const DEFAULT_CAPABILITIES: RunCapabilities = { directRun: false, debug: null };

/** 语言能力（未注册语言 → 保守默认：不直跑、无 Debug）。 */
export function capabilitiesFor(lang: RunLang): RunCapabilities {
  return runLanguageById(lang)?.capabilities ?? DEFAULT_CAPABILITIES;
}

/** 结果读取通道（未注册语言 → vitest JSON，与既有兜底分支同语义）。 */
export function resultsSourceFor(lang: RunLang): ResultsSource {
  return runLanguageById(lang)?.results ?? 'vitest-json';
}
