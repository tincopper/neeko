import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCargoManifestCache, resolveCargoManifestDir } from '../cargoManifest';

vi.mock('@/features/file/api/fileApi', () => ({ fileExists: vi.fn() }));

const { fileExists } = await import('@/features/file/api/fileApi');
const fileExistsMock = vi.mocked(fileExists);

/** 探测便捷构造：按路径集合返回 exists 结果。 */
function probeReturning(exists: string[]): (path: string) => Promise<boolean> {
  return (path) => Promise.resolve(exists.includes(path));
}

beforeEach(() => {
  clearCargoManifestCache();
  fileExistsMock.mockReset();
});

describe('resolveCargoManifestDir', () => {
  it('should_return_null_for_root_manifest_layout', async () => {
    const probe = vi.fn(probeReturning(['/proj/Cargo.toml']));
    await expect(resolveCargoManifestDir('/proj', probe)).resolves.toBeNull();
    expect(probe).toHaveBeenCalledWith('/proj/Cargo.toml');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('should_return_src_tauri_for_tauri_layout', async () => {
    const probe = vi.fn(probeReturning(['/proj/src-tauri/Cargo.toml']));
    await expect(resolveCargoManifestDir('/proj', probe)).resolves.toBe('src-tauri');
    expect(probe).toHaveBeenCalledWith('/proj/Cargo.toml');
    expect(probe).toHaveBeenCalledWith('/proj/src-tauri/Cargo.toml');
  });

  it('should_return_null_when_no_manifest_found', async () => {
    const probe = vi.fn(probeReturning([]));
    await expect(resolveCargoManifestDir('/proj', probe)).resolves.toBeNull();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('should_cache_result_per_project_root', async () => {
    const probe = vi.fn(probeReturning(['/proj/src-tauri/Cargo.toml']));
    await resolveCargoManifestDir('/proj', probe);
    await resolveCargoManifestDir('/proj', probe);
    expect(probe).toHaveBeenCalledTimes(2); // 首次探测 2 次，第二次全缓存
    await resolveCargoManifestDir('/other', probe);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it('should_trim_trailing_slashes_from_root', async () => {
    const probe = vi.fn(probeReturning(['/proj/src-tauri/Cargo.toml']));
    await expect(resolveCargoManifestDir('/proj/', probe)).resolves.toBe('src-tauri');
    expect(probe).toHaveBeenCalledWith('/proj/src-tauri/Cargo.toml');
  });

  it('should_return_null_for_empty_root_without_probe', async () => {
    const probe = vi.fn();
    await expect(resolveCargoManifestDir('', probe)).resolves.toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('should_fall_back_to_null_when_probe_rejects', async () => {
    const probe = vi.fn(() => Promise.reject(new Error('ipc down')));
    await expect(resolveCargoManifestDir('/proj', probe)).resolves.toBeNull();
  });
});
