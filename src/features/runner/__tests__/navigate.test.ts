import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { FileContent } from '@/shared/types';
import { deferred } from '@/testing/async';

import { ensureStopSourceTab, openSourceAtLine, openVirtualSourceAtLine } from '../navigate';
import type { StackFrameDto } from '../types';

const { readFileContentMock, preloadMock, externalReadMock, virtualReadMock, recordJumpMock } =
  vi.hoisted(() => ({
    readFileContentMock: vi.fn(),
    preloadMock: vi.fn(),
    externalReadMock: vi.fn(),
    virtualReadMock: vi.fn(),
    recordJumpMock: vi.fn(),
  }));

vi.mock('@/features/file/api/fileApi', () => ({
  readFileContent: readFileContentMock,
}));

vi.mock('@/shared/utils/codemirror', () => ({
  preloadLanguageExtension: preloadMock,
}));

vi.mock('../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/debugApi')>()),
  dapReadExternalSource: externalReadMock,
  dapSourceContent: virtualReadMock,
}));

vi.mock('@/shared/store/navigationHistoryStore', () => ({
  captureCurrentNavLocation: () => null,
  recordNavigationJump: recordJumpMock,
}));

const EXTERNAL_PATH = '/opt/dep/src/lib.rs';

function content(path: string, body = 'x') {
  return { path, content: body, size: body.length, is_binary: false };
}

describe('openSourceAtLine — DAP 停止行打开源文件（canonical 构造）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => content(p));
  });

  it('DAP 绝对路径直接 canonical 存储（不再相对化），id 与 filePath 一致可推导', async () => {
    await openSourceAtLine('p1', '/repo', '/repo/src/main.rs', 10, 2);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1);
    expect(space.tabs[0].id).toBe('p1:/repo/src/main.rs');
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });

  it('projectPath 快照缺失 → 回退 activeProject.path 作 canonical 根', async () => {
    useProjectStore.setState({
      activeProject: { id: 'p1', path: '/repo' } as never,
    });

    await openSourceAtLine('p1', '', '/repo/src/main.rs', 1);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs[0].data.kind === 'file' && space.tabs[0].data.filePath).toBe(
      '/repo/src/main.rs',
    );
  });

  it('同一路径再次停止 → 复用既有 tab（canonical 身份命中）', async () => {
    await openSourceAtLine('p1', '/repo', '/repo/src/main.rs', 10);
    await openSourceAtLine('p1', '/repo', '/repo/src/main.rs', 42);

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1);
    expect(space.activeTabId).toBe('p1:/repo/src/main.rs');
  });
});

