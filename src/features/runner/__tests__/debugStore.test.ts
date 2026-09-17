// @vitest-environment node
import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAP_EVENT } from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { deferred, flushMicrotasks } from '@/testing/async';

import type * as DebugApi from '../api/debugApi';
import { useDebugStore } from '../store/debugStore';
import { useJavaDebugStore } from '../store/javaDebugStore';
import type { DapEventPayload, StackFrameDto, VariableDto } from '../types';

const dapVariablesByReference = vi.hoisted(() => vi.fn());
const dapVariables = vi.hoisted(() => vi.fn());
const dapStackTrace = vi.hoisted(() => vi.fn());
const dapControl = vi.hoisted(() => vi.fn());
const dapStopSession = vi.hoisted(() => vi.fn());
const dapEvaluate = vi.hoisted(() => vi.fn());
const ensureStopSourceTab = vi.hoisted(() => vi.fn());

vi.mock('../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugApi>()),
  dapVariables,
  dapVariablesByReference,
  dapStackTrace,
  dapControl,
  dapStopSession,
  dapEvaluate,
}));

// 隔离 store 编排与 tab 生命周期（tab 生命周期由 navigate.test.ts 覆盖）。
vi.mock('../navigate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../navigate')>()),
  ensureStopSourceTab,
}));

type DapListener = (event: { payload: DapEventPayload }) => void;

async function subscribeAndGrabDapListener(): Promise<DapListener> {
  await useDebugStore.getState().subscribeEvents();
  const calls = vi.mocked(listen).mock.calls;
  const dapEventCall = calls.find(([name]) => name === DAP_EVENT);
  if (!dapEventCall) throw new Error('dap-event listener not registered');
  return dapEventCall[1] as DapListener;
}

function makeVar(name: string, ref = 0, value = 'v'): VariableDto {
  return { name, value, type: null, variablesReference: ref };
}

function seedLiveSession(status = 'stopped') {
  useDebugStore.setState({
    session: {
      sessionId: 's1',
      projectId: 'p1',
      projectPath: '/proj',
      configName: 'cfg',
      status,
    },
    variables: [makeVar('m', 100, '{...}')],
  });
}

/** Seed + expand one variable, returning the store snapshot after expansion. */
async function seedExpanded() {
  seedLiveSession();
  dapVariablesByReference.mockResolvedValue([makeVar('fetched_at', 0, '2026-09-04')]);
  await useDebugStore.getState().toggleVariableExpand(100);
}

function expansionState() {
  const s = useDebugStore.getState();
  return {
    childrenByRef: s.childrenByRef,
    expandedRefs: s.expandedRefs,
    loadingRefs: s.loadingRefs,
    varErrors: s.varErrors,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dapVariables.mockResolvedValue([]);
  useDebugStore.setState({
    session: null,
    panelOpen: false,
    frames: [],
    variables: [],
    childrenByRef: {},
    expandedRefs: {},
    loadingRefs: {},
    varErrors: {},
    selectedFrameId: null,
    location: null,
    locationSeq: 0,
    generation: null,
    error: null,
  });
});

