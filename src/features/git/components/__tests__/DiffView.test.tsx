import { describe, it, expect } from 'vitest';

import { detectLanguage, escapeHtml, buildSplitRows } from '@/features/git/components/diff';
import type { DiffHunk, DiffLine, DiffSource } from '@/features/git/components/diff';

describe('detectLanguage', () => {
  it('.ts 返回 typescript', () => {
    expect(detectLanguage('index.ts')).toBe('typescript');
  });

  it('.tsx 返回 typescript', () => {
    expect(detectLanguage('App.tsx')).toBe('typescript');
  });

  it('.js 返回 javascript', () => {
    expect(detectLanguage('main.js')).toBe('javascript');
  });

  it('.py 返回 python', () => {
    expect(detectLanguage('app.py')).toBe('python');
  });

  it('.rs 返回 rust', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('Dockerfile 返回 dockerfile', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
  });

  it('路径中包含 Dockerfile 返回 dockerfile', () => {
    expect(detectLanguage('deploy/Dockerfile')).toBe('dockerfile');
  });

  it('.xyz 未知扩展名返回 plaintext', () => {
    expect(detectLanguage('file.xyz')).toBe('plaintext');
  });

  it('无扩展名返回 plaintext', () => {
    expect(detectLanguage('Makefile')).toBe('plaintext');
  });

  it('大小写不敏感', () => {
    expect(detectLanguage('App.TS')).toBe('typescript');
    expect(detectLanguage('Style.CSS')).toBe('css');
  });
});

describe('escapeHtml', () => {
  it('转义 & < > "', () => {
    expect(escapeHtml('<b class="x">&</b>')).toBe('&lt;b class=&quot;x&quot;&gt;&amp;&lt;/b&gt;');
  });

  it('没有特殊字符时返回原字符串', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('空字符串返回空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('buildSplitRows', () => {
  const hunk = (lines: DiffLine[]): DiffHunk => ({
    old_start: 1,
    old_lines: lines.length,
    new_start: 1,
    new_lines: lines.length,
    lines,
  });

  it('第一行是 hunk-header', () => {
    const rows = buildSplitRows(hunk([{ Context: 'line1' }]));
    expect(rows[0].type).toBe('hunk-header');
    expect(rows[0].hunkHeader).toContain('@@');
  });

  it('context 行产生单行', () => {
    const rows = buildSplitRows(hunk([{ Context: 'unchanged' }]));
    expect(rows).toHaveLength(2); // header + 1 context
    expect(rows[1]).toMatchObject({
      type: 'context',
      oldContent: 'unchanged',
      newContent: 'unchanged',
      oldType: 'context',
      newType: 'context',
    });
  });

  it('removed + added 配对在同一行', () => {
    const rows = buildSplitRows(hunk([{ Removed: 'old line' }, { Added: 'new line' }]));
    // header + 1 change row
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      type: 'change',
      oldContent: 'old line',
      newContent: 'new line',
      oldType: 'removed',
      newType: 'added',
    });
  });

  it('removed 比 added 多时，多出的行标记为 empty', () => {
    const rows = buildSplitRows(
      hunk([{ Removed: 'old1' }, { Removed: 'old2' }, { Added: 'new1' }]),
    );
    // header + 2 change rows
    expect(rows).toHaveLength(3);
    expect(rows[1].oldType).toBe('removed');
    expect(rows[1].newType).toBe('added');
    expect(rows[2].oldType).toBe('removed');
    expect(rows[2].newType).toBe('empty');
  });

  it('added 比 removed 多时，多出的行标记为 empty', () => {
    const rows = buildSplitRows(hunk([{ Removed: 'old1' }, { Added: 'new1' }, { Added: 'new2' }]));
    expect(rows).toHaveLength(3);
    expect(rows[1].newType).toBe('added');
    expect(rows[2].oldType).toBe('empty');
    expect(rows[2].newType).toBe('added');
  });

  it('行号递增正确', () => {
    const rows = buildSplitRows(hunk([{ Context: 'c1' }, { Context: 'c2' }]));
    expect(rows[1].oldLineNum).toBe(1);
    expect(rows[1].newLineNum).toBe(1);
    expect(rows[2].oldLineNum).toBe(2);
    expect(rows[2].newLineNum).toBe(2);
  });
});

describe('DiffSource worktree type', () => {
  it('worktree DiffSource 应有正确的类型结构', () => {
    const source: DiffSource = {
      type: 'worktree',
      projectId: 'proj-123',
      worktreePath: '/path/to/worktree',
    };
    expect(source.type).toBe('worktree');
    expect(source.projectId).toBe('proj-123');
    expect(source.worktreePath).toBe('/path/to/worktree');
  });

  it('worktree DiffSource 与其他类型可区分', () => {
    const local: DiffSource = { type: 'local', projectId: 'p1' };
    const wt: DiffSource = { type: 'worktree', projectId: 'p1', worktreePath: '/wt' };
    const wsl: DiffSource = { type: 'wsl', distro: 'Ubuntu', projectPath: '/home' };

    expect(local.type).toBe('local');
    expect(wt.type).toBe('worktree');
    expect(wsl.type).toBe('wsl');
  });
});
