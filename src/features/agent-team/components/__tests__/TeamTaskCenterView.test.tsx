import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskDetail } from '@/shared/types/team';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { invoke } from '@/testing/tauriCore';

import TeamTaskCenterView from '../TeamTaskCenterView';

// 统一复制走 Tauri 插件（useCopyToClipboard 的第一优先通道）—— 在文件顶层 mock
// （vi.mock 会被提升；写在测试体内不生效）。
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(async () => undefined),
}));

/**
 * 任务详情 tab 的**线上载荷契约**。
 *
 * 这个文件的载荷是**手写的电线形状**（不是 `createTaskDetail` 夹具）：
 * 夹具照 TS 类型手写，所以它永远与类型自洽 —— 类型和夹具一起错时，用夹具的测试
 * 全绿而真实窗口白屏。事故正是这一类：后端 `view.rs::TaskDetail` 序列化出
 * `events` / `eventsTruncated`，前端类型读的是 `steps` / `stepsTruncated`，
 * 于是 `detail.steps.length` 在用户点开任务时抛 TypeError。
 *
 * 所以这里**故意**绕过夹具，用 `unknown as TaskDetail` 注入一份「后端实际会发的东西」：
 * 类型说谎时，只有这种测试会红。
 */

const mockInvoke = vi.mocked(invoke);
const mockWriteText = vi.mocked(writeText);

/**
 * 后端 `view.rs::TaskDetail` 的**真实** JSON（`#[serde(rename_all = "camelCase")]`
 * + `TaskCard` 的 `flatten`）。改后端字段名时这里必须一起改 —— 这份字面量就是这个
 * 跨栈契约在前端的唯一锚点。
 */
function wireTaskDetail(): Record<string, unknown> {
  return {
    // --- TaskCard（flatten） ---
    id: 't1',
    teamId: 'tm_1',
    title: '登录页骨架',
    state: 'in_progress',
    owner: 'w1@tm_1',
    // 计划事实（谁该做）—— v24 的列。故意与 owner 叉开：载荷里少这个字段时
    // `assignee` 会退成 `undefined`，任何「只看 owner」的实现都看不出来。
    assignee: 'w2@tm_1',
    workspace: 'shared',
    dependsOn: [],
    claimedAt: 1_700_000_000_000,
    leaseTtl: 1800,
    summary: null,
    summaryTruncated: false,
    artifacts: [],
    reclaimCount: 0,
    // --- TaskDetail 自有字段 ---
    body: '# 派活正文',
    events: [
      {
        at: 1_700_000_100_000,
        kind: 'claim',
        actor: 'w1@tm_1',
        subject: 't1',
        detail: '开始处理',
      },
      {
        at: 1_700_000_200_000,
        kind: 'update',
        actor: 'w1@tm_1',
        subject: 't1',
        detail: null,
      },
    ],
    eventsTruncated: true,
  };
}

const renderView = (): void =>
  render(<TeamTaskCenterView teamId="tm_1" taskId="t1" />, {
    wrapper: createAppProviderWrapper(),
  });