describe('debugStore.toggleVariableExpand', () => {
  it('should_fetch_and_cache_children_on_first_expand', async () => {
    await seedExpanded();

    expect(dapVariablesByReference).toHaveBeenCalledWith('s1', 100);
    expect(useDebugStore.getState().childrenByRef[100]).toEqual([
      makeVar('fetched_at', 0, '2026-09-04'),
    ]);
    expect(useDebugStore.getState().expandedRefs[100]).toBe(true);
  });

  it('should_not_refetch_when_collapsing_then_reexpanding', async () => {
    await seedExpanded();

    await useDebugStore.getState().toggleVariableExpand(100); // collapse
    expect(useDebugStore.getState().expandedRefs[100]).toBe(false);

    await useDebugStore.getState().toggleVariableExpand(100); // re-expand
    expect(dapVariablesByReference).toHaveBeenCalledTimes(1);
    expect(useDebugStore.getState().expandedRefs[100]).toBe(true);
  });

  it('should_set_and_clear_loading_state', async () => {
    seedLiveSession();
    let resolveFetch: (v: VariableDto[]) => void = () => {};
    dapVariablesByReference.mockReturnValue(
      new Promise<VariableDto[]>((r) => {
        resolveFetch = r;
      }),
    );

    const pending = useDebugStore.getState().toggleVariableExpand(100);
    expect(useDebugStore.getState().loadingRefs[100]).toBe(true);
    resolveFetch([makeVar('a')]);
    await pending;
    expect(useDebugStore.getState().loadingRefs[100]).toBe(false);
  });

  it('should_record_error_and_allow_retry_on_failure', async () => {
    seedLiveSession();
    dapVariablesByReference.mockRejectedValueOnce(new Error('stale ref'));
    dapVariablesByReference.mockResolvedValueOnce([makeVar('a')]);

    await useDebugStore.getState().toggleVariableExpand(100);
    expect(useDebugStore.getState().varErrors[100]).toBe('stale ref');
    expect(useDebugStore.getState().expandedRefs[100]).toBe(false);

    await useDebugStore.getState().toggleVariableExpand(100);
    expect(useDebugStore.getState().varErrors[100]).toBeUndefined();
    expect(useDebugStore.getState().expandedRefs[100]).toBe(true);
  });

  it('should_be_noop_without_live_session', async () => {
    seedLiveSession();
    useDebugStore.setState({ session: null });
    await useDebugStore.getState().toggleVariableExpand(100);
    expect(dapVariablesByReference).not.toHaveBeenCalled();
  });

  it('should_be_noop_for_leaf_variable', async () => {
    seedLiveSession();
    await useDebugStore.getState().toggleVariableExpand(0);
    expect(dapVariablesByReference).not.toHaveBeenCalled();
  });
});

describe('debugStore variable expansion cache invalidation', () => {
  it('should_clear_expansion_cache_on_continued_event', async () => {
    await seedExpanded();
    seedLiveSession('running'); // continued → status running

    const handler = await subscribeAndGrabDapListener();
    handler({ payload: { sessionId: 's1', projectId: 'p1', kind: 'continued', body: {} } });

    expect(expansionState()).toEqual({
      childrenByRef: {},
      expandedRefs: {},
      loadingRefs: {},
      varErrors: {},
    });
  });

  it('should_clear_expansion_cache_on_terminated_event', async () => {
    await seedExpanded();

    const handler = await subscribeAndGrabDapListener();
    handler({ payload: { sessionId: 's1', projectId: 'p1', kind: 'terminated', body: {} } });

    const s = useDebugStore.getState();
    expect(s.session?.status).toBe('terminated');
    expect(expansionState()).toEqual({
      childrenByRef: {},
      expandedRefs: {},
      loadingRefs: {},
      varErrors: {},
    });
  });

  it('should_clear_expansion_cache_when_switching_frames', async () => {
    await seedExpanded();
    dapVariablesByReference.mockClear();
    dapVariables.mockResolvedValue([makeVar('other', 0)]);
    useDebugStore.setState({
      frames: [{ id: 5, name: 'main', sourcePath: '/proj/main.go', line: 3, column: 1 }],
      session: {
        sessionId: 's1',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'stopped',
      },
    });

    await useDebugStore.getState().selectFrame(5);

    expect(useDebugStore.getState().childrenByRef).toEqual({});
    expect(useDebugStore.getState().expandedRefs).toEqual({});
  });
});

describe('debugStore.pushConsole', () => {
  it('should_keep_repeated_program_output_verbatim', () => {
    // 实证：同一用例两次 println("0:2")，第二行被旧去重吞掉 —— 程序输出必须逐字保留。
    useDebugStore.setState({ consoleLines: [] });
    const push = useDebugStore.getState().pushConsole;
    push('out', '0:2');
    push('out', '0:2');
    const texts = useDebugStore.getState().consoleLines.map((l) => l.text);
    expect(texts).toEqual(['0:2', '0:2']);
  });

  it('should_still_dedup_consecutive_identical_sys_lines', () => {
    useDebugStore.setState({ consoleLines: [] });
    const push = useDebugStore.getState().pushConsole;
    push('sys', 'Starting: Debug test: test1…');
    push('sys', 'Starting: Debug test: test1…');
    const texts = useDebugStore.getState().consoleLines.map((l) => l.text);
    expect(texts).toEqual(['Starting: Debug test: test1…']);
  });
});

