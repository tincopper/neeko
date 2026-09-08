import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCargoManifestCache,
  resolveCargoManifestDir,
  resolveCargoManifestDirForFile,
} from '../cargoManifest';

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

describe('resolveCargoManifestDirForFile', () => {
  it('should_locate_root_manifest_from_src_module', async () => {
    const probe = vi.fn(probeReturning(['/proj/Cargo.toml']));
    await expect(
      resolveCargoManifestDirForFile('/proj', 'src/agent/chat/serve.rs', probe),
    ).resolves.toBeNull();
    expect(probe).toHaveBeenCalledWith('/proj/src/agent/chat/Cargo.toml');
    expect(probe).toHaveBeenCalledWith('/proj/Cargo.toml');
  });

  it('should_locate_src_tauri_member_from_nested_module', async () => {
    const probe = vi.fn(probeReturning(['/proj/src-tauri/Cargo.toml']));
    await expect(
      resolveCargoManifestDirForFile('/proj', 'src-tauri/src/agent/chat/adapter/serve.rs', probe),
    ).resolves.toBe('src-tauri');
    expect(probe).toHaveBeenCalledWith('/proj/src-tauri/src/agent/chat/adapter/Cargo.toml');
    expect(probe).toHaveBeenCalledWith('/proj/src-tauri/Cargo.toml');
  });

  it('should_locate_workspace_member_crate', async () => {
    // workspace 根只有 [workspace]：被编辑文件在 member 内 → 指到 member 的 Cargo.toml
    const probe = vi.fn(probeReturning(['/proj/packages/foo/Cargo.toml']));
    await expect(
      resolveCargoManifestDirForFile('/proj', 'packages/foo/src/lib.rs', probe),
    ).resolves.toBe('packages/foo');
    expect(probe).toHaveBeenCalledWith('/proj/packages/foo/src/Cargo.toml');
    expect(probe).toHaveBeenCalledWith('/proj/packages/foo/Cargo.toml');
  });

  it('should_prefer_nearest_manifest_over_root', async () => {
    // 嵌套 crate（member 有独立 Cargo.toml 且根也有）：取最近的
    const probe = vi.fn(probeReturning(['/proj/Cargo.toml', '/proj/packages/foo/Cargo.toml']));
    await expect(
      resolveCargoManifestDirForFile('/proj', 'packages/foo/src/lib.rs', probe),
    ).resolves.toBe('packages/foo');
  });

  it('should_fall_back_to_root_resolver_for_empty_file_path', async () => {
    const probe = vi.fn(probeReturning(['/proj/src-tauri/Cargo.toml']));
    await expect(resolveCargoManifestDirForFile('/proj', '', probe)).resolves.toBe('src-tauri');
  });
});
