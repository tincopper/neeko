import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemberStatusView } from '@/shared/types/team';
import { createTaskCard } from '@/testing/factories';

import TeamFlowGraph from '../TeamFlowGraph';

/**
 * 分配图的两条用户裁决（本文件是它们的判据）：
 *
 * 1. **认领实线已取消** —— 成员与任务的关系由任务行上的 `assignee`（计划事实）/
 *    `owner`（执行事实）表达。图上再画一条成员→任务的实线，就是把同一份信息投影两次。
 * 2. **第 2 轮：两个事实各占一行**（不再 `assignee ?? owner`）—— 见 design §8 四行表。
 *    `FlowTaskNode.test.tsx` 直测四种组合的精确文案；这里从整图的角度再钉一次，
 *    防止 `TeamFlowGraph` 传错 props / 复用旧的单行节点。
 *
 * 为什么不断言「没有 `.flow-claim`」就够了：那只证明渲染器少了一个分支。真正要钉住的是
 * **副标题的来源**（只看 `owner` 的话，被指派但还没人认领的任务会显示「未指派」——
 * 那正是这次要修的症状）。
 */

const members = [
  { memberId: 'w1@tm_1', name: 'w1' },
  { memberId: 'w2@tm_1', name: 'w2' },
] as unknown as MemberStatusView[];

/** 图的根 `<svg>`：`role="img"` 是组件自己的可访问契约（不必用 container 取）。 */
function flowSvg(): SVGElement {
  return screen.getByRole('img', { name: /任务分配图/ });
}

describe('TeamFlowGraph — 节点副标题（两行）', () => {
  it('只有 assignee：指派者 + 待认领', () => {
    render(
      <TeamFlowGraph
        tasks={[createTaskCard({ id: 't1', assignee: 'w1@tm_1' })]}
        members={members}
      />,
    );
    expect(screen.getByText('t1 · 指派 w1')).toBeInTheDocument();
    expect(screen.getByText('待认领')).toBeInTheDocument();
  });

  it('只有 owner：空指派槽 + 已认领（老数据没有 assignee）', () => {
    render(
      <TeamFlowGraph
        tasks={[createTaskCard({ id: 't1', owner: 'w2@tm_1', state: 'in_progress' })]}
        members={members}
      />,
    );
    expect(screen.getByText('t1 · 指派 —')).toBeInTheDocument();
    expect(screen.getByText('已认领 w2')).toBeInTheDocument();
  });

  it('两者都有且不同：两行分别出现两个名字（本轮 #1 的核心判据）', () => {
    render(
      <TeamFlowGraph
        tasks={[
          createTaskCard({
            id: 't1',
            assignee: 'w1@tm_1',
            owner: 'w2@tm_1',
            state: 'in_progress',
          }),
        ]}
        members={members}
      />,
    );
    expect(screen.getByText('t1 · 指派 w1')).toBeInTheDocument();
    expect(screen.getByText('已认领 w2')).toBeInTheDocument();
    expect(screen.queryByText('已认领 w1')).not.toBeInTheDocument();
    expect(screen.queryByText('t1 · 指派 w2')).not.toBeInTheDocument();
  });

  it('两者都没有：未指派 + 待认领', () => {
    render(<TeamFlowGraph tasks={[createTaskCard({ id: 't1' })]} members={members} />);
    expect(screen.getByText('t1 · 未指派')).toBeInTheDocument();
    expect(screen.getByText('待认领')).toBeInTheDocument();
  });
});