describe('TeamTaskCenterView — 线上载荷', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('按后端 `events` / `eventsTruncated` 渲染步骤轨迹，不炸', async () => {
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === 'team_task_detail' ? (wireTaskDetail() as unknown as TaskDetail) : undefined,
    );
    renderView();

    // 开工文档（markdown 真渲染，标题不带 `#`）
    expect(await screen.findByRole('heading', { name: '派活正文' })).toBeInTheDocument();

    const trace = screen.getByRole('region', { name: 'Activity log' });
    // 每一条审计行都要出现（claim / update 都在，最新在前）
    expect(trace).toHaveTextContent('claim');
    expect(trace).toHaveTextContent('update');
    expect(trace).toHaveTextContent('开始处理');
    // 截断必须说出来（否则「就只有这两条」看起来像事实）
    expect(trace).toHaveTextContent('(showing the latest 2)');
  });

  it('没有步骤时给一句明确的空态，而不是空白轨迹区', async () => {
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === 'team_task_detail'
        ? ({ ...wireTaskDetail(), events: [], eventsTruncated: false } as unknown as TaskDetail)
        : undefined,
    );
    renderView();

    expect(await screen.findByText('No steps recorded yet.')).toBeInTheDocument();
    // 空轨迹不许挂截断提示（永远亮着的提示等于没有提示）
    expect(screen.getByRole('region', { name: 'Activity log' })).not.toHaveTextContent(
      '(showing the latest',
    );
  });

  it('失败：一句可访问的错误，不渲染半截正文', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_task_detail') throw 'boom';
      return undefined;
    });
    renderView();

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('重新读取：再发一次 team_task_detail（错误路径也能重试成功）', async () => {
    let attempt = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd !== 'team_task_detail') return undefined;
      attempt += 1;
      if (attempt === 1) throw 'boom';
      return wireTaskDetail() as unknown as TaskDetail;
    });
    renderView();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload task details' }));

    expect(await screen.findByRole('heading', { name: '派活正文' })).toBeInTheDocument();
    // 重试成功后旧错误必须消失
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('TeamTaskCenterView — 重试动作', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockWriteText.mockClear();
  });

  it('failed 详情头部出现重试；点击发 team_task_retry 并重载本地详情', async () => {
    let detailLoads = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_task_detail') {
        detailLoads += 1;
        // 头部重试按钮只挂在可重试状态上 —— 详情必须是 failed。
        return { ...wireTaskDetail(), state: 'failed' } as unknown as TaskDetail;
      }
      if (cmd === 'team_task_retry') {
        // 回包是重试后的任务行（TeamTask）—— 详情 tab 不消费它，刷新靠重载。
        return { ...wireTaskDetail(), state: 'pending', owner: null } as unknown as TaskDetail;
      }
      return undefined;
    });
    renderView();

    const retryButton = await screen.findByTestId('task-retry');
    fireEvent.click(retryButton);

    expect(mockInvoke).toHaveBeenCalledWith('team_task_retry', {
      teamId: 'tm_1',
      taskId: 't1',
      assignee: null,
    });
    // 详情是自持数据（不进 store）：重试成功后必须 reload 一次，否则界面停在旧状态。
    await waitFor(() => expect(detailLoads).toBe(2));
  });

  it('不可重试（in_progress）详情不渲染重试按钮 —— 不做灰按钮', async () => {
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === 'team_task_detail' ? (wireTaskDetail() as unknown as TaskDetail) : undefined,
    );
    renderView();

    expect(await screen.findByRole('heading', { name: '派活正文' })).toBeInTheDocument();
    expect(screen.queryByTestId('task-retry')).not.toBeInTheDocument();
  });

  it('重试失败：错误可见（role=alert），详情数据不清（失败不清数据）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_task_detail') {
        return { ...wireTaskDetail(), state: 'failed' } as unknown as TaskDetail;
      }
      if (cmd === 'team_task_retry') throw 'task tm_1/t1 is done';
      return undefined;
    });
    renderView();

    fireEvent.click(await screen.findByTestId('task-retry'));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('task tm_1/t1 is done'))).toBe(true);
    // 详情仍可读：被拒的重试不动任何本地状态。
    expect(screen.getByRole('heading', { name: '派活正文' })).toBeInTheDocument();
  });
});

describe('TeamTaskCenterView — 交接改引用制（R6）', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockWriteText.mockClear();
  });

  it('artifacts 渲染路径值，点击复制（引用制：对端按路径读取）', async () => {
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === 'team_task_detail'
        ? ({
            ...wireTaskDetail(),
            artifacts: [
              { kind: 'path', value: '/tmp/team/tm_1/share/report.md' },
              { kind: 'commit', value: 'abc123' },
            ],
          } as unknown as TaskDetail)
        : undefined,
    );
    renderView();

    const chips = await screen.findAllByTestId('artifact-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('/tmp/team/tm_1/share/report.md');
    expect(screen.getByText('abc123')).toBeInTheDocument();
    fireEvent.click(chips[0]);
    await waitFor(() =>
      expect(mockWriteText).toHaveBeenCalledWith('/tmp/team/tm_1/share/report.md'),
    );
  });

  it('summaryTruncated（老数据）给出可见提示', async () => {
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === 'team_task_detail'
        ? ({
            ...wireTaskDetail(),
            summary: '旧的一轮回报（长）',
            summaryTruncated: true,
          } as unknown as TaskDetail)
        : undefined,
    );
    renderView();

    expect(await screen.findByText('(truncated at 4KB)')).toBeInTheDocument();
  });
});
