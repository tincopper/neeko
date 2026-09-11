import { describe, expect, it } from 'vitest';

import type { LspRunnable } from '../../runnables/runnable';
import type { MainLang } from '../mainEntries';
import {
  buildMainDebugBuildCommand,
  buildMainRunCommand,
  buildRunCommand,
  resolveRunContext,
} from '../runLanguages';
import type { TestCaseInfo } from '../testCases';
import {
  buildDebugBuildCommand,
  parseCargoBinaryPath,
  buildMainJavaDebugCommand,
  buildMainDebugLaunchConfig,
  buildDebugLaunchConfig,
  buildGoDebugBuildCommand,
  buildJavaClasspath,
  buildJavaDebugCommand,
  buildJavaLauncherPath,
  buildJunitReportsDir,
  buildMavenClasspathCommand,
  buildMavenClasspathPath,
  buildTestConfigId,
  buildVitestReportPath,
  defaultRunContext,
  deriveJavaFqcn,
  findGoModuleDir,
  findJavaModuleDir,
  goDebugBinaryRelPath,
  goPkgDir,
  goTestRunPattern,
  javaCompiledClassExists,
  JUNIT_CONSOLE_LAUNCHER_VERSION,
  junitLauncherJarName,
  parseClasspathOutput,
  parseTestBinaryPath,
  resolveBinaryPath,
  resolveJavaClasspath,
  resolveTestTargetFlag,
  shellToken,
  type JavaRunEnv,
  type ReadTextProbe,
} from '../testCommands';

const tsCase: TestCaseInfo = { name: 'adds numbers', line: 2, lang: 'ts' };
const rustCase: TestCaseInfo = { name: 'parse_simple', line: 1, lang: 'rust' };
const goCase: TestCaseInfo = { name: 'TestAdd', line: 3, lang: 'go' };
const javaCase: TestCaseInfo = { name: 'testAdd', line: 4, lang: 'java' };

// ── 测试便捷：resolve（IO 边界）+ 纯构造两步 ──────────────────────────────────
// 生产调用方（useRunActions）亦按此两步调用；此处包一层仅为保持既有断言体可读。
// 纯构造本身另有直测（`build*Command 纯函数` 块，无 IO 语言零 await）。

async function runCmd(
  tc: TestCaseInfo,
  relPath: string,
  manifestDir: string | null = null,
  runRoot: string | null = null,
  probe?: (p: string) => Promise<boolean>,
  javaEnv?: JavaRunEnv,
): Promise<string> {
  const ctx = await resolveRunContext(tc.lang, relPath, runRoot, { probe, javaEnv });
  return buildRunCommand(tc, relPath, manifestDir, runRoot, ctx);
}

async function mainRunCmd(
  lang: MainLang,
  filePath: string,
  runRoot: string,
  opts: {
    manifestDir?: string | null;
    probe?: (p: string) => Promise<boolean>;
    javaEnv?: JavaRunEnv;
  } = {},
): Promise<string> {
  const ctx = await resolveRunContext(lang, filePath, runRoot, {
    probe: opts.probe,
    javaEnv: opts.javaEnv,
  });
  return buildMainRunCommand(lang, filePath, runRoot, ctx, { manifestDir: opts.manifestDir });
}

async function javaDebugCmd(
  tc: TestCaseInfo,
  relPath: string,
  runRoot: string | null | undefined,
  javaEnv?: JavaRunEnv,
): Promise<string> {
  const ctx = await resolveRunContext('java', relPath, runRoot, { javaEnv });
  return buildJavaDebugCommand(tc, relPath, runRoot, ctx);
}

async function mainJavaDebugCmd(
  filePath: string,
  runRoot: string,
  javaEnv: JavaRunEnv,
): Promise<string> {
  const ctx = await resolveRunContext('java', filePath, runRoot, { javaEnv });
  return buildMainJavaDebugCommand(filePath, runRoot, ctx);
}

async function mainDebugBuildCmd(
  lang: 'go' | 'rust',
  filePath: string,
  runRoot: string,
  opts: { manifestDir?: string | null; probe?: (p: string) => Promise<boolean> } = {},
): Promise<string> {
  const ctx = await resolveRunContext(lang, filePath, runRoot, { probe: opts.probe });
  return buildMainDebugBuildCommand(lang, ctx, { manifestDir: opts.manifestDir });
}