describe('openSourceAtLine — 项目外栈帧源码兜底（外部只读通道）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
    readFileContentMock.mockRejectedValue(new Error('Path is outside root directory'));
  });

  it('项目内读取失败 + 绝对路径 + sessionId → 外部读取成功建只读 tab', async () => {
    externalReadMock.mockResolvedValue(content(EXTERNAL_PATH, 'external body'));

    await openSourceAtLine('p1', '/repo', EXTERNAL_PATH, 5, 1, { sessionId: 's1' });

    expect(externalReadMock).toHaveBeenCalledWith('p1', 's1', EXTERNAL_PATH);
    const tab = useEditorStore.getState().tabs['p1'].tabs[0];
    expect(tab.data.kind === 'file' && tab.data.readOnly).toBe(true);
    expect(tab.data.kind === 'file' && tab.data.content.content).toBe('external body');
    expect(tab.data.kind === 'file' && tab.data.isDirty).toBe(false);
  });

  it('无 sessionId → 不调外部命令、不建 tab', async () => {
    const onError = vi.fn();

    await openSourceAtLine('p1', '/repo', EXTERNAL_PATH, 5, 1, { onError });

    expect(externalReadMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('无法归一到绝对路径（项目根缺失）→ 不调外部命令', async () => {
    // No project root snapshot and no active project: the relative frame path
    // stays relative, so it cannot be aligned with adapter frame paths.
    await openSourceAtLine('p1', '', 'src/lib.rs', 5, 1, { sessionId: 's1' });

    expect(externalReadMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });

  it('外部读取失败 → 不建 tab、上报 onError、不污染导航历史', async () => {
    externalReadMock.mockRejectedValue(new Error('not a readable external debug stop'));
    const onError = vi.fn();

    await openSourceAtLine('p1', '/repo', EXTERNAL_PATH, 5, 1, { sessionId: 's1', onError });

    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
    expect(recordJumpMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to open source'));
  });

  it('外部读取成功 → 记录导航历史', async () => {
    externalReadMock.mockResolvedValue(content(EXTERNAL_PATH));

    await openSourceAtLine('p1', '/repo', EXTERNAL_PATH, 5, 1, { sessionId: 's1' });

    expect(recordJumpMock).toHaveBeenCalledTimes(1);
  });
});

describe('openSourceAtLine — JDK 缓存路径身份归一（同一份源码同一个 tab / 同一套断点 key）', () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';

  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('已有同身份的 jdt tab → 直接激活，不读取任何内容', async () => {
    useEditorStore.setState({
      tabs: {
        p1: {
          tabs: [
            {
              id: `p1:${JDT}`,
              projectId: 'p1',
              title: 'PrintStream.java',
              order: 0,
              data: {
                kind: 'file' as const,
                filePath: JDT,
                fileName: 'PrintStream.java',
                content: { path: JDT, content: 'class PrintStream {}', size: 20, is_binary: false },
                isDirty: false,
                readOnly: true,
                virtualUri: 'jdt://contents/java.base/java.io/PrintStream.class?=q',
              },
            },
          ],
          activeTabId: null,
        },
      },
      editorLayout: {},
      activeTabId: null,
    });

    await openSourceAtLine('p1', '/repo', CACHE, 1167, 1, { sessionId: 's1' });

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1); // 同一个类只有一个 tab
    expect(space.activeTabId).toBe(`p1:${JDT}`);
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(externalReadMock).not.toHaveBeenCalled();
  });

  it('无同身份 tab → 新建 tab 用**规范身份**（jdt），内容取自缓存文件', async () => {
    readFileContentMock.mockRejectedValue(new Error('Path is outside root directory'));
    externalReadMock.mockResolvedValue(content(CACHE, 'jdk body'));

    await openSourceAtLine('p1', '/repo', CACHE, 1167, 1, { sessionId: 's1' });

    // 内容来源 = 缓存文件（真实可读路径）
    expect(externalReadMock).toHaveBeenCalledWith('p1', 's1', CACHE);
    // tab 身份 = 规范身份：断点 key 因此在两条打开路径下都一致
    const tab = useEditorStore.getState().tabs['p1'].tabs[0];
    expect(tab.id).toBe(`p1:${JDT}`);
    expect(tab.data.kind === 'file' && tab.data.filePath).toBe(JDT);
    expect(tab.data.kind === 'file' && tab.data.content.content).toBe('jdk body');
    expect(tab.data.kind === 'file' && tab.data.readOnly).toBe(true);
  });
});

describe('openSourceAtLine — jdt 虚拟文档（不拼根、不读 fs）', () => {
  const JDT_DISPLAY = 'jdt:/java.base/java/io/PrintStream.java';

  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
  });

  it('虚拟文档已打开 → 激活既有 tab，不触发任何读取', async () => {
    useEditorStore.setState({
      tabs: {
        p1: {
          tabs: [
            {
              id: `p1:${JDT_DISPLAY}`,
              projectId: 'p1',
              title: 'PrintStream.java',
              order: 0,
              data: {
                kind: 'file' as const,
                filePath: JDT_DISPLAY,
                fileName: 'PrintStream.java',
                content: {
                  path: JDT_DISPLAY,
                  content: 'class PrintStream {}',
                  size: 20,
                  is_binary: false,
                },
                isDirty: false,
                readOnly: true,
              },
            },
          ],
          activeTabId: null,
        },
      },
      editorLayout: {},
      activeTabId: null,
    });

    await openSourceAtLine('p1', '/repo', JDT_DISPLAY, 1167);

    expect(useEditorStore.getState().tabs['p1'].activeTabId).toBe(`p1:${JDT_DISPLAY}`);
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(externalReadMock).not.toHaveBeenCalled();
  });

  it('jdt 源：有会话 → 走会话门控外部通道建只读 tab，不做注定失败的项目内读取', async () => {
    externalReadMock.mockResolvedValue(content(JDT_DISPLAY, 'class PrintStream {}'));

    await openSourceAtLine('p1', '/repo', JDT_DISPLAY, 1167, 0, { sessionId: 's1' });

    // jdt 身份不是文件路径：不得走项目内读取（会得到不存在的路径），直接走外部通道。
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(externalReadMock).toHaveBeenCalledWith('p1', 's1', JDT_DISPLAY);
    const tab = useEditorStore.getState().tabs['p1']?.tabs?.[0];
    expect(tab?.id).toBe(`p1:${JDT_DISPLAY}`);
    expect(tab?.data.kind === 'file' && tab.data.readOnly).toBe(true);
  });

  it('jdt 源：无会话 → 不建 tab，明确说明需要活动会话', async () => {
    const onError = vi.fn();

    await openSourceAtLine('p1', '/repo', JDT_DISPLAY, 1167, 0, { onError });

    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(externalReadMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('live debug session'));
  });

  it('jdt 源：后端拒绝（源码不可得）→ 错误原样上报，不静默', async () => {
    const onError = vi.fn();
    externalReadMock.mockRejectedValue(new Error('not a readable external debug stop'));

    await openSourceAtLine('p1', '/repo', JDT_DISPLAY, 1167, 0, { sessionId: 's1', onError });

    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('not a readable external debug stop'),
    );
  });

  it('jdt 路径不会被拼上项目根（回归：<root>/jdt:/… 会让断点永远打不上）', async () => {
    const onError = vi.fn();

    await openSourceAtLine('p1', '/repo', JDT_DISPLAY, 1, 0, { onError });

    const tab = useEditorStore.getState().tabs['p1']?.tabs?.[0];
    expect(tab).toBeUndefined();
    const message = String(onError.mock.calls[0]?.[0] ?? '');
    expect(message).not.toContain('/repo/jdt:');
  });
});

