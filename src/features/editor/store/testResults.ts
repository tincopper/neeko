/**
 * 用例级测试状态 store（P1：结构化结果流 → gutter ✓/✗）。
 *
 * 就近放 editor feature：gutter 状态贡献（同域）与 Run 链路（useRunActions）
 * 直接消费，不跨 feature（AGENTS.md 防火墙）。
 *
 * 数据模型：key = {projectId, filePath} → {running, cases, subtests}。
 * caseName 为源码侧用例名（parseTestCases 产物）——Run 链路先 parse + matchCaseName
 * 对齐（utils/testResultParsers）再落库，store 对行号一无所知：行号是文档态，
 * 与 CM StateField 双份维护必然漂移；line → caseName 的映射由 gutter 贡献经
 * runCodelensField 完成（任务指定 statusForLine 的职责拆分，偏离点已记录 implement.md）。
 *
 * **subtests（P3 动态子测试）**：`cases` 只存源码侧用例的**状态**；子测试的
 * **发现**（Go `t.Run` 运行时全名，来自 test2json）单独存 `subtests`，因为二者
 * 生命周期不同 —— `cases` 每次 `beginRun` 清空重算（上次运行的状态无意义），
 * `subtests` 跨运行**归并**保留（单跑一个子测试只发现它自己，若不清空重算就会
 * 让菜单里的兄弟子测试消失）。仅 `invalidateFile`（文件编辑）才丢弃，因为子测试名
 * 派生自源码内容。这份缓存不是 `cases` 的派生值（来源不同、生命周期不同），故独立存放。
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
  /**
   * 动态发现的子测试全名：父用例名 → 全名列表（`<父>/<层级>`，Go t.Run 语义）。
   * 跨运行归并（见模块头）；仅 `invalidateFile` 丢弃。菜单据此渲染「单跑子测试」项。
   */
  subtests: Record<string, string[]>;
}

interface TestResultsState {
  files: Record<string, FileResults>;
  /** 每文件单调递增版本（gutter 刷新信号，不渲染）。 */
  versions: Record<string, number>;
  /** Run 开始：清该文件旧状态并标记进行中（保留子测试发现缓存）。 */
  beginRun: (projectId: string, filePath: string) => void;
  /** 落库对齐后的结果并结束 running；空结果 = 本次运行无状态可落（如编译失败）。 */
  applyResults: (projectId: string, filePath: string, results: AlignedCaseResult[]) => void;
  /** 归并本次运行发现的子测试全名（无新增 → 不变更、不 bump）。 */
  recordSubtests: (
    projectId: string,
    filePath: string,
    parentCaseName: string,
    names: string[],
  ) => void;
  /** 文件编辑 → 状态失效（删除整文件条目，含子测试发现缓存）。 */
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
      // 子测试发现缓存跨运行保留（清掉会让菜单在一次运行期间闪空并丢掉兄弟子测试）
      const subtests = state.files[key]?.subtests ?? {};
      return { files: { ...state.files, [key]: { running: true, cases: {}, subtests } } };
    }),

  applyResults: (projectId, filePath, results) =>
    set((state) => {
      const key = testResultsFileKey(projectId, filePath);
      // upsert：无 beginRun 前置（如视图重挂载后晚到的结果）也照常落库
      const prev = state.files[key] ?? { running: false, cases: {}, subtests: {} };
      const cases = { ...prev.cases };
      for (const r of results) {
        cases[r.caseName] = {
          status: r.status,
          ...(r.duration !== undefined ? { duration: r.duration } : {}),
          ...(r.message !== undefined ? { message: r.message } : {}),
        };
      }
      bumpVersion(state, key);
      return {
        files: { ...state.files, [key]: { running: false, cases, subtests: prev.subtests } },
      };
    }),

  recordSubtests: (projectId, filePath, parentCaseName, names) =>
    set((state) => {
      if (names.length === 0) return state;
      const key = testResultsFileKey(projectId, filePath);
      const prev = state.files[key] ?? { running: false, cases: {}, subtests: {} };
      const known = prev.subtests[parentCaseName] ?? [];
      const merged = [...known];
      const seen = new Set(known);
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        merged.push(name);
      }
      // 无新增 → 不 bump（避免每次运行都触发无意义的 gutter 刷新）
      if (merged.length === known.length) return state;
      bumpVersion(state, key);
      return {
        files: {
          ...state.files,
          [key]: { ...prev, subtests: { ...prev.subtests, [parentCaseName]: merged } },
        },
      };
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

/**
 * 某父用例已发现的子测试全名（菜单渲染消费）。未发现 / 未知文件 → []。
 * 读取非响应式（与 statusForCase 同惯例）——菜单在 openMenu 时点读，天然取到最新缓存。
 */
export function subtestsForCase(
  projectId: string,
  filePath: string,
  parentCaseName: string,
): string[] {
  const file = useTestResultsStore.getState().files[testResultsFileKey(projectId, filePath)];
  return file?.subtests[parentCaseName] ?? [];
}
