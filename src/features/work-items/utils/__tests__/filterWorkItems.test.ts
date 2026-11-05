/**
 * `filterWorkItems`：搜索命中的判据（design §4.5）。
 *
 * 抽成纯函数的意义就在这份文件：边界（空查询 / 空白查询 / 多字段命中 / Unassigned）可以**直接**
 * 断言，而不必靠「造三行数据、数剩下几行"的渲染断言间接推断。
 */
import { describe, expect, it } from 'vitest';

import { toLocalTask, type TaskItem } from '../../viewModel';
import { filterWorkItems } from '../filterWorkItems';

function item(title: string, overrides: Partial<Parameters<typeof toLocalTask>[0]> = {}): TaskItem {
  return toLocalTask({
    id: title,
    projectId: 'p1',
    title,
    body: '',
    stage: 'Backlog',
    priority: null,
    labels: [],
    assignee: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

const ROWS: TaskItem[] = [
  item('修复登录'),
  item('重构看板', { labels: ['design'] }),
  item('补测试', { assignee: 'tincopper' }),
];

describe('filterWorkItems', () => {
  it('空查询返回**原数组引用**（不过滤就该原样返回，否则下游 memo 白掉）', () => {
    expect(filterWorkItems(ROWS, '')).toBe(ROWS);
  });

  it('空白查询等价于空查询（打几个空格不该让列表变成「没有匹配"）', () => {
    expect(filterWorkItems(ROWS, '   ')).toBe(ROWS);
  });

  it('按标题命中，大小写不敏感', () => {
    expect(filterWorkItems(ROWS, '看板').map((row) => row.title)).toEqual(['重构看板']);
    expect(filterWorkItems(ROWS, 'TINCOPPER').map((row) => row.title)).toEqual(['补测试']);
  });

  it('按标签命中（标签是用户自己写的检索锚点）', () => {
    expect(filterWorkItems(ROWS, 'design').map((row) => row.title)).toEqual(['重构看板']);
  });

  it('按负责人命中', () => {
    expect(filterWorkItems(ROWS, 'tinc').map((row) => row.title)).toEqual(['补测试']);
  });

  it('Unassigned（assignee=null）不会因为空串匹配而全中', () => {
    // `(item.assignee ?? '')` 若直接 `includes(query)`，查询 'tinc' 仍只命中那一行；
    // 但若把空串当成「命中任意前缀"，Unassigned的行会全部留下 —— 这里钉住它没有。
    expect(filterWorkItems(ROWS, 'zzz')).toEqual([]);
  });

  it('命不中时返回空数组（与「没有数据"是两件事，由调用点的文案区分）', () => {
    expect(filterWorkItems(ROWS, 'zzz')).toHaveLength(0);
  });
});