describe('TeamFlowGraph — 成员行已移除（能力留在 flowLayout）', () => {
  // 成员名故意与任务上的 owner/assignee 无关：节点副标题本来就会写成员的短 id，
  // 用花名册专属名字才能证明「成员行那一块 JSX」没了，而不是误伤节点文本。
  const roster = [
    { memberId: 'alpha@tm_1', name: 'alpha-person', persona: '研究员' },
    { memberId: 'beta@tm_1', name: 'beta-person', persona: '实现者' },
  ] as unknown as MemberStatusView[];
  const tasks = [createTaskCard({ id: 't1' })];

  /** `viewBox` 的宽高（SVG 无 role 可查，按属性读）。 */
  function viewBoxSize(svg: SVGElement): { w: number; h: number } {
    const parts = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    return { w: parts[2] ?? 0, h: parts[3] ?? 0 };
  }

  it('传入 members 时 SVG 里没有成员名 / 角色 / 任务数', () => {
    render(<TeamFlowGraph tasks={tasks} members={roster} />);
    const svg = flowSvg();
    expect(svg).not.toHaveTextContent('alpha-person');
    expect(svg).not.toHaveTextContent('beta-person');
    expect(svg).not.toHaveTextContent('研究员');
    expect(svg).not.toHaveTextContent('任务');
  });

  it('成员数不再撑开画布：宽高与无成员时完全一致，且高度低于第 1 轮基线', () => {
    const { unmount } = render(<TeamFlowGraph tasks={tasks} members={roster} />);
    const withMembers = viewBoxSize(flowSvg());
    unmount();
    render(<TeamFlowGraph tasks={tasks} members={[]} />);
    expect(viewBoxSize(flowSvg())).toEqual(withMembers);
    // 第 1 轮同一夹具（1 个任务 + 成员行）：tasksTop=8+30+34=72，
    // 高度 = 72 + 1*(38+34) + 40(成员行) = 184。节点加高后仍须比它小。
    expect(withMembers.h).toBeLessThan(184);
  });
});

