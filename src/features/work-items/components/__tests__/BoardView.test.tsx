/**
 * `BoardView`：列来自 `plan.stages`（不是写死的五列）、卡片按 store 顺序落列、列头计数、`plan=null` 不画列。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StagePlan, WorkItem } from '../../types';
import { toLocalTask, type TaskItem } from '../../viewModel';
import BoardView from '../BoardView';

/** 自定义 3 阶段：列必须跟着 plan 变（写死 Backlog…Done 会让卡片凭空消失）。 */
const PLAN: StagePlan = {
  stages: ['Todo', 'Doing', 'Done'],
  transitions: [
    { from: 'Todo', to: 'Doing' },
    { from: 'Doing', to: 'Todo' },
    { from: 'Doing', to: 'Done' },
    { from: 'Done', to: 'Doing' },
  ],
};

function item(id: string, stage: string, overrides: Partial<WorkItem> = {}): TaskItem {
  return toLocalTask({
    id,
    projectId: 'p1',
    title: `工作项 ${id}`,
    body: '',
    stage,
    priority: null,
    labels: [],
    assignee: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

/**
 * store 给的顺序（`updatedAt DESC`）：`wi_3` 最新，其次 `wi_2`、`wi_1`。
 * 渲染层不得重排，所以列内顺序必须与这个数组一致。
 */
const ITEMS: TaskItem[] = [item('wi_3', 'Todo'), item('wi_2', 'Doing'), item('wi_1', 'Todo')];

describe('BoardView — 列来自 plan', () => {
  it('按 plan.stages 画列，而不是写死五列', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    expect(screen.getAllByRole('region', { name: / column$/ })).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Todo column' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Doing column' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Done column' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Backlog column' })).not.toBeInTheDocument();
  });

  it('卡片落在自己的 stage 列里，且保持 store 顺序', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    const todo = screen.getByRole('region', { name: 'Todo column' });
    const cards = within(todo).getAllByRole('button', { name: /Open work item/ });
    expect(cards.map((card) => card.getAttribute('data-work-item-id'))).toEqual(['wi_3', 'wi_1']);

    const doing = screen.getByRole('region', { name: 'Doing column' });
    expect(
      within(doing)
        .getAllByRole('button', { name: /Open work item/ })
        .map((c) => c.dataset.workItemId),
    ).toEqual(['wi_2']);

    // 空列：占位文字，不是「一条都没有却什么都不说"。
    expect(
      within(screen.getByRole('region', { name: 'Done column' })).getByText('No items'),
    ).toBeInTheDocument();
  });

  it('列头显示 stage + 该列数量', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Todo stage, 2 items' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Doing stage, 1 items' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Done stage, 0 items' })).toBeInTheDocument();
  });

  it('列可伸展（flex-1 basis-0）而不是固定 168px', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    const columns = screen.getAllByRole('region', { name: / column$/ });
    expect(columns).toHaveLength(PLAN.stages.length);
    for (const column of columns) {
      // 宽度必须由容器决定：固定宽 + shrink-0 在中心全宽视图里会把右边空出一大片
      expect(column).toHaveClass('flex-1', 'basis-0', 'min-w-[168px]');
      // 不再写死像素宽（下限由 min-w 承担：窄窗口靠外层横滚，不靠压列）
      expect(column).not.toHaveClass('w-[168px]');
      expect(column).not.toHaveClass('shrink-0');
    }
  });

  it('看板容器的横向溢出仍然保留（列多 / 窗口窄时可横滚）', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    expect(screen.getByRole('group', { name: 'Work items board' })).toHaveClass('overflow-x-auto');
  });
});

