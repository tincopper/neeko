/**
 * 语言 runner 注册表：每语言的 Run/Debug **前置步骤**（带副作用 —— 探测、预检、通知）。
 *
 * 与 `utils/runLanguages` 的声明表互补：声明表放「语言是什么」（分类 / 命令形态 /
 * 能力 / 结果通道），本表放「该语言的运行前要做什么」。二者共同构成
 * LanguageRunner；新增语言需两处各加一项，`Record<RunLang, …>` 的键类型会在
 * 编译期强制穷尽，杜绝漏配。
 */
import { useNotificationStore } from '@/shared/store/notificationStore';

import type { RunTarget } from '../gutter/runTarget';
import type { MainEntry } from '../syntax/contract';
import { resolveCargoManifestDir, resolveCargoManifestDirForFile } from '../utils/cargoManifest';
import type { RunLang } from '../utils/runLanguages';
import type { TestCaseInfo } from '../utils/testCases';
import type { JavaRunEnv } from '../utils/testCommands';

import type { TestActionContext } from './context';
import {
  checkJavaCompiled,
  debugJava,
  prepareJavaMainRun,
  prepareJavaRun,
  resolveJavaRunRoot,
  withJavaNestedClassPath,
} from './java';
import { launchNativeDebug } from './native';

/** 前置步骤产出：命令构造所需的已解析事实。 */
export interface RunPreparation {
  /** 任务 cwd / 命令构造使用的 run 根（Java 多模块下沉到模块根）。 */
  runRoot: string;
  /** Java：launcher 与 classpath 事实（喂给 `resolveRunContext`）。 */
  javaEnv?: JavaRunEnv;
  /** Rust：cargo 清单目录（`--manifest-path`）。 */
  manifestDir?: string | null;
}

/** 单语言运行器。 */
export interface LanguageRunner {
  /** 测试用例 Run 前置；返回 `null` = 阻断（通知已发，调用方结束 running 占位）。 */
  prepareRun(
    ctx: TestActionContext,
    target: TestCaseInfo,
    runRoot: string,
  ): Promise<RunPreparation | null>;
  /** main Run 前置；返回 `null` = 阻断（通知已发）。 */
  prepareMainRun(
    ctx: TestActionContext,
    target: MainEntry,
    runRoot: string,
  ): Promise<RunPreparation | null>;
  /**
   * 可选：命令构造前**富化用例**（Java：用 LSP `documentSymbol` 求 `@Nested` 内层类链）。
   *
   * 刻意做成注册表 hook 而非在 `launch.ts` 里加 `if lang === 'java'`——后者会破坏
   * 「语言差异全在注册表」的既有约束（见模块头）。省略该 hook / 降级失败 → 返回入参原样。
   */
  enrichTestCase?(ctx: TestActionContext, target: TestCaseInfo): Promise<TestCaseInfo>;
  /** Debug 执行（无 Debug 能力的语言省略；与 `capabilities.debug` 一一对应）。 */
  debug?(ctx: TestActionContext, target: RunTarget): Promise<void>;
}

/** 无前置语言（ts/rust/go 的 common 形态）：原样透传 run 根。 */
const passthrough = async (_ctx: TestActionContext, _t: unknown, runRoot: string) => ({ runRoot });

const TS: LanguageRunner = { prepareRun: passthrough, prepareMainRun: passthrough };

const RUST: LanguageRunner = {
  async prepareRun(ctx, _target, runRoot) {
    // 清单探测基准 = 实际执行目录；crate 目录从被编辑文件向上找最近 Cargo.toml。
    return { runRoot, manifestDir: await resolveCargoManifestDir(ctx.projectPath ?? '') };
  },
  async prepareMainRun(ctx, _target, runRoot) {
    return { runRoot, manifestDir: await resolveCargoManifestDirForFile(runRoot, ctx.filePath) };
  },
  debug: (ctx, target) => launchNativeDebug(target, ctx),
};

const GO: LanguageRunner = {
  prepareRun: passthrough,
  prepareMainRun: passthrough,
  debug: (ctx, target) => launchNativeDebug(target, ctx),
};

const JAVA: LanguageRunner = {
  async prepareRun(ctx, _target, runRoot) {
    // 多模块工程：运行根下沉到最近 pom.xml / build.gradle 所在模块。
    const javaRoot = await resolveJavaRunRoot(runRoot, ctx.filePath);
    const javaEnv = await prepareJavaRun(ctx, javaRoot);
    if (!javaEnv) return null; // launcher 缺失（通知已发）→ 阻断
    const blockReason = await checkJavaCompiled(javaRoot, ctx.filePath);
    if (blockReason) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Java Test',
        message: blockReason,
      });
      return null; // 未编译 → 阻断（避免 Task Console 空跑、gutter 永久 running）
    }
    return { runRoot: javaRoot, javaEnv };
  },
  async prepareMainRun(ctx, _target, runRoot) {
    const javaRoot = await resolveJavaRunRoot(runRoot, ctx.filePath);
    const block = await checkJavaCompiled(javaRoot, ctx.filePath);
    if (block) {
      useNotificationStore.getState().addNotification({
        type: 'error',
        title: 'Java Run',
        message: block,
      });
      return null;
    }
    // main 直跑不需要 launcher jar（仅测试需要）→ 轻量前置。
    return { runRoot: javaRoot, javaEnv: await prepareJavaMainRun(ctx, javaRoot) };
  },
  // `@Nested` 内层类链（LSP documentSymbol）：不就绪 / 失败 → 原样返回，选择器与历史一致。
  enrichTestCase: (ctx, target) => withJavaNestedClassPath(ctx, target),
  debug: (ctx, target) => debugJava(target, ctx),
};

/** 语言 → runner（键类型强制穷尽：新增语言不补此表即编译失败）。 */
const RUNNERS: Record<RunLang, LanguageRunner> = {
  ts: TS,
  rust: RUST,
  go: GO,
  java: JAVA,
};

/** 查表（未注册语言 → 保守的透传 runner）。 */
export function runnerFor(lang: RunLang): LanguageRunner {
  return RUNNERS[lang] ?? { prepareRun: passthrough, prepareMainRun: passthrough };
}
