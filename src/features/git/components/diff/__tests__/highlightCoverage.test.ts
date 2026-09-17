// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { LANGUAGE_BY_EXTENSION, LANGUAGE_BY_FILENAME } from '@/shared/utils/languageRegistry';

import { HIGHLIGHT_KEYS } from '../highlight';

describe('highlight 覆盖度护栏', () => {
  it('EXT_TO_LANG 的键均收录于 languageRegistry 词表（新增扩展名只改词表）', () => {
    expect(HIGHLIGHT_KEYS.length).toBeGreaterThan(0);
    const missing = HIGHLIGHT_KEYS.filter((key) => {
      const bare = key.toLowerCase();
      if (bare.startsWith('.')) return !LANGUAGE_BY_EXTENSION[bare.slice(1)];
      return !LANGUAGE_BY_FILENAME[bare] && !LANGUAGE_BY_EXTENSION[bare];
    });
    expect(missing).toEqual([]);
  });
});