describe('BoardView — 岛屿布局（design §4.2b）', () => {
  /**
   * column是**主岛内的分区**，不是独立的岛（2026-11-03 修订）。
   *
   * 曾经每列 `ISLAND_CLASS`（圆角 + 阴影 + 二级底），看板因此看起来是「一排浮岛漂在海面上"；
   * 而 Library 的正确形态是**一座主岛**（岛内 toolbar + content）。用户反馈的原话是
   * 「中间应该像这样有一层岛屿作为内容的承载，而不是直接内容在海里面"。
   */
  /**
   * column是**圆角块**（2026-11-03 二次裁决，用户看过参考图后确认）。
   *
   * 上一版把它判成「没有圆角/阴影的分区"—— 那是在否决「列套 `ISLAND_CLASS`"
   * （`rounded-lg shadow-sm bg-bg-secondary`，看板会变成「一排浮岛漂在海面上"）。
   * 但参考图的列是**中间态**：圆角 + 可见空隙 + 略深的表面，**没有阴影**。
   * 这个中间态 spec 当时没考虑过，视觉上确实更好（列与列之间有呼吸）。
   *
   * 所以判据拆成三条独立特征，缺一条都不对：
   *
   * | 特征 | column | 理由 |
   * | --- | --- | --- |
   * | 圆角 | ✅ `rounded-lg` | 与参考图一致，列是有边界的块 |
   * | 阴影 | ❌ | 有阴影 = 浮岛（被否决的那个形态） |
   * | 底色 | `bg-bg-tertiary` | **底层 token 不变**（用户明确要求） |
   */
  it('列是圆角块：有圆角、无阴影、底色仍是 tertiary（底层不变）', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    const columns = screen.getAllByRole('region', { name: / column$/ });
    expect(columns.length).toBeGreaterThan(1);

    for (const column of columns) {
      const tokens = new Set(column.className.split(/\s+/));
      // 圆角：是块，不是紧贴的分区条
      expect(tokens).toContain('rounded-lg');
      // 阴影：有它就是浮岛（被否决的形态）
      expect(tokens).not.toContain('shadow-sm');
      expect(tokens).not.toContain('shadow-md');
      // 底色：底层 token **不变**（用户要求）
      expect(tokens).toContain('bg-bg-tertiary');
      expect(tokens).not.toContain('bg-bg-secondary');
    }
  });

  /**
   * column间距改为 `ISLAND_GAP_CLASS`（6px），因为列现在是**圆角块**。
   *
   * `gap-px` 是**分栏**的几何（两侧各贴一条 `ResizableHandle`，三者相加才是 3px）。
   * 圆角块之间只留 1px，`rounded-lg` 的弧线在 1px 缝里读起来是「表格线"而不是
   * 「两块浮起来的块"—— `islands.ts` 对这条有明文说明。
   */
  it('列间距走 ISLAND_GAP_CLASS（6px）：圆角块之间需要可见空隙', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    const board = screen.getByRole('group', { name: 'Work items board' });
    const tokens = new Set(board.className.split(/\s+/));

    expect(tokens).toContain('gap-1.5');
    expect(tokens).not.toContain('gap-px');
    expect(tokens).not.toContain('gap-2');
  });

  /**
   * 卡片**必须与它所在的列不同表面**（2026-11-03 修正，上一版写反了）。
   *
   * 上一版断言「卡片用 `bg-bg-tertiary`，不是 `bg-bg-primary`"—— 而列本身就是
   * `bg-bg-tertiary`，于是卡片与列**同色**，在五个主题里对比度恒为 1.00：卡片看起来
   * 不是「浮在列里"，而是「列被画了个方框"。用户的原话是「UI 和整个应用主题不适配"。
   *
   * 全仓惯例是岛内卡片用 `bg-bg-primary`（`ui/Card` / `PromptCard` / `TaskCardRow` /
   * `MemberApprovalQueue` 的行都是）。`bg-bg-primary` 在这里**不是**「海面"——
   * 它已经不在岛与海的边界上，而是「分区内再一层控件面"。
   *
   * 判据因此是「与列不同"，而不是「等于某个 token"。数值侧（跨主题对比度 ≥1.05）
   * 由 `__tests__/surfaceContrast.test.ts` 钉住。
   */
  it('卡片与所在列是**不同表面**（同色会让卡片消失）', () => {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    const card = screen.getByRole('button', { name: 'Open work item 工作项 wi_3' });
    // 卡片所在的列由 `data-work-item-id` 反查，不写死列名 —— 夹具的阶段集改名时这条用例不该跟着红。
    const column = screen
      .getAllByRole('region', { name: / column$/ })
      .find((section) => section.contains(card));
    expect(column).toBeDefined();

    // 正判据：卡片的底色与列**不共享同一个 token**
    const columnSurface = ['bg-bg-primary', 'bg-bg-secondary', 'bg-bg-tertiary'].find((token) =>
      column.classList.contains(token),
    );
    expect(columnSurface).toBe('bg-bg-tertiary');

    const cardSurfaces = ['bg-bg-primary', 'bg-bg-secondary', 'bg-bg-tertiary'].filter((token) =>
      card.classList.contains(token),
    );
    // 恰好一个表面 token（两个就是自相矛盾的样式）
    expect(cardSurfaces).toHaveLength(1);
    // 且不是列的那一个
    expect(cardSurfaces[0]).not.toBe(columnSurface);
    // 边框仍然要：卡片靠「描边 + 不同底"两重标识
    expect(card).toHaveClass('border', 'border-border');
  });
});