describe('buildRunCommand', () => {
  it('should_build_vitest_command_with_json_report_output_for_ts_cases', async () => {
    expect(await runCmd(tsCase, 'src/a.test.ts', null, '/tmp/proj')).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_fall_back_to_relative_report_path_without_run_root', async () => {
    expect(await runCmd(tsCase, 'src/a.test.ts')).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_build_cargo_test_with_libtest_json_via_posix_env_prefix_for_rust_cases', async () => {
    expect(await runCmd(rustCase, 'src/lib.rs')).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('should_append_manifest_path_before_harness_separator_for_subdir_cargo_layouts', async () => {
    expect(await runCmd(rustCase, 'src-tauri/tests/x.rs', 'src-tauri')).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' --manifest-path 'src-tauri/Cargo.toml'" +
        ' -- -Z unstable-options --format=json --show-output',
    );
  });

  it('should_not_append_manifest_args_for_null_hint', async () => {
    expect(await runCmd(rustCase, 'src/lib.rs', null)).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('should_single_quote_escape_names_with_quotes_and_spaces', async () => {
    expect(await runCmd({ ...tsCase, name: "it's fine" }, 'src/a.test.ts', null, '/tmp/proj')).toBe(
      `pnpm vitest run 'src/a.test.ts' -t 'it'\\''s fine'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
    expect(
      await runCmd({ ...tsCase, name: 'has "double" quotes' }, 'src/a.test.ts', null, '/tmp/proj'),
    ).toBe(
      `pnpm vitest run 'src/a.test.ts' -t 'has "double" quotes'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_quote_relative_paths_containing_spaces', async () => {
    expect(await runCmd(tsCase, 'src/my folder/a.test.ts', null, '/tmp/proj')).toBe(
      `pnpm vitest run 'src/my folder/a.test.ts' -t 'adds numbers'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

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
    expect(await runCmd(goCase, 'submod/pkg/math/add_test.go', null, '/proj', exists)).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });

  it('should_build_junit_launcher_command_for_java_cases', async () => {
    // JUnit Platform Console Launcher：launcher（~/.neeko/ 缓存）+ --class-path
    // （target/ 自编译输出；无 Maven 依赖产物时退化为仅 target/）+ 类/方法选择器
    // + reports-dir（run 根下 .neeko）。
    const homeEnv: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
    };
    expect(
      await runCmd(
        javaCase,
        'src/test/java/com/example/CalculatorTest.java',
        null,
        '/proj',
        undefined,
        homeEnv,
      ),
    ).toBe(
      `java -jar '/Users/tester/.neeko/${junitLauncherJarName()}'` +
        " --class-path='/proj/target/classes:/proj/target/test-classes'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/proj/.neeko/junit-reports'",
    );
  });

  it('should_select_only_method_without_class_selector', async () => {
    // `-c` 与 `-m` 是 OR 语义（多 selector 取并集）：同传 `-c` 会选中全类，
    // 单用例 Run/Debug 必须只传 `-m`（实证：选 test1 却跑了整文件）。
    const env: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
    };
    const run = await runCmd(
      javaCase,
      'src/test/java/com/example/CalculatorTest.java',
      null,
      '/proj',
      undefined,
      env,
    );
    expect(run).toContain(" -m 'com.example.CalculatorTest#testAdd'");
    expect(run).not.toMatch(/(^|\s)-c\s/);
  });

  it('should_append_maven_deps_to_classpath_when_artifact_present', async () => {
    // Maven build-classpath 产物（.neeko/java-classpath.txt）经 resolveJavaClasspath
    // 读入 → `--class-path` 追加依赖 jar（target/ 目录仍前置拼接，research §3.1）。
    const depsEnv: JavaRunEnv = {
      launcherPath: '/opt/neeko/junit-platform-console-standalone.jar',
      readText: async () => '/root/.m2/repository/junit/jupiter-api.jar:/root/.m2/a.jar',
    };
    expect(
      await runCmd(
        javaCase,
        'src/test/java/com/example/CalculatorTest.java',
        null,
        '/proj',
        undefined,
        depsEnv,
      ),
    ).toBe(
      "java -jar '/opt/neeko/junit-platform-console-standalone.jar'" +
        " --class-path='/proj/target/classes:/proj/target/test-classes:/root/.m2/repository/junit/jupiter-api.jar:/root/.m2/a.jar'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/proj/.neeko/junit-reports'",
    );
  });

  it('should_fall_back_to_versioned_launcher_name_and_relative_target_classpath_without_env', async () => {
    // 无 JavaRunEnv（未注入 home/launcher）：回退 bare launcher 文件名（含版本，shQuote 包裹），
    // run 根空 → target/ 相对目录（命令 cwd 即 run 根）。
    const cmd = await runCmd(javaCase, 'src/test/java/CalculatorTest.java');
    expect(cmd).toContain(`java -jar '${junitLauncherJarName()}'`);
    expect(cmd).toContain("--class-path='target/classes:target/test-classes'");
  });

  it('should_derive_default_package_fqcn_for_root_test_files', async () => {
    // 默认包边界：文件直接位于 src/test/java/ 下 → FQCN 仅类名
    expect(
      await runCmd(javaCase, 'src/test/java/CalculatorTest.java', null, '/proj', undefined, {
        launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
        readText: async () => null,
      }),
    ).toBe(
      `java -jar '/Users/tester/.neeko/${junitLauncherJarName()}'` +
        " --class-path='/proj/target/classes:/proj/target/test-classes'" +
        " -m 'CalculatorTest#testAdd' --reports-dir='/proj/.neeko/junit-reports'",
    );
  });

  it('should_quote_reports_dir_with_spaces_in_run_root', async () => {
    expect(
      await runCmd(
        javaCase,
        'src/test/java/com/example/CalculatorTest.java',
        null,
        '/proj/my project',
        undefined,
        {
          launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
          readText: async () => null,
        },
      ),
    ).toBe(
      `java -jar '/Users/tester/.neeko/${junitLauncherJarName()}'` +
        " --class-path='/proj/my project/target/classes:/proj/my project/target/test-classes'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/proj/my project/.neeko/junit-reports'",
    );
  });
});

describe('deriveJavaFqcn', () => {
  it('should_map_src_test_java_path_to_fqcn', () => {
    expect(deriveJavaFqcn('src/test/java/com/example/CalculatorTest.java')).toBe(
      'com.example.CalculatorTest',
    );
    expect(deriveJavaFqcn('src/test/java/org/foo/BarTests.java')).toBe('org.foo.BarTests');
  });

  it('should_return_class_name_for_default_package', () => {
    expect(deriveJavaFqcn('src/test/java/CalculatorTest.java')).toBe('CalculatorTest');
  });

  it('should_normalize_windows_separators', () => {
    expect(deriveJavaFqcn('src\\test\\java\\com\\example\\CalculatorTest.java')).toBe(
      'com.example.CalculatorTest',
    );
  });

  it('should_map_src_main_java_path_to_fqcn', () => {
    // 学习工程把用例放 src/main/java：必须剥离源根而非把目录全拼进类名
    //（实证：learning-algorithm/src/main/java/com/tomgs/.../ArrayTest 被误推导为
    // learning-algorithm.src.main.java.com... 导致 Console Launcher 0 tests found）。
    expect(
      deriveJavaFqcn('learning-algorithm/src/main/java/com/tomgs/algorithm/array/ArrayTest.java'),
    ).toBe('com.tomgs.algorithm.array.ArrayTest');
    expect(deriveJavaFqcn('src/main/java/com/example/CalculatorTest.java')).toBe(
      'com.example.CalculatorTest',
    );
  });
  it('should_fall_back_to_directory_levels_when_marker_absent', () => {
    expect(deriveJavaFqcn('test/com/example/CalculatorTest.java')).toBe(
      'test.com.example.CalculatorTest',
    );
  });
});

describe('findJavaModuleDir', () => {
  it('should_return_nested_module_dir_for_multimodule_layout', async () => {
    const probe = async (p: string) => p === '/tmp/proj/learning-algorithm/pom.xml';
    await expect(
      findJavaModuleDir(
        'learning-algorithm/src/main/java/com/tomgs/algorithm/base/BaseTest.java',
        '/tmp/proj',
        probe,
      ),
    ).resolves.toBe('learning-algorithm');
  });

  it('should_return_empty_for_root_module_and_support_gradle_markers', async () => {
    const maven = async (p: string) => p === '/tmp/proj/pom.xml';
    await expect(
      findJavaModuleDir('src/test/java/com/example/CalcTest.java', '/tmp/proj', maven),
    ).resolves.toBe('');
    const gradle = async (p: string) => p === '/tmp/proj/build.gradle.kts';
    await expect(
      findJavaModuleDir('src/test/java/com/example/CalcTest.java', '/tmp/proj', gradle),
    ).resolves.toBe('');
  });

  it('should_accept_canonical_absolute_file_paths_from_production', async () => {
    // 生产链路（FileEditor → useRunActions）传入 tab.filePath —— 恒为 canonical 绝对；
    // 探测以「runRoot 相对」为前提拼 `${root}/${dir}`，绝对路径必须先剥根。
    const probe = async (p: string) => p === '/tmp/proj/learning-algorithm/pom.xml';
    await expect(
      findJavaModuleDir(
        '/tmp/proj/learning-algorithm/src/main/java/com/tomgs/algorithm/base/BaseTest.java',
        '/tmp/proj',
        probe,
      ),
    ).resolves.toBe('learning-algorithm');
  });

  it('should_return_null_when_no_marker_or_probe_fails', async () => {
    const none = async () => false;
    await expect(
      findJavaModuleDir('src/main/java/com/example/A.java', '/tmp/proj', none),
    ).resolves.toBeNull();
    const failing = async (): Promise<boolean> => {
      throw new Error('ipc down');
    };
    await expect(
      findJavaModuleDir('src/main/java/com/example/A.java', '/tmp/proj', failing),
    ).resolves.toBeNull();
  });
});

describe('javaCompiledClassExists', () => {
  it('should_hit_maven_test_classes_output', async () => {
    const probe = async (p: string) =>
      p === '/tmp/proj/learning-algorithm/target/test-classes/com/tomgs/BaseTest.class';
    await expect(
      javaCompiledClassExists('/tmp/proj/learning-algorithm', 'com.tomgs.BaseTest', probe),
    ).resolves.toBe(true);
  });

  it('should_hit_gradle_main_output_and_miss_when_uncompiled', async () => {
    const probe = async (p: string) =>
      p === '/tmp/proj/build/classes/java/main/com/example/App.class';
    await expect(javaCompiledClassExists('/tmp/proj', 'com.example.App', probe)).resolves.toBe(
      true,
    );
    await expect(javaCompiledClassExists('/tmp/proj', 'com.example.Missing', probe)).resolves.toBe(
      false,
    );
  });
});

describe('buildJunitReportsDir', () => {
  it('should_join_reports_dir_under_neeko_of_run_root', () => {
    expect(buildJunitReportsDir('/proj')).toBe('/proj/.neeko/junit-reports');
    expect(buildJunitReportsDir('/proj/')).toBe('/proj/.neeko/junit-reports');
  });

  it('should_return_relative_dir_for_empty_root', () => {
    expect(buildJunitReportsDir('')).toBe('.neeko/junit-reports');
  });
});

describe('resolveJavaClasspath (maven)', () => {
  it('should_build_maven_build_classpath_command_with_output_file', () => {
    expect(buildMavenClasspathCommand('/proj')).toBe(
      "mvn dependency:build-classpath -Dmdep.outputFile='/proj/.neeko/java-classpath.txt'",
    );
  });

  it('should_build_classpath_path_under_neeko_of_run_root', () => {
    expect(buildMavenClasspathPath('/proj')).toBe('/proj/.neeko/java-classpath.txt');
    expect(buildMavenClasspathPath('')).toBe('.neeko/java-classpath.txt');
  });

  it('should_parse_single_line_classpath_output', () => {
    const line = '/root/.m2/repository/junit/jupiter-api.jar:/root/.m2/repository/a/b.jar';
    expect(parseClasspathOutput(`${line}\n`)).toBe(line);
  });

  it('should_trim_whitespace_and_empty_lines', () => {
    expect(parseClasspathOutput('  /a.jar  \n\n  /b.jar\n')).toBe('/a.jar:/b.jar');
  });
});

describe('buildVitestReportPath', () => {
  it('should_join_report_path_under_node_modules_neeko_of_project_root', () => {
    expect(buildVitestReportPath('/tmp/proj')).toBe(
      '/tmp/proj/node_modules/.neeko/vitest-report.json',
    );
    expect(buildVitestReportPath('/tmp/proj/')).toBe(
      '/tmp/proj/node_modules/.neeko/vitest-report.json',
    );
  });

  it('should_return_relative_path_for_empty_root', () => {
    expect(buildVitestReportPath('')).toBe('node_modules/.neeko/vitest-report.json');
  });
});

describe('buildDebugBuildCommand', () => {
  it('should_build_cargo_no_run_command_with_artifact_json_for_rust_cases', () => {
    // C4：产物定位走结构化协议 —— `--message-format=json` 输出 compiler-artifact，
    // 不再靠正则猜 `Running unittests` 行。
    expect(buildDebugBuildCommand(rustCase)).toBe(
      "cargo test 'parse_simple' --no-run --message-format=json",
    );
  });

  it('should_append_manifest_path_to_no_run_for_subdir_layouts', () => {
    expect(buildDebugBuildCommand(rustCase, 'src-tauri')).toBe(
      "cargo test 'parse_simple' --no-run --manifest-path 'src-tauri/Cargo.toml' --message-format=json",
    );
  });

  it('should_throw_for_non_rust_cases_debug_is_rust_only', () => {
    expect(() => buildDebugBuildCommand(tsCase)).toThrow();
  });

  it('should_append_target_flag_between_no_run_and_manifest', () => {
    expect(buildDebugBuildCommand(rustCase, 'src-tauri', '--lib')).toBe(
      "cargo test 'parse_simple' --no-run --lib --manifest-path 'src-tauri/Cargo.toml' --message-format=json",
    );
    expect(buildDebugBuildCommand(rustCase, null, '--test unit')).toBe(
      "cargo test 'parse_simple' --no-run --test unit --message-format=json",
    );
  });
});

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
    expect(await goPkgDir('pkg/math/add_test.go')).toBe('./pkg/math');
    expect(await goPkgDir('add_test.go')).toBe('.');
  });

  it('should_normalize_windows_separators', async () => {
    expect(await goPkgDir('pkg\\math\\add_test.go')).toBe('./pkg/math');
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

describe('buildDebugLaunchConfig', () => {
  it('should_build_lldb_config_for_rust_cases', () => {
    expect(buildDebugLaunchConfig(rustCase, '/proj/target/debug/deps/neeko-abc', '/proj')).toEqual({
      name: 'Debug test: parse_simple',
      type: 'lldb',
      request: 'launch',
      program: '/proj/target/debug/deps/neeko-abc',
      cwd: '/proj',
      args: ['parse_simple'],
      stopOnEntry: false,
    });
  });

  it('should_build_go_exec_config_with_anchored_test_run_pattern_for_go_cases', () => {
    expect(buildDebugLaunchConfig(goCase, '/proj/.neeko/test-bin/TestAdd', '/proj')).toEqual({
      name: 'Debug test: TestAdd',
      type: 'go',
      request: 'launch',
      program: '/proj/.neeko/test-bin/TestAdd',
      cwd: '/proj',
      mode: 'exec',
      args: ['^TestAdd$'],
      stopOnEntry: false,
    });
  });

  it('子测试目标 → args 用层级锚定模式（dlv `-test.run` 单跑该子测试）', () => {
    // 动态子测试（P3）与 Run 共用同一模式构造：避免两条链路各自拼 -test.run 而漂移。
    const subCase: TestCaseInfo = { name: 'TestTable/with.dot', line: 3, lang: 'go' };
    expect(buildDebugLaunchConfig(subCase, '/proj/.neeko/test-bin/x', '/proj').args).toEqual([
      '^TestTable$/^\\Qwith.dot\\E$',
    ]);
  });
});

describe('buildJavaDebugCommand', () => {
  // J3 attach-first：与 Run 命令同源（FQCN/reports-dir/classpath 推导一致），仅注入
  // jdwp 参数 `-agentlib:jdwp=...,server=y,suspend=y,address=0`（JVM 自选端口，
  // 后端解析 stdout `Listening for transport dt_socket at address: <port>`）。
  const homeEnv: JavaRunEnv = {
    launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
    readText: async () => null,
  };

  it('should_inject_jdwp_agent_before_jar_and_keep_run_selectors_with_classpath', async () => {
    expect(
      await javaDebugCmd(
        javaCase,
        'src/test/java/com/example/CalculatorTest.java',
        '/tmp/proj',
        homeEnv,
      ),
    ).toBe(
      'java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0' +
        ` -jar '/Users/tester/.neeko/${junitLauncherJarName()}'` +
        " --class-path='/tmp/proj/target/classes:/tmp/proj/target/test-classes'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/tmp/proj/.neeko/junit-reports'",
    );
  });

  it('should_fall_back_to_relative_reports_dir_without_run_root', async () => {
    expect(
      await javaDebugCmd(javaCase, 'src/test/java/CalculatorTest.java', undefined, homeEnv),
    ).toContain("--reports-dir='.neeko/junit-reports'");
  });

  it('should_quote_method_with_spaces_via_shell_quote', async () => {
    const spaced: TestCaseInfo = { name: 'should pass', line: 4, lang: 'java' };
    const cmd = await javaDebugCmd(spaced, 'src/test/java/org/foo/BarTests.java', '/p', homeEnv);
    expect(cmd).toContain("'org.foo.BarTests#should pass'");
  });

  it('should_append_maven_deps_to_classpath_in_debug_command', async () => {
    const depsEnv: JavaRunEnv = {
      launcherPath: '/opt/neeko/junit-platform-console-standalone.jar',
      readText: async () => '/root/.m2/dep.jar',
    };
    const cmd = await javaDebugCmd(
      javaCase,
      'src/test/java/com/example/CalculatorTest.java',
      '/proj',
      depsEnv,
    );
    expect(cmd).toContain(
      "--class-path='/proj/target/classes:/proj/target/test-classes:/root/.m2/dep.jar'",
    );
  });
});

describe('java launcher + classpath helpers', () => {
  it('should_build_versioned_launcher_jar_name', () => {
    expect(junitLauncherJarName()).toBe(
      `junit-platform-console-standalone-${JUNIT_CONSOLE_LAUNCHER_VERSION}.jar`,
    );
    expect(junitLauncherJarName('1.12.2')).toBe('junit-platform-console-standalone-1.12.2.jar');
  });

  it('should_resolve_launcher_path_under_home_neeko_cache', () => {
    expect(buildJavaLauncherPath('/Users/tester')).toBe(
      `/Users/tester/.neeko/${junitLauncherJarName()}`,
    );
  });

  it('should_fall_back_to_bare_launcher_name_without_home', () => {
    expect(buildJavaLauncherPath(null)).toBe(junitLauncherJarName());
    expect(buildJavaLauncherPath('')).toBe(junitLauncherJarName());
  });

  it('should_build_classpath_with_target_outputs_and_deps', () => {
    expect(buildJavaClasspath('/proj')).toBe('/proj/target/classes:/proj/target/test-classes');
    expect(buildJavaClasspath('/proj', '/root/.m2/a.jar')).toBe(
      '/proj/target/classes:/proj/target/test-classes:/root/.m2/a.jar',
    );
    expect(buildJavaClasspath('')).toBe('target/classes:target/test-classes');
  });

  it('should_resolve_java_classpath_from_maven_artifact_read', async () => {
    const readText: ReadTextProbe = async (absPath) => {
      expect(absPath).toBe('/proj/.neeko/java-classpath.txt');
      return '/root/.m2/a.jar:/root/.m2/b.jar\n';
    };
    expect(await resolveJavaClasspath('/proj', readText)).toBe('/root/.m2/a.jar:/root/.m2/b.jar');
  });

  it('should_resolve_empty_classpath_when_artifact_missing', async () => {
    const readText: ReadTextProbe = async () => null;
    expect(await resolveJavaClasspath('/proj', readText)).toBe('');
  });
});

describe('buildTestConfigId', () => {
  it('should_build_stable_per_case_ids_distinguishing_run_and_debug', () => {
    const run = buildTestConfigId('run', tsCase, 'src/a.test.ts');
    const debug = buildTestConfigId('debug', rustCase, 'src/lib.rs');
    expect(debug).toBe('testcase:debug:rust:src/lib.rs:parse_simple');
    expect(run).not.toBe(debug);
  });
});

describe('parseTestBinaryPath', () => {
  // cargo `--message-format=json` 的 compiler-artifact 行（executable 绝对路径，
  // target.src_path 绝对路径；C4：结构化产物定位）。
  const artifact = (executable: string | null, srcPath: string, test = true) =>
    JSON.stringify({
      reason: 'compiler-artifact',
      target: { kind: ['lib'], name: 'neeko', src_path: srcPath },
      profile: { test },
      executable,
    });
  const ARTIFACT_OUTPUT = [
    '   Compiling neeko v0.1.0 (/proj)',
    artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs'),
    artifact('/proj/target/debug/deps/neeko_bin-def456', '/proj/src/main.rs'),
  ].join('\n');

  it('should_parse_single_test_artifact_executable', () => {
    expect(
      parseTestBinaryPath(artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs')),
    ).toEqual({ ok: true, path: '/proj/target/debug/deps/neeko-abc123' });
  });

  it('should_discard_non_json_lines_and_non_artifact_reasons', () => {
    const output = [
      '   Compiling neeko v0.1.0 (/proj)',
      '    Finished test [unoptimized + debuginfo] target(s) in 2.11s',
      JSON.stringify({ reason: 'build-finished', success: true }),
      JSON.stringify({ reason: 'compiler-message', message: 'warning: unused' }),
      'not json at all {{{',
      artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs'),
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_ignore_non_test_profile_and_null_executable_artifacts', () => {
    const output = [
      artifact('/proj/target/debug/deps/libneeko.rlib', '/proj/src/lib.rs', false),
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/proj/build.rs' },
        profile: { test: false },
        executable: null,
      }),
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({ ok: false, error: 'binary_not_found' });
  });

  it('should_return_binary_not_found_when_no_artifact', () => {
    expect(parseTestBinaryPath('Finished in 1s\nRunning target/debug/app')).toEqual({
      ok: false,
      error: 'binary_not_found',
    });
    expect(parseTestBinaryPath('')).toEqual({ ok: false, error: 'binary_not_found' });
  });

  it('should_prefer_source_hint_match_in_multi_binary_workspaces', () => {
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT, 'src/main.rs')).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko_bin-def456',
    });
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT, 'src/lib.rs')).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_return_binary_ambiguous_for_multi_artifacts_without_disambiguating_hint', () => {
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT)).toEqual({
      ok: false,
      error: 'binary_ambiguous',
    });
    expect(parseTestBinaryPath(ARTIFACT_OUTPUT, 'src/other.rs')).toEqual({
      ok: false,
      error: 'binary_ambiguous',
    });
  });

  it('should_parse_artifact_lines_with_crlf_endings', () => {
    const output = [
      '   Compiling neeko v0.1.0 (/proj)\r',
      artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs') + '\r',
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_parse_artifact_lines_with_ansi_color_prefix', () => {
    const line =
      '\x1b[32m' + artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs') + '\x1b[0m';
    expect(parseTestBinaryPath(`   Compiling neeko v0.1.0 (/proj)\n${line}\n`)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
  });

  it('should_ignore_truncated_json_line_from_output_cap', () => {
    const output = [
      '   Compiling neeko v0.1.0 (/proj)',
      '{"reason":"compiler-artifact","targe',
      artifact('/proj/target/debug/deps/neeko-abc123', '/proj/src/lib.rs'),
    ].join('\n');
    expect(parseTestBinaryPath(output)).toEqual({
      ok: true,
      path: '/proj/target/debug/deps/neeko-abc123',
    });
    expect(parseTestBinaryPath('{"reason":"compiler-artifact","targe')).toEqual({
      ok: false,
      error: 'binary_not_found',
    });
  });
});

describe('resolveBinaryPath', () => {
  it('should_join_relative_paths_with_cwd', () => {
    expect(resolveBinaryPath('target/debug/deps/neeko-abc', '/proj')).toBe(
      '/proj/target/debug/deps/neeko-abc',
    );
  });

  it('should_keep_absolute_paths_untouched', () => {
    expect(resolveBinaryPath('/abs/bin', '/proj')).toBe('/abs/bin');
  });
});

describe('resolveTestTargetFlag', () => {
  it('should_lock_integration_target_for_tests_files', () => {
    expect(resolveTestTargetFlag('tests/unit.rs', false)).toBe('--test unit');
    // manifest 子目录布局（Tauri `src-tauri/`）：filePath 相对项目根，带前缀
    expect(resolveTestTargetFlag('src-tauri/tests/unit.rs', false)).toBe('--test unit');
  });

  it('should_lock_bin_target_for_src_bin_files', () => {
    expect(resolveTestTargetFlag('src/bin/tool.rs', true)).toBe('--bin tool');
    expect(resolveTestTargetFlag('src/bin/tool/main.rs', true)).toBe('--bin tool');
  });

  it('should_lock_lib_target_for_src_modules_when_lib_exists', () => {
    // 多目标工作区（lib + bin 共享 src/）：artifact 的 src_path 是 crate root，
    // 与源文件行永不匹配 —— 必须靠 `--lib` 构建期锁定，产物唯一。
    expect(resolveTestTargetFlag('src/agent/chat/adapter/serve.rs', true)).toBe('--lib');
    expect(resolveTestTargetFlag('src/lib.rs', true)).toBe('--lib');
  });

  it('should_not_lock_when_no_lib_target_exists', () => {
    // 纯 bin 项目（无 src/lib.rs）：src/ 模块属唯一 bin，不指定目标即唯一候选。
    expect(resolveTestTargetFlag('src/main.rs', false)).toBe('');
    expect(resolveTestTargetFlag('src/tool.rs', false)).toBe('');
  });

  it('should_return_empty_for_unknown_layouts', () => {
    expect(resolveTestTargetFlag('', false)).toBe('');
    expect(resolveTestTargetFlag('README.md', true)).toBe('');
  });
});

describe('buildMainRunCommand', () => {
  it('Go：go run 包目录（module 感知）', async () => {
    const probe = async (p: string) => p === '/tmp/proj/go.mod';
    await expect(mainRunCmd('go', 'pkg/math/main.go', '/tmp/proj', { probe })).resolves.toBe(
      "go run './pkg/math'",
    );
  });

  it('Rust：cargo run + manifest-path（workspace member）', async () => {
    await expect(
      mainRunCmd('rust', 'src/main.rs', '/tmp/proj', { manifestDir: 'crates/app' }),
    ).resolves.toBe("cargo run --manifest-path 'crates/app/Cargo.toml'");
  });

  it('Rust：无 manifest 时 cargo run 裸跑（cwd = run 根）', async () => {
    await expect(mainRunCmd('rust', 'src/main.rs', '/tmp/proj')).resolves.toBe('cargo run');
  });

  it('Java：java -cp target 输出 + FQCN', async () => {
    const javaEnv: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
    };
    await expect(
      mainRunCmd('java', 'src/main/java/com/example/App.java', '/tmp/proj', { javaEnv }),
    ).resolves.toBe(
      "java -cp '/tmp/proj/target/classes:/tmp/proj/target/test-classes' com.example.App",
    );
  });
});

describe('buildMainDebugBuildCommand', () => {
  it('Go：go build -o .neeko/test-bin/main + 无优化 gcflags', async () => {
    const probe = async (p: string) => p === '/tmp/proj/go.mod';
    await expect(
      mainDebugBuildCmd('go', 'cmd/agent/main.go', '/tmp/proj', { probe }),
    ).resolves.toBe("go build -o '.neeko/test-bin/main' -gcflags 'all=-N -l' './cmd/agent'");
  });

  it('Rust：cargo build --message-format=json（含 manifest-path）', async () => {
    await expect(
      mainDebugBuildCmd('rust', 'src/main.rs', '/tmp/proj', { manifestDir: 'crates/app' }),
    ).resolves.toBe("cargo build --manifest-path 'crates/app/Cargo.toml' --message-format=json");
  });
});

describe('buildMainDebugLaunchConfig', () => {
  it('Go：type go + mode exec + 无测试过滤', () => {
    expect(buildMainDebugLaunchConfig('go', '/tmp/proj/.neeko/test-bin/main', '/tmp/proj')).toEqual(
      {
        name: 'Debug main',
        type: 'go',
        request: 'launch',
        program: '/tmp/proj/.neeko/test-bin/main',
        cwd: '/tmp/proj',
        mode: 'exec',
        args: [],
        stopOnEntry: false,
      },
    );
  });

  it('Rust：type lldb + 无参数', () => {
    expect(buildMainDebugLaunchConfig('rust', '/tmp/proj/target/debug/app', '/tmp/proj')).toEqual({
      name: 'Debug main',
      type: 'lldb',
      request: 'launch',
      program: '/tmp/proj/target/debug/app',
      cwd: '/tmp/proj',
      args: [],
      stopOnEntry: false,
    });
  });
});

describe('buildMainJavaDebugCommand', () => {
  it('java -agentlib:jdwp + -cp target 输出 + FQCN（无选择器）', async () => {
    const env: JavaRunEnv = { readText: async () => null };
    await expect(
      mainJavaDebugCmd('src/main/java/com/example/App.java', '/tmp/proj', env),
    ).resolves.toBe(
      'java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0' +
        " -cp '/tmp/proj/target/classes:/tmp/proj/target/test-classes' com.example.App",
    );
  });
});

describe('parseCargoBinaryPath', () => {
  it('取非 test profile 的可执行产物，按 sourceHint 消歧', () => {
    const output = [
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/lib.rs' },
        profile: { test: false },
        executable: null,
      }),
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/main.rs' },
        profile: { test: false },
        executable: '/p/target/debug/app',
      }),
      JSON.stringify({ reason: 'build-finished', success: true }),
    ].join('\n');
    expect(parseCargoBinaryPath(output, 'src/main.rs')).toEqual({
      ok: true,
      path: '/p/target/debug/app',
    });
  });

  it('多可执行产物且 hint 无法消歧 → binary_ambiguous', () => {
    const output = [
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/bin/a/main.rs' },
        profile: { test: false },
        executable: '/p/target/debug/a',
      }),
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { src_path: '/p/src/bin/b/main.rs' },
        profile: { test: false },
        executable: '/p/target/debug/b',
      }),
    ].join('\n');
    expect(parseCargoBinaryPath(output, 'src/other.rs')).toEqual({
      ok: false,
      error: 'binary_ambiguous',
    });
  });

  it('排除 test 二进制（与 parseTestBinaryPath 互补）', () => {
    const output = JSON.stringify({
      reason: 'compiler-artifact',
      target: { src_path: '/p/src/main.rs' },
      profile: { test: true },
      executable: '/p/target/debug/deps/app-hash',
    });
    expect(parseCargoBinaryPath(output)).toEqual({ ok: false, error: 'binary_not_found' });
  });
});

describe('resolveRunContext — Run/Debug 命令链路的唯一 IO 边界', () => {
  it('go：按 go.mod 边界解析包目录（嵌套 module 取相对 module 根）', async () => {
    const probe = async (p: string) => p === '/proj/submod/go.mod';
    const ctx = await resolveRunContext('go', 'submod/pkg/math/add_test.go', '/proj', { probe });
    expect(ctx.goPkg).toBe('./pkg/math');
  });

  it('java：读 Maven classpath 产物 + launcher 路径', async () => {
    const ctx = await resolveRunContext('java', 'src/test/java/A.java', '/proj', {
      javaEnv: { launcherPath: '/opt/junit.jar', readText: async () => '/root/.m2/a.jar' },
    });
    expect(ctx.javaDeps).toBe('/root/.m2/a.jar');
    expect(ctx.javaLauncher).toBe('/opt/junit.jar');
  });

  it('rust/ts：零 IO，直接返回默认上下文', async () => {
    expect(await resolveRunContext('rust', 'src/lib.rs', '/proj')).toEqual(defaultRunContext());
    expect(await resolveRunContext('ts', 'a.test.ts', '/proj')).toEqual(defaultRunContext());
  });
});

describe('build*Command 纯函数（IO 已在 resolveRunContext 完成）', () => {
  it('rust 命令可同步构造：无 await、无探针', () => {
    expect(buildRunCommand(rustCase, 'src/lib.rs', null, null, defaultRunContext())).toBe(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple' -- -Z unstable-options --format=json --show-output",
    );
  });

  it('ts 报告路径纯由 runRoot 推导', () => {
    expect(buildRunCommand(tsCase, 'src/a.test.ts', null, '/tmp/proj', defaultRunContext())).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('go 命令直接吃已解析的 goPkg（不再自己探测）', () => {
    const ctx = { ...defaultRunContext(), goPkg: './pkg/math' };
    expect(buildRunCommand(goCase, 'pkg/math/add_test.go', null, null, ctx)).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });
});

// ── tier ①：LSP runnable → 命令（rust-analyzer `experimental/runnables`）──────────
// 夹具的 cargoArgs / executableArgs 取自真机实测载荷（见 runnables/__tests__/runnable.test.ts）。

describe('tier ① LSP runnable → 命令', () => {
  const specificTest: LspRunnable = {
    label: 'cargo test -p api --bin stock-buddy -- routes::sentiment::tests::test_x --exact',
    kind: 'cargo',
    args: {
      cwd: '/proj/crates/api',
      workspaceRoot: '/proj',
      cargoArgs: ['test', '--package', 'api', '--bin', 'stock-buddy'],
      executableArgs: [
        'routes::sentiment::tests::test_x',
        '--exact',
        '--nocapture',
        '--include-ignored',
      ],
    },
  };
  const mainRun: LspRunnable = {
    label: 'cargo run -p api',
    kind: 'cargo',
    args: {
      cwd: '/proj',
      workspaceRoot: '/proj',
      cargoArgs: ['run', '--package', 'api'],
      executableArgs: [],
    },
  };

  it('测试 Run：用 LS 的 target + 完整测试路径 + --exact，并保留本项目结构化结果流参数', () => {
    const cmd = buildRunCommand(
      rustCase,
      'crates/api/src/x.rs',
      null,
      '/proj',
      defaultRunContext(),
      specificTest,
    );
    expect(cmd).toBe(
      'RUSTC_BOOTSTRAP=1 cargo test --package api --bin stock-buddy -- ' +
        'routes::sentiment::tests::test_x --exact -Z unstable-options --format=json --show-output',
    );
    // --nocapture 会污染 JSON 行；--include-ignored 改变语义 → 均不采用
    expect(cmd).not.toContain('--nocapture');
    expect(cmd).not.toContain('--include-ignored');
  });

  it('测试 Debug 构建：LS 的 target + --no-run --message-format=json', () => {
    expect(buildDebugBuildCommand(rustCase, 'crates/api', '', specificTest)).toBe(
      'cargo test --package api --bin stock-buddy --no-run --message-format=json',
    );
  });

  it('main Run：直接用 LS 的 cargo run 参数（多 bin 工作区不再靠 cargo 报错）', () => {
    expect(
      buildMainRunCommand('rust', 'crates/api/src/main.rs', '/proj', defaultRunContext(), {
        lsp: mainRun,
      }),
    ).toBe('cargo run --package api');
  });

  it('main Debug 构建：LS 的 run 子命令换成 build + --message-format=json', () => {
    expect(buildMainDebugBuildCommand('rust', defaultRunContext(), { lsp: mainRun })).toBe(
      'cargo build --package api --message-format=json',
    );
  });

  it('无 LSP runnable 时保持既有快路径命令（回归）', () => {
    expect(buildRunCommand(rustCase, 'src/lib.rs', null, '/proj', defaultRunContext())).toContain(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple'",
    );
    expect(buildMainRunCommand('rust', 'src/main.rs', '/proj', defaultRunContext())).toBe(
      'cargo run',
    );
    expect(buildDebugBuildCommand(rustCase, null, '--lib')).toBe(
      "cargo test 'parse_simple' --no-run --lib --message-format=json",
    );
  });

  it('shellToken：仅不安全 token 加引号（命令可读且可复制）', () => {
    expect(shellToken('--package')).toBe('--package');
    expect(shellToken('routes::sentiment::tests::test_x')).toBe('routes::sentiment::tests::test_x');
    expect(shellToken('/proj/crates/api')).toBe('/proj/crates/api');
    expect(shellToken('has space')).toBe("'has space'");
    expect(shellToken("it's")).toBe(`'it'\\''s'`);
    expect(shellToken('')).toBe("''");
  });
});

describe('Go benchmark 命令（P2）', () => {
  const benchCase: TestCaseInfo = { name: 'BenchmarkAdd', line: 4, lang: 'go', kind: 'benchmark' };
  const goCtx: RunContext = { goPkg: './pkg/math' } as RunContext;

  it('Run：-run 置空 + -bench 锚定 + -count=1（benchmark 结果不缓存）', () => {
    expect(buildRunCommand(benchCase, 'pkg/math/add_test.go', null, null, goCtx)).toBe(
      "go test -run '^$' -bench '^BenchmarkAdd$' -count=1 -json './pkg/math'",
    );
  });

  it('Run：普通用例命令不受影响（回归）', () => {
    expect(buildRunCommand(goCase, 'pkg/math/add_test.go', null, null, goCtx)).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });

  it('Debug：dlv launch 传显式 -test.run/-test.bench（首参带 `-` → adapter 原样透传）', () => {
    expect(
      buildDebugLaunchConfig(benchCase, '/proj/.neeko/test-bin/BenchmarkAdd', '/proj'),
    ).toEqual({
      name: 'Debug benchmark: BenchmarkAdd',
      type: 'go',
      request: 'launch',
      program: '/proj/.neeko/test-bin/BenchmarkAdd',
      cwd: '/proj',
      mode: 'exec',
      args: ['-test.run', '^$', '-test.bench', '^BenchmarkAdd$'],
      stopOnEntry: false,
    });
  });

  it('Debug：普通用例仍走裸锚定模式（adapter 拼 -test.run）', () => {
    expect(buildDebugLaunchConfig(goCase, '/p/bin', '/proj').args).toEqual(['^TestAdd$']);
  });
});
