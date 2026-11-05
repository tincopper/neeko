/**
 * `WorkItemCard`：右键 [Move to] 菜单（design §11.5 方式三）。
 *
 * 只钉三件事，因为可达性判据本身住在 `utils/stageRail.ts`（并由它的单测钉满）：
 * 1. 菜单里**只有**可直接流转的 stage（current / locked 不出现）；
 * 2. 选中一条 → `onMove(id, stage)`（宿主负责 `transition` + 失败 toast）；
 * 3. 没有可流转目标时仍然弹一条置灰说明 —— 右键被接管却什么都不弹，用户只会以为菜单坏了。
 *
 * 这里**不做拖拽**（HTML5 `dataTransfer` 在 jsdom 里不可靠，会产出脆弱测试）：
 * design §4.5 已把拖拽标为「未来支持"，§11.5 只是把三种入口并列。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StagePlan, WorkItem } from '../../types';
import { toLocalTask, type TaskItem } from '../../viewModel';
import WorkItemCard from '../WorkItemCard';

/** 相邻两两可流转（与后端 `StagePlan::default()` 同形），所以中间那条有两个可去目标。 */
const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Ready' },
    { from: 'In Progress', to: 'Done' },
    { from: 'Done', to: 'In Progress' },
  ],
};

function item(stage = 'Ready', overrides: Partial<WorkItem> = {}): TaskItem {
  return toLocalTask({
    id: 'wi_1',
    projectId: 'p1',
    title: '修复登录',
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

/** 右键卡片 → 返回菜单容器（Radix 的 Content 有 `role="menu"`）。 */
async function openMenu(
  stage = 'Ready',
  props: Partial<React.ComponentProps<typeof WorkItemCard>> = {},
): Promise<HTMLElement> {
  render(
    <ul>
      <WorkItemCard item={item(stage)} plan={PLAN} onOpen={vi.fn()} onMove={vi.fn()} {...props} />
    </ul>,
  );

  fireEvent.contextMenu(screen.getByRole('button', { name: /Open work item/ }));

  return screen.findByRole('menu');
}

describe('WorkItemCard — 右键 Move to', () => {
  it('只列可直接流转的 stage：当前 stage 与需要经过中间阶段的都不出现', async () => {
    const menu = await openMenu('Ready');

    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((entry) => entry.textContent);

    // Ready 的相邻是 Backlog 与 In Progress；Done 需要先经过 In Progress ⇒ 不出现。
    expect(labels).toEqual(['Backlog', 'In Progress']);
    expect(within(menu).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Done')).not.toBeInTheDocument();
  });

  it('选中一个 stage → onMove(卡片 id, stage)', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const menu = await openMenu('Ready', { onMove });

    await user.click(within(menu).getByRole('menuitem', { name: 'In Progress' }));

    await waitFor(() => expect(onMove).toHaveBeenCalledWith('wi_1', 'In Progress'));
  });

  it('阶段轨还没拿到（plan=null）时菜单里是置灰说明，不是一个能点的目标', async () => {
    const menu = await openMenu('Ready', { plan: null });

    const entries = within(menu).getAllByRole('menuitem');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('No reachable stages');
    expect(entries[0]).toHaveAttribute('aria-disabled', 'true');
  });

  it('右键不改变卡片的点击语义：左键仍然打开详情', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ul>
        <WorkItemCard item={item()} plan={PLAN} onOpen={onOpen} onMove={vi.fn()} />
      </ul>,
    );

    await user.click(screen.getByRole('button', { name: /Open work item/ }));

    expect(onOpen).toHaveBeenCalledWith('wi_1');
  });
});

describe('WorkItemCard — 卡片像岛 + 呼吸感（2026-11-03）', () => {
  /**
   * 用户反馈：「内容卡片可以采用岛屿的方式进行展示，带一点呼吸感，当前看起来比前面好一点
   * 但是还是不够美观"。
   *
   * # 「像岛"不是「套 ISLAND_CLASS"
   *
   * 卡片是**分区内的一层控件面**，不是岛（岛 = 一块可独立开关的面板，见
   * `component-guidelines.md` 的表面层级契约）。所以它不能套 `ISLAND_CLASS`
   * —— 那会得到「岛中岛中岛"。它该有的是一组**与岛同源的几何语汇**：
   *
   * | 特征 | 岛（`ISLAND_CLASS`） | 卡片（本节） |
   * | --- | --- | --- |
   * | 圆角 | `rounded-lg`（8px） | `rounded-lg`（同源） |
   * | 阴影 | `shadow-sm` | `shadow-sm`（同源，更轻的层靠底色而非阴影分层） |
   * | 描边 | 无（靠底色 + 阴影） | `border border-border`（卡片小，需要硬边界） |
   * | 底色 | `bg-bg-secondary` | `bg-bg-primary` |
   *
   * # 「呼吸感"= 内边距 + 卡间距 + 行间距三处一起给
   *
   * 现状三处都紧：`px-2 py-1.5`（内距 8/6px）、`gap-1`（卡间 4px）、`mt-1`（行间 4px）。
   * 全仓参照 `PromptCard` 是 `p-3 gap-2`（12px/8px），`TeamTaskBoard` 的列内是 `gap-1.5`。
   * 卡片比列小、比行大，取中间：内距 `px-2.5 py-2`（10/8px）、卡间 `gap-1.5`（6px）、
   * 行间 `mt-1.5`（6px）。
   *
   * 判据只钉「不低于某档"，不钉精确像素：这样微调间距不会红，但退回紧贴会红。
   */
  /** 渲染一张最小卡片（无元数据）。**返回 void** —— 查询由调用点自己做，
   *  避免辅助函数的返回值被 `testing-library/render-result-naming-convention` 当成 render result。 */
  function renderCard(): void {
    render(
      <ul>
        <WorkItemCard item={item('Ready')} plan={PLAN} onOpen={vi.fn()} onMove={vi.fn()} />
      </ul>,
    );
  }

  /** 取那张卡片的按钮。 */
  function cardOf(): HTMLElement {
    return screen.getByRole('button', { name: 'Open work item 修复登录' });
  }

  it('岛同源几何：圆角 + 细阴影 + 描边（不是裸方块）', () => {
    renderCard();
    const cardEl = cardOf();

    // 与 `ISLAND_CLASS` 同源的圆角与阴影 —— 卡片与岛「看起来是一套语汇"
    expect(cardEl).toHaveClass('rounded-lg');
    expect(cardEl).toHaveClass('shadow-sm');
    // 卡片小，仍需硬边界：纯阴影在浅色主题下几乎看不见（light 的岛/海只有 1.18）
    expect(cardEl).toHaveClass('border', 'border-border');
  });

  /**
   * 「不套岛壳"的判据**不是底色**（2026-11-03 二次修正）。
   *
   * 上一版断言「卡片不许 `bg-bg-secondary`（那是岛的表面）"—— 而用户看过参考图后要求
   * 卡片**自己适配底层**：列是 `bg-bg-tertiary`，卡片要在它之上更亮，那就只能是
   * `bg-bg-secondary`。底色重合是**允许的**：卡片与岛同色不构成「岛中岛"，因为它们
   * 在不同的层级位置上（卡片在一个已经存在的列里，不可能独立开关）。
   *
   * 真正的判据是**几何/定位特征** —— 岛壳是 `ISLAND_CLASS` 那一套（`flex flex-col`
   * + `overflow-hidden` + `min-h-0`）。卡片带这些才是「套了岛壳"。
   */
  it('不套岛壳：判据是几何特征，不是底色', () => {
    renderCard();
    const cardEl = cardOf();

    const tokens = new Set(cardEl.className.split(/\s+/));
    // `ISLAND_CLASS` 的四个特征一个都不该有
    expect(tokens).not.toContain('flex-col');
    expect(tokens).not.toContain('overflow-hidden');
    expect(tokens).not.toContain('min-h-0');
    // 但它是**可点的一层**（不是面板容器）：`w-full` + 文字左对齐
    expect(tokens).toContain('w-full');
    expect(tokens).toContain('text-left');
  });

  it('呼吸感：内距不小于 8/10px、行间距不小于 6px', () => {
    renderCard();
    const cardEl = cardOf();

    // 按**完整 token** 判定，不用正则 —— `\bpx-2\b` 会匹配到 `px-2.5` 的前缀
    // （`\b` 在 `.` 前成立），于是「呼吸档"反而被自己的判据判违规。
    const tokens = new Set(cardEl.className.split(/\s+/));

    // 内距：参考图档位是 `p-3`（12px）。紧贴档 `px-2`/`py-1.5`（8/6px）与中间档
    // `px-2.5`/`py-2`（10/8px）都不再是终点 —— 卡片是列里的主内容块，要最松的一档。
    expect(tokens).not.toContain('px-2');
    expect(tokens).not.toContain('py-1.5');
    expect(tokens).not.toContain('px-2.5');
    expect(tokens).toContain('p-3');
  });

  // 行间距单独一条 —— 不塞进上面的通用用例，否则「夹具没有元数据行"时
  // 断言会被 `if` 静默跳过，绿得毫无判别力。
  it('元数据行与标题之间有 6px 间距（不是 4px 的紧贴档）', () => {
    render(
      <ul>
        <WorkItemCard
          item={item('Ready', { priority: 'p1', labels: ['bug'], assignee: 'alice' })}
          plan={PLAN}
          onOpen={vi.fn()}
          onMove={vi.fn()}
        />
      </ul>,
    );

    // 元数据行用 `data-testid` 取（与卡片上 `data-work-item-id` 同款做法）。
    // 不用 `querySelector` / `parentElement`：它们被 `testing-library/no-node-access` 拦，
    // 而按 class 爬 DOM 会在样式微调时静默失效。
    const metaRow = screen.getByTestId('work-item-card-meta');
    expect(metaRow.className.split(/\s+/)).toContain('mt-1.5');
  });
});

describe('WorkItemCard — 参考图式卡片（2026-11-03 二次）', () => {
  /**
   * 参考图的卡片有四个特征，与「圆角块列"配套：
   *
   * | # | 特征 | 为什么 |
   * | --- | --- | --- |
   * | 1 | 标题**粗体、可换行 2-3 行**（不截断成一行） | 参考图里标题是卡片的主信息，`truncate` 会把长标题压成一行省略号 |
   * | 2 | 内距更大（`p-3`） | 参考图卡片明显比我们松 |
   * | 3 | 带**相对时间**（"3d ago"） | 参考图每张卡都有；我们现在完全没有时间信息 |
   * | 4 | 卡片是**最亮层**（在暗主题下） | 参考图「卡片浮在列上"的核心观感 |
   *
   * 第 4 items受「底层 token 不变"约束：不能把列改成 `bg-bg-primary` 来让卡片变亮。
   * 所以卡片改用 `bg-bg-secondary`（岛的表面）—— 它在暗主题下比 `bg-bg-primary` 亮，
   * 在 light/claude 下也是「卡片最亮"的那一档。这是「卡片自己适配底层"的做法。
   */
  function renderOne(overrides: Partial<TaskItem> = {}): void {
    render(
      <ul>
        <WorkItemCard
          item={item('Ready', overrides)}
          plan={PLAN}
          onOpen={vi.fn()}
          onMove={vi.fn()}
        />
      </ul>,
    );
  }

  it('卡片是列上更亮的一层（bg-bg-secondary），不是与列同族的最暗层', () => {
    renderOne();
    const card = screen.getByRole('button', { name: 'Open work item 修复登录' });

    // column是 `bg-bg-tertiary`；卡片取 `bg-bg-secondary` 才有「浮在列上"的对比。
    // 在 dark 下 secondary 比 primary 亮（1.05），在 light/claude 下也是卡片最亮那一档。
    expect(card).toHaveClass('bg-bg-secondary');
    expect(card).not.toHaveClass('bg-bg-primary');
    expect(card).not.toHaveClass('bg-bg-tertiary');
  });

  it('标题可换行 2-3 行，不截断成一行', () => {
    renderOne({ title: '订阅额度用尽导致的构建失败需要用户手动重跑' });
    const title = screen.getByText('订阅额度用尽导致的构建失败需要用户手动重跑');

    const tokens = new Set(title.className.split(/\s+/));
    // 不截断：`truncate` 会把长标题压成一行省略号，参考图里标题占 2-3 行
    expect(tokens).not.toContain('truncate');
    expect(tokens).toContain('break-words');
    // 粗体：标题是卡片的主信息
    expect(tokens).toContain('font-semibold');
    // 最多 3 行，超出的省略（卡片高度要有界）
    expect(tokens).toContain('line-clamp-3');
  });

  it('卡片内距 p-3（参考图明显更松）', () => {
    renderOne();
    const card = screen.getByRole('button', { name: 'Open work item 修复登录' });

    const tokens = new Set(card.className.split(/\s+/));
    expect(tokens).toContain('p-3');
    expect(tokens).not.toContain('px-2.5');
    expect(tokens).not.toContain('py-2');
  });

  it('卡片带相对时间（"Nd ago"），且不是 hint 的 10px 字阶', () => {
    // `updatedAt` 固定成一个很久以前的时间戳，断言渲染出相对时间。
    renderOne({ updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 });

    const time = screen.getByTestId('work-item-card-time');
    expect(time).toHaveTextContent(/3d ago/);
    // 时间戳用 `text-micro`（它正是「时间戳"的用途，见字阶表）
    expect(time).toHaveClass('text-micro');
  });
});