describe('BoardView — 没有阶段轨', () => {
  it('plan 为 null 时不画任何列，只显示占位', () => {
    render(
      <BoardView plan={null} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );

    expect(screen.queryAllByRole('region', { name: / column$/ })).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Stages unavailable');
  });

  it('plan 还在拉时占位文案说「加载中」（不谎报不可用）', () => {
    render(<BoardView plan={null} planLoading items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading stages…');
  });
});

describe('BoardView — 阶段不在阶段轨里的工作项', () => {
  it('不猜位置，而是报告条数', () => {
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={[item('wi_9', 'Archived')]}
        onOpen={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText('1 item(s) have a stage outside the stage plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open work item/ })).not.toBeInTheDocument();
  });
});

describe('BoardView — 右键 Move to 透传到宿主（design §11.5 方式三）', () => {
  it('卡片右键选中的 stage 带着该卡片 id 交给宿主（Board → Column → Card 的接线）', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={[item('wi_2', 'Doing')]}
        onOpen={vi.fn()}
        onMove={onMove}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open work item 工作项 wi_2' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Done' }));

    expect(onMove).toHaveBeenCalledWith('wi_2', 'Done');
  });
});

describe('BoardView — 列内的呼吸感（2026-11-03）', () => {
  /**
   * 用户反馈：「内容卡片可以采用岛屿的方式进行展示，带一点呼吸感……还是不够美观"。
   *
   * 卡片本身已改成「岛同源几何"（圆角 8px + `shadow-sm` + 描边，内距 10/8px）。
   * 但列头与列底按钮仍是 `py-1`（4px）+ `text-micro`（10px）—— 整列读起来还是「表格"：
   * 上下两条薄横条夹着一堆卡片，没有松紧对比。
   *
   * 全仓参照：`PromptCard` 用 `p-3`（12px），`TeamTaskBoard` 的列内用 `gap-1.5`。
   * column头/列底是「列的框架"，取 6px（`py-1.5`）—— 比卡片内距略紧，比原来的 4px 松。
   */
  function renderBoard() {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );
  }

  it('列头纵向内距 ≥ 6px（原 `py-1` = 4px 太薄）', () => {
    renderBoard();
    // 多列都有列头 —— 取全部逐条验，不只看第一列（否则「只改了一列"也会绿）
    const headers = screen.getAllByRole('heading', { name: / stage, \d+ items/ });
    expect(headers.length).toBeGreaterThan(1);

    for (const header of headers) {
      const tokens = new Set(header.className.split(/\s+/));
      expect(tokens).not.toContain('py-1');
      expect(tokens).toContain('py-1.5');
    }
  });

  /**
   * column底**没有** `+ Add`（2026-11-03 三次，用户明确要求去掉）。
   *
   * 它原本是「用该 stage 预填创建对话框」的捷径，但：
   *
   * 1. 工具栏已有「新建」，两处入口做同一件事，而列底那个还多带一个隐式 stage 参数；
   * 2. 它固定在列的最底部，列内一滚动就跟着滚走 —— 是个**会消失**的按钮；
   * 3. 每列一个，5 列就是 5 个同样的横条，把列底切成「内容 + 一条按钮」两段。
   *
   * # 判据为什么不能是「按某个名字查不到」
   *
   * 首版写的是 `queryByRole('button', { name: /新建工作项/ })` —— 那**恒真**：
   * 一个名字叫 `Add task` / `+` / 任意其它写法的创建按钮都能通过。而这一轮的文字已改成
   * 英文，「新建工作项」这个名字在界面上根本不存在。
   * 把按钮加回来（`aria-label="Add task"`）实测首版仍然 17 条全绿 —— 即零判别力。
   *
   * 正确的判据是**结构**的：列里只允许出现卡片（`data-work-item-id` 的 button）与
   * 空态占位。任何**别的** button 都是多出来的入口，不管它叫什么名字。
   */
  it('列底没有 `+ Add`（列里除了卡片没有任何其它按钮）', () => {
    renderBoard();

    const columns = screen.getAllByRole('region', { name: / column$/ });
    expect(columns.length).toBeGreaterThan(1);

    for (const column of columns) {
      // `queryAllByRole` 而不是 `getAllByRole`：空列（"No items"）本来就没有按钮
      const buttons = within(column).queryAllByRole('button');
      for (const button of buttons) {
        // 列内唯一合法的按钮是卡片本身（`WorkItemCard` 的根是个 button）
        expect(button).toHaveAttribute('data-work-item-id');
      }
    }
  });

  it('卡片之间 6px、列内四周 6px（不是 4px 紧贴）', () => {
    renderBoard();
    const lists = screen.getAllByRole('list');
    expect(lists.length).toBeGreaterThan(1);

    for (const list of lists) {
      const tokens = new Set(list.className.split(/\s+/));
      // 卡间距：`gap-1`（4px）太紧 → `gap-1.5`（6px）
      expect(tokens).not.toContain('gap-1');
      expect(tokens).toContain('gap-1.5');
      // 内缩：`p-1`（4px）→ `p-1.5`（6px）
      expect(tokens).not.toContain('p-1');
      expect(tokens).toContain('p-1.5');
    }
  });
});

