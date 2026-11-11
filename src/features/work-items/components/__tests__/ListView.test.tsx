/**
 * `ListView`：列表行是**分区内的行**（不是岛），以及它的呼吸感。
 *
 * # 为什么这里不钉「岛壳"
 *
 * 列表与看板是同一块主岛里的两个分区（design §4.2b / 2026-11-03 修订）。行之间的
 * `border-b` 是**岛内**的行分隔，不是岛与岛之间那条海面。给行套岛壳会得到「一列浮岛"。
 *
 * # 行式布局的呼吸感与卡片不同
 *
 * 卡片（`WorkItemCard`）是「一叠块"，靠圆角 + 阴影 + 内距分层；列表行是「一张表"，
 * 靠行高与分隔线分层 —— **不该**给行加圆角/阴影（那会让表变成卡片堆）。
 * 它需要的只是纵向留白：`py-1.5`（6px）在 12px 字号下太紧，行与行读起来连成一片。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toLocalTask, type TaskItem } from '../../viewModel';
import ListView from '../ListView';

function item(id: string, title: string, overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    ...toLocalTask({
      id,
      projectId: 'p1',
      title,
      body: '',
      stage: 'Ready',
      priority: null,
      labels: [],
      assignee: null,
      createdAt: 1,
      updatedAt: 1,
    }),
    ...overrides,
  };
}

const ITEMS: TaskItem[] = [item('wi_1', '修复登录'), item('wi_2', '补充文档')];

function renderList(items: TaskItem[] = ITEMS) {
  render(<ListView items={items} onOpen={vi.fn()} />);
}

describe('ListView — 行是分区里的块，不是岛', () => {
  /**
   * 判据是**阴影**，不是圆角（2026-11-03 二次修正）。
   *
   * 上一版断言「行没有圆角"—— 那是「行 = 表格行"时代的结论。用户确认看板列变圆角块后，
   * 列表行也跟上同一套语汇（否则两个视图读起来像两个产品）。但行仍**不是岛**：
   * 岛的特征是 `ISLAND_CLASS` 那一整套（含 `shadow-sm`），行刻意没有阴影。
   */
  it('行不是岛：无阴影、无岛壳几何', () => {
    renderList();

    for (const row of screen.getAllByRole('button', { name: /Open work item/ })) {
      const tokens = new Set(row.className.split(/\s+/));
      // 无阴影：一屏 20 行的阴影会让列表看起来在抖
      expect(tokens).not.toContain('shadow-sm');
      // 无岛壳几何（`ISLAND_CLASS` 的 `flex-col` / `overflow-hidden` / `min-h-0`）
      expect(tokens).not.toContain('overflow-hidden');
      expect(tokens).not.toContain('min-h-0');
    }
  });
});

describe('ListView — 呼吸感（2026-11-03）', () => {
  it('行纵向内距 ≥ 10px（块比表格行要松）', () => {
    renderList();

    const rows = screen.getAllByRole('button', { name: /Open work item/ });
    expect(rows.length).toBeGreaterThan(1);

    // 逐行验，不只看第一行（否则「只改了一行"也会绿）。
    // 档位演进：`py-1.5`（6px，表格行）→ `py-2`（8px）→ `py-2.5`（10px，圆角块）。
    for (const row of rows) {
      const tokens = new Set(row.className.split(/\s+/));
      expect(tokens).not.toContain('py-1.5');
      expect(tokens).not.toContain('py-2');
      expect(tokens).toContain('py-2.5');
    }
  });

  it('行内「标题 ↔ 元数据」间距 ≥ 4px（`gap-0.5` = 2px 太挤）', () => {
    renderList();

    const row = screen.getByRole('button', { name: 'Open work item 修复登录' });
    const tokens = new Set(row.className.split(/\s+/));

    expect(tokens).not.toContain('gap-0.5');
    expect(tokens).toContain('gap-1');
  });

  it('空态用正文级字阶，不是 hint 的 10px', () => {
    renderList([]);

    const empty = screen.getByRole('status');
    expect(empty).toHaveClass('text-meta');
    expect(empty).not.toHaveClass('text-micro');
  });
});

