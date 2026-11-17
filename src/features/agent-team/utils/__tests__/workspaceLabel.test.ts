import { describe, expect, it } from 'vitest';

import { nonDefaultWorkspaceLabel, workspaceLabel } from '../workspaceLabel';

/**
 * 工作区文案的**唯一**映射点（成员行 / 卡片 / 抽屉共用）。
 *
 * 两条规则各自对应一个真实事故面：
 *
 * | 规则 | 不遵守的后果 |
 * | --- | --- |
 * | worktree 只留末段 | 绝对路径在 280px 列里把名字挤没（原型实测） |
 * | `shared` 是缺省值 ⇒ 行内不渲染 | 每行都写「共享工作区」= 一整列噪音（R7 / R8）|
 */
describe('workspaceLabel — 全量文案（抽屉 / 详情用）', () => {
  it('shared / read_only 各有自己的文案（三态不许合并）', () => {
    expect(workspaceLabel('shared')).toBe('共享工作区');
    expect(workspaceLabel('read_only')).toBe('只读');
  });

  it('worktree 只显示路径末段（POSIX / Windows 分隔符都吃）', () => {
    expect(workspaceLabel({ worktree: { path: '/repo/wt/feat-auth-ui' } })).toBe(
      'worktree feat-auth-ui',
    );
    expect(workspaceLabel({ worktree: { path: 'C:\\repo\\wt\\feat-auth-api\\' } })).toBe(
      'worktree feat-auth-api',
    );
  });
});

describe('nonDefaultWorkspaceLabel — 缺省值不渲染这一条规则的落点', () => {
  it('shared 是缺省值 ⇒ null（调用方据此整枚不渲染）', () => {
    expect(nonDefaultWorkspaceLabel('shared')).toBeNull();
  });

  it('read_only 仍是事实 ⇒ 「只读」', () => {
    expect(nonDefaultWorkspaceLabel('read_only')).toBe('只读');
  });

  it('worktree ⇒ 与 workspaceLabel 同源（不复制字符串）', () => {
    const ws = { worktree: { path: '/repo/wt/feat-auth-ui' } } as const;
    expect(nonDefaultWorkspaceLabel(ws)).toBe(workspaceLabel(ws));
  });
});
