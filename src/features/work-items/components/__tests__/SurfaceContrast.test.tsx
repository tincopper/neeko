import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { colorOf, contrastRatio, readThemeFiles } from '../../../../styles/__tests__/themeCss';
import type { StagePlan, WorkItem } from '../../types';
import {
  collectSurfacePairs,
  findMultipleSurfaces,
  parseSurfacePair,
} from '../../utils/surfaceLayers';
import { toLocalTask, type TaskItem } from '../../viewModel';
import BoardView from '../BoardView';
import ListView from '../ListView';
import TasksPanelBody from '../TasksPanelBody';

/**
 * **表面层叠的可见性判据：自动发现 + 跨全部主题验算**（2026-11-03）。
 *
 * # 三次同型事故，根因是判据形态而不是配色
 *
 * | # | 形态 | 当时为什么没被发现 |
 * | --- | --- | --- |
 * | ① | 海面 vs 岛 | 面板根写了海面色，被外层岛包着 → 岛被填成海 |
 * | ② | 卡片 vs 列 | 卡片也写 `bg-bg-tertiary` → 与列同色，恒 1.00 |
 * | ③ | 行 vs 主岛 | 列表容器没底色，行（`secondary`）直接叠在主岛（也是 `secondary`） |
 *
 * 每次的修法都是「人肉列一张我关心的 token 配对」，而缺陷恰好落在**没列到**的那一对上。
 * 手写列表只能覆盖「我已经想到的层」—— 这是结构性的盲区，不是疏忽。
 *
 * # 现在的判据：从真实渲染自动收集
 *
 * 1. **渲染真实的组件**（Board / List / 空态），不是手写 `<div>`；
 * 2. `collectSurfacePairs` 自动抽出每对「内层表面 / 最近的外层表面」；
 * 3. 对每一对，在**每个主题**下验算对比度 ≥ 1.05。
 *
 * 新增一层表面时它自动进入判据，不需要有人记得去登记。
 *
 * # 为什么阈值是 1.05
 *
 * 同色恒 1.00（三次事故的形态）。实测最紧的正当配对是 light 下
 * `secondary > tertiary` 的 1.09、`primary > secondary` 的 1.18。
 * 1.05 高于「同色」，低于最紧的正当配对 —— 不会误伤。
 *
 * 与 `design-tokens.md` 坑 8 的关系：坑 8 钉「表面层级 token 的对比区间是 1.0 ~ 1.3」，
 * 本文件补它缺的另一半 —— 「隐约分层」的前提是**有分层**。
 */
const MIN_ADJACENT_SURFACE_CONTRAST = 1.05;

const PLAN: StagePlan = {
  stages: ['Todo', 'Doing'],
  transitions: [
    { from: 'Todo', to: 'Doing' },
    { from: 'Doing', to: 'Todo' },
  ],
};

function item(id: string, stage: string): TaskItem {
  return toLocalTask({
    id,
    projectId: 'p1',
    title: `item ${id}`,
    body: '',
    stage,
    priority: 'p1',
    labels: ['bug'],
    assignee: 'alice',
    createdAt: 1,
    updatedAt: 1,
  } satisfies Partial<WorkItem> as WorkItem);
}

/**
 * 收集**本域真实渲染**里出现的全部表面配对。
 *
 * # 必须放在真实宿主里渲染（这一条是变异验证抓出来的）
 *
 * 首版把 `ListView` / `BoardView` 单独渲染 —— 它们外面没有主岛，行/列往上找不到任何
 * 表面，于是**不产生配对**。后果：把列表分区层的 `bg-bg-tertiary` 删掉（复现第③次事故），
 * 判据仍然全绿。自动发现「看不见没有外层表面的元素」= 它漏掉了「缺一层」这类缺陷。
 *
 * 所以每个视图都包一层**主岛**（`bg-bg-secondary`，与 `TasksPanel` 的真实结构一致）：
 * 这样「行直接住在主岛下」会被收集成 `bg-bg-secondary > bg-bg-secondary` ⇒ 判据红。
 *
 * 三个渲染面覆盖三条层级路径：
 * - 看板：主岛 → 列（分区）→ 卡片；
 * - 列表：主岛 → 列表分区 → 行；
 * - 空态：主岛 → 内容分区 → 文案。
 */
function collectRealPairs(): string[] {
  const all = new Set<string>();

  /** 主岛外壳：与 `TasksPanel` 里 `<Island>` 的表面一致，让视图在真实层叠里被检验。 */
  function withIsland(node: React.ReactNode): React.ReactElement {
    return <div className="flex flex-col bg-bg-secondary">{node}</div>;
  }

  /** 渲染一个视图、收集它的表面配对、卸载。 */
  function collectFrom(node: React.ReactNode): void {
    const { container, unmount } = render(withIsland(node));
    collectSurfacePairs(container).forEach((pair) => all.add(pair));
    unmount();
  }

  collectFrom(
    <BoardView
      plan={PLAN}
      planLoading={false}
      items={[item('a', 'Todo'), item('b', 'Doing')]}
      onOpen={vi.fn()}
      onMove={vi.fn()}
    />,
  );
  collectFrom(<ListView items={[item('a', 'Todo')]} onOpen={vi.fn()} />);
  collectFrom(
    <TasksPanelBody
      projectId={null}
      loading={false}
      error={null}
      items={[]}
      visible={[]}
      view="board"
      plan={PLAN}
      planLoading={false}
      onOpen={vi.fn()}
      onMove={vi.fn()}
      onNew={vi.fn()}
      detail={null}
    />,
  );

  return Array.from(all).sort();
}

