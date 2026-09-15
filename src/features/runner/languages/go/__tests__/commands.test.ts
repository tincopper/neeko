/**
 * go 命令构造测试（跑测 / 主入口 / 调试前置构建 / 产物定位）
 */
import { describe, expect, it } from 'vitest';

import { TestCaseInfo } from '../../../syntax/contract';
import {
  buildGoDebugBuildCommand,
  buildGoMainDebugBuildCommand,
  buildGoMainRunCommand,
  buildGoRunCommand,
  goDebugBinaryRelPath,
  goTestRunPattern,
} from '../commands';
import { goPkgDir } from '../pkg';

const goCase: TestCaseInfo = { name: 'TestAdd', line: 3, lang: 'go' };

type Probe = (p: string) => Promise<boolean>;

/** Go 包目录（cwd 相对）：向上找 go.mod，嵌套 module 取相对 module 根。 */
const goPkgOf = (relPath: string, runRoot: string | null | undefined, probe?: Probe) =>
  goPkgDir(relPath, runRoot, probe ?? (async () => false));

// 测试侧只做生产 `planTestRun` / `planMainRun` 的等价两步：解析环境事实 → 调纯构造器，
// 断言因此与生产同源，又不必在每个 it 里重复装载 ctx。

const runCmd = async (
  tc: TestCaseInfo,
  relPath: string,
  runRoot: string | null = null,
  probe?: Probe,
) => buildGoRunCommand(tc, await goPkgOf(relPath, runRoot, probe));

const mainRunCmd = async (filePath: string, runRoot: string, opts: { probe?: Probe } = {}) =>
  buildGoMainRunCommand(await goPkgOf(filePath, runRoot, opts.probe));

const mainDebugBuildCmd = async (filePath: string, runRoot: string, opts: { probe?: Probe } = {}) =>
  buildGoMainDebugBuildCommand(await goPkgOf(filePath, runRoot, opts.probe));

describe('buildGoRunCommand', () => {
  const benchCase: TestCaseInfo = {
    name: 'BenchmarkAdd',
    line: 4,
    lang: 'go',
    variant: 'benchmark',
  };
  const goPkg = './pkg/math';

  it('should_build_go_test_command_with_anchored_run_and_json_for_go_cases', async () => {
    expect(await runCmd(goCase, 'pkg/math/add_test.go')).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });

  it('should_use_dot_package_dir_for_root_go_test_files', async () => {
    expect(await runCmd(goCase, 'add_test.go')).toBe("go test -run '^TestAdd$' -json '.'");
  });

  it('should_build_hierarchically_anchored_run_for_go_subtest_targets', async () => {
    // 动态子测试（P3）：test2json 的 `Test` 全名（`TestAdd/positive`）直接作为目标名 →
    // `-run` 层级锚定单跑该子测试；含元字符的段经 \Q…\E 原样引用。
    const subCase: TestCaseInfo = { name: 'TestAdd/with.dot', line: 3, lang: 'go' };
    expect(await runCmd(subCase, 'pkg/math/add_test.go')).toBe(
      "go test -run '^TestAdd$/^\\Qwith.dot\\E$' -json './pkg/math'",
    );
  });

  it('should_resolve_nested_module_pkg_relative_to_module_root_for_go_cases', async () => {
    // 嵌套 module：go.mod 在 `submod/`，包目录取相对 module 根（`./pkg/math`），
    // 而非 cwd 相对（`./submod/pkg/math`）——与 `go test` 的 module 内寻址一致。
    const exists = async (p: string) => ['/proj/submod/go.mod'].includes(p);
    expect(await runCmd(goCase, 'submod/pkg/math/add_test.go', '/proj', exists)).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });

  it('go 命令直接吃已解析的 goPkg（不再自己探测）', () => {
    expect(buildGoRunCommand(goCase, './pkg/math')).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });

  it('Run：-run 置空 + -bench 锚定 + -count=1（benchmark 结果不缓存）', () => {
    expect(buildGoRunCommand(benchCase, goPkg)).toBe(
      "go test -run '^$' -bench '^BenchmarkAdd$' -count=1 -json './pkg/math'",
    );
  });

  it('Run：普通用例命令不受影响（回归）', () => {
    expect(buildGoRunCommand(goCase, goPkg)).toBe("go test -run '^TestAdd$' -json './pkg/math'");
  });
});

describe('buildGoDebugBuildCommand', () => {
  it('should_build_go_test_c_command_with_explicit_output_and_no_optimization', () => {
    expect(buildGoDebugBuildCommand('./pkg/math', '.neeko/test-bin/TestAdd')).toBe(
      "go test -c -o '.neeko/test-bin/TestAdd' -gcflags 'all=-N -l' './pkg/math'",
    );
  });

  it('should_use_dot_package_for_root_files', () => {
    expect(buildGoDebugBuildCommand('.', '.neeko/test-bin/TestAdd')).toBe(
      "go test -c -o '.neeko/test-bin/TestAdd' -gcflags 'all=-N -l' '.'",
    );
  });
});

