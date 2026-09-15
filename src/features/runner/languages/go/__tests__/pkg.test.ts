/**
 * go 包目录与 module 根探测
 */
import { describe, expect, it } from 'vitest';

import { findGoModuleDir, goPkgDir } from '../pkg';

type Probe = (p: string) => Promise<boolean>;

describe('findGoModuleDir', () => {
  const exists = (existing: string[]) => async (p: string) => existing.includes(p);

  it('should_return_empty_string_for_root_module_go_mod_at_run_root', async () => {
    const probe = exists(['/proj/go.mod']);
    expect(await findGoModuleDir('pkg/math/add_test.go', '/proj', probe)).toBe('');
  });

  it('should_return_nested_module_dir_when_go_mod_is_in_subdir', async () => {
    const probe = exists(['/proj/submod/go.mod']);
    expect(await findGoModuleDir('submod/pkg/math/add_test.go', '/proj', probe)).toBe('submod');
  });

  it('should_return_null_when_no_go_mod_found_up_to_run_root', async () => {
    const probe = exists([]);
    expect(await findGoModuleDir('pkg/math/add_test.go', '/proj', probe)).toBeNull();
  });

  it('should_return_null_for_empty_run_root_or_file_path', async () => {
    expect(await findGoModuleDir('pkg/math/add_test.go', '', async () => true)).toBeNull();
    expect(await findGoModuleDir('', '/proj', async () => true)).toBeNull();
  });

  it('should_return_null_and_fall_back_when_probe_throws', async () => {
    const probe = async () => {
      throw new Error('ipc down');
    };
    expect(await findGoModuleDir('pkg/math/add_test.go', '/proj', probe)).toBeNull();
  });

  it('should_accept_canonical_absolute_file_paths_from_production', async () => {
    // 生产传入 tab.filePath（canonical 绝对）——不剥根时会拼成
    // `/proj//proj/…`，模块探测永不命中。
    const root = exists(['/proj/go.mod']);
    expect(await findGoModuleDir('/proj/pkg/math/add_test.go', '/proj', root)).toBe('');
    const nested = exists(['/proj/submod/go.mod']);
    expect(await findGoModuleDir('/proj/submod/pkg/math/add_test.go', '/proj', nested)).toBe(
      'submod',
    );
  });
});

describe('goPkgDir', () => {
  const exists = (existing: string[]) => async (p: string) => existing.includes(p);

  it('should_derive_package_directory_from_file_path', async () => {
    expect(await goPkgDir('pkg/math/add_test.go', null, exists([]))).toBe('./pkg/math');
    expect(await goPkgDir('add_test.go', null, exists([]))).toBe('.');
  });

  it('should_normalize_windows_separators', async () => {
    expect(await goPkgDir('pkg\\math\\add_test.go', null, exists([]))).toBe('./pkg/math');
  });

  it('should_resolve_root_module_package_relative_to_run_root', async () => {
    const probe = exists(['/proj/go.mod']);
    expect(await goPkgDir('pkg/math/add_test.go', '/proj', probe)).toBe('./pkg/math');
    expect(await goPkgDir('add_test.go', '/proj', probe)).toBe('.');
  });

  it('should_resolve_nested_module_package_relative_to_module_root', async () => {
    // 嵌套 module：go.mod 在 `submod/`，包目录相对 module 根（`./pkg/math`），
    // 而非 cwd 相对（`./submod/pkg/math`）；文件在 module 根时返回 `.`。
    const probe = exists(['/proj/submod/go.mod']);
    expect(await goPkgDir('submod/pkg/math/add_test.go', '/proj', probe)).toBe('./pkg/math');
    expect(await goPkgDir('submod/add_test.go', '/proj', probe)).toBe('.');
  });

  it('should_fall_back_to_file_dir_when_no_go_mod_found', async () => {
    const probe = exists([]);
    expect(await goPkgDir('pkg/math/add_test.go', '/proj', probe)).toBe('./pkg/math');
    expect(await goPkgDir('add_test.go', '/proj', probe)).toBe('.');
  });

  it('should_resolve_package_from_canonical_absolute_file_path', async () => {
    // 生产链路传入 canonical 绝对路径（codeant `cmd/agent/main.go` 实测回归）：
    // 不剥根会产出 `./Users/…/cmd/agent` 伪包路径 → go run / go build 秒失败。
    expect(await goPkgDir('/proj/cmd/agent/main.go', '/proj', exists(['/proj/go.mod']))).toBe(
      './cmd/agent',
    );
    expect(
      await goPkgDir('/proj/submod/pkg/math/add_test.go', '/proj', exists(['/proj/submod/go.mod'])),
    ).toBe('./pkg/math');
  });

  it('should_fall_back_to_file_dir_for_absolute_path_without_go_mod', async () => {
    expect(await goPkgDir('/proj/cmd/agent/main.go', '/proj', exists([]))).toBe('./cmd/agent');
  });

  it('should_fall_back_to_cwd_when_file_is_outside_run_root', async () => {
    // 无法表达为 cwd 相对（worktree 错配等）→ 兜底 cwd，不产出假路径。
    expect(await goPkgDir('/elsewhere/cmd/agent/main.go', '/proj', exists([]))).toBe('.');
  });

  it('go：按 go.mod 边界解析包目录（嵌套 module 取相对 module 根）', async () => {
    const probe: Probe = async (p) => p === '/proj/submod/go.mod';
    expect(await goPkgDir('submod/pkg/math/add_test.go', '/proj', probe)).toBe('./pkg/math');
  });
});
