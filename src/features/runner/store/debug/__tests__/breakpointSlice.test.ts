// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/shared/store/notificationStore';

import type * as DebugApi from '../../../api/debugApi';
import type { BreakpointSpec } from '../../../types';
import { useDebugStore } from '../../debugStore';
import { mergeBreakpointEntries } from '../breakpointSlice';

const dapSetBreakpoints = vi.hoisted(() => vi.fn());
const dapGetBreakpoints = vi.hoisted(() => vi.fn());
const dapSetBreakpointsMuted = vi.hoisted(() => vi.fn());
const dapGetBreakpointsMuted = vi.hoisted(() => vi.fn());

vi.mock('../../../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugApi>()),
  dapSetBreakpoints,
  dapGetBreakpoints,
  dapSetBreakpointsMuted,
  dapGetBreakpointsMuted,
}));

beforeEach(() => {
  vi.clearAllMocks();
  dapSetBreakpoints.mockResolvedValue([]);
  dapSetBreakpointsMuted.mockResolvedValue(undefined);
  useDebugStore.setState({
    breakpoints: {},
    breakpointsMuted: {},
    session: null,
    error: null,
  });
});

function fileEntries(projectId: string, filePath: string) {
  return useDebugStore.getState().breakpoints[projectId]?.[filePath] ?? [];
}

function echo(...specs: Partial<BreakpointSpec>[]): BreakpointSpec[] {
  return specs.map((s) => ({
    filePath: '/proj/a.go',
    line: 0,
    verified: false,
    enabled: true,
    ...s,
  }));
}

describe('breakpointSlice.toggleBreakpoint', () => {
  it('新断点 entry 默认 enabled', async () => {
    dapSetBreakpoints.mockResolvedValue(echo({ line: 10, verified: true }));
    await useDebugStore.getState().toggleBreakpoint('p1', '/proj/a.go', 10);

    expect(fileEntries('p1', '/proj/a.go')).toEqual([{ line: 10, enabled: true }]);
    // 下发的是全文件 entries（含 enabled），后端按 effective 过滤。
    expect(dapSetBreakpoints).toHaveBeenCalledWith(
      'p1',
      '/proj/a.go',
      [{ line: 10, enabled: true }],
      null,
    );
  });

  it('存在性 toggle：已有行 → 删除', async () => {
    useDebugStore.setState({
      breakpoints: { p1: { '/proj/a.go': [{ line: 10, enabled: true }] } },
    });
    dapSetBreakpoints.mockResolvedValue([]);

    await useDebugStore.getState().toggleBreakpoint('p1', '/proj/a.go', 10);
    expect(useDebugStore.getState().breakpoints.p1?.['/proj/a.go'] ?? []).toEqual([]);
  });
});

