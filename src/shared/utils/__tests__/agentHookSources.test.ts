import { describe, expect, it } from 'vitest';

import type { HookInstallStatus } from '@/shared/types/notification';
import {
  installableHookRows,
  isHookSourceEnabled,
  readSourceOverrides,
} from '@/shared/utils/agentHookSources';

function row(overrides: Partial<HookInstallStatus> & { source: string }): HookInstallStatus {
  return {
    path: `/home/u/.${overrides.source}`,
    installed: true,
    versionCurrent: true,
    selfSupplied: false,
    trusted: null,
    ...overrides,
  };
}

describe('installableHookRows', () => {
  it('过滤自供源（上报由 CLI 自己的插件完成，Neeko 没有安装腿）', () => {
    const rows = [row({ source: 'pi' }), row({ source: 'dsh', selfSupplied: true })];
    expect(installableHookRows(rows).map((r) => r.source)).toEqual(['pi']);
  });
});

describe('readSourceOverrides', () => {
  it('畸形容忍：只收布尔值', () => {
    expect(readSourceOverrides({ agentHookSources: { pi: false, claude: 'nope', x: 1 } })).toEqual({
      pi: false,
    });
  });

  it('键缺失 / 非对象 ⇒ 空表（跟随主开关）', () => {
    expect(readSourceOverrides({})).toEqual({});
    expect(readSourceOverrides({ agentHookSources: ['pi'] })).toEqual({});
    expect(readSourceOverrides({ agentHookSources: null })).toEqual({});
  });
});

describe('isHookSourceEnabled', () => {
  it('主开关关闭 ⇒ 全部不启用（覆盖表无权越过主开关）', () => {
    expect(isHookSourceEnabled('pi', {}, false)).toBe(false);
    expect(isHookSourceEnabled('pi', { pi: true }, false)).toBe(false);
  });

  it('键缺失 = 跟随主开关；显式 false 才关闭该 CLI', () => {
    expect(isHookSourceEnabled('pi', {}, true)).toBe(true);
    expect(isHookSourceEnabled('pi', { pi: false }, true)).toBe(false);
    expect(isHookSourceEnabled('claude', { pi: false }, true)).toBe(true);
  });
});
