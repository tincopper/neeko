/**
 * `providerPreference`：GitHub PR 开关的读写（design §8.3：默认**关闭**）。
 *
 * 纯函数 100% 覆盖是仓库红线。与 `viewPreference.test.ts` 对称地钉两条容错契约 ——
 * 它们的反面是「隐私模式下勾选框直接把面板搞崩」与「勾一下抛错」：
 * 1. 存储不可用（`null`）时读回落「关」、写静默跳过；
 * 2. `getItem` / `setItem` 抛错时同样静默。
 *
 * 另外钉住**默认值是 false** 这条裁决：缺省 / 垃圾值 / 旧版本遗留一律不许当成「打开」。
 */
import { describe, expect, it } from 'vitest';

import {
  parseGithubProvider,
  PROVIDER_STORAGE_KEY,
  readGithubProviderPreference,
  writeGithubProviderPreference,
} from '../providerPreference';
import type { ViewStorage } from '../viewPreference';

function memoryStorage(initial: Record<string, string> = {}): ViewStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** 读写都抛错的存储：隐私模式 / 配额耗尽的形状。 */
const throwingStorage: ViewStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('parseGithubProvider', () => {
  it('只有精确的 true 才算打开', () => {
    expect(parseGithubProvider('true')).toBe(true);
  });

  it('其余一律关闭：缺省、false、以及看起来像真的垃圾值', () => {
    expect(parseGithubProvider('false')).toBe(false);
    expect(parseGithubProvider(null)).toBe(false);
    expect(parseGithubProvider('')).toBe(false);
    expect(parseGithubProvider('1')).toBe(false);
    expect(parseGithubProvider('yes')).toBe(false);
    expect(parseGithubProvider('TRUE')).toBe(false);
  });
});

describe('readGithubProviderPreference', () => {
  it('读出存过的 true', () => {
    expect(readGithubProviderPreference(memoryStorage({ [PROVIDER_STORAGE_KEY]: 'true' }))).toBe(
      true,
    );
  });

  it('键不存在时默认关闭（并联期不许替用户打开外部依赖）', () => {
    expect(readGithubProviderPreference(memoryStorage())).toBe(false);
  });

  it('没有存储（localStorage 拿不到）时默认关闭', () => {
    expect(readGithubProviderPreference(null)).toBe(false);
  });

  it('读取抛错时默认关闭，不把异常抛给调用方', () => {
    expect(readGithubProviderPreference(throwingStorage)).toBe(false);
  });
});

describe('writeGithubProviderPreference', () => {
  it('写入 true / false 用同一个键（与 viewPreference 同一命名空间）', () => {
    const storage = memoryStorage();

    writeGithubProviderPreference(storage, true);
    expect(storage.data[PROVIDER_STORAGE_KEY]).toBe('true');

    writeGithubProviderPreference(storage, false);
    expect(storage.data[PROVIDER_STORAGE_KEY]).toBe('false');
  });

  it('没有存储时静默跳过', () => {
    expect(() => writeGithubProviderPreference(null, true)).not.toThrow();
  });

  it('写入抛错时静默（一次偏好没存上不该让勾选报错）', () => {
    expect(() => writeGithubProviderPreference(throwingStorage, true)).not.toThrow();
  });
});
