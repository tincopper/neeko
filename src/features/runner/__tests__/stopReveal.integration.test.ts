/**
 * issue #13 的症状级回归：**停点跳转链的端到端交错**。
 *
 * 与 `debugStore.test.ts` 的区别：这里**不 mock `../navigate`** —— 真实跑
 * 「停点 → 打开源码 tab → 激活」，只把内容读取与 DAP 调用换成可控夹具。这样构造出的
 * 交错就是用户实际遇到的那条链路（旧停点的源码内容迟到）。
 *
 * 断言面刻意选**跨机制稳定**的 `editorStore` 事实（活动 tab）：
 * - 旧机制（跳转目标经 `pendingNavigateTarget` 单槽、由异步链写入）下，迟到的旧链会
 *   `activateTab` 抢走激活并写旧跳转目标 ⇒ 断言失败（真红）；
 * - 新机制（位置单写者 + 代际守卫）下，迟到的旧链在 `addTab` / `activateTab` 前就被拦下
 *   ⇒ 断言通过。
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebugStopReveal } from '@/features/editor';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileContent } from '@/shared/types';
import { sourceIdentityOf } from '@/shared/utils/fileRef';
import { deferred, flushMicrotasks } from '@/testing/async';
import { createStackFrame } from '@/testing/factories';

import type * as DebugApi from '../api/debugApi';
import { useDebugStore } from '../store/debugStore';
import type { StackFrameDto } from '../types';

const readFileContentMock = vi.hoisted(() => vi.fn());
const dapStackTrace = vi.hoisted(() => vi.fn());
const dapVariables = vi.hoisted(() => vi.fn());
const dapSourceContent = vi.hoisted(() => vi.fn());

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: readFileContentMock,
}));

vi.mock('@/shared/utils/codemirror', () => ({
  preloadLanguageExtension: vi.fn(),
}));

vi.mock('@/shared/store/navigationHistoryStore', () => ({
  captureCurrentNavLocation: () => null,
  recordNavigationJump: vi.fn(),
}));

vi.mock('../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugApi>()),
  dapStackTrace,
  dapVariables,
  dapSourceContent,
}));

const PROJECT = '/repo';
const A_PATH = `${PROJECT}/src/A.java`;
const B_PATH = `${PROJECT}/src/B.java`;
const A_TAB = `p1:${A_PATH}`;
const B_TAB = `p1:${B_PATH}`;

function content(path: string, body = 'x'): FileContent {
  return { path, content: body, size: body.length, is_binary: false };
}

/** 帧夹具：字面量集中在 `@/testing/factories`，下面两个只固化本文件惯用的形态。 */
function frame(id: number, sourcePath: string, line: number): StackFrameDto {
  return createStackFrame({ id, name: `f${id}`, sourcePath, line, column: 0 });
}

/** 适配器侧虚拟源码帧（无磁盘路径，字节由 adapter 持有）。 */
function virtualFrame(id: number, reference: number, name: string, line: number): StackFrameDto {
  return createStackFrame({
    id,
    name: `f${id}`,
    sourcePath: null,
    sourceReference: reference,
    sourceName: name,
    line,
    column: 0,
  });
}

function activeTabId(): string | null {
  return useEditorStore.getState().tabs['p1']?.activeTabId ?? null;
}

function openTabIds(): string[] {
  return (useEditorStore.getState().tabs['p1']?.tabs ?? []).map((t) => t.id);
}

/** 已打开 file tab 的 `data.filePath`（= tab 身份；FileEditor 由它算 absFilePath）。 */
function openTabPaths(): string[] {
  return (useEditorStore.getState().tabs['p1']?.tabs ?? [])
    .filter((t) => t.data.kind === 'file')
    .map((t) => (t.data.kind === 'file' ? t.data.filePath : ''));
}

const STOP_DOC = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

function makeView(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  // 刻意不装 `navigateCaretExtension`（跨 feature 深导被防火墙拦下）：本用例只断言光标位置，
  // 闪烁装饰的效果由 editor 域的 `useDebugStopReveal.test.ts` 覆盖。
  return new EditorView({ state: EditorState.create({ doc: STOP_DOC }), parent });
}