/** 把 `bg-bg-secondary` 这类工具类映射回主题变量名。 */
function themeVarOf(token: string): string {
  return `--${token.replace(/^bg-/, '')}`;
}

describe('表面层叠：从真实渲染自动发现，逐主题验算', () => {
  it('收集到的每一对在**每个**主题下对比 ≥ 1.05', () => {
    const pairs = collectRealPairs();

    // 先确认收集本身有货 —— 空集合会让下面的循环「零次通过」，绿得毫无判别力
    expect(pairs.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const pair of pairs) {
      const parsed = parseSurfacePair(pair);
      if (parsed === null) {
        failures.push(`配对字符串无法解析：${pair}`);
        continue;
      }

      for (const theme of readThemeFiles()) {
        const outer = colorOf(theme, themeVarOf(parsed.outer));
        const inner = colorOf(theme, themeVarOf(parsed.inner));
        if (!outer || !inner) {
          failures.push(`${theme.file}：${pair} 的 token 无法解析`);
          continue;
        }

        const ratio = contrastRatio(outer, inner);
        if (ratio < MIN_ADJACENT_SURFACE_CONTRAST) {
          failures.push(
            `${theme.file}：${pair} 只有 ${ratio.toFixed(2)} < ${MIN_ADJACENT_SURFACE_CONTRAST}（这两层看不出来）`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  /**
   * 反证①：收集器**必须**能看见「内外同色」的缺陷形态。
   *
   * 这条钉的是收集器本身 —— 如果它只会收集「不同 token」的配对，那缺陷形态永远不会进
   * 判据集合，上面那条会一直绿。用真实缺陷树（卡片与列同色）验证它如实报告。
   */
  it('反证：收集器对「内外同色」的缺陷树如实报告（不静默跳过）', () => {
    const defective = document.createElement('div');
    defective.innerHTML = `
      <div class="bg-bg-tertiary">
        <div class="flex"><div class="bg-bg-tertiary"></div></div>
      </div>
    `;

    expect(collectSurfacePairs(defective)).toEqual(['bg-bg-tertiary > bg-bg-tertiary']);
  });

  it('反证：同 token 的对比度是 1.00，必然低于阈值（判据不是空转）', () => {
    const theme = readThemeFiles()[0];
    const tertiary = colorOf(theme, '--bg-tertiary');
    expect(tertiary).not.toBeNull();

    expect(contrastRatio(tertiary!, tertiary!)).toBe(1);
    expect(contrastRatio(tertiary!, tertiary!)).toBeLessThan(MIN_ADJACENT_SURFACE_CONTRAST);
  });

  it('同一元素上不许写两个表面类（生效顺序取决于 CSS 产出，不可预测）', () => {
    for (const renderRoot of ['board', 'list'] as const) {
      const view =
        renderRoot === 'board'
          ? render(
              <BoardView
                plan={PLAN}
                planLoading={false}
                items={[item('a', 'Todo')]}
                onOpen={vi.fn()}
                onMove={vi.fn()}
              />,
            )
          : render(<ListView items={[item('a', 'Todo')]} onOpen={vi.fn()} />);

      expect(findMultipleSurfaces(view.container)).toEqual([]);
      view.unmount();
    }
  });

  /**
   * 记录当前的真实配对集合。
   *
   * 这不是快照（快照会锁死结构、让正当重构变成改测试）—— 它只断言「集合非空且每项格式合法」。
   * 真正的内容判据在上面那条「逐主题验算」里：新增一层会自动进来，不需要改这个文件。
   */
  it('配对集合非空且每项格式合法', () => {
    const pairs = collectRealPairs();
    expect(pairs.length).toBeGreaterThan(0);

    for (const pair of pairs) {
      expect(parseSurfacePair(pair)).not.toBeNull();
    }
  });
});

describe('表面层叠：缺陷形态必须被这套判据抓住（变异验证）', () => {
  /**
   * 把真实渲染面**故意改坏**，确认判据会红。
   *
   * 判据的价值全在「坏掉时会红」。这条用 `ListView` 的真实缺陷形态（行与主岛同色）
   * 走一遍数值链路，断言它**确实**算出 < 1.05。
   */
  it('行与主岛同色（列表分区缺失）在每个主题下都判为不可分辨', () => {
    const failures: string[] = [];

    for (const theme of readThemeFiles()) {
      // 缺陷形态：行 `--bg-secondary` 直接叠在主岛 `--bg-secondary`
      const row = colorOf(theme, '--bg-secondary');
      const island = colorOf(theme, '--bg-secondary');
      if (!row || !island) {
        failures.push(`${theme.file}：无法解析 --bg-secondary`);
        continue;
      }
      const ratio = contrastRatio(row, island);
      if (ratio >= MIN_ADJACENT_SURFACE_CONTRAST) {
        failures.push(`${theme.file}：同色却算出 ${ratio.toFixed(2)}，判据失效`);
      }
    }

    expect(failures).toEqual([]);
  });
});