describe('breakpointSlice.setBreakpointEnabled', () => {
  it('缺行 no-op：不改状态、不下发', async () => {
    await useDebugStore.getState().setBreakpointEnabled('p1', '/proj/a.go', 99, false);
    expect(dapSetBreakpoints).not.toHaveBeenCalled();
    expect(useDebugStore.getState().breakpoints).toEqual({});
  });

  it('乐观改单个位 + 回填 verified（remap 不丢 enabled）', async () => {
    useDebugStore.setState({
      breakpoints: {
        p1: {
          '/proj/a.go': [
            { line: 10, enabled: true },
            { line: 20, enabled: false },
          ],
        },
      },
    });
    // 启用 20 → 有效行 [10,20]；适配器把 20 重映射到 21（verified）→ 21 继承 enabled（remap 不丢）。
    dapSetBreakpoints.mockResolvedValue([
      { filePath: '/proj/a.go', line: 10, verified: true, enabled: true },
      { filePath: '/proj/a.go', line: 21, verified: true, enabled: true },
    ]);

    await useDebugStore.getState().setBreakpointEnabled('p1', '/proj/a.go', 20, true);

    const entries = fileEntries('p1', '/proj/a.go');
    expect(entries).toEqual([
      { line: 10, enabled: true },
      { line: 21, enabled: true },
    ]);
  });

  it('失败回滚 + notify（评审 P7）', async () => {
    useDebugStore.setState({
      breakpoints: { p1: { '/proj/a.go': [{ line: 10, enabled: true }] } },
    });
    const notify = vi.spyOn(useNotificationStore.getState(), 'addNotification');
    dapSetBreakpoints.mockRejectedValue(new Error('backend down'));

    await useDebugStore.getState().setBreakpointEnabled('p1', '/proj/a.go', 10, false);

    // 回滚到启用态
    expect(fileEntries('p1', '/proj/a.go')).toEqual([{ line: 10, enabled: true }]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    notify.mockRestore();
  });
});

describe('mergeBreakpointEntries（评审 P2 冲突策略）', () => {
  it('同行为一 entry；适配器确认行 enabled 优先（remap 落相邻行）', () => {
    // 42 enabled、43 disabled；适配器把 42 重映射到 43 → 43 变一个 enabled entry。
    const sent = [
      { line: 42, enabled: true },
      { line: 43, enabled: false },
    ];
    const returned = [{ filePath: '/p', line: 43, verified: true, enabled: true }];
    expect(mergeBreakpointEntries(sent, returned)).toEqual([{ line: 43, enabled: true }]);
  });

  it('offline 回显（verified=false）沿用 UI 的 enabled 位', () => {
    const sent = [
      { line: 10, enabled: true },
      { line: 20, enabled: false },
    ];
    const returned = [
      { filePath: '/p', line: 10, verified: false, enabled: true },
      { filePath: '/p', line: 20, verified: false, enabled: true },
    ];
    expect(mergeBreakpointEntries(sent, returned)).toEqual([
      { line: 10, enabled: true },
      { line: 20, enabled: false },
    ]);
  });

  it('live 部分确认：verified=false 的 enabled 行保留在模型（未确认 ≠ 删除）', () => {
    // 适配器确认了 10、但 20 暂未确认（如所在文件尚未加载）——20 必须留在模型，
    // 否则下一次下发会把 20 从磁盘上也删掉。
    const sent = [
      { line: 10, enabled: true },
      { line: 20, enabled: true },
    ];
    const returned = [
      { filePath: '/p', line: 10, verified: true, enabled: true },
      { filePath: '/p', line: 20, verified: false, enabled: true },
    ];
    expect(mergeBreakpointEntries(sent, returned)).toEqual([
      { line: 10, enabled: true },
      { line: 20, enabled: true },
    ]);
  });

  it('live 全未确认：disabled 行不被回显吞掉（回显只含 effective 行）', () => {
    // 实时路径的回显只覆盖下发过的有效行（enabled && !muted），disabled 行不在其中；
    // 模型必须保留 15（disabled），不能按回显行重建而丢掉它。
    const sent = [
      { line: 10, enabled: true },
      { line: 15, enabled: false },
      { line: 20, enabled: true },
    ];
    const returned = [
      { filePath: '/p', line: 10, verified: false, enabled: true },
      { filePath: '/p', line: 20, verified: false, enabled: true },
    ];
    expect(mergeBreakpointEntries(sent, returned)).toEqual([
      { line: 10, enabled: true },
      { line: 15, enabled: false },
      { line: 20, enabled: true },
    ]);
  });
});

describe('breakpointSlice.setBreakpointsMuted', () => {
  it('乐观置位 + 调后端 + entries 不动（叠加态）', async () => {
    useDebugStore.setState({
      breakpoints: { p1: { '/proj/a.go': [{ line: 10, enabled: true }] } },
    });
    await useDebugStore.getState().setBreakpointsMuted('p1', true);

    expect(useDebugStore.getState().breakpointsMuted.p1).toBe(true);
    expect(dapSetBreakpointsMuted).toHaveBeenCalledWith('p1', true);
    // 单个 enabled 位原样保留
    expect(fileEntries('p1', '/proj/a.go')).toEqual([{ line: 10, enabled: true }]);
  });

  it('失败回滚（评审 P7）', async () => {
    const notify = vi.spyOn(useNotificationStore.getState(), 'addNotification');
    dapSetBreakpointsMuted.mockRejectedValueOnce(new Error('backend down'));

    await useDebugStore.getState().setBreakpointsMuted('p1', true);

    expect(useDebugStore.getState().breakpointsMuted.p1 ?? false).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    notify.mockRestore();
  });

  it('同值短路：不重复调用后端', async () => {
    useDebugStore.setState({ breakpointsMuted: { p1: true } });
    await useDebugStore.getState().setBreakpointsMuted('p1', true);
    expect(dapSetBreakpointsMuted).not.toHaveBeenCalled();
  });
});

describe('breakpointSlice.loadBreakpoints', () => {
  it('磁盘为真相：列表 + muted 同取', async () => {
    dapGetBreakpoints.mockResolvedValue([
      { filePath: '/proj/a.go', line: 10, verified: false, enabled: true },
      { filePath: '/proj/a.go', line: 20, verified: true, enabled: false },
    ]);
    dapGetBreakpointsMuted.mockResolvedValue(true);

    await useDebugStore.getState().loadBreakpoints('p1');

    expect(fileEntries('p1', '/proj/a.go')).toEqual([
      { line: 10, enabled: true },
      { line: 20, enabled: false },
    ]);
    expect(useDebugStore.getState().breakpointsMuted.p1).toBe(true);
    expect(dapGetBreakpointsMuted).toHaveBeenCalledWith('p1');
  });
});
