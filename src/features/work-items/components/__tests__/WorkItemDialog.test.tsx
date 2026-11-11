/**
 * `WorkItemDialog`：新建 / 编辑共用一个表单的两条契约线。
 *
 * 钉住四件事：
 * 1. 标题必填是**就地**校验（不提交、不 toast）；
 * 2. 新建提交带 stage（来自列底部 `+ Add` 的预填）；
 * 3. 编辑态**没有** stage 选择器（`UpdateWorkItemParams` 里没有 `stage`），且字段预填；
 * 4. 清空优先级 / 负责人用空串表达（`''` = 清空，`undefined` = 不改）。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StagePlan, WorkItem } from '../../types';
import WorkItemDialog from '../WorkItemDialog';

const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
  ],
};

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    projectId: 'p1',
    title: '修复登录态过期',
    body: '两步走',
    stage: 'Ready',
    priority: 'p2',
    labels: ['bug', 'auth'],
    assignee: 'tincopper',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

interface Handlers {
  onCreate: ReturnType<typeof vi.fn>;
  onUpdate: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function renderDialog(intent: React.ComponentProps<typeof WorkItemDialog>['intent']): Handlers {
  const handlers: Handlers = {
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <WorkItemDialog
      intent={intent}
      plan={PLAN}
      submitting={false}
      error={null}
      onCreate={handlers.onCreate}
      onUpdate={handlers.onUpdate}
      onClose={handlers.onClose}
    />,
  );
  return handlers;
}

describe('WorkItemDialog — 新建', () => {
  it('标题为空时拦下提交并就地提示', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog({ kind: 'create', stage: 'Backlog' });

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Title is required')).toBeInTheDocument();
  });

  it('提交时带上预填的 stage，空的可选字段落成 undefined', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog({ kind: 'create', stage: 'Ready' });

    await user.type(screen.getByLabelText('Title'), '  重构 认证模块  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      title: '重构 认证模块',
      body: '',
      stage: 'Ready',
      priority: undefined,
      labels: [],
      assignee: undefined,
    });
  });
});

describe('WorkItemDialog — 编辑', () => {
  it('预填当前值，并且**不出现** stage 选择器', async () => {
    const { onUpdate } = renderDialog({ kind: 'edit', item: item() });

    expect(screen.getByLabelText('Title')).toHaveValue('修复登录态过期');
    expect(screen.getByLabelText('Assignee')).toHaveValue('tincopper');
    // 改阶段只能走 StageRail：`UpdateWorkItemParams` 没有 `stage`，所以控件不该出现。
    expect(screen.queryByLabelText('阶段')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("清空优先级与负责人时提交空串（`''` = 清空）", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog({
      kind: 'edit',
      item: item({ assignee: 'tincopper', priority: 'p1' }),
    });

    await user.selectOptions(screen.getByLabelText('Priority'), '');
    await user.clear(screen.getByLabelText('Assignee'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      id: 'wi_1',
      title: '修复登录态过期',
      body: '两步走',
      priority: '',
      labels: ['bug', 'auth'],
      assignee: '',
    });
  });
});
