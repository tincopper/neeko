// @vitest-environment node
/**
 * `workItemsApi` 是 Local provider 的唯一 IPC 入口。
 *
 * 这一层**没有业务逻辑**：断言只钉两件事 —— 命令名（snake_case，跨端契约）
 * 与入参形状（camelCase，Tauri 负责转 snake_case）。任何"该不该允许"的判断
 * 都在 Rust 的 manager 里，在这里重复一遍就会有两份判据。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

import {
  createWorkItem,
  deleteWorkItem,
  getStagePlan,
  listWorkItemRuns,
  listWorkItems,
  recordWorkItemRun,
  transitionWorkItem,
  updateWorkItem,
} from '../workItemsApi';

describe('workItemsApi', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('listWorkItems 只传 projectId', async () => {
    mockInvoke.mockResolvedValue([]);

    await expect(listWorkItems('proj-1')).resolves.toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith('work_item_list', { projectId: 'proj-1' });
  });

  it('getStagePlan 无入参（invoke 只带命令名）', async () => {
    mockInvoke.mockResolvedValue({ stages: [], transitions: [] });

    await getStagePlan();
    expect(mockInvoke).toHaveBeenCalledWith('work_item_stage_plan');
  });

  it('createWorkItem 把可选字段原样下发（缺省不补值）', async () => {
    mockInvoke.mockResolvedValue({ id: 'wi_1' });

    await createWorkItem({ projectId: 'proj-1', title: '修复登录' });

    expect(mockInvoke).toHaveBeenCalledWith('work_item_create', {
      projectId: 'proj-1',
      title: '修复登录',
      body: undefined,
      stage: undefined,
      priority: undefined,
      labels: undefined,
      assignee: undefined,
    });
  });

  it('createWorkItem 传满字段时一个不丢', async () => {
    mockInvoke.mockResolvedValue({ id: 'wi_1' });

    await createWorkItem({
      projectId: 'proj-1',
      title: 't',
      body: 'b',
      stage: 'Ready',
      priority: 'p1',
      labels: ['ui', 'bug'],
      assignee: 'me',
    });

    expect(mockInvoke).toHaveBeenCalledWith('work_item_create', {
      projectId: 'proj-1',
      title: 't',
      body: 'b',
      stage: 'Ready',
      priority: 'p1',
      labels: ['ui', 'bug'],
      assignee: 'me',
    });
  });

  it('updateWorkItem 不含 stage（改名/改字段不能绕过流转校验）', async () => {
    mockInvoke.mockResolvedValue({ id: 'wi_1' });

    await updateWorkItem({ id: 'wi_1', title: '新标题' });

    const [, payload] = mockInvoke.mock.calls[0];
    expect(mockInvoke.mock.calls[0][0]).toBe('work_item_update');
    expect(payload).toEqual({
      id: 'wi_1',
      title: '新标题',
      body: undefined,
      priority: undefined,
      labels: undefined,
      assignee: undefined,
    });
    expect(Object.keys(payload as object)).not.toContain('stage');
  });

  it('updateWorkItem 用空串表达「清空」（后端约定：None = 不改，空值 = 清空）', async () => {
    mockInvoke.mockResolvedValue({ id: 'wi_1' });

    await updateWorkItem({ id: 'wi_1', priority: '', assignee: '', labels: [] });

    expect(mockInvoke).toHaveBeenCalledWith('work_item_update', {
      id: 'wi_1',
      title: undefined,
      body: undefined,
      priority: '',
      labels: [],
      assignee: '',
    });
  });

  it('transitionWorkItem 用 `to` 而不是 stage', async () => {
    mockInvoke.mockResolvedValue({ id: 'wi_1' });

    await transitionWorkItem('wi_1', 'Review');
    expect(mockInvoke).toHaveBeenCalledWith('work_item_transition', { id: 'wi_1', to: 'Review' });
  });

  it('deleteWorkItem 返回 void', async () => {
    await deleteWorkItem('wi_1');
    expect(mockInvoke).toHaveBeenCalledWith('work_item_delete', { id: 'wi_1' });
  });

  it('listWorkItemRuns 按 workItemId 拉执行记录', async () => {
    mockInvoke.mockResolvedValue([]);

    await listWorkItemRuns('wi_1');
    expect(mockInvoke).toHaveBeenCalledWith('work_item_run_list', { workItemId: 'wi_1' });
  });

  it('recordWorkItemRun 用 `runState` 而不是 `state`（后者被 Tauri 的 State 占着）', async () => {
    mockInvoke.mockResolvedValue({ id: 'run_1' });

    await recordWorkItemRun({
      workItemId: 'wi_1',
      mode: 'single',
      refKind: 'session',
      refId: 'tab_1',
      runState: 'running',
      label: 'OpenCode',
    });

    const [command, payload] = mockInvoke.mock.calls[0];
    expect(command).toBe('work_item_run_record');
    expect(payload).toEqual({
      workItemId: 'wi_1',
      mode: 'single',
      refKind: 'session',
      refId: 'tab_1',
      refSub: undefined,
      runState: 'running',
      label: 'OpenCode',
    });
    // 线上键里**没有** `state`：它会被 Rust 侧的 `tauri::State` 吃掉，执行状态就永远不在。
    expect(Object.keys(payload as object)).not.toContain('state');
  });
});
