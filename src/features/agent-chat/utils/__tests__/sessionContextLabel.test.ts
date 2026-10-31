import { describe, expect, it } from 'vitest';

import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import {
  envLabelOf,
  unitDisplayName,
  worktreeNameOf,
  worktreePathOfKey,
} from '../sessionContextLabel';

/** 地址 key 只经值对象铸造（不手拼分隔符）。 */
const keyOf = (projectId: string, worktreePath: string | null) =>
  WorkspaceSession.of(projectId, worktreePath).key;

describe('worktreeNameOf', () => {
  it('取 POSIX 路径的末段', () => {
    expect(worktreeNameOf('/Users/me/.neeko/worktrees/multi-agent')).toBe('multi-agent');
  });

  it('Windows 分隔符同样取末段（后端按目标环境回传路径形态）', () => {
    expect(worktreeNameOf('C:\\Users\\me\\.neeko\\worktrees\\feat-x')).toBe('feat-x');
  });

  it('尾部斜杠不产生空名', () => {
    expect(worktreeNameOf('/tmp/wt/feat-y/')).toBe('feat-y');
  });

  it('主 checkout（null / 空串 / 纯分隔符）返回 null', () => {
    expect(worktreeNameOf(null)).toBeNull();
    expect(worktreeNameOf(undefined)).toBeNull();
    expect(worktreeNameOf('')).toBeNull();
    expect(worktreeNameOf('   ')).toBeNull();
    expect(worktreeNameOf('/')).toBeNull();
  });
});

describe('worktreePathOfKey — 地址 key 的唯一 codec', () => {
  it('worktree 单元解出路径；主 checkout 解出 null', () => {
    expect(worktreePathOfKey(keyOf('p1', '/w/wt'))).toBe('/w/wt');
    expect(worktreePathOfKey(keyOf('p1', null))).toBeNull();
  });

  it('缺 key（旧载荷 / 未回显）不猜地址', () => {
    expect(worktreePathOfKey(undefined)).toBeNull();
    expect(worktreePathOfKey('')).toBeNull();
  });
});

describe('unitDisplayName', () => {
  it('主 checkout 只显示项目名', () => {
    expect(
      unitDisplayName({ projectName: 'neeko', projectId: 'p1', workspaceKey: keyOf('p1', null) }),
    ).toBe('neeko');
  });

  it('worktree 单元显示「项目名 · worktree 名」——只显示项目名会让人以为跑在主仓', () => {
    expect(
      unitDisplayName({
        projectName: 'neeko',
        projectId: 'p1',
        workspaceKey: keyOf('p1', '/Users/me/.neeko/worktrees/multi-agent'),
      }),
    ).toBe('neeko · multi-agent');
  });

  it('没有项目名时用 projectId 兜底，不猜 worktree 名', () => {
    expect(unitDisplayName({ projectId: 'p1' })).toBe('p1');
  });

  it('地址来自后端回显：没回显 worktree 就按主 checkout 显示（不拿 tab 自己的地址补）', () => {
    expect(
      unitDisplayName({ projectName: 'neeko', projectId: 'p1', workspaceKey: keyOf('p1', null) }),
    ).toBe('neeko');
  });
});

describe('envLabelOf', () => {
  it('local 是默认值 —— 不显示（否则就是 neeko · wt（local） 这类噪音）', () => {
    expect(envLabelOf('local')).toBeNull();
    expect(envLabelOf('LOCAL')).toBeNull();
    expect(envLabelOf('')).toBeNull();
    expect(envLabelOf(null)).toBeNull();
    expect(envLabelOf(undefined)).toBeNull();
  });

  it('wsl / ssh 才携带信息', () => {
    expect(envLabelOf('wsl')).toBe('WSL');
    expect(envLabelOf('ssh')).toBe('SSH');
  });

  it('未知取值不吞掉（大写后原样显示，便于发现新环境）', () => {
    expect(envLabelOf('container')).toBe('CONTAINER');
  });
});
