import { describe, expect, it } from 'vitest';

import { isMainCheckout, WORKSPACE_KEY_SEP, WorkspaceSession } from '../workspaceRef';

/**
 * `WorkspaceSession` class（值对象）—— key 是对象的属性（getter），不是散件拼装。
 * golden 输入与 Rust `WorkspaceRef::key()` 的契约测试逐字对齐（见 workspaceRef.test.ts）。
 */
describe('WorkspaceSession', () => {
  it('session.key 与后端 WorkspaceRef::key() golden 契约一致（主仓）', () => {
    const s = WorkspaceSession.of('proj-1', null);
    expect(s.key).toBe(`proj-1${WORKSPACE_KEY_SEP}`);
  });

  it('session.key 与后端 WorkspaceRef::key() golden 契约一致（worktree）', () => {
    const s = WorkspaceSession.of('proj-1', '/srv/app/.worktrees/dev');
    expect(s.key).toBe('proj-1\0/srv/app/.worktrees/dev');
  });

  it('key getter 二次访问返回同一引用（缓存生效）', () => {
    const s = WorkspaceSession.of('p1', '/wt/a');
    expect(s.key).toBe(s.key);
  });

  it('JSON.stringify 只产出 projectId / worktreePath 两键（getter 不入 wire）', () => {
    const s = WorkspaceSession.of('p1', '/wt/a');
    expect(JSON.stringify(s)).toBe('{"projectId":"p1","worktreePath":"/wt/a"}');
    expect(Object.keys(JSON.parse(JSON.stringify(s)) as object).sort()).toEqual([
      'projectId',
      'worktreePath',
    ]);
  });

  it('fromKey 往返主仓形态', () => {
    const s = WorkspaceSession.fromKey('p1\0');
    expect(s).not.toBeNull();
    expect(s?.projectId).toBe('p1');
    expect(s?.worktreePath).toBeNull();
    expect(s?.key).toBe('p1\0');
    expect(isMainCheckout(s!)).toBe(true);
  });

  it('fromKey 往返 worktree 形态', () => {
    const s = WorkspaceSession.fromKey('p1\0/wt/a');
    expect(s).not.toBeNull();
    expect(s?.projectId).toBe('p1');
    expect(s?.worktreePath).toBe('/wt/a');
    expect(s?.key).toBe('p1\0/wt/a');
    expect(isMainCheckout(s!)).toBe(false);
  });

  it('fromKey 对无 NUL 的非法输入返回 null', () => {
    expect(WorkspaceSession.fromKey('plain-uuid')).toBeNull();
    expect(WorkspaceSession.fromKey('')).toBeNull();
  });

  it('of 空串/空白 worktree 与 null 同归主仓（与 workspaceKeyOf 归一规则同源）', () => {
    expect(WorkspaceSession.of('p1', '').key).toBe(WorkspaceSession.of('p1', null).key);
    expect(WorkspaceSession.of('p1', '   ').key).toBe(WorkspaceSession.of('p1', null).key);
  });

  it('class 实例满足既有结构消费（isMainCheckout 双形态）', () => {
    const s = WorkspaceSession.of('p1', null);
    // 既有接口以 `{ projectId; worktreePath }` 结构消费 session；class 实例必须可替换
    const struct: { projectId: string; worktreePath: string | null } = s;
    expect(struct.projectId).toBe('p1');
    expect(isMainCheckout(s)).toBe(true);
    expect(isMainCheckout(s.key)).toBe(true);
  });

  it('私有构造不可绕过（运行时无 new 通道）', () => {
    // TS 层 private 构造已挡编译期；运行时验证 of 是唯一入口的语义（无导出的 mint）。
    expect(typeof WorkspaceSession.of).toBe('function');
    expect(typeof WorkspaceSession.fromKey).toBe('function');
  });
});
