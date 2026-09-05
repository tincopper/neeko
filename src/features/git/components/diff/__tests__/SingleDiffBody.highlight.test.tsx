/* eslint-disable testing-library/no-container, testing-library/no-node-access -- 断言 hljs-* CSS 类，Testing Library 无按类查询 API */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SingleDiffBody from '../SingleDiffBody';
import type { DiffResult } from '../types';

vi.mock('@/features/quick-open', () => ({
  openProjectFile: vi.fn(() => Promise.resolve()),
}));

const diffResult: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 1,
      lines: [{ Added: 'const answer: number = 42;' }],
    },
  ],
};

/**
 * 回归测试（2026-09-05）：
 * SingleDiffBody 曾把 filePath 误传给 ensureLanguageRegistered（应为
 * detectLanguage 的语言名），LANGUAGE_MAP 查不到 → 语言永不注册 →
 * highlightLine 永久降级 escapeHtml，single 模式 Diff 高亮整体消失
 * （引入于 3f14eea4 组件拆分重构）。
 *
 * 本文件隔离运行（vitest 模块隔离，hljs 单例不跨文件）：
 * SingleDiffBody 内部是唯一注册路径，传参错误必然导致本用例红。
 */
describe('SingleDiffBody — 语法高亮回归', () => {
  it('unified 视图渲染后 DOM 出现 hljs token（语言注册链路完整）', async () => {
    const { container } = render(
      <SingleDiffBody
        filePath="src/demo.ts"
        loading={false}
        error={null}
        diffResult={diffResult}
        viewMode="unified"
        fullMode={false}
        onToggleFull={vi.fn()}
        onViewModeChange={vi.fn()}
        changeStats={{ additions: 1, deletions: 0 }}
        totalChangeBlocks={1}
        currentBlockIndex={0}
        onChangePrev={vi.fn()}
        onChangeNext={vi.fn()}
        onRetry={vi.fn()}
        selectedLines={new Set()}
        onToggleLine={vi.fn()}
        onDragCommit={vi.fn()}
        fullHunks={null}
        expandedSections={new Set()}
        onToggleSection={vi.fn()}
        reviewPopoverEl={null}
      />,
    );

    // 语言注册是异步的：首帧为纯转义文本，注册完成后 setLanguageReady 触发重渲染
    await vi.waitFor(() => {
      expect(container.querySelector('.hljs-keyword')).not.toBeNull();
    });
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });
});
