/**
 * Go 语言模块（`LanguageModule` 实现）。
 *
 * Go 的两处「与其它语言不同」在这里集中：`/` 表达用例层级（`t.Run`，由 `-run` 逐层锚定）、
 * 测试文件必须 `_test.go`（main 仍可 `match`）。包目录需向上探测 `go.mod`（嵌套 module 取
 * 相对 module 根的包目录）。
 */
import { runNativeDebug } from '../../exec/nativeDebug';
import { buildTestConfigId } from '../../exec/shell';
import type { RunTarget } from '../../runTarget';
import type { MenuAction, LanguageModule } from '../contract';
import { testDebugLabel, testRunLabel } from '../labels';

import { buildGoMainRunCommand, buildGoRunCommand } from './commands';
import { GO_DEBUG_HOOKS } from './debug';
import { discoverGoMains, discoverGoTests } from './discover';
import { goLabels } from './labels';
import { goCaseOverlays, goSubtestsOf } from './overlays';
import { goPkgDir } from './pkg';
import { readGoResults } from './results';

export const GO: LanguageModule = {
  id: 'go',
  filePolicy: {
    // 进列含 main.go（有 main 入口）；用例发现再收窄到 `_test.go`。
    match: (name) => name.endsWith('.go'),
    isTestCaseFile: (name) => name.endsWith('_test.go'),
    hasMain: true,
  },
  discover: (sd) => ({ tests: discoverGoTests(sd), mains: discoverGoMains(sd) }),
  readResults: readGoResults,
  ui: { labels: goLabels, extraMenuItems: goExtraMenuItems },
  caseOverlays: goCaseOverlays,
  capabilities: { directRun: false, debug: 'native' },

  async planTestRun({ ctx, testCase, runRoot, io }) {
    // 包目录 = cwd 相对（`.go` 的测试目标）；探测走注入 IO，故本模块可脱离 Tauri 单测。
    const goPkg = await goPkgDir(ctx.filePath, runRoot, io.fileExists);
    return {
      cwd: runRoot,
      command: buildGoRunCommand(testCase, goPkg),
      configId: buildTestConfigId('run', testCase, ctx.filePath),
    };
  },

  async planMainRun({ ctx, runRoot, io }) {
    const goPkg = await goPkgDir(ctx.filePath, runRoot, io.fileExists);
    return {
      cwd: runRoot,
      command: buildGoMainRunCommand(goPkg),
      configId: `main:go:${ctx.filePath}`,
    };
  },

  planDebug: (input) => runNativeDebug(GO_DEBUG_HOOKS, input.target, input.ctx),
  debugHooks: {
    adapterHint: () => 'Install Delve: go install github.com/go-delve/delve/cmd/dlv@latest',
  },
};

/**
 * Go 的动态子测试菜单（P3）：上次运行由 test2json **真实发现**的 `<父>/<层级>` 全名，
 * 每个给 Run + Debug 两条（与父用例同构）。
 *
 * 名字来自运行时而非静态猜测 → 无 `t.Run` 形态约束、零 LSP 依赖；未发现 / 全部已有静态按钮
 * 则整段省略（不出现空分隔条）。已有**静态**按钮的子测试在此剔除（§7.8.4 去重：同一目标不给两个入口）。
 */
function goExtraMenuItems(
  target: RunTarget,
  deps: { subtestsFor(name: string): string[] },
): MenuAction[] {
  if (target.kind !== 'test' || target.testCase.variant === 'benchmark') return [];
  const dynamic = deps.subtestsFor(target.testCase.name);
  const covered = new Set(goSubtestsOf(target.overlay));
  const names = dynamic.filter((name) => !covered.has(name));
  return names.flatMap((name) => {
    const subTarget: RunTarget = {
      kind: 'test',
      testCase: { name, line: target.testCase.line, lang: 'go' },
    };
    return [
      { label: testRunLabel(name), action: 'run' as const, target: subTarget },
      { label: testDebugLabel(name), action: 'debug' as const, target: subTarget },
    ];
  });
}