describe('BoardView — 列头：圆点 + 数字 pill（参考图 2026-11-03）', () => {
  /**
   * 参考图的列头是「● 待开始 10"：一个阶段圆点 + 名字 + 一枚数字 pill。
   *
   * 三个元素各有分工，缺一个都会退化成「一行纯文本"：
   *
   * | 元素 | 作用 |
   * | --- | --- |
   * | 圆点 | 扫视锚点（列头是一行小字，纯文字扫起来很慢） |
   * | 名字 | 主信息 |
   * | 数字 pill | 与名字**视觉分离**：数字是元数据，同字号同行读起来像名字的一部分 |
   *
   * 圆点**不用语义色**（红黄绿）：阶段不是严重度，引入色板会让用户以为「红的列有问题"。
   * 用 `bg-text-muted` 的中性点，靠形状而不靠颜色区分。
   */
  function renderBoard() {
    render(
      <BoardView plan={PLAN} planLoading={false} items={ITEMS} onOpen={vi.fn()} onMove={vi.fn()} />,
    );
  }

  it('列头有阶段圆点（中性色，不用语义色）', () => {
    renderBoard();
    const headers = screen.getAllByRole('heading', { name: / stage, \d+ items/ });
    expect(headers.length).toBeGreaterThan(1);

    for (const header of headers) {
      const dot = within(header).getByTestId('board-column-dot');
      const tokens = new Set(dot.className.split(/\s+/));

      // 中性色：阶段不是严重度，红黄绿会让用户以为「红的列有问题"
      expect(tokens).toContain('bg-text-muted');
      for (const semantic of ['bg-accent-red', 'bg-accent-yellow', 'bg-accent-green']) {
        expect(tokens).not.toContain(semantic);
      }
      // 是个圆点（圆 + 小尺寸），不是方块
      expect(tokens).toContain('rounded-full');
    }
  });

  it('数字是独立 pill（与名字视觉分离），且不在读屏名称里', () => {
    renderBoard();
    const headers = screen.getAllByRole('heading', { name: / stage, \d+ items/ });
    expect(headers.length).toBeGreaterThan(1);

    for (const header of headers) {
      const count = within(header).getByTestId('board-column-count');
      const tokens = new Set(count.className.split(/\s+/));

      // pill：背景 + 圆角 + 内距 —— 纯文本数字与名字同排会读成名字的一部分
      expect(tokens).toContain('rounded-full');
      expect(tokens).toContain('bg-bg-secondary');
      // 数量已经进了列头的 `aria-label`（「共 N items"），pill 本身对读屏是重复信息
      expect(count).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