describe('openVirtualSourceAtLine — 适配器虚拟源码（sourceReference）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
  });

  it('有 sessionId + reference → 建只读虚拟 tab（身份 dap-source:）', async () => {
    virtualReadMock.mockResolvedValue('class Foo {}');

    await openVirtualSourceAtLine('p1', 'Foo.java', 42, 7, 2, { sessionId: 's1' });

    expect(virtualReadMock).toHaveBeenCalledWith('s1', 42);
    const tab = useEditorStore.getState().tabs['p1'].tabs[0];
    expect(tab.id).toBe('p1:dap-source:/42/Foo.java');
    expect(tab.title).toBe('Foo.java');
    expect(tab.data.kind === 'file' && tab.data.readOnly).toBe(true);
    expect(tab.data.kind === 'file' && tab.data.content.content).toBe('class Foo {}');
    expect(tab.data.kind === 'file' && tab.data.isDirty).toBe(false);
  });

  it('同一 reference 再次停止 → 复用既有 tab', async () => {
    virtualReadMock.mockResolvedValue('class Foo {}');

    await openVirtualSourceAtLine('p1', 'Foo.java', 42, 7, 2, { sessionId: 's1' });
    virtualReadMock.mockClear();
    await openVirtualSourceAtLine('p1', 'Foo.java', 42, 9, 0, { sessionId: 's1' });

    expect(useEditorStore.getState().tabs['p1'].tabs).toHaveLength(1);
    // 复用路径不重取内容
    expect(virtualReadMock).not.toHaveBeenCalled();
  });

  it('无 sessionId 或非正 reference → 不取内容、不建 tab', async () => {
    await openVirtualSourceAtLine('p1', 'Foo.java', 42, 7, 2);
    await openVirtualSourceAtLine('p1', 'Foo.java', 0, 7, 2, { sessionId: 's1' });

    expect(virtualReadMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });

  it('取内容失败 → 不建 tab 并上报 onError', async () => {
    virtualReadMock.mockRejectedValue(new Error('session not found'));
    const onError = vi.fn();

    await openVirtualSourceAtLine('p1', 'Foo.java', 42, 7, 2, { sessionId: 's1', onError });

    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to open source'));
  });
});

/**
 * 停点路径：**只确保源码 tab 存在并激活**，不写跳转目标（跳转由 `location` 派生链承担），
 * 且在 `await` 之后必须校验落地许可 —— 旧停点的内容加载晚到时不得抢走新停点的激活。
 */
