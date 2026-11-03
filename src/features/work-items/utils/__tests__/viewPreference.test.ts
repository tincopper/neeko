/**
 * `viewPreference`：Board / List 上次选择的读写（design §4.5）。
 *
 * 纯函数 100% 覆盖是仓库红线。这里额外钉住两条**容错**契约 —— 它们的反面是「隐私模式下
 * 面板直接崩」与「切视图抛错」，都不是能从代码形状上看出来的：
 * 1. 存储不可用（`null`）时读回落 `board`、写静默跳过；
 * 2. `getItem` / `setItem` / 取 `window.localStorage` 本身抛错时同样静默。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  localStorageOrNull,
  parseView,
  readViewPreference,
  VIEW_STORAGE_KEY,
  writeViewPreference,
  type ViewStorage,
} from '../viewPreference';

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

afterEach(() => {
  // `localStorageOrNull` 的用例会换掉 window.localStorage 的 getter，这里还原默认描述符。
  vi.restoreAllMocks();
});

describe('parseView', () => {
  it('只有精确的 list 才认，其余回落 board', () => {
    expect(parseView('list')).toBe('list');
    expect(parseView('board')).toBe('board');
    expect(parseView(null)).toBe('board');
    expect(parseView('LIST')).toBe('board');
    expect(parseView('{"view":"list"}')).toBe('board');
  });
});

describe('readViewPreference', () => {
  it('读出存过的 list', () => {
    expect(readViewPreference(memoryStorage({ [VIEW_STORAGE_KEY]: 'list' }))).toBe('list');
  });

  it('键不存在时回落 board', () => {
    expect(readViewPreference(memoryStorage())).toBe('board');
  });

  it('存储不可用（null）时回落 board', () => {
    expect(readViewPreference(null)).toBe('board');
  });

  it('getItem 抛错时回落 board（隐私模式）', () => {
    const storage: ViewStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: vi.fn(),
    };

    expect(readViewPreference(storage)).toBe('board');
  });
});

describe('writeViewPreference', () => {
  it('写到带域前缀的键上', () => {
    const storage = memoryStorage();

    writeViewPreference(storage, 'list');

    expect(storage.data[VIEW_STORAGE_KEY]).toBe('list');
  });

  it('存储不可用（null）时静默跳过', () => {
    expect(() => writeViewPreference(null, 'list')).not.toThrow();
  });

  it('setItem 抛错时静默（配额耗尽 / 被禁用不该让切视图报错）', () => {
    const storage: ViewStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(() => writeViewPreference(storage, 'list')).not.toThrow();
  });
});

describe('localStorageOrNull', () => {
  it('正常环境返回 window.localStorage', () => {
    expect(localStorageOrNull()).toBe(window.localStorage);
  });

  it('取属性本身抛错时返回 null（Safari 隐私模式）', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError: localStorage is not available');
    });

    expect(localStorageOrNull()).toBeNull();

    spy.mockRestore();
  });
});