describe('TeamFlowGraph — 视口（wheel zoom + pointer pan）', () => {
  const tasks = [createTaskCard({ id: 't1' })];

  /** jsdom 的 PointerEvent 默认 `isPrimary=false`，真实鼠标恒为 true，故显式给。 */
  const pointer = (clientX: number, clientY: number) => ({
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX,
    clientY,
  });
  const viewport = () => screen.getByTestId('flow-viewport');

  afterEach(() => vi.restoreAllMocks());

  it('受控模式：wheel 上滚把钳制后的值交给 onZoomChange', () => {
    const onZoomChange = vi.fn();
    render(<TeamFlowGraph tasks={tasks} members={[]} zoom={1} onZoomChange={onZoomChange} />);
    // wheel 原生事件必须 preventDefault，否则页面跟着滚。
    expect(fireEvent.wheel(viewport(), { deltaY: -100 })).toBe(false);
    expect(onZoomChange).toHaveBeenCalledWith(1.1);
  });

  it('受控模式：到上界再上滚仍只收到钳制值', () => {
    const onZoomChange = vi.fn();
    render(<TeamFlowGraph tasks={tasks} members={[]} zoom={2.5} onZoomChange={onZoomChange} />);
    fireEvent.wheel(viewport(), { deltaY: -100 });
    expect(onZoomChange).toHaveBeenCalledWith(2.5);
  });

  it('wheel 用原生非 passive 监听注册、卸载时移除（React onWheel 是 passive）', () => {
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const { unmount } = render(<TeamFlowGraph tasks={tasks} members={[]} />);
    expect(addSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
  });

  it('非受控模式：wheel 后 SVG 宽度变化（dock 也能缩放）', () => {
    render(<TeamFlowGraph tasks={tasks} members={[]} />);
    const svg = flowSvg();
    // zoom 省略 → 初始响应式 width:100%，没有 width 属性。
    expect(svg).not.toHaveAttribute('width');
    fireEvent.wheel(viewport(), { deltaY: -100 });
    // 内部 state 是唯一持有者：滚轮后按精确像素渲染，宽度真的变了。
    expect(svg.getAttribute('width')).not.toBeNull();
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
  });

  it('pointer 拖动改滚动容器 scrollLeft/scrollTop，超阈值时吞掉 click', () => {
    const onOpenTask = vi.fn();
    render(<TeamFlowGraph tasks={tasks} members={[]} onOpenTask={onOpenTask} />);
    const el = viewport();
    fireEvent.pointerDown(el, pointer(100, 50));
    fireEvent.pointerMove(el, pointer(70, 80));
    fireEvent.pointerUp(el, pointer(70, 80));
    expect(el.scrollLeft).toBe(30);
    expect(el.scrollTop).toBe(-30);
    // 拖完手一松不能误开任务详情。
    fireEvent.click(screen.getByRole('button', { name: /打开任务 t1/ }));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('零位移点击仍打开任务详情（不能把正常点击也吞了）', () => {
    const onOpenTask = vi.fn();
    render(<TeamFlowGraph tasks={tasks} members={[]} onOpenTask={onOpenTask} />);
    const el = viewport();
    fireEvent.pointerDown(el, pointer(100, 50));
    fireEvent.pointerUp(el, pointer(100, 50));
    expect(el.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /打开任务 t1/ }));
    expect(onOpenTask).toHaveBeenCalledWith('tm_1', 't1', 'task t1');
  });
});

describe('TeamFlowGraph — 图例与边', () => {
  const tasks = [
    createTaskCard({ id: 't1', assignee: 'w1@tm_1' }),
    createTaskCard({ id: 't2', dependsOn: ['t1'], owner: 'w2@tm_1', state: 'in_progress' }),
  ];

  it('图例只讲「实线 = 派发 · 虚线 = 依赖」，不再宣称「实线 = 认领」', () => {
    render(<TeamFlowGraph tasks={tasks} members={members} />);
    const legend = screen.getByText(/实线 = 派发/);
    expect(legend).toHaveTextContent('虚线 = 依赖');
    // 只断言图例本身：节点副标题现在本来就会写「已认领 / 待认领」，
    // 对整块 section 断言「不出现认领」会把本轮 #1 的修复当成退化。
    expect(legend).not.toHaveTextContent('认领');
  });

  it('派发连首层、依赖仍是虚线，不再画成员→任务的实线', () => {
    render(<TeamFlowGraph tasks={tasks} members={members} />);
    const svg = flowSvg();
    // 边的种类只能从 `<path>` 的 class 上读：SVG 的形状没有可访问角色，
    // 语义查询在这里到不了（结构断言必须落到 querySelector）。
    // eslint-disable-next-line testing-library/no-node-access -- SVG path 无 role，只能按 class 判定
    const create = svg.querySelectorAll('path.flow-create');
    // 只有 layer 0 的 t1 有派发边；t2 由 t1 的依赖边追溯回 lead。
    expect(create).toHaveLength(1);
    // `1 3` 点线在浅底上几乎全是空隙（用户只看到一个箭头）：改成可见实线。
    // eslint-disable-next-line testing-library/no-node-access -- SVG path 属性无 role
    expect(create[0]).not.toHaveAttribute('stroke-dasharray');
    // eslint-disable-next-line testing-library/no-node-access -- 同上
    expect(create[0]).toHaveAttribute('stroke-width', '1.4');
    // eslint-disable-next-line testing-library/no-node-access -- 同上
    expect(create[0]).toHaveClass('stroke-text-muted');
    // 依赖边仍靠线型（4 3 虚线）与派发边区分，不靠谁更淡。
    // eslint-disable-next-line testing-library/no-node-access -- SVG path 属性无 role
    expect(svg.querySelectorAll('path[stroke-dasharray="4 3"]')).toHaveLength(1);
    // 认领边没了：它曾经是 `path.flow-claim`（成员身份色实线）
    // eslint-disable-next-line testing-library/no-node-access -- 同上：这条断言就是「这条边不存在」
    expect(svg.querySelectorAll('path.flow-claim')).toHaveLength(0);
  });
});
