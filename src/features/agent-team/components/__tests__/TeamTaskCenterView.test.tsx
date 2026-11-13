import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskDetail } from '@/shared/types/team';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { invoke } from '@/testing/tauriCore';

import TeamTaskCenterView from '../TeamTaskCenterView';

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

    const trace = screen.getByRole('region', { name: '步骤轨迹' });
    // 每一条审计行都要出现（claim / update 都在，最新在前）
    expect(trace).toHaveTextContent('claim');
    expect(trace).toHaveTextContent('update');
    expect(trace).toHaveTextContent('开始处理');
    // 截断必须说出来（否则「就只有这两条」看起来像事实）
    expect(trace).toHaveTextContent('（只显示最近 2 条）');
  });

  it('没有步骤时给一句明确的空态，而不是空白轨迹区', async () => {
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === 'team_task_detail'
        ? ({ ...wireTaskDetail(), events: [], eventsTruncated: false } as unknown as TaskDetail)
        : undefined,
    );
    renderView();

    expect(await screen.findByText('还没有步骤记录。')).toBeInTheDocument();
    // 空轨迹不许挂截断提示（永远亮着的提示等于没有提示）
    expect(screen.getByRole('region', { name: '步骤轨迹' })).not.toHaveTextContent('（只显示最近');
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
    fireEvent.click(screen.getByRole('button', { name: '重新读取任务详情' }));

    expect(await screen.findByRole('heading', { name: '派活正文' })).toBeInTheDocument();
    // 重试成功后旧错误必须消失
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