describe('goDebugBinaryRelPath（子测试名 → `-o` 安全文件名）', () => {
  const BIN_DIR = '.neeko/test-bin/';
  const unsafeOf = (name: string) => goDebugBinaryRelPath(name).slice(BIN_DIR.length);

  it('should_keep_top_level_identifier_names_byte_identical', () => {
    // 顶层用例名是 Go 标识符 → 不发生替换 → 产物名与既有形态逐字节一致（零行为变化）
    expect(goDebugBinaryRelPath('TestAdd')).toBe('.neeko/test-bin/TestAdd');
    expect(goDebugBinaryRelPath('BenchmarkAdd')).toBe('.neeko/test-bin/BenchmarkAdd');
    expect(goDebugBinaryRelPath('main')).toBe('.neeko/test-bin/main');
  });

  it('should_flatten_slashes_into_a_single_safe_segment', () => {
    // `t.Run` 子测试名含 `/`：实测 `go test -c -o` 会自建嵌套目录（能编译），
    // 但会把 .neeko/test-bin 撑成树 → 清洗为单段。前缀里那一个 `/` 是唯一分隔符。
    const rel = goDebugBinaryRelPath('TestTable/with.dot');
    expect(rel.startsWith(BIN_DIR)).toBe(true);
    const segment = unsafeOf('TestTable/with.dot');
    expect(segment).not.toContain('/');
    expect(segment).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(segment.startsWith('TestTable_with.dot')).toBe(true);
  });

  it('should_replace_characters_that_are_illegal_in_windows_filenames', () => {
    // `:` 等在本机（macOS/Linux）合法 —— 本地开发不暴露，Windows 上 `-o` 直接失败。
    // 覆盖 Windows 保留字符全集，保证跨平台可用。
    const reserved = [':', '*', '?', '"', '<', '>', '|', '\\'];
    const forbidden = reserved.filter((ch) => unsafeOf(`TestTable/a${ch}b`).includes(ch));
    expect(forbidden).toEqual([]);
  });

  it('should_be_deterministic_for_the_same_name', () => {
    expect(goDebugBinaryRelPath('TestTable/zero')).toBe(goDebugBinaryRelPath('TestTable/zero'));
  });

  it('should_not_collide_when_two_names_sanitize_to_the_same_segment', () => {
    // `TestTable/zero` 与 `TestTable_zero` 清洗后同形 —— 共用产物文件会让后一次构建
    // 覆盖前一个二进制，调试时挂到错误的 target 上。原名哈希后缀保证唯一。
    expect(goDebugBinaryRelPath('TestTable/zero')).not.toBe(goDebugBinaryRelPath('TestTable_zero'));
  });

  it('should_not_collide_across_different_unsafe_characters', () => {
    expect(goDebugBinaryRelPath('TestTable/a:b')).not.toBe(goDebugBinaryRelPath('TestTable/a/b'));
  });
});

describe('goTestRunPattern（Go -run/-test.run 层级锚定；GoLand 同款）', () => {
  const anchored = (name: string) => [name, goTestRunPattern(name)];

  it('顶层用例名是标识符 → 与既有 `^Name$` 逐字节一致（零行为变化）', () => {
    expect(anchored('TestAdd')).toEqual(['TestAdd', '^TestAdd$']);
    expect(goTestRunPattern('BenchmarkAdd')).toBe('^BenchmarkAdd$');
  });

  it('子测试按 `/` 分段独立锚定（裸标识符段不加 \\Q\\E，减少噪音）', () => {
    expect(goTestRunPattern('TestTable/positive')).toBe('^TestTable$/^positive$');
    expect(goTestRunPattern('TestNested/outer/inner')).toBe('^TestNested$/^outer$/^inner$');
  });

  it('含正则元字符的段用 \\Q…\\E 原样引用（t.Run 名可任意；实测未引用 `^a+b$` 匹配不到字面量 `a+b`）', () => {
    expect(goTestRunPattern('TestTable/with.dot')).toBe('^TestTable$/^\\Qwith.dot\\E$');
    expect(goTestRunPattern('TestTable/a+b')).toBe('^TestTable$/^\\Qa+b\\E$');
    expect(goTestRunPattern('TestTable/a|b')).toBe('^TestTable$/^\\Qa|b\\E$');
    expect(goTestRunPattern('TestTable/(x)[y]')).toBe('^TestTable$/^\\Q(x)[y]\\E$');
  });
});

describe('buildGoMainRunCommand', () => {
  it('Go：go run 包目录（module 感知）', async () => {
    const probe = async (p: string) => p === '/tmp/proj/go.mod';
    await expect(mainRunCmd('pkg/math/main.go', '/tmp/proj', { probe })).resolves.toBe(
      "go run './pkg/math'",
    );
  });
});

describe('buildGoMainDebugBuildCommand', () => {
  it('Go：go build -o .neeko/test-bin/main + 无优化 gcflags', async () => {
    const probe = async (p: string) => p === '/tmp/proj/go.mod';
    await expect(mainDebugBuildCmd('cmd/agent/main.go', '/tmp/proj', { probe })).resolves.toBe(
      "go build -o '.neeko/test-bin/main' -gcflags 'all=-N -l' './cmd/agent'",
    );
  });
});
