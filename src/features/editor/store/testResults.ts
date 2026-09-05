/**
 * 用例级测试状态 store（P1：结构化结果流 → gutter ✓/✗）。
 *
 * 就近放 editor feature：gutter 状态贡献（同域）与 Run 链路（useTestRunActions）
 * 直接消费，不跨 feature（AGENTS.md 防火墙）。
 *
 * 数据模型：key = {projectId, filePath} → {running, cases: caseName → 状态}。
 * caseName 为源码侧用例名（parseTestCases 产物）——Run 链路先 parse + matchCaseName
 * 对齐（utils/testResultParsers）再落库，store 对行号一无所知：行号是文档态，
 * 与 CM StateField 双份维护必然漂移；line → caseName 的映射由 gutter 贡献经
 * testCodelensField 完成（任务指定 statusForLine 的职责拆分，偏离点已记录 implement.md）。
 *
 * 响应式契约：每次变更 bump 该文件 version —— gutter 的 test-status core
 * 订阅 version 触发一次 CM 刷新 dispatch（markers() 重读 store）。
 */
import { create } from 'zustand';

export type TestCaseStatus = 'passed' | 'failed' | 'ignored' | 'skipped' | 'running';

export interface TestCaseStatusInfo {
  status: TestCaseStatus;
  duration?: number;
  /** 失败摘要（gutter title 展示）。 */
  message?: string;
}

/** Run 链路对齐后的单条用例结果（store 的输入形态）。 */
export interface AlignedCaseResult {
  caseName: string;
  status: Exclude<TestCaseStatus, 'running'>;
  duration?: number;
  message?: string;
}

interface FileResults {
  /** beginRun 置位；applyResults/invalidate 结束。running 期间无用例命中时选择器给 running 占位。 */
  running: boolean;
  cases: Record<string, TestCaseStatusInfo>;
}

interface TestResultsState {
  files: Record<string, FileResults>;
  /** 每文件单调递增版本（gutter 刷新信号，不渲染）。 */
  versions: Record<string, number>;
  /** Run 开始：清该文件旧状态并标记进行中。 */
  beginRun: (projectId: string, filePath: string) => void;
  /** 落库对齐后的结果并结束 running；空结果 = 本次运行无状态可落（如编译失败）。 */
  applyResults: (projectId: string, filePath: string, results: AlignedCaseResult[]) => void;
  /** 文件编辑 → 状态失效（删除整文件条目）。 */
  invalidateFile: (projectId: string, filePath: string) => void;
}

/** 复合 key（projectId 与 filePath 均可含任意字符，用 \u0000 分隔避免歧义）。 */
export function testResultsFileKey(projectId: string, filePath: string): string {
  return `${projectId}\u0000${filePath}`;
}

function bumpVersion(state: TestResultsState, key: string): void {
  state.versions = { ...state.versions, [key]: (state.versions[key] ?? 0) + 1 };
}

export const useTestResultsStore = create<TestResultsState>((set) => ({
  files: {},
  versions: {},

  beginRun: (projectId, filePath) =>
    set((state) => {
      const key = testResultsFileKey(projectId, filePath);
      bumpVersion(state, key);
      return { files: { ...state.files, [key]: { running: true, cases: {} } } };
    }),

  applyResults: (projectId, filePath, results) =>
    set((state) => {
      const key = testResultsFileKey(projectId, filePath);
      // upsert：无 beginRun 前置（如视图重挂载后晚到的结果）也照常落库
      const prev = state.files[key] ?? { running: false, cases: {} };
      const cases = { ...prev.cases };
      for (const r of results) {
        cases[r.caseName] = {
          status: r.status,
          ...(r.duration !== undefined ? { duration: r.duration } : {}),
          ...(r.message !== undefined ? { message: r.message } : {}),
        };
      }
      bumpVersion(state, key);
      return { files: { ...state.files, [key]: { running: false, cases } } };
    }),

  invalidateFile: (projectId, filePath) =>
    set((state) => {
      const key = testResultsFileKey(projectId, filePath);
      if (!(key in state.files)) return state;
      bumpVersion(state, key);
      const files = { ...state.files };
      delete files[key];
      return { files };
    }),
}));

/**
 * 用例状态查询（gutter 贡献消费）：run 进行中且该用例尚无结果时给 running
 * 占位（半透明图标），run 结束后未命中的用例无状态（不渲染）。
 */
export function statusForCase(
  projectId: string,
  filePath: string,
  caseName: string,
): TestCaseStatusInfo | null {
  const file = useTestResultsStore.getState().files[testResultsFileKey(projectId, filePath)];
  if (!file) return null;
  const info = file.cases[caseName];
  if (info) return info;
  if (file.running) return { status: 'running' };
  return null;
}
