// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { FileTab } from '@/shared/types';

import { fileEditorFallbackKind } from '../FileEditorFallback';

const tab = (opts: { isBinary?: boolean; size?: number } = {}): FileTab =>
  ({
    content: { is_binary: opts.isBinary ?? false, size: opts.size ?? 0 },
  }) as FileTab;

const HALF_MB = 512 * 1024;

describe('fileEditorFallbackKind（只读兜底视图判定）', () => {
  it('普通文件 → null（可正常编辑）', () => {
    expect(fileEditorFallbackKind(tab(), false)).toBeNull();
    // 恰好 512KB 仍可编辑（判定为严格大于）
    expect(fileEditorFallbackKind(tab({ size: HALF_MB }), false)).toBeNull();
  });

  it('二进制：本地图片 → image，其余 → binary', () => {
    expect(fileEditorFallbackKind(tab({ isBinary: true }), true)).toBe('image');
    expect(fileEditorFallbackKind(tab({ isBinary: true }), false)).toBe('binary');
  });

  it('超大文件（> 512KB）→ oversized', () => {
    expect(fileEditorFallbackKind(tab({ size: HALF_MB + 1 }), false)).toBe('oversized');
  });

  it('优先级：二进制判定先于超大（二进制且超大 → binary/image，不落 oversized）', () => {
    const hugeBinary = { isBinary: true, size: 10 * 1024 * 1024 };
    expect(fileEditorFallbackKind(tab(hugeBinary), false)).toBe('binary');
    expect(fileEditorFallbackKind(tab(hugeBinary), true)).toBe('image');
  });
});
