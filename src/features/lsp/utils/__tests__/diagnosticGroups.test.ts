import { describe, expect, it } from 'vitest';

import type { LspDiagnostic } from '../../types';
import {
  diagnosticGroupLabel,
  diagnosticRowKeys,
  orderDiagnosticFileGroups,
  sortDiagnosticsForGroup,
} from '../diagnosticGroups';

const PROJECT = '/proj';

function diag(
  line: number,
  severity: number | null,
  message: string,
  character = 0,
): LspDiagnostic {
  return {
    range: { start: { line, character }, end: { line: line + 1, character } },
    severity,
    message,
    source: 'test-ls',
  };
}

describe('sortDiagnosticsForGroup —— 组内排序', () => {
  it('按 severity → 行 → 列排序，且不改写入参数组', () => {
    const input = [
      diag(5, 2, 'warning'),
      diag(9, 1, 'error-late'),
      diag(9, 1, 'error-early', 7),
      diag(1, null, 'unknown'),
    ];

    const sorted = sortDiagnosticsForGroup(input);

    expect(sorted.map((d) => d.message)).toEqual([
      'error-late',
      'error-early',
      'warning',
      'unknown',
    ]);
    // 不改写入参：store 的数组引用是分组增量的唯一判据，绝不能被就地重排
    expect(input.map((d) => d.message)).toEqual([
      'warning',
      'error-late',
      'error-early',
      'unknown',
    ]);
  });
});

describe('diagnosticGroupLabel —— 展示路径', () => {
  it('项目内相对化，项目外保持绝对路径，非文件 uri 原样', () => {
    expect(diagnosticGroupLabel('file:///proj/src/a.ts', PROJECT)).toBe('src/a.ts');
    expect(diagnosticGroupLabel('file:///other/b.ts', PROJECT)).toBe('/other/b.ts');
    expect(diagnosticGroupLabel('jdt://contents/java.lang/String.class', PROJECT)).toBe(
      'jdt://contents/java.lang/String.class',
    );
  });

  /**
   * 剥根的边界必须按分隔符比较（判据复用 `fileRef.relativeToRoot`）——「以 root 为前缀的字符串」
   * 不等于「位于 root 之下」：`/proj-x` 是 `/proj` 的兄弟目录。自写 `path.startsWith(root)`
   * 会把它当成项目内，标签被切成 `-x/a.ts`（既不是相对路径，也不再是绝对路径）。
   */
  it('兄弟目录同前缀不被误判为项目内', () => {
    expect(diagnosticGroupLabel('file:///proj-x/a.ts', PROJECT)).toBe('/proj-x/a.ts');
  });

  it('path 恰为 root 时不产出空标签', () => {
    expect(diagnosticGroupLabel('file:///proj', PROJECT)).toBe('/proj');
  });

  it('root 与 path 斜杠形态混用时先归一再剥根（Windows 形态的 root）', () => {
    expect(diagnosticGroupLabel('C:/proj/src/a.ts', 'C:\\proj')).toBe('src/a.ts');
  });

  it('root 为空时无法锚定，原样返回', () => {
    expect(diagnosticGroupLabel('file:///proj/src/a.ts', '')).toBe('/proj/src/a.ts');
  });
});

describe('orderDiagnosticFileGroups —— 有序文件分组', () => {
  it('按标签字母序，空数组不产生分组，diagnostics 保持 store 原引用', () => {
    const aDiags = [diag(0, 1, 'x')];
    const groups = orderDiagnosticFileGroups(
      {
        'file:///proj/src/b.ts': [diag(0, 1, 'b')],
        'file:///proj/src/a.ts': aDiags,
        'file:///proj/src/cleared.ts': [],
      },
      PROJECT,
    );

    expect(groups.map((g) => g.label)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(groups[0].diagnostics).toBe(aDiags);
  });

  it('无切片（undefined）返回空列表', () => {
    expect(orderDiagnosticFileGroups(undefined, PROJECT)).toEqual([]);
  });
});

describe('diagnosticRowKeys —— 组内行身份', () => {
  it('同指纹的重复诊断各得唯一 key（旧实现同 key，React 会告警并错配行）', () => {
    const keys = diagnosticRowKeys([diag(0, 1, 'same'), diag(0, 1, 'same'), diag(0, 1, 'same')]);

    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe('same-0-0-1#0');
    expect(keys[1]).toBe('same-0-0-1#1');
  });

  it('同一份内容重复调用产出同一组 key（跨 publish 稳定）', () => {
    const content = [diag(2, 1, 'boom'), diag(2, 1, 'boom'), diag(3, 2, 'other')];

    expect(diagnosticRowKeys(content)).toEqual(diagnosticRowKeys([...content]));
  });

  it('不同位置/severity 的诊断指纹不同（不依赖序号区分）', () => {
    const keys = diagnosticRowKeys([diag(0, 1, 'm'), diag(1, 1, 'm'), diag(0, 2, 'm')]);

    expect(new Set(keys).size).toBe(3);
    expect(keys.every((key) => key.endsWith('#0'))).toBe(true);
  });
});