/** 光标当前所在行（1-based）。 */
function caretLine(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

/**
 * 挂一个「已打开 tab 的编辑器」的跟随钩子（真实 `useDebugStopReveal`）。
 * 这里只挂钩子而非整套 FileEditor：本用例验证的是**停点链 → 跟随**这一段接线。
 *
 * 只给 `absFilePath`：它是**规范源身份**（fs / jdt / 虚拟源码三种都成立）——判定不再需要
 * 第二个参数（曾经的 tab 原始路径参数是为绕过「虚拟身份被拼根」而设的权宜，已随身份文法闭合删除）。
 */
function renderRevealFor(view: EditorView, filePath: string) {
  const ref = { current: view };
  return renderHook(() =>
    useDebugStopReveal({
      absFilePath: filePath,
      editorViewRef: ref,
      viewEpoch: 0,
    }),
  );
}

function seedStoppedSession(): void {
  useDebugStore.setState({
    session: {
      sessionId: 's1',
      projectId: 'p1',
      projectPath: PROJECT,
      configName: 'cfg',
      status: 'stopped',
    },
    generation: null,
    location: null,
    locationSeq: 0,
    frames: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    tabs: {},
    editorLayout: {},
    activeTabId: null,
    pendingNavigateTarget: null,
  });
  useProjectStore.setState({
    activeProject: { id: 'p1', name: 'proj', path: PROJECT } as never,
  });
  useWorktreeStore.setState({ activeWorktreePath: null });
  dapVariables.mockResolvedValue([]);
});

