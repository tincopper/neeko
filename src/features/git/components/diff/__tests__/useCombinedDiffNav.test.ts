import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CommitFileChange } from '@/shared/types';

import { useCombinedDiffNav } from '../useCombinedDiffNav';

function file(path: string, additions = 1, deletions = 0): CommitFileChange {
  return { path, status: 'M', additions, deletions };
}

const FILES: CommitFileChange[] = [
  file('src/a.ts', 5, 1),
  file('src/b.ts', 2, 0),
  file('src/c.ts', 1, 3),
];

const FILES_MANY: CommitFileChange[] = [
  file('src/a.ts'),
  file('src/b.ts'),
  file('src/c.ts'),
  file('src/d.ts'),
  file('src/e.ts'),
];

function renderNav(overrides?: Partial<Parameters<typeof useCombinedDiffNav>[0]>) {
  return renderHook(
    (props: Parameters<typeof useCombinedDiffNav>[0]) => useCombinedDiffNav(props),
    {
      initialProps: {
        fileList: FILES,
        initialPath: 'src/b.ts',
        viewMode: 'unified' as const,
        ...overrides,
      },
    },
  );
}

describe('useCombinedDiffNav', () => {
  it('should_initialize_expanded_paths_and_index_from_initial_path', () => {
    const { result } = renderNav({ initialPath: 'src/b.ts' });

    // 小文件集（<=3）默认全部展开
    expect(result.current.expandedPaths).toEqual(new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']));
    // currentFileIdx 定位到 initialPath
    expect(result.current.currentFileIdx).toBe(1);
    expect(result.current.allCollapsed).toBe(false);
  });

  it('should_expand_only_preferred_path_for_large_file_sets', () => {
    const { result } = renderNav({ fileList: FILES_MANY, initialPath: 'src/d.ts' });

    expect(result.current.expandedPaths).toEqual(new Set(['src/d.ts']));
    expect(result.current.currentFileIdx).toBe(3);
  });

  it('should_reset_nav_state_when_file_set_identity_changes', () => {
    const { result, rerender } = renderNav({ fileList: FILES_MANY, initialPath: 'src/d.ts' });

    // 手动折叠全部 → 导航 state 被修改
    act(() => {
      result.current.toggleFoldAll();
    });
    expect(result.current.expandedPaths.size).toBe(0);

    // 文件集身份变化（filesKey 不同）→ 渲染期重置
    const newFiles = [...FILES_MANY, file('src/f.ts')];
    rerender({ fileList: newFiles, initialPath: 'src/f.ts', viewMode: 'unified' });
    expect(result.current.expandedPaths).toEqual(new Set(['src/f.ts']));
    expect(result.current.currentFileIdx).toBe(5);
  });

  it('should_adjust_index_and_expand_path_when_scroll_to_path_changes', () => {
    const { result, rerender } = renderNav({ scrollToPath: undefined });

    act(() => {
      rerender({
        fileList: FILES,
        initialPath: 'src/a.ts',
        scrollToPath: 'src/c.ts',
        viewMode: 'unified',
      });
    });

    expect(result.current.currentFileIdx).toBe(2);
    expect(result.current.expandedPaths.has('src/c.ts')).toBe(true);
  });

  it('should_toggle_file_expansion_and_track_current_index', () => {
    const { result } = renderNav();

    act(() => {
      result.current.toggleFile('src/a.ts');
    });
    // 原本展开 → 折叠
    expect(result.current.expandedPaths.has('src/a.ts')).toBe(false);
    expect(result.current.currentFileIdx).toBe(0);

    act(() => {
      result.current.toggleFile('src/a.ts');
    });
    expect(result.current.expandedPaths.has('src/a.ts')).toBe(true);
  });

  it('should_toggle_fold_all_between_expanded_and_collapsed', () => {
    const { result } = renderNav();

    act(() => {
      result.current.toggleFoldAll();
    });
    expect(result.current.expandedPaths.size).toBe(0);
    expect(result.current.allCollapsed).toBe(true);

    act(() => {
      result.current.toggleFoldAll();
    });
    expect(result.current.expandedPaths).toEqual(new Set(FILES.map((f) => f.path)));
    expect(result.current.allCollapsed).toBe(false);
  });

  it('should_navigate_file_prev_and_next', () => {
    const onScrollToPathChange = vi.fn();
    const { result } = renderNav({
      initialPath: 'src/a.ts',
      onScrollToPathChange,
    });

    act(() => {
      result.current.navigateFile('next');
    });
    expect(result.current.currentFileIdx).toBe(1);
    expect(onScrollToPathChange).toHaveBeenCalledWith('src/b.ts');

    act(() => {
      result.current.navigateFile('prev');
    });
    expect(result.current.currentFileIdx).toBe(0);
  });

  it('should_not_navigate_beyond_boundaries', () => {
    const { result } = renderNav({ initialPath: 'src/c.ts' });

    act(() => {
      result.current.navigateFile('next'); // 已在末尾
    });
    expect(result.current.currentFileIdx).toBe(2);

    // 每个 act 块独立渲染，使 navigateFile 闭包重新绑定最新 currentFileIdx
    act(() => {
      result.current.navigateFile('prev');
    });
    expect(result.current.currentFileIdx).toBe(1);
    act(() => {
      result.current.navigateFile('prev');
    });
    expect(result.current.currentFileIdx).toBe(0);
    act(() => {
      result.current.navigateFile('prev'); // 已到开头
    });
    expect(result.current.currentFileIdx).toBe(0);
  });

  it('should_compute_combined_stats_from_file_list', () => {
    const { result } = renderNav();

    expect(result.current.combinedStats).toEqual({ additions: 8, deletions: 4 });
    expect(result.current.filesKey).toBe('src/a.ts\0src/b.ts\0src/c.ts');
  });

  it('should_expand_target_when_navigating_block_with_no_mounted_blocks', () => {
    const { result } = renderNav({ initialPath: 'src/b.ts' });

    // scrollRef 未挂载 → 无已挂载变更块 → 展开当前文件后重试（无崩溃）
    act(() => {
      result.current.navigateCombinedBlock('next');
    });
    expect(result.current.expandedPaths.has('src/b.ts')).toBe(true);
  });
});