// Java 会话入口已迁到 `store/javaDebugStore.ts`（方案 B 阶段 4）；本用例依赖本文件既有的
// DAP api mock 设置，故留在此处，仅把调用目标改为语言 store。
describe('javaDebugStore.startJavaAttach', () => {
  it('should_echo_executed_command_after_session_reset', async () => {
    // 回显必须在 resetSessionState 之后（之前推会被清空导致 console 不可见）。
    // adapter 不可用时 launchSession 直接抛错 —— 回显先行，不依赖会话建成。
    useDebugStore.setState({ consoleLines: [] });
    await expect(
      useJavaDebugStore
        .getState()
        .startJavaAttach(
          'p1',
          'java -agentlib:jdwp=transport=dt_socket -jar launcher.jar',
          '/tmp/proj',
          'test1',
          [],
        ),
    ).rejects.toThrow();
    const texts = useDebugStore.getState().consoleLines.map((l) => l.text);
    expect(texts[0]).toBe('$ java -agentlib:jdwp=transport=dt_socket -jar launcher.jar');
  });
});

describe('debugStore.refreshStackAndVars stops', () => {
  const REGISTRY_FRAME = {
    id: 7,
    name: 'serde::de::value::borrowed_str_deserialize',
    sourcePath:
      '/home/u/.cargo/registry/src/index.crates.io-6facae9b0d0d8f07/serde-1.0.219/src/de.rs',
    line: 1234,
    column: 5,
  };
  const GO_RUNTIME_FRAME = {
    id: 3,
    name: 'runtime.main',
    sourcePath: '/usr/local/go/src/runtime/proc.go',
    line: 250,
    column: 1,
  };

  function seedStoppedSession() {
    useDebugStore.setState({
      session: {
        sessionId: 's1',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'stopped',
      },
    });
  }

  it('should_park_third_party_stop_and_highlight_it', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([REGISTRY_FRAME]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(dapControl).not.toHaveBeenCalledWith('s1', 'continue');
    expect(useDebugStore.getState().selectedFrameId).toBe(7);
    expect(useDebugStore.getState().location).toEqual({
      identity: REGISTRY_FRAME.sourcePath,
      line: 1234,
      column: 5,
    });
  });

  /// 回归：停在 JDK 方法、调用方是项目文件时，编辑器必须跟**栈顶 JDK 帧**。
  /// 「优先项目帧」会把编辑器拉回调用方文件 → 用户看到「跳不到 System.out.println」。
  it('should_open_the_library_stop_frame_not_the_caller_project_frame', async () => {
    seedStoppedSession();
    const jdkFrame = {
      id: 1,
      name: 'PrintStream.println(String)',
      sourcePath:
        '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java',
      line: 1167,
      column: 1,
    };
    const callerFrame = {
      id: 2,
      name: 'ArrayTest.test1()',
      sourcePath: '/proj/src/test/java/ArrayTest.java',
      line: 7,
      column: 1,
    };
    dapStackTrace.mockResolvedValue([jdkFrame, callerFrame]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(useDebugStore.getState().selectedFrameId).toBe(1);
    // location.identity 用**规范身份**（jdt 形态）：与 tab 身份、断点 key 同一套，
    // 黄线判定退化为精确相等。
    expect(useDebugStore.getState().location?.identity).toBe(
      'jdt:/java.base/java/io/PrintStream.java',
    );
    // 把**整只帧**交给 navigate：身份归一与内容通道选择都在那一层做
    expect(ensureStopSourceTab).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        projectPath: '/proj',
        frame: jdkFrame,
        sessionId: 's1',
        isCurrent: expect.any(Function),
      }),
      expect.any(Function),
    );
  });

  it('should_never_auto_continue_stdlib_stop', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([GO_RUNTIME_FRAME]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(dapControl).not.toHaveBeenCalled();
    expect(useDebugStore.getState().location?.identity).toBe(GO_RUNTIME_FRAME.sourcePath);
  });

  it('should_select_top_frame_without_highlight_when_no_frame_has_source', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([
      { id: 9, name: 'native', sourcePath: null, line: 0, column: 0 },
    ]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(useDebugStore.getState().selectedFrameId).toBe(9);
    expect(useDebugStore.getState().location).toBeNull();
  });

  it('should_open_adapter_virtual_source_when_no_frame_has_a_path', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([
      {
        id: 11,
        name: 'remote.frame',
        sourcePath: null,
        line: 3,
        column: 0,
        sourceReference: 42,
        sourceName: 'Foo.java',
      },
    ]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(useDebugStore.getState().selectedFrameId).toBe(11);
    expect(useDebugStore.getState().location).toEqual({
      identity: 'dap-source:/42/Foo.java',
      line: 3,
      column: 0,
    });
    expect(ensureStopSourceTab).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        projectPath: '/proj',
        frame: expect.objectContaining({ sourceReference: 42, sourceName: 'Foo.java' }),
        sessionId: 's1',
      }),
      expect.any(Function),
    );
  });

  it('should_open_path_source_when_a_frame_has_one', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([GO_RUNTIME_FRAME]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(ensureStopSourceTab).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        projectPath: '/proj',
        frame: GO_RUNTIME_FRAME,
        sessionId: 's1',
      }),
      expect.any(Function),
    );
  });
});

