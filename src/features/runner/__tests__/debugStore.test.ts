import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAP_EVENT } from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';

import type * as DebugApi from '../api/debugApi';
import { useDebugStore } from '../store/debugStore';
import { useJavaDebugStore } from '../store/javaDebugStore';
import type { DapEventPayload, VariableDto } from '../types';

const dapVariablesByReference = vi.hoisted(() => vi.fn());
const dapVariables = vi.hoisted(() => vi.fn());
const dapStackTrace = vi.hoisted(() => vi.fn());
const dapControl = vi.hoisted(() => vi.fn());
const openSourceAtLine = vi.hoisted(() => vi.fn());
const openVirtualSourceAtLine = vi.hoisted(() => vi.fn());

vi.mock('../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugApi>()),
  dapVariables,
  dapVariablesByReference,
  dapStackTrace,
  dapControl,
}));

// Isolate store orchestration from tab lifecycle (covered by navigate.test.ts).
vi.mock('../navigate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../navigate')>()),
  openSourceAtLine,
  openVirtualSourceAtLine,
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
    frames: [],
    variables: [],
    childrenByRef: {},
    expandedRefs: {},
    loadingRefs: {},
    varErrors: {},
    selectedFrameId: null,
    stoppedAt: null,
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
    expect(useDebugStore.getState().stoppedAt).toEqual({
      filePath: REGISTRY_FRAME.sourcePath,
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
    // stoppedAt 用**规范身份**（jdt 形态）：与 tab 身份、断点 key 同一套，
    // 黄线判定退化为精确相等。
    expect(useDebugStore.getState().stoppedAt?.filePath).toBe(
      'jdt:/java.base/java/io/PrintStream.java',
    );
    // 打开时仍把「实际帧路径」（缓存文件）交给 navigate —— 身份归一在那一层做
    expect(openSourceAtLine).toHaveBeenCalledWith(
      'p1',
      '/proj',
      jdkFrame.sourcePath,
      jdkFrame.line,
      jdkFrame.column,
      expect.objectContaining({ sessionId: 's1' }),
    );
  });

  it('should_never_auto_continue_stdlib_stop', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([GO_RUNTIME_FRAME]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(dapControl).not.toHaveBeenCalled();
    expect(useDebugStore.getState().stoppedAt?.filePath).toBe(GO_RUNTIME_FRAME.sourcePath);
  });

  it('should_select_top_frame_without_highlight_when_no_frame_has_source', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([
      { id: 9, name: 'native', sourcePath: null, line: 0, column: 0 },
    ]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(useDebugStore.getState().selectedFrameId).toBe(9);
    expect(useDebugStore.getState().stoppedAt).toBeNull();
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
    expect(useDebugStore.getState().stoppedAt).toEqual({
      filePath: 'dap-source:/42/Foo.java',
      line: 3,
      column: 0,
    });
    expect(openVirtualSourceAtLine).toHaveBeenCalledWith(
      'p1',
      'Foo.java',
      42,
      3,
      0,
      expect.objectContaining({ sessionId: 's1' }),
    );
  });

  it('should_open_path_source_when_a_frame_has_one', async () => {
    seedStoppedSession();
    dapStackTrace.mockResolvedValue([GO_RUNTIME_FRAME]);

    await useDebugStore.getState().refreshStackAndVars();

    expect(openSourceAtLine).toHaveBeenCalledWith(
      'p1',
      '/proj',
      GO_RUNTIME_FRAME.sourcePath,
      GO_RUNTIME_FRAME.line,
      GO_RUNTIME_FRAME.column,
      expect.objectContaining({ sessionId: 's1' }),
    );
    expect(openVirtualSourceAtLine).not.toHaveBeenCalled();
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