describe('ListView — 卡片式行（参考图 2026-11-03）', () => {
  /**
   * 列表与看板共用同一份数据，观感也该同一套语汇。
   *
   * 看板列已改成**圆角块**（`rounded-lg`，无阴影），卡片是它上面更亮的一层
   * （`bg-bg-secondary`）。列表**行**同理：行是列表分区里的块，不是表格行。
   *
   * 但行比卡片轻一档：行是「一行"，卡片是「一块"——
   * 行只加圆角 + 底色，**不加阴影**（一屏 20 行的阴影会让列表看起来在抖）。
   */
  function renderList(items: TaskItem[] = ITEMS) {
    render(<ListView items={items} onOpen={vi.fn()} />);
  }

  it('行是圆角块（与看板列同一套语汇），但不加阴影', () => {
    renderList();

    const rows = screen.getAllByRole('button', { name: /Open work item/ });
    expect(rows.length).toBeGreaterThan(1);

    for (const row of rows) {
      const tokens = new Set(row.className.split(/\s+/));
      // 圆角块：与看板列/卡片同源
      expect(tokens).toContain('rounded-lg');
      // 无阴影：一屏 20 行的阴影会让列表看起来在抖
      expect(tokens).not.toContain('shadow-sm');
      // 行底色比列表分区亮一档（列表分区是 `bg-bg-tertiary`）
      expect(tokens).toContain('bg-bg-secondary');
    }
  });

  /**
   * 行与它**直接栖身的那一层**必须是不同表面（2026-11-03 三次修正）。
   *
   * # 这条为什么能抓到上一版的缺陷
   *
   * 行的底色是 `bg-bg-secondary`，而**岛**也是 `bg-bg-secondary`。上一版的列表容器是
   * 裸 `flex-1`（无底色），于是行直接叠在岛上 ⇒ `secondary` 对 `secondary`
   * 在五个主题里对比度恒为 **1.00** ⇒ 行只剩下 `border` 描出的方框。
   *
   * 这与 `surfaceContrast.test.ts` 钉住的事故同型，只是换到了列表这一侧 ——
   * 那个文件只钉「卡片 vs 列」，看不到「行 vs 岛」。
   *
   * # 判据是「相邻层不同」而不是「等于某个 token」
   *
   * 写死 `bg-bg-tertiary` 会让「换一套表面阶梯」这种正当改动变成改测试。这里断言
   * 行的**父层**自带一个表面 token，且**与行不同**。
   */
  it('行与它所在的分区是**不同表面**（同色会让行只剩一个方框）', () => {
    renderList();

    const SURFACES = ['bg-bg-primary', 'bg-bg-secondary', 'bg-bg-tertiary'];

    // 行所栖身的那一层：列表**分区容器**（`bg-tertiary` 那一层）。
    // 按 testid 取，不爬 `parentElement` —— `no-node-access` 的判据就是「别手写 DOM 遍历」。
    const host = screen.getByTestId('work-items-list-region');

    for (const row of screen.getAllByRole('button', { name: /Open work item/ })) {
      const rowSurface = SURFACES.find((token) => row.classList.contains(token));
      expect(rowSurface).toBeDefined();

      // 行栖身的那一层：用 Testing Library 的容器查询取「包含该行的 list」，
      // 而不是自己爬 `parentElement`（`no-node-access` 的判据就是「别手写 DOM 遍历」）。
      // `getByRole('list')` 是列表分区容器，行都住在它里面。
      const hostSurface = SURFACES.find((token) => host.classList.contains(token));
      expect(hostSurface).toBeDefined();
      expect(rowSurface).not.toBe(hostSurface);
    }
  });

  it('行之间靠 6px 空隙分开，不靠 border-b（块不是表格行）', () => {
    renderList();

    // 行容器用 `ISLAND_GAP_CLASS`（6px）：块之间需要可见空隙，
    // 而 `border-b` 是「表格行"的画法 —— 行是块之后它就不该再画线。
    const list = screen.getByRole('list');
    const tokens = new Set(list.className.split(/\s+/));
    expect(tokens).toContain('gap-1.5');

    for (const row of screen.getAllByRole('button', { name: /Open work item/ })) {
      // 行的 `<li>` 不再画分隔线
      expect(row.parentElement?.className.split(/\s+/)).not.toContain('border-b');
    }
  });
});