/**
 * Neeko Check F14：`logDebugStackError` 曾有一段「两个分支体完全相同」的死条件 ——
 * 它想表达的策略是「栈 race 只记日志、不弹 toast」。这里把**策略**（而非那段死代码）钉住，
 * 防止后人顺手加回一个 toast。
 */
describe('debugStore 栈刷新失败的处理策略', () => {
  it('should_log_without_toast_when_stack_fetch_keeps_failing', async () => {
    useDebugStore.setState({
      session: {
        sessionId: 's1',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'stopped',
      },
      consoleLines: [],
    });
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Delve 的 stack race 是瞬态：重试一次后仍失败
    dapStackTrace.mockRejectedValue(new Error('Delve: Dummy thread'));

    vi.useFakeTimers();
    try {
      const pending = useDebugStore.getState().refreshStackAndVars();
      await vi.advanceTimersByTimeAsync(150); // 触发内置的一次重试
      await pending;

      expect(warn).toHaveBeenCalledWith('[debug]', 'Error: Delve: Dummy thread');
      // 不弹 toast：错误已进 Debug Console，toast 只会是零信息量的打扰
      expect(useNotificationStore.getState().notifications).toEqual([]);
      expect(useDebugStore.getState().consoleLines.map((l) => l.kind)).toContain('err');
    } finally {
      vi.useRealTimers();
      // spy 必须在 finally 里摘：若断言失败就跳过 mockRestore，泄漏的 console.warn spy
      // 会静音后续用例的输出 —— 恰好掩盖后续失败（Neeko Check F21）。
      warn.mockRestore();
    }
  });
});

describe('debugStore.stopSilent — 项目切换静默释放（#14 配套）', () => {
  it('终止 live 会话、标记 terminated，但不打开面板', async () => {
    seedLiveSession('running');
    dapStopSession.mockResolvedValue(undefined);
    await useDebugStore.getState().stopSilent();
    const s = useDebugStore.getState();
    expect(dapStopSession).toHaveBeenCalledWith('s1');
    expect(s.session?.status).toBe('terminated');
    expect(s.panelOpen).toBe(false);
  });

  it('无会话时静默返回，不触碰面板状态', async () => {
    dapStopSession.mockResolvedValue(undefined);
    await useDebugStore.getState().stopSilent();
    expect(dapStopSession).not.toHaveBeenCalled();
    expect(useDebugStore.getState().panelOpen).toBe(false);
  });
});

/**
 * 切片 1+2：**停点代际化 + 位置单写者 + 原子写**。
 *
 * 症状（issue #13）：停点/单步时编辑器有时不跳到当前断点位置（点一下栈帧才定位）。
 * 根因一 = 旧停点的异步链迟到后覆盖新停点（此前只校验 sessionId）；根因二 = 帧与位置
 * 分两次 `set`，出现「新位置 + 旧帧」的可观测中间态。本组用例把两条不变式钉住。
 */
