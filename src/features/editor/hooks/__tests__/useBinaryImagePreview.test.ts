import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTab, ProjectEnvironment } from '@/shared/types';

import { useBinaryImagePreview } from '../useBinaryImagePreview';

function fileTab(filePath: string, isBinary: boolean): FileTab {
  return {
    id: 't1',
    projectId: 'p1',
    filePath,
    fileName: filePath.split('/').pop() ?? filePath,
    content: { path: filePath, content: '', size: 10, is_binary: isBinary },
    isDirty: false,
    order: 0,
  };
}

function seedEnvironment(environment: ProjectEnvironment) {
  useProjectStore.setState({ projects: [{ id: 'p1', environment }] as never });
}

describe('useBinaryImagePreview — 本地图片预览可用性', () => {
  beforeEach(() => {
    seedEnvironment({ type: 'Local' });
  });

  it('should_preview_binary_image_on_local_project', () => {
    const { result } = renderHook(() => useBinaryImagePreview(fileTab('/repo/a.png', true)));
    expect(result.current).toBe(true);
  });

  it('should_not_preview_on_wsl_or_remote（asset 协议取不到远程文件）', () => {
    seedEnvironment({ type: 'Wsl', distro: 'Ubuntu' });
    expect(
      renderHook(() => useBinaryImagePreview(fileTab('/repo/a.png', true))).result.current,
    ).toBe(false);
    seedEnvironment({
      type: 'Remote',
      host: 'h',
      port: 22,
      username: 'u',
      auth: { Password: 'x' },
    });
    expect(
      renderHook(() => useBinaryImagePreview(fileTab('/repo/a.png', true))).result.current,
    ).toBe(false);
  });

  it('should_not_preview_when_not_binary_or_not_image', () => {
    // 文本内容 → 走常规编辑器
    expect(
      renderHook(() => useBinaryImagePreview(fileTab('/repo/a.png', false))).result.current,
    ).toBe(false);
    // 二进制但非图片 → 走二进制兜底视图
    expect(
      renderHook(() => useBinaryImagePreview(fileTab('/repo/a.bin', true))).result.current,
    ).toBe(false);
  });

  it('should_not_preview_when_project_unknown', () => {
    useProjectStore.setState({ projects: [] as never });
    expect(
      renderHook(() => useBinaryImagePreview(fileTab('/repo/a.png', true))).result.current,
    ).toBe(false);
  });
});
