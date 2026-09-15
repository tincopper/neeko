/**
 * 语言模块契约（方案 B 的核心 seam）。
 *
 * **一句话**：语言知识（怎么发现目标、怎么算命令、怎么读结果、缺什么运行时依赖、UI 怎么称呼它）
 * 全部由一个 `LanguageModule` 声明；通用层（`exec/`、`store/`、`syntax/`、渲染层）只按
 * `RunLang` 查表后调接口，**不认识任何具体语言**。
 *
 * 设计取舍（与 `src-tauri/src/dap/adapter/backend.rs::LanguageBackend` 同构）：
 * - **表驱动而非 `dyn`**：语言集合编译期已知固定 → `Record<RunLang, LanguageModule>` 查表，
 *   新增语言漏注册即编译失败（见 `registry.ts`）。
 * - **中间产物不外泄**：每个语言的前置产物（Java 的 launcher/classpath、Rust 的清单目录、
 *   Go 的包目录）是模块**私有类型**，通用层只看 `RunPlan`。这是本重构要消灭「共享可选字段袋」
 *   （旧 `RunContext` / `RunPreparation`）的关键。
 * - **IO 注入**：模块不直接 import `@tauri-apps/api` / `file/api` / `lsp/api` / 外部 store，
 *   一律经 [`LangIo`] 调用 → 语言模块可脱离 Tauri 单测（见 `io.ts` 的生产实现）。
 * - **语言私有数据用中性载体**：`TestCaseInfo.variant` / `containerPath`、`RunTarget.overlay`
 *   对通用层是不透明透传值，语义（Go benchmark / Java `@Nested` / Rust runnable）由所属语言
 *   解释 —— 通用层读取它们即架构护栏失败（`__tests__/architecture.test.ts`）。
 *
 * 依赖方向：`languages/<lang>/` → 本文件（+ `syntax/` 工具箱 + `exec/` 通用原语）；
 * 反向依赖（通用层直导某语言目录）由护栏测试钉死。
 */
import type { TestActionContext } from '../exec/context';
import type { RunTarget } from '../runTarget';
import type { AlignedCaseResult } from '../store/testResults';
import type { MainEntry, RunLang, SyntaxDoc, TestCaseInfo } from '../syntax/contract';

export type { MainEntry, RunLang, SyntaxDoc, TestCaseInfo };

/** 语言私有载荷/判别位：通用层只透传，**不得读取**（护栏钉住）。 */
export type LanguageOverlay = unknown;

/** 文件存在性探针（语言模块的向上探测：模块根 / 清单 / 产物）；实现由 `LangIo.fileExists` 提供。 */
export type ExistsProbe = (absPath: string) => Promise<boolean>;

/** 文本读取探针（读 Maven classpath 产物等）；`null` = 缺失/读取失败。 */
export type ReadTextProbe = (absPath: string) => Promise<string | null>;

/** 用例点击直跑（不弹菜单）；`false` → 弹 Run/Debug 菜单。 */
export interface RunCapabilities {
  readonly directRun: boolean;
  /** Debug 通道：`attach`（Java attach-first）/ `native`（lldb·dlv）/ `null`（无 Debug）。 */
  readonly debug: 'attach' | 'native' | null;
}

/** 发现结果（一次解析、两次发现）。 */
export interface Discovered {
  tests: TestCaseInfo[];
  mains: MainEntry[];
}

/**
 * 目标平台 classpath 分隔符（JVM `File.pathSeparator`）。
 *
 * 归属契约层的原因：它由**目标执行环境**（Local 宿主 / WSL / SSH 的 OS）决定，而不是 Java 独有
 * 的语法 —— 语言模块解析出它，通用层把它原样带过界（Stage 2 起由 Java 命令构造独占消费）。
 */
export type ClasspathSeparator = ':' | ';';

/**
 * 一次 Run 的完整计划：语言内部把「探测 → 预检 → 环境 → 命令」算完，通用层只执行。
 *
 * `command` 与 `cwd` 分离（而非合并成一条 shell 串）以便 Task 会话按项目环境选 shell；
 * `configId` 供 Task Console 去重/历史。**预留**：将来把计划产出搬到后端时，本结构即
 * IPC 契约（前端不再自算命令），无需再改语言模块的调用形态。
 */
export interface RunPlan {
  /** 任务 cwd（Java 多模块 = 模块根；Rust = 清单所在 run 根）。 */
  cwd: string;
  /** 完整 shell 命令（Task Console 展示 + 执行）。 */
  command: string;
  /** Task Console 配置 id。 */
  configId: string;
}

