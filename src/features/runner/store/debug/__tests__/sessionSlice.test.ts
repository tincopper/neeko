// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DebugApi from '../../../api/debugApi';
import type { DapSessionInfo, LaunchConfig } from '../../../types';
import { useDebugStore } from '../../debugStore';

const dapCheckAdapter = vi.hoisted(() => vi.fn());
const dapStartSession = vi.hoisted(() => vi.fn());
const dapStartSessionConfig = vi.hoisted(() => vi.fn());
const dapStopSession = vi.hoisted(() => vi.fn());
const dapStackTrace = vi.hoisted(() => vi.fn());

vi.mock('../../../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugApi>()),
  dapCheckAdapter,
  dapStartSession,
  dapStartSessionConfig,
  dapStopSession,
  dapStackTrace,
}));

function sessionFor(projectId: string, status = 'running'): DapSessionInfo {
  return {
    sessionId: 's1',
    projectId,
    projectPath: '/proj',
    configName: 'cfg',
    status,
  };
}

const CFG: LaunchConfig = {
  name: 'cfg',
  type: 'lldb',
  request: 'launch',
  program: '/proj/main.go',
  cwd: '${workspaceFolder}',
  args: [],
  mode: null,
  preLaunchTask: null,
  stopOnEntry: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  dapCheckAdapter.mockResolvedValue(true);
  dapStartSession.mockResolvedValue(sessionFor('p1'));
  dapStartSessionConfig.mockResolvedValue(sessionFor('p1'));
  dapStackTrace.mockResolvedValue([]);
  useDebugStore.setState({
    session: null,
    lastLaunch: null,
    isLaunching: false,
    configs: [CFG],
    selectedConfigName: 'cfg',
    error: null,
    consoleLines: [],
  });
});

describe('sessionSlice.lastLaunch（D6：只增不丢）', () => {
  it('start 成功 → 记录 intent（label + 快照 config）', async () => {
    await useDebugStore.getState().start('p1');
    const intent = useDebugStore.getState().lastLaunch;
    expect(intent?.projectId).toBe('p1');
    expect(intent?.label).toBe('cfg');
    // 重放 = 再走 startWithConfig（通用层零语言字面量）
    await intent!.replay();
    expect(dapStartSessionConfig).toHaveBeenCalled();
  });

  it('失败启动不覆盖既有 intent', async () => {
    dapStartSession.mockRejectedValue(new Error('boom'));
    useDebugStore.setState({
      lastLaunch: { projectId: 'p1', label: 'old', replay: vi.fn() },
    });

    await expect(useDebugStore.getState().start('p1')).rejects.toThrow();
    expect(useDebugStore.getState().lastLaunch?.label).toBe('old');
  });

  it('reset / stop / terminated 不清 intent（终止后重跑是主场景）', async () => {
    useDebugStore.setState({
      lastLaunch: { projectId: 'p1', label: 'cfg', replay: vi.fn() },
      session: sessionFor('p1'),
    });
    useDebugStore.getState().resetSession();
    expect(useDebugStore.getState().lastLaunch?.label).toBe('cfg');

    await useDebugStore.getState().stop();
    expect(useDebugStore.getState().lastLaunch?.label).toBe('cfg');
  });
});

describe('sessionSlice.rerun', () => {
  it('同项目 → 重放意图（新会话）', async () => {
    await useDebugStore.getState().start('p1');
    await useDebugStore.getState().rerun('p1');
    // 重放走了 startWithConfig 链 → dapStartSessionConfig
    expect(dapStartSessionConfig).toHaveBeenCalledTimes(1);
    // isLaunching 互斥位复位
    expect(useDebugStore.getState().isLaunching).toBe(false);
  });

  it('集成（A5）：停住 → Rerun → 新 sessionId、同配置重起', async () => {
    dapStartSession.mockResolvedValue({
      ...sessionFor('p1'),
      sessionId: 's1',
      status: 'stopped',
    });
    await useDebugStore.getState().start('p1');
    expect(useDebugStore.getState().session?.sessionId).toBe('s1');

    dapStartSessionConfig.mockResolvedValue({
      ...sessionFor('p1'),
      sessionId: 's2',
      status: 'stopped',
    });
    await useDebugStore.getState().rerun('p1');

    const s = useDebugStore.getState().session;
    expect(s?.sessionId).toBe('s2');
    expect(s?.configName).toBe('cfg');
    // 同断点再停：replay 后的 stopped 状态照常回填栈（refreshStackAndVars 已随停住触发）。
    expect(dapStackTrace).toHaveBeenCalled();
  });

  it('跨项目拒绝（对齐 #14/I7）', async () => {
    const replay = vi.fn();
    useDebugStore.setState({
      lastLaunch: { projectId: 'p1', label: 'cfg', replay },
    });
    await useDebugStore.getState().rerun('p2');
    expect(replay).not.toHaveBeenCalled();
  });

  it('无 intent → no-op', async () => {
    await useDebugStore.getState().rerun('p1');
    expect(dapStartSessionConfig).not.toHaveBeenCalled();
  });

  it('isLaunching 期间 no-op（防 start×rerun 并发双链，评审 P3）', async () => {
    const replay = vi.fn();
    useDebugStore.setState({
      lastLaunch: { projectId: 'p1', label: 'cfg', replay },
      isLaunching: true,
    });
    await useDebugStore.getState().rerun('p1');
    expect(replay).not.toHaveBeenCalled();
  });
});

describe('sessionSlice.attach 会话的 rerun（评审 P4）', () => {
  it('attach 后 Rerun = 重放上次 launch 意图（不重放 attach）', async () => {
    // 上次 launch 成功登记 intent
    await useDebugStore.getState().start('p1');
    dapStartSessionConfig.mockClear();
    // 随后进入 attach 会话（attachSession 不登记 intent）
    useDebugStore.getState().attachSession(sessionFor('p1', 'stopped'));

    await useDebugStore.getState().rerun('p1');
    // 重放的是 launch 链（startWithConfig → dapStartSessionConfig），而非 attach 链。
    expect(dapStartSessionConfig).toHaveBeenCalledTimes(1);
  });
});

describe('sessionSlice.isLaunching 覆盖全部启动入口（评审 P3）', () => {
  it('startWithConfig 期间置互斥位、完成复位', async () => {
    let resolveStart!: (s: DapSessionInfo) => void;
    dapStartSessionConfig.mockReturnValue(
      new Promise<DapSessionInfo>((r) => {
        resolveStart = r;
      }),
    );
    const pending = useDebugStore.getState().startWithConfig('p1', CFG);
    expect(useDebugStore.getState().isLaunching).toBe(true);
    resolveStart(sessionFor('p1'));
    await pending;
    expect(useDebugStore.getState().isLaunching).toBe(false);
  });

  it('start 在 isLaunching 期间 no-op（不发启动链，不清在途会话状态）', async () => {
    useDebugStore.setState({ isLaunching: true });
    await useDebugStore.getState().start('p1');
    expect(dapStartSession).not.toHaveBeenCalled();
    expect(useDebugStore.getState().isLaunching).toBe(true);
  });

  it('startWithConfig 在 isLaunching 期间 no-op', async () => {
    useDebugStore.setState({ isLaunching: true });
    await useDebugStore.getState().startWithConfig('p1', CFG);
    expect(dapStartSessionConfig).not.toHaveBeenCalled();
  });
});
