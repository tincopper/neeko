import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAP_EVENT } from '@/shared/events';

import { useDebugStore } from '../store/debugStore';
import type { DapEventPayload, VariableDto } from '../types';

const dapVariablesByReference = vi.hoisted(() => vi.fn());
const dapVariables = vi.hoisted(() => vi.fn());

vi.mock('../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/debugApi')>()),
  dapVariables,
  dapVariablesByReference,
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

describe('debugStore.startJavaAttach', () => {
  it('should_echo_executed_command_after_session_reset', async () => {
    // 回显必须在 resetSessionState 之后（之前推会被清空导致 console 不可见）。
    // adapter 不可用时 launchSession 直接抛错 —— 回显先行，不依赖会话建成。
    useDebugStore.setState({ consoleLines: [] });
    await expect(
      useDebugStore
        .getState()
        .startJavaAttach(
          'p1',
          'java -agentlib:jdwp=transport=dt_socket -jar launcher.jar',
          '/tmp/proj',
          'test1',
        ),
    ).rejects.toThrow();
    const texts = useDebugStore.getState().consoleLines.map((l) => l.text);
    expect(texts[0]).toBe('$ java -agentlib:jdwp=transport=dt_socket -jar launcher.jar');
  });
});
