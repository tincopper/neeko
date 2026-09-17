// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CODEMIRROR_EXTENSIONS, CODEMIRROR_FILENAMES } from '../codemirror';
import {
  LANGUAGE_BY_EXTENSION,
  LANGUAGE_BY_FILENAME,
  extensionOf,
  languageForPath,
} from '../languageRegistry';

describe('languageRegistry', () => {
  it('extensionOf：路径分隔符 / 大小写 / 前导点 / 尾点 / 空串', () => {
    expect(extensionOf('/a/b/App.TSX')).toBe('tsx');
    expect(extensionOf('win\\dir\\lib.rs')).toBe('rs');
    expect(extensionOf('Dockerfile')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
    expect(extensionOf('')).toBe('');
  });

  it('languageForPath：扩展名优先，其次文件名，未识别为 null', () => {
    expect(languageForPath('src/main.go')).toBe('go');
    expect(languageForPath('Dockerfile')).toBe('dockerfile');
    expect(languageForPath('a/.gitignore')).toBe('plaintext');
    expect(languageForPath('unknown.zzz')).toBeNull();
  });

  it('词表键规范：扩展名表无点且全小写；文件名表全小写', () => {
    for (const key of Object.keys(LANGUAGE_BY_EXTENSION)) {
      expect(key).toBe(key.toLowerCase());
      expect(key.startsWith('.')).toBe(false);
    }
    for (const key of Object.keys(LANGUAGE_BY_FILENAME)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  // ── 覆盖度护栏：目标侧不得出现词表未收录的扩展名（新增扩展名只改词表）──
  it('CodeMirror 覆盖的扩展名 / 文件名均收录于词表', () => {
    // 非空断言：避免列表被清空后护栏"静默通过"
    expect(CODEMIRROR_EXTENSIONS.length).toBeGreaterThan(0);
    expect(CODEMIRROR_FILENAMES.length).toBeGreaterThan(0);
    const missingExt = CODEMIRROR_EXTENSIONS.filter((ext) => !LANGUAGE_BY_EXTENSION[ext]);
    const missingName = CODEMIRROR_FILENAMES.filter((name) => !LANGUAGE_BY_FILENAME[name]);
    expect({ missingExt, missingName }).toEqual({ missingExt: [], missingName: [] });
  });
});