describe('停点跳转链交错（issue #13 症状）', () => {
  it('[T3-tab] 旧停点的源码内容迟到不得抢走新停点的 tab 激活', async () => {
    seedStoppedSession();
    const slowRead = deferred<FileContent>();
    readFileContentMock.mockImplementation((_projectId: string, p: string) =>
      p === A_PATH ? slowRead.promise : Promise.resolve(content(p)),
    );

    // 停点1 → A（内容读取挂起）
    const slowStack = deferred<StackFrameDto[]>();
    dapStackTrace.mockImplementationOnce(() => slowStack.promise);
    const firstRun = useDebugStore.getState().refreshStackAndVars();
    slowStack.resolve([frame(1, A_PATH, 10)]);
    await flushMicrotasks(); // 让旧链走到「内容还在路上」

    // 停点2 → B（立即完成）
    dapStackTrace.mockResolvedValue([frame(2, B_PATH, 20)]);
    await useDebugStore.getState().refreshStackAndVars();
    expect(activeTabId()).toBe(B_TAB);

    // A 的内容此刻才到 —— 它属于已被取代的停点
    slowRead.resolve(content(A_PATH));
    await firstRun;
    // ★ 必须再冲刷微任务：`loadStopSourceContent` → `openStopTab` 之间还有若干 await 层，
    // 只 `await firstRun` 会在迟到链真正执行 addTab 之前抢先断言 —— 那是「假绿」。
    await flushMicrotasks();

    expect(activeTabId()).toBe(B_TAB);
    expect(openTabIds()).not.toContain(A_TAB);
    // 停点路径不得写跳转目标：跳转由 location 派生链承担（旧机制此刻会写 A 的旧目标）。
    expect(useEditorStore.getState().pendingNavigateTarget).toBeNull();
  });

  it('[T3-tab] 顺序到达（非竞态）时两个文件都会被打开，激活属最后一个停点', async () => {
    seedStoppedSession();
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => content(p));

    dapStackTrace.mockResolvedValue([frame(1, A_PATH, 10)]);
    await useDebugStore.getState().refreshStackAndVars();
    expect(activeTabId()).toBe(A_TAB);

    dapStackTrace.mockResolvedValue([frame(2, B_PATH, 20)]);
    await useDebugStore.getState().refreshStackAndVars();

    expect(openTabIds()).toEqual([A_TAB, B_TAB]);
    expect(activeTabId()).toBe(B_TAB);
  });

  it('[T3-cursor] 交错结束后光标落在最新停点，迟到方视图回到初始位置', async () => {
    // 端到端接线检查：真实停点链（navigate + 代际守卫）+ 真实 `useDebugStopReveal`（派生链）。
    // 两个已打开的 tab 各挂一个 view：迟到方（A）从未成为「当前停点」，其视图不得被放置。
    seedStoppedSession();
    const viewA = makeView();
    const viewB = makeView();
    const { unmount: unmountA } = renderRevealFor(viewA, A_PATH);
    const { unmount: unmountB } = renderRevealFor(viewB, B_PATH);

    const slowRead = deferred<FileContent>();
    readFileContentMock.mockImplementation((_projectId: string, p: string) =>
      p === A_PATH ? slowRead.promise : Promise.resolve(content(p)),
    );

    const slowStack = deferred<StackFrameDto[]>();
    dapStackTrace.mockImplementationOnce(() => slowStack.promise);
    const firstRun = useDebugStore.getState().refreshStackAndVars();
    slowStack.resolve([frame(1, A_PATH, 10)]);
    await flushMicrotasks();
    // 停点1 尚未成为「最终停点」（A 的内容还没到），此刻它的位置确实进过 store。
    expect(caretLine(viewA)).toBe(10);

    dapStackTrace.mockResolvedValue([frame(2, B_PATH, 20)]);
    await useDebugStore.getState().refreshStackAndVars();
    await flushMicrotasks();
    expect(caretLine(viewB)).toBe(20);
    // 停点已移走 → A 的光标被释放回原位（不再指向旧的停点行）。
    expect(caretLine(viewA)).toBe(1);

    slowRead.resolve(content(A_PATH));
    await firstRun;
    await flushMicrotasks();

    expect(caretLine(viewB)).toBe(20);
    expect(caretLine(viewA)).toBe(1);

    unmountA();
    unmountB();
    viewA.destroy();
    viewB.destroy();
  });

  it('[T3-tab] 停点位置与打开的 tab 身份一致（规范身份单写者）', async () => {
    seedStoppedSession();
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => content(p));
    dapStackTrace.mockResolvedValue([frame(1, A_PATH, 10)]);

    await useDebugStore.getState().refreshStackAndVars();

    const { location } = useDebugStore.getState();
    expect(location).toEqual({ identity: A_PATH, line: 10, column: 0 });
    // 位置身份就是 tab 身份：不存在「同一份源码两种身份」的分叉。
    expect(openTabIds()).toEqual([`p1:${location!.identity}`]);
  });

  it('[T3-tab] 适配器虚拟源码：tab 身份即停点身份，编辑器单参数即可命中', async () => {
    // 虚拟源码（DAP `sourceReference`）没有磁盘路径，身份是合成的 `dap-source:/<ref>/<name>`。
    // 这条用例锁两件事：
    // ① `FileEditor` 由 tab 身份算出的 `absFilePath` 必须**等于**停点身份（身份构造点幂等）；
    // ② 因此匹配判定只需 `absFilePath` 一个参数 —— 回退用的第二个参数已删除且不再需要。
    seedStoppedSession();
    dapSourceContent.mockResolvedValue('line 1\nline 2\n');
    dapStackTrace.mockResolvedValue([virtualFrame(9, 9, 'f9', 2)]);

    await useDebugStore.getState().refreshStackAndVars();

    const { location } = useDebugStore.getState();
    expect(location?.identity).toBe('dap-source:/9/f9');

    const tabPath = openTabPaths()[0];
    expect(tabPath).toBe('dap-source:/9/f9');
    // ★ F3 的核心断言：身份函数对虚拟身份幂等（此前会被拼上项目根 → 伪路径）
    expect(sourceIdentityOf(PROJECT, tabPath)).toBe(location!.identity);

    // ★ 单参数命中：absFilePath 即身份（正是 FileEditor 传给跟随钩子的那个值）
    const view = makeView();
    const { unmount } = renderRevealFor(view, sourceIdentityOf(PROJECT, tabPath));
    await flushMicrotasks();
    expect(caretLine(view)).toBe(2);

    unmount();
    view.destroy();
  });
});