describe('debugStore 停点代际与位置（代际化 / 单写者 / 原子写）', () => {
  const PROJECT = '/proj';
  const JDK_CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT_IDENTITY = 'jdt:/java.base/java/io/PrintStream.java';

  function stopFrame(
    id: number,
    line: number,
    name = `frame${id}`,
    sourcePath: string = `${PROJECT}/a.go`,
  ): StackFrameDto {
    return { id, name, sourcePath, line, column: 1 };
  }

  /** 播一次停点并把位置落到 line（供清空类用例做前置）。 */
  async function seedStoppedAt(line: number): Promise<void> {
    seedLiveSession();
    dapStackTrace.mockResolvedValue([stopFrame(1, line)]);
    await useDebugStore.getState().refreshStackAndVars();
  }

  it('[T1] 旧代际迟到不得落地（新链先完成、旧链后完成）', async () => {
    seedLiveSession();
    const older = deferred<StackFrameDto[]>();
    const newer = deferred<StackFrameDto[]>();
    dapStackTrace
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const firstRun = useDebugStore.getState().refreshStackAndVars(); // 旧代际
    const secondRun = useDebugStore.getState().refreshStackAndVars(); // 新代际

    // 关键：新链先完成、旧链后完成 —— 「迟到者」由 deferred 反转兑现顺序构造，
    // 而不是靠 await 次序（后者根本构造不出竞态）。
    newer.resolve([stopFrame(2, 20, 'newer')]);
    await secondRun;
    older.resolve([stopFrame(1, 10, 'older')]);
    await firstRun;

    const s = useDebugStore.getState();
    expect(s.frames.map((f) => f.id)).toEqual([2]);
    expect(s.selectedFrameId).toBe(2);
    expect(s.location?.line).toBe(20);
  });

  it('[T2] frames 与 location 原子落地（不存在「新 location + 旧 frames」快照）', async () => {
    seedLiveSession();
    const snapshots: { lines: number[]; locationLine: number | null }[] = [];
    const unsubscribe = useDebugStore.subscribe((s) => {
      snapshots.push({
        lines: s.frames.map((f) => f.line),
        locationLine: s.location?.line ?? null,
      });
    });

    dapStackTrace.mockResolvedValue([stopFrame(1, 10, 'a')]);
    await useDebugStore.getState().refreshStackAndVars();
    dapStackTrace.mockResolvedValue([stopFrame(2, 20, 'b')]);
    await useDebugStore.getState().refreshStackAndVars();
    unsubscribe();

    // 每一次快照里，位置必须描述同一批帧（否则编辑器会出现「黄线在新停点、位置在旧停点」）。
    const inconsistent = snapshots.filter(
      (snap) => snap.locationLine !== null && snap.lines[0] !== snap.locationLine,
    );
    expect(inconsistent).toEqual([]);
    expect(snapshots.at(-1)).toEqual({ lines: [20], locationLine: 20 });
  });

  it('[T4] 切帧：同一代际内更新位置（规范身份）且 locationSeq+1', async () => {
    seedLiveSession();
    dapStackTrace.mockResolvedValue([
      stopFrame(1, 3, 'caller', `${PROJECT}/src/ArrayTest.java`),
      { id: 2, name: 'PrintStream.println', sourcePath: JDK_CACHE, line: 1167, column: 5 },
    ]);
    await useDebugStore.getState().refreshStackAndVars();

    const generationBefore = useDebugStore.getState().generation;
    const seqBefore = useDebugStore.getState().locationSeq;

    await useDebugStore.getState().selectFrame(2);

    const s = useDebugStore.getState();
    // 切帧不是新停点事件：代际必须保持，否则在途的变量请求会被整批判死。
    expect(s.generation).toEqual(generationBefore);
    expect(s.selectedFrameId).toBe(2);
    expect(s.locationSeq).toBe(seqBefore + 1);
    // 位置身份必须规范（旧实现写裸 sourcePath，会让黄线与跳转判定分叉）。
    expect(s.location).toEqual({ identity: JDT_IDENTITY, line: 1167, column: 5 });
  });

  it('[T11] 旧停点交给 navigate 的落地许可在新停点到来后失效', async () => {
    seedLiveSession();
    const guards: (() => boolean)[] = [];
    ensureStopSourceTab.mockImplementation(async (req: { isCurrent: () => boolean }) => {
      guards.push(req.isCurrent);
      return 'tab-id';
    });
    const slow = deferred<StackFrameDto[]>();
    dapStackTrace.mockImplementationOnce(() => slow.promise);

    const firstRun = useDebugStore.getState().refreshStackAndVars();
    slow.resolve([stopFrame(1, 10, 'older')]);
    await flushMicrotasks(); // 让旧链推进到「已交给 navigate、内容还在路上」的状态

    expect(guards).toHaveLength(1);
    expect(guards[0]()).toBe(true); // 此刻旧链仍是当前代际

    dapStackTrace.mockResolvedValue([stopFrame(2, 20, 'newer')]);
    await useDebugStore.getState().refreshStackAndVars(); // 新停点
    expect(guards[0]()).toBe(false); // 旧链迟到的内容已无权建 tab / 抢激活

    await firstRun;
  });

  it('[T2] 空栈：帧与位置必须原子清空（序号 +1）', async () => {
    seedLiveSession();
    dapStackTrace.mockResolvedValue([]);
    const seqBefore = useDebugStore.getState().locationSeq;

    await useDebugStore.getState().refreshStackAndVars();

    const s = useDebugStore.getState();
    expect(s.frames).toEqual([]);
    expect(s.selectedFrameId).toBeNull();
    expect(s.location).toBeNull();
    expect(s.locationSeq).toBe(seqBefore + 1);
  });

  it('[T12] 变量拉取失败只记日志：不得被误判为栈刷新失败而重试', async () => {
    // 回归锁：变量失败若冒泡到外层 catch，会触发 150ms 重试 + 二次 dapStackTrace + 弹错 ——
    // 而帧与位置已经落地，用户已能看到停点，多出来的重试与报错都是噪音。
    seedLiveSession();
    useDebugStore.setState({ consoleLines: [] });
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    dapStackTrace.mockResolvedValue([stopFrame(1, 10)]);
    dapVariables.mockRejectedValue(new Error('variables boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await useDebugStore.getState().refreshStackAndVars();

      expect(useDebugStore.getState().location?.line).toBe(10);
      expect(dapStackTrace).toHaveBeenCalledTimes(1);
      expect(useDebugStore.getState().consoleLines).toEqual([]);
      expect(useNotificationStore.getState().notifications).toEqual([]);
      expect(warn).toHaveBeenCalledWith('[debug]', expect.stringContaining('variables boom'));
    } finally {
      warn.mockRestore();
    }
  });

  it('[T14] 无代际（未经过 beginStop）时切帧仍写入变量', async () => {
    // 外部评审指出的陷阱回归：`isSameGeneration(null, null) === false`，若切帧的复查直接用它会
    // 把「双方皆无代际」误判为「已变」⇒ 变量静默不写、源码 tab 不打开（attach 到已暂停进程、
    // 测试直接 seed frames+session 等未过 beginStop 的停止态都会踩到）。
    useDebugStore.setState({
      session: {
        sessionId: 's1',
        projectId: 'p1',
        projectPath: '/proj',
        configName: 'cfg',
        status: 'stopped',
      },
      frames: [{ id: 1, name: 'f1', sourcePath: '/proj/a.go', line: 3, column: 1 }],
      generation: null,
      variables: [],
    });
    dapVariables.mockResolvedValue([makeVar('v', 0, 'kept')]);

    await useDebugStore.getState().selectFrame(1);

    expect(useDebugStore.getState().variables).toEqual([makeVar('v', 0, 'kept')]);
  });

  it('[T15] 切帧期间出现新停点 → 迟到的变量被丢弃', async () => {
    // 锁定外部改动的**意图**：切帧不新开代际，但新停点到达必须让这条链的后续落地失效
    //（DAP 数字帧 id 极易碰撞，单靠 selectedFrameId 会误判为「仍是这一帧」）。
    seedLiveSession();
    dapStackTrace.mockResolvedValue([
      { id: 1, name: 'f1', sourcePath: '/proj/a.go', line: 3, column: 1 },
    ]);
    await useDebugStore.getState().refreshStackAndVars();

    const gate = deferred<VariableDto[]>();
    dapVariables.mockImplementationOnce(() => gate.promise);
    const pending = useDebugStore.getState().selectFrame(1);

    useDebugStore.getState().beginStop('s1'); // 新停点取代本次切帧
    gate.resolve([makeVar('stale', 0, 'stale')]);
    await pending;

    expect(useDebugStore.getState().variables).toEqual([]);
  });

  it('[T5] 清空路径（continued / terminated / resetSession）清位置、无效代际且 seq+1', async () => {
    const handler = await subscribeAndGrabDapListener();
    await seedStoppedAt(10);
    const afterContinue = useDebugStore.getState().locationSeq;
    handler({ payload: { sessionId: 's1', projectId: 'p1', kind: 'continued', body: {} } });
    expect(useDebugStore.getState().location).toBeNull();
    expect(useDebugStore.getState().locationSeq).toBe(afterContinue + 1);
    // 运行中不存在有效停点代际：在途旧链必须被判死。
    expect(useDebugStore.getState().generation).toBeNull();

    await seedStoppedAt(20);
    const afterTerminate = useDebugStore.getState().locationSeq;
    handler({ payload: { sessionId: 's1', projectId: 'p1', kind: 'terminated', body: {} } });
    expect(useDebugStore.getState().location).toBeNull();
    expect(useDebugStore.getState().locationSeq).toBe(afterTerminate + 1);

    await seedStoppedAt(30);
    const afterReset = useDebugStore.getState().locationSeq;
    useDebugStore.getState().resetSession();
    expect(useDebugStore.getState().location).toBeNull();
    expect(useDebugStore.getState().locationSeq).toBe(afterReset + 1);
    expect(useDebugStore.getState().generation).toBeNull();
  });
});

describe('debugStore 停点链的防御分支（会话丢失 / 重试期间被取代）', () => {
  it('链中途会话丢失 → 不写帧与位置', async () => {
    seedLiveSession();
    const stack = deferred<StackFrameDto[]>();
    dapStackTrace.mockImplementationOnce(() => stack.promise);
    const run = useDebugStore.getState().refreshStackAndVars();

    // 会话在 await 期间结束（但代际未被改写）：applyStop 必须发现 live 已消失并放弃。
    useDebugStore.setState({ session: null });
    stack.resolve([{ id: 1, name: 'f1', sourcePath: '/proj/a.go', line: 10, column: 1 }]);
    await run;

    expect(useDebugStore.getState().frames).toEqual([]);
    expect(useDebugStore.getState().location).toBeNull();
  });

  it('重试等待期间代际被取代 → 不再重取栈（防御分支）', async () => {
    seedLiveSession();
    dapStackTrace.mockRejectedValueOnce(new Error('Delve: Dummy thread'));

    vi.useFakeTimers();
    try {
      const run = useDebugStore.getState().refreshStackAndVars();
      await vi.advanceTimersByTimeAsync(100); // 进入 150ms 等待窗口
      useDebugStore.getState().beginStop('s1'); // 新停点取代本次重试
      await vi.advanceTimersByTimeAsync(100); // 越过 150ms
      await run;

      expect(dapStackTrace).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('debugStore.evaluate — 求值上下文', () => {
  it('无会话 → 错误进 console，且不调用 DAP', async () => {
    useDebugStore.setState({ session: null, consoleLines: [] });

    await useDebugStore.getState().evaluate('1+1');

    expect(dapEvaluate).not.toHaveBeenCalled();
    const lines = useDebugStore.getState().consoleLines;
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('err');
    expect(lines[0].text).toContain('No active debug session');
  });

  it('成功 → 依次回显表达式与结果', async () => {
    seedLiveSession();
    useDebugStore.setState({ consoleLines: [] });
    dapEvaluate.mockResolvedValue('42');

    await useDebugStore.getState().evaluate('1+41');

    expect(dapEvaluate).toHaveBeenCalledWith('s1', '1+41', null);
    expect(useDebugStore.getState().consoleLines.map((l) => [l.kind, l.text])).toEqual([
      ['in', '1+41'],
      ['out', '42'],
    ]);
  });

  it('失败 → 错误进 console（不抛出）', async () => {
    seedLiveSession();
    useDebugStore.setState({ consoleLines: [] });
    dapEvaluate.mockRejectedValue(new Error('evaluate boom'));

    await useDebugStore.getState().evaluate('boom');

    const lines = useDebugStore.getState().consoleLines;
    expect(lines.map((l) => l.kind)).toEqual(['in', 'err']);
    expect(lines[1].text).toContain('evaluate boom');
  });
});