describe('ensureStopSourceTab — 停点只确保源码可见（不写跳转目标 + 落地许可）', () => {
  const PROJECT = '/repo';
  const A_PATH = `${PROJECT}/src/A.java`;
  const B_PATH = `${PROJECT}/src/B.java`;

  function frame(id: number, sourcePath: string | null, line = 10): StackFrameDto {
    return { id, name: `f${id}`, sourcePath, line, column: 2 };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      tabs: {},
      editorLayout: {},
      activeTabId: null,
      pendingNavigateTarget: null,
    });
    useProjectStore.setState({ activeProject: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
    readFileContentMock.mockImplementation(async (_projectId: string, p: string) => content(p));
  });

  it('should_open_and_activate_the_tab_without_writing_a_navigate_target', async () => {
    const tabId = await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => true,
    });

    const store = useEditorStore.getState();
    expect(tabId).toBe('p1:/repo/src/A.java');
    expect(store.tabs['p1'].activeTabId).toBe('p1:/repo/src/A.java');
    // 跳转目标必须为空：编辑器侧由 useDebugStopReveal 从 location 派生，不再经单槽消费。
    expect(store.pendingNavigateTarget).toBeNull();
  });

  it('should_reuse_an_existing_tab_without_reading_content', async () => {
    await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => true,
    });
    readFileContentMock.mockClear();

    const tabId = await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH, 42),
      sessionId: 's1',
      isCurrent: () => true,
    });

    expect(tabId).toBe('p1:/repo/src/A.java');
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['p1'].tabs).toHaveLength(1);
    expect(useEditorStore.getState().pendingNavigateTarget).toBeNull();
  });

  it('[T11] should_drop_a_late_content_load_when_the_commit_guard_turned_false', async () => {
    const gate = deferred<FileContent>();
    readFileContentMock.mockImplementationOnce(() => gate.promise);
    let allowed = true;

    const pending = ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => allowed,
    });
    // 内容还在路上时，新的停点（B）已经落地 —— A 这条链已经被取代。
    allowed = false;
    gate.resolve(content(A_PATH));
    const tabId = await pending;

    expect(tabId).toBeNull();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });

  it('should_bail_out_before_reading_when_the_guard_is_already_false', async () => {
    const tabId = await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => false,
    });

    expect(tabId).toBeNull();
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });

  it('should_open_a_virtual_source_tab_for_a_source_reference_frame', async () => {
    virtualReadMock.mockResolvedValue('class Foo {}');

    const tabId = await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: {
        id: 3,
        name: 'remote',
        sourcePath: null,
        line: 7,
        column: 0,
        sourceReference: 42,
        sourceName: 'Foo.java',
      },
      sessionId: 's1',
      isCurrent: () => true,
    });

    expect(tabId).toBe('p1:dap-source:/42/Foo.java');
    expect(virtualReadMock).toHaveBeenCalledWith('s1', 42);
  });

  it('should_return_null_for_a_frame_without_any_source', async () => {
    const tabId = await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(4, null),
      sessionId: 's1',
      isCurrent: () => true,
    });

    expect(tabId).toBeNull();
    expect(useEditorStore.getState().tabs['p1']).toBeUndefined();
  });

  it('should_report_a_failed_load_without_creating_a_tab', async () => {
    // 项目内读取失败 + 绝对路径 + 有会话 → 走外部兜底通道；这里让它也失败（双通道皆不可得）。
    readFileContentMock.mockRejectedValue(new Error('boom'));
    externalReadMock.mockRejectedValue(new Error('not a readable external debug stop'));
    const onError = vi.fn();

    const tabId = await ensureStopSourceTab(
      {
        projectId: 'p1',
        projectPath: PROJECT,
        frame: frame(1, A_PATH),
        sessionId: 's1',
        isCurrent: () => true,
      },
      onError,
    );

    expect(tabId).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Failed to open source'));
  });

  it('should_do_nothing_for_an_empty_project_id（tab 空间键为空时的守卫）', async () => {
    const id = await ensureStopSourceTab({
      projectId: '',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => true,
    });

    expect(id).toBeNull();
    expect(readFileContentMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs['']).toBeUndefined();
  });

  it('既有 tab 存非规范形态时也复用（同文件判定走身份抽象）', async () => {
    // 历史 / 会话恢复的 tab 可能存 `…/src//A.java` 这类形态：字符串等值会漏判 ⇒ 再开一个 tab。
    useEditorStore.setState({
      tabs: {
        p1: {
          tabs: [
            {
              id: 'p1:/repo/src//A.java',
              projectId: 'p1',
              title: 'A.java',
              order: 0,
              data: {
                kind: 'file' as const,
                filePath: '/repo/src//A.java',
                fileName: 'A.java',
                content: { path: '/repo/src//A.java', content: 'x', size: 1, is_binary: false },
                isDirty: false,
              },
            },
          ],
          activeTabId: 'p1:/repo/src//A.java',
        },
      },
      editorLayout: {},
      activeTabId: null,
      pendingNavigateTarget: null,
    });
    readFileContentMock.mockClear();

    await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => true,
    });

    const space = useEditorStore.getState().tabs['p1'];
    expect(space.tabs).toHaveLength(1);
    // 复用路径不重取内容
    expect(readFileContentMock).not.toHaveBeenCalled();
  });

  it('should_open_the_second_file_when_stops_arrive_in_order', async () => {
    // 对照组（非竞态）：顺序到达时两个文件都应被打开，最后一次激活属后者。
    await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(1, A_PATH),
      sessionId: 's1',
      isCurrent: () => true,
    });
    await ensureStopSourceTab({
      projectId: 'p1',
      projectPath: PROJECT,
      frame: frame(2, B_PATH),
      sessionId: 's1',
      isCurrent: () => true,
    });

    const store = useEditorStore.getState();
    expect(store.tabs['p1'].tabs.map((t) => t.id)).toEqual([
      'p1:/repo/src/A.java',
      'p1:/repo/src/B.java',
    ]);
    expect(store.tabs['p1'].activeTabId).toBe('p1:/repo/src/B.java');
  });
});