/**
 * 计划结果：`null` = 无法出计划（语言模块**已自行发出用户可见通知**）。
 *
 * 阻断类失败（未编译 / 缺 launcher / 无活动项目）一律走 `null` + `io.notify`，使通用层只需
 * 「结束 running 占位」——与「静默成功」区分开：静默成功返回 `RunPlan`。
 */
export type PlanResult = RunPlan | null;

/** 运行终态事实（「0 命中」诊断需要：退出码 + 实际命令）。 */
export interface RunOutcome {
  exitCode: number;
  /** 实际执行的命令 —— 命中 0 时用户需要看到过滤器与 target 才能自助排查。 */
  command: string;
}

/** 结果读取器输出（Go 额外产出动态发现的子测试全名）。 */
export interface ReaderOutput {
  results: AlignedCaseResult[];
  subtests?: string[];
}

/** 语言模块的 IO 依赖面（生产实现见 `io.ts`；单测注入 fake）。 */
export interface LangIo {
  /** 目标环境文件存在性（经统一执行门面，Local/WSL/SSH 通吃）。 */
  fileExists(absPath: string): Promise<boolean>;
  /** 读项目内文本文件（缺失/失败 → `null`）。 */
  readText(projectId: string, relPath: string, root: string | null): Promise<string | null>;
  /** 宿主 home 目录（缓存产物落点）。 */
  homeDir(): Promise<string>;
  /**
   * **目标执行环境**的平台（Local 宿主 / WSL / SSH 各自解析）。
   *
   * 语言模块据此派生平台事实（如 Java 的 classpath 分隔符 = 目标 JVM 的
   * `File.pathSeparator`）—— 由**目标**而非宿主决定，故不能读平台常量。
   */
  targetPlatform(projectId: string): 'windows' | 'unix';
  /** LSP 请求（未就绪/失败由调用方兜住，不抛）。 */
  lspRequest(projectPath: string, lang: string, method: string, params: unknown): Promise<unknown>;
  /** 无头执行一条命令（构建 / 生成 classpath 产物），返回输出而非抛错。 */
  runBuild(spec: {
    projectId: string;
    command: string;
    cwd: string;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** 用户通知（语言模块的失败/指引出口）。 */
  notify(n: { type: 'error' | 'warning' | 'info'; title: string; message: string }): void;
  /** 应用级确认对话框（`window.confirm` 在 WKWebView 下不可靠，故必须走应用入口）。 */
  confirm(a: { title: string; message: string; confirmLabel: string }): Promise<boolean>;
}

/** 文件名 → 语言能力（进列门控的唯一事实源）。 */
export interface FilePolicy {
  /** 是否属于本语言（扩展名/命名判定，无文档内容）。 */
  match(fileName: string): boolean;
  /** 是否承载**测试用例**（比 `match` 更窄：Go 仅 `_test.go`；可看内容，如 Rust `#[test]`）。 */
  isTestCaseFile(fileName: string, docText?: string): boolean;
  /** 是否解析并显示 main 入口。 */
  readonly hasMain: boolean;
}

/** 行覆盖目标（语言无关；Rust runnable overlay 用）。 */
export interface LineTarget {
  line: number;
  kind: 'test' | 'main';
}

/**
 * 语言自带的运行时 overlay 来源（tier ①：LSP 等异步确定性信息）。
 *
 * 通用层只问「这个文件的 overlay provider 是谁」，不认识任何具体语言的协议
 * （rust-analyzer `experimental/runnables` 的实现细节留在 `languages/rust/`）。
 */
export interface OverlayProvider {
  /** 拉取覆盖结果；未就绪/失败 → 空 Map（不阻塞快路径）。 */
  load(args: {
    projectId: string;
    projectPath: string;
    absFilePath: string;
    targets: readonly LineTarget[];
  }): Promise<Map<number, LanguageOverlay>>;
}

/** 菜单项（纯数据：语言模块不依赖 shared 组件类型）。 */
export interface MenuAction {
  label: string;
  action: 'run' | 'debug';
  target: RunTarget;
}

/** 语言的 UI 文案与附加菜单（把「语言专属说法」从通用 hook 里清出去）。 */
export interface UiHooks {
  labels(target: RunTarget): { run: string; debug: string };
  /** 附加菜单项（Go 的运行时子测试）；无 → 省略。 */
  extraMenuItems?(target: RunTarget, deps: { subtestsFor(name: string): string[] }): MenuAction[];
}

/**
 * 会话生命周期中语言专属的判定（把 Java/Go 特例从通用 store 清出去）。
 *
 * `adapterHint` 是**必须**的：每种语言的 adapter 安装方式都不同，通用层给不出正确指引。
 */
export interface DebugHooks {
  /** adapter 不可用时的安装指引（面向用户）。 */
  adapterHint(): string;
  /** 是否跳过 adapter 存在性门控（Java：走 JDTLS 后端时不需要 host jar）。 */
  skipAdapterGate?(configType: string): Promise<boolean>;
  /**
   * 会话输出逐行不变式检查（Java：Console Launcher 汇总「0 用例」→ 必须终止会话，
   * 否则留下「running 但断点永不命中」的静默会话）。返回非空即由通用层终止会话。
   */
  inspectConsoleLine?(line: string): { stop: true; message: string } | null;
}

/** run 命令计划输入（测试用例）。 */
export interface TestRunPlanInput {
  ctx: TestActionContext;
  testCase: TestCaseInfo;
  runRoot: string;
  /** tier ① overlay（Rust runnable）；语言私有载荷，通用层只透传。 */
  overlay?: LanguageOverlay;
  io: LangIo;
}

/** run 命令计划输入（main 入口）。 */
export interface MainRunPlanInput {
  ctx: TestActionContext;
  entry: MainEntry;
  runRoot: string;
  /** tier ① overlay（Rust runnable）；语言私有载荷，通用层只透传。 */
  overlay?: LanguageOverlay;
  io: LangIo;
}

/** 结果读取输入。 */
export interface ReadResultsInput {
  output: string;
  testCase: TestCaseInfo;
  ctx: TestActionContext;
  /** 任务 cwd（报告文件相对它读取）。 */
  cwd: string;
  io: LangIo;
}

/** 单一语言模块。 */
export interface LanguageModule {
  readonly id: RunLang;
  readonly filePolicy: FilePolicy;
  /** 发现（AST）：语法树 → 用例 + main 入口。相同文档**只解析一次**由调用方保证。 */
  discover(sd: SyntaxDoc): Discovered;
  /** 能力声明（UI 同步消费：进列门控 / 直跑 / 菜单）。 */
  readonly capabilities: RunCapabilities;
  /**
   * 测试用例 Run 计划：探测模块根 → 预检 → 环境事实 → 命令。
   * 返回 `null` = 静默无计划；`Blocked` = 已给用户可见原因，调用方只通知 + 收尾。
   */
  planTestRun(input: TestRunPlanInput): Promise<PlanResult>;
  /** main 入口 Run 计划。 */
  planMainRun(input: MainRunPlanInput): Promise<PlanResult>;
  /** Debug 执行（无 Debug 能力的语言省略；与 `capabilities.debug` 一一对应）。 */
  planDebug?(input: { ctx: TestActionContext; target: RunTarget; io: LangIo }): Promise<void>;
  /** 结果解析（Run 终点）：产物格式与命令形态同源，故同住语言模块。 */
  readResults?(input: ReadResultsInput): Promise<ReaderOutput>;
  /**
   * 「命令成功（exit 0）但 0 个用例命中」是否该告警。
   *
   * 语言可声明**预期内**的 0 命中（Rust + Windows 本地：`cmd.exe` 不支持 `VAR=x cmd`
   * 前缀，libtest JSON 结构化流本就不产出）→ 不报，否则是噪音。
   */
  reportZeroMatch?(matched: number, outcome: RunOutcome, hostIsWindows: boolean): boolean;
  /** tier ① overlay 来源（Rust runnable）；无 → 省路。 */
  readonly overlayProvider?: OverlayProvider;
  /**
   * 由**已发现的用例**构建「每用例的同步 overlay 载荷」（键 = 用例名）。
   *
   * Go 用它携带静态子测试索引（供菜单与运行时动态发现求差）；其它语言省略 → 不可能产出
   * 伪造的父子关系（`/` 只在声明层级用例名的语言里才有语义，而该声明只属于 Go）。
   * 通用层只做「取载荷 → 透传给 marker」，不解释其结构。
   */
  caseOverlays?(tests: readonly TestCaseInfo[]): Map<string, LanguageOverlay>;
  /** overlay 的稳定比较键（避免 marker 无谓重建）。 */
  overlayKey?(overlay: LanguageOverlay): string;
  /**
   * 语言自带的 UI 文案与附加菜单（**必填**：菜单文案差异是语言知识，通用 hook 不再分支）。
   */
  readonly ui: UiHooks;
  readonly debugHooks?: DebugHooks;
}
