/**
 * 用例状态 gutter 贡献（P1：✓/✗/进行中 回显）。
 *
 * 与 run 同行并排（priority 30 > run 20 → play 左、状态右；cell flex gap
 * 由统一 gutter 主题提供）。状态来自 runner/store/testResults（Run 链路落库）：
 * - markersOf：行 → 用例（复用本域 runCodelensField 的 runAtLine，行→名映射唯一
 *   来源仍是检测 field，store 对行号无感知）→ 用例名 → store 状态。
 * - running 占位（半透明）由 store 的 statusForCase 给出（beginRun 后、结果落库前）。
 * - 失败 title 携带 message 摘要（libtest stdout / vitest failureMessages[0]）。
 * - onClick 吞掉事件（返回 true 无动作）：状态行必有用例片段，断点已被 run
 *   冲突规则压制；状态图标点击不设断点，也不需任何动作。
 *
 * 响应式（store → CM）：createTestStatusCore 经 ViewPlugin 订阅 store 的 per-file
 * version，变更时 dispatch refreshTestStatusEffect 触发一次 view update —— 统一
 * gutter 的 markers() 每次 update 都会重读贡献（SingleGutterView.update 实证），
 * ComposedMarker.eq 值比较命中后重建 DOM。失效（CM → store）：同一 updateListener
 * 语义的 plugin.update 上，docChanged → invalidateFile。
 */
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

import { isRunnableFile } from '@/features/runner';
import {
  statusForCase,
  testResultsFileKey,
  useTestResultsStore,
  type TestCaseStatusInfo,
} from '@/features/runner/store/testResults';

import type { GutterContribution, GutterHit, GutterLineContext } from './contribution';
import { runAtLine, runLinesOf } from './runContribution';

/** store 状态变更 → gutter 重读信号（无 field 消费，仅触发 view update）。 */
export const refreshTestStatusEffect = StateEffect.define<null>();

/** 状态图标（lucide 路径，ISC；raw DOM marker 与 RUN_ICON_SVG 同惯例内联 SVG）。 */
const STATUS_ICON_SVG: Record<TestCaseStatusInfo['status'], string> = {
  passed:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  failed:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  running:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>',
  ignored:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>',
  skipped:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>',
};

/** gutter title 文案：失败摘要（首行截断）优先，其余为状态名。 */
function statusTitle(info: TestCaseStatusInfo): string {
  if (info.status === 'failed') {
    const summary = (info.message ?? 'test failed').split('\n')[0];
    return summary.length > 160 ? `${summary.slice(0, 160)}…` : summary;
  }
  if (info.status === 'running') return 'running';
  return info.status;
}

/** 状态图标 DOM（纯视觉片段，点击路由由统一 gutter 列级委托处理）。 */
export function buildTestStatusElement(info: TestCaseStatusInfo): HTMLElement {
  const el = document.createElement('div');
  el.className = `cm-test-status-marker cm-test-status-marker--${info.status}`;
  el.title = statusTitle(info);
  el.innerHTML = STATUS_ICON_SVG[info.status];
  return el;
}

/** 状态图标样式（颜色走主题 token；running 半透明）。 */
export const testStatusTheme = EditorView.theme({
  '.cm-test-status-marker': {
    width: '12px',
    height: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-test-status-marker svg': {
    width: '12px',
    height: '12px',
    display: 'block',
  },
  '.cm-test-status-marker--passed': {
    color: 'var(--accent-green, #98c379)',
  },
  '.cm-test-status-marker--failed': {
    color: 'var(--accent-red, #e06c75)',
  },
  '.cm-test-status-marker--skipped': {
    color: 'var(--text-tertiary, #7f8c98)',
    opacity: '0.7',
  },
  '.cm-test-status-marker--ignored': {
    color: 'var(--text-tertiary, #7f8c98)',
    opacity: '0.7',
  },
  '.cm-test-status-marker--running': {
    color: 'var(--text-tertiary, #7f8c98)',
    opacity: '0.45',
  },
});

export interface TestStatusContributionOptions {
  projectId: string;
  /** 与 TestActionContext.filePath 同源（相对项目/worktree 根）。 */
  filePath: string;
}

export function createTestStatusContribution(
  options: TestStatusContributionOptions,
): GutterContribution<TestCaseStatusInfo> {
  const { projectId, filePath } = options;
  return {
    id: 'test-status',
    priority: 30,

    when(ctx: GutterLineContext): boolean {
      // 与 run 同门控，且共用唯一事实源（runLanguages）—— 此前此处手写
      // `isTestFile || .rs || .java` 漏掉 `.go`，与 run 漂移；改为同源调用后
      // 结构上不可能再漂移。markersOf 再按 kind==='test' 收窄（main 行无状态）。
      return ctx.editable && isRunnableFile(ctx.fileName);
    },
    linesOf(state): readonly number[] {
      return runLinesOf(state);
    },

    markersOf(state, line): { payload: TestCaseStatusInfo } | null {
      const target = runAtLine(state, line);
      // 状态回显仅对单测用例有意义（main 入口无 test-result 状态）。
      if (!target || target.kind !== 'test') return null;
      const info = statusForCase(projectId, filePath, target.testCase.name);
      return info ? { payload: info } : null;
    },

    render(hit: GutterHit<TestCaseStatusInfo>): HTMLElement | null {
      const el = buildTestStatusElement(hit.payload);
      el.setAttribute('data-gutter-contribution', 'test-status');
      return el;
    },

    onClick(): boolean {
      // 状态图标点击无动作且吞掉：不冒泡到列级（该行无断点可 toggle，已被冲突规则压制）
      return true;
    },
  };
}

/** store 订阅 → view 刷新 + 文件编辑失效（最小侵入：一个 ViewPlugin）。 */
export function createTestStatusCore(options: TestStatusContributionOptions): Extension {
  const key = testResultsFileKey(options.projectId, options.filePath);
  return ViewPlugin.fromClass(
    class {
      private lastVersion = useTestResultsStore.getState().versions[key] ?? 0;
      private scheduled = false;
      private unsub: () => void;

      constructor(readonly view: EditorView) {
        const v = view;
        this.unsub = useTestResultsStore.subscribe((state) => {
          const version = state.versions[key] ?? 0;
          if (version === this.lastVersion) return;
          this.lastVersion = version;
          // store 订阅回调可能处于任意调用栈；刷新 dispatch 排队到微任务
          if (this.scheduled) return;
          this.scheduled = true;
          // store 订阅回调可能处于任意调用栈；刷新 dispatch 排队到微任务
          queueMicrotask(() => {
            this.scheduled = false;
            try {
              v.dispatch({ effects: refreshTestStatusEffect.of(null) });
            } catch {
              // view destroyed between schedule and microtask
            }
          });
        });
      }

      update(update: ViewUpdate): void {
        // 文件编辑 → 状态失效（文档一变，旧用例状态即过期）。同步写 store；
        // 订阅回调随后排微任务 dispatch 刷新（本 update 的 gutter 已错过重读窗口）。
        if (update.docChanged) {
          useTestResultsStore.getState().invalidateFile(options.projectId, options.filePath);
        }
      }

      destroy(): void {
        this.unsub();
      }
    },
  );
}
