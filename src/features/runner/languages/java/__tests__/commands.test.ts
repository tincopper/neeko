// @vitest-environment node
/**
 * java 命令构造测试（跑测 / 调试 / 选择器 / launcher / classpath 拼装）
 */
import { describe, expect, it } from 'vitest';

import { TestCaseInfo } from '../../../syntax/contract';
import { type LangIo } from '../../contract';
import {
  JUNIT_CONSOLE_LAUNCHER_MAIN_CLASS,
  JUNIT_CONSOLE_LAUNCHER_VERSION,
  buildJavaClasspath,
  buildJavaClasspathEntries,
  buildJavaDebugCommand,
  buildJavaLauncherArgs,
  buildJavaLauncherPath,
  buildJavaMainRunCommand,
  buildJavaRunCommand,
  buildJunitReportsDir,
  buildMainJavaDebugCommand,
  buildMavenTestCompileCommand,
  deriveJavaFqcn,
  isMavenAggregatePom,
  javaClassName,
  javaMethodSelector,
  junitLauncherJarName,
  mavenArtifactId,
} from '../commands';
import { javaCommandEnv, type JavaRunEnv } from '../env';

const javaCase: TestCaseInfo = { name: 'testAdd', line: 4, lang: 'java' };

/** 最小 `LangIo` 替身：`javaCommandEnv` 只读 `targetPlatform`（其契约另见 env.test.ts）。 */
const ioFor = (platform: 'windows' | 'unix'): LangIo =>
  ({ targetPlatform: () => platform }) as unknown as LangIo;

/**
 * 测试侧装载：**直接复用生产唯一解析点** `env.ts::javaCommandEnv`（不复制解析逻辑）。
 * 与生产 `planTestRun` / `planMainRun` 的两步等价：解析环境事实 → 调纯构造器。
 */
const javaEnvOf = (runRoot: string | null | undefined, javaEnv?: JavaRunEnv) =>
  javaCommandEnv(
    runRoot ?? '',
    javaEnv ?? { classpathSeparator: ':' },
    'test-project',
    ioFor('unix'),
  );

const runCmd = async (
  tc: TestCaseInfo,
  relPath: string,
  runRoot: string | null = null,
  javaEnv?: JavaRunEnv,
) => buildJavaRunCommand(tc, relPath, runRoot, await javaEnvOf(runRoot, javaEnv));

const mainRunCmd = async (filePath: string, runRoot: string, opts: { javaEnv?: JavaRunEnv } = {}) =>
  buildJavaMainRunCommand(filePath, runRoot, await javaEnvOf(runRoot, opts.javaEnv));

const javaDebugCmdWithEnv = async (
  tc: TestCaseInfo,
  relPath: string,
  runRoot: string | null | undefined,
  javaEnv?: JavaRunEnv,
) => buildJavaDebugCommand(tc, relPath, runRoot, await javaEnvOf(runRoot, javaEnv));

const mainJavaDebugCmdWithEnv = async (filePath: string, runRoot: string, javaEnv: JavaRunEnv) =>
  buildMainJavaDebugCommand(filePath, runRoot, await javaEnvOf(runRoot, javaEnv));

describe('buildJavaRunCommand', () => {
  /**
   * Windows 目标 **端到端**：`JavaRunEnv` 带的分隔符必须一路传到命令串 ——
   * env → 语言模块解析出的 `RunContext.classpathSeparator` → `--class-path`。
   *
   * 这条覆盖的是"分隔符在产出口解析一次、下游不再推断"这个约定本身：
   * 任一跳漏传（或下游改回宿主常量），断言即失败。
   */

  it('should_build_junit_launcher_command_for_java_cases', async () => {
    // JUnit Platform Console Launcher：launcher（~/.neeko/ 缓存）+ --class-path
    // （target/ 自编译输出；无 Maven 依赖产物时退化为仅 target/）+ 类/方法选择器
    // + reports-dir（run 根下 .neeko）。
    const homeEnv: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
      classpathSeparator: ':',
    };
    expect(
      await runCmd(javaCase, 'src/test/java/com/example/CalculatorTest.java', '/proj', homeEnv),
    ).toBe(
      `java -jar '/Users/tester/.neeko/${junitLauncherJarName()}'` +
        " --class-path='/proj/target/classes:/proj/target/test-classes'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/proj/.neeko/junit-reports'",
    );
  });

  it('should_append_nested_class_path_to_java_selector', async () => {
    // @Nested：真机证实内层类必须以 `$` 连接（design §7.7.1 / research/jdtls-runnables-probe.md）——
    // 不带 `$` 时 Console Launcher 报 `MethodSelector … resolution failed`，0 个用例执行。
    const env: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
      classpathSeparator: ':',
    };
    const oneLevel: TestCaseInfo = {
      name: 'testNested',
      line: 16,
      lang: 'java',
      containerPath: ['InnerCases'],
    };
    const twoLevels: TestCaseInfo = {
      name: 'deep',
      line: 30,
      lang: 'java',
      containerPath: ['L1', 'L2'],
    };
    const commands = await Promise.all(
      [oneLevel, twoLevels].map((tc) =>
        runCmd(tc, 'src/test/java/com/example/CalculatorTest.java', '/proj', env),
      ),
    );
    expect(
      commands.map((c) => c.includes("-m 'com.example.CalculatorTest$InnerCases#testNested'")),
    ).toEqual([true, false]);
    expect(commands.map((c) => c.includes("-m 'com.example.CalculatorTest$L1$L2#deep'"))).toEqual([
      false,
      true,
    ]);
  });

  it('should_keep_java_selector_byte_identical_without_nested_class_path', async () => {
    // 缺省 / 空数组必须与现状**逐字节一致**（同 `goTestRunPattern` 的「顶层不变」护栏）——
    // LSP 不就绪时的降级路径正是「不带 containerPath」。
    const env: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
      classpathSeparator: ':',
    };
    const withEmpty: TestCaseInfo = { name: 'testAdd', line: 4, lang: 'java', containerPath: [] };
    const [withEmptyCmd, withoutCmd] = await Promise.all(
      [withEmpty, javaCase].map((tc) =>
        runCmd(tc, 'src/test/java/com/example/CalculatorTest.java', '/proj', env),
      ),
    );
    expect(withEmptyCmd).toBe(withoutCmd);
    expect(withoutCmd).toContain("-m 'com.example.CalculatorTest#testAdd'");
  });

  it('should_select_only_method_without_class_selector', async () => {
    // `-c` 与 `-m` 是 OR 语义（多 selector 取并集）：同传 `-c` 会选中全类，
    // 单用例 Run/Debug 必须只传 `-m`（实证：选 test1 却跑了整文件）。
    const env: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
      classpathSeparator: ':',
    };
    const run = await runCmd(
      javaCase,
      'src/test/java/com/example/CalculatorTest.java',
      '/proj',
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
      classpathSeparator: ':',
    };
    expect(
      await runCmd(javaCase, 'src/test/java/com/example/CalculatorTest.java', '/proj', depsEnv),
    ).toBe(
      "java -jar '/opt/neeko/junit-platform-console-standalone.jar'" +
        " --class-path='/proj/target/classes:/proj/target/test-classes:/root/.m2/repository/junit/jupiter-api.jar:/root/.m2/a.jar'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='/proj/.neeko/junit-reports'",
    );
  });

  it('should_carry_windows_separator_into_the_class_path_flag', async () => {
    const winEnv: JavaRunEnv = {
      launcherPath: 'C:\\neeko\\junit-platform-console-standalone.jar',
      readText: async () => 'C:\\m2\\jupiter-api.jar;C:\\m2\\a.jar',
      classpathSeparator: ';',
    };
    expect(
      await runCmd(javaCase, 'src/test/java/com/example/CalculatorTest.java', 'C:\\proj', winEnv),
    ).toBe(
      "java -jar 'C:\\neeko\\junit-platform-console-standalone.jar'" +
        " --class-path='C:\\proj/target/classes;C:\\proj/target/test-classes;C:\\m2\\jupiter-api.jar;C:\\m2\\a.jar'" +
        " -m 'com.example.CalculatorTest#testAdd' --reports-dir='C:\\proj/.neeko/junit-reports'",
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
      await runCmd(javaCase, 'src/test/java/CalculatorTest.java', '/proj', {
        launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
        readText: async () => null,
        classpathSeparator: ':',
      }),
    ).toBe(
      `java -jar '/Users/tester/.neeko/${junitLauncherJarName()}'` +
        " --class-path='/proj/target/classes:/proj/target/test-classes'" +
        " -m 'CalculatorTest#testAdd' --reports-dir='/proj/.neeko/junit-reports'",
    );
  });

  it('should_quote_reports_dir_with_spaces_in_run_root', async () => {
    expect(
      await runCmd(javaCase, 'src/test/java/com/example/CalculatorTest.java', '/proj/my project', {
        launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
        readText: async () => null,
        classpathSeparator: ':',
      }),
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

describe('buildJunitReportsDir', () => {
  it('should_join_reports_dir_under_neeko_of_run_root', () => {
    expect(buildJunitReportsDir('/proj')).toBe('/proj/.neeko/junit-reports');
    expect(buildJunitReportsDir('/proj/')).toBe('/proj/.neeko/junit-reports');
  });

  it('should_return_relative_dir_for_empty_root', () => {
    expect(buildJunitReportsDir('')).toBe('.neeko/junit-reports');
  });
});

describe('buildJavaDebugCommand', () => {
  // J3 attach-first：与 Run 命令同源（FQCN/reports-dir/classpath 推导一致），仅注入
  // jdwp 参数 `-agentlib:jdwp=...,server=y,suspend=y,address=0`（JVM 自选端口，
  // 后端解析 stdout `Listening for transport dt_socket at address: <port>`）。
  const homeEnv: JavaRunEnv = {
    launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
    readText: async () => null,
    classpathSeparator: ':',
  };

  it('should_inject_jdwp_agent_before_jar_and_keep_run_selectors_with_classpath', async () => {
    expect(
      await javaDebugCmdWithEnv(
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
      await javaDebugCmdWithEnv(javaCase, 'src/test/java/CalculatorTest.java', undefined, homeEnv),
    ).toContain("--reports-dir='.neeko/junit-reports'");
  });

  it('should_quote_method_with_spaces_via_shell_quote', async () => {
    const spaced: TestCaseInfo = { name: 'should pass', line: 4, lang: 'java' };
    const cmd = await javaDebugCmdWithEnv(
      spaced,
      'src/test/java/org/foo/BarTests.java',
      '/p',
      homeEnv,
    );
    expect(cmd).toContain("'org.foo.BarTests#should pass'");
  });

  it('should_append_maven_deps_to_classpath_in_debug_command', async () => {
    const depsEnv: JavaRunEnv = {
      launcherPath: '/opt/neeko/junit-platform-console-standalone.jar',
      readText: async () => '/root/.m2/dep.jar',
      classpathSeparator: ':',
    };
    const cmd = await javaDebugCmdWithEnv(
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

describe('junitLauncherJarName', () => {
  /**
   * Windows 目标：分隔符必须是 `;`，且 `deps` 要按 `;` **正确拆分**。
   * 若仍按 `:` 处理，`C:\a.jar;C:\b.jar` 会被当成**单条**条目 —— 交给 host 后
   * 静默解析不到依赖源码（不会报错，只是没有源码可显示）。
   */

  it('should_build_versioned_launcher_jar_name', () => {
    expect(junitLauncherJarName()).toBe(
      `junit-platform-console-standalone-${JUNIT_CONSOLE_LAUNCHER_VERSION}.jar`,
    );
    expect(junitLauncherJarName('1.12.2')).toBe('junit-platform-console-standalone-1.12.2.jar');
  });
});

describe('buildJavaLauncherPath', () => {
  /**
   * Windows 目标：分隔符必须是 `;`，且 `deps` 要按 `;` **正确拆分**。
   * 若仍按 `:` 处理，`C:\a.jar;C:\b.jar` 会被当成**单条**条目 —— 交给 host 后
   * 静默解析不到依赖源码（不会报错，只是没有源码可显示）。
   */

  it('should_resolve_launcher_path_under_home_neeko_cache', () => {
    expect(buildJavaLauncherPath('/Users/tester')).toBe(
      `/Users/tester/.neeko/${junitLauncherJarName()}`,
    );
  });

  it('should_fall_back_to_bare_launcher_name_without_home', () => {
    expect(buildJavaLauncherPath(null)).toBe(junitLauncherJarName());
    expect(buildJavaLauncherPath('')).toBe(junitLauncherJarName());
  });
});

describe('buildJavaClasspath', () => {
  /**
   * Windows 目标：分隔符必须是 `;`，且 `deps` 要按 `;` **正确拆分**。
   * 若仍按 `:` 处理，`C:\a.jar;C:\b.jar` 会被当成**单条**条目 —— 交给 host 后
   * 静默解析不到依赖源码（不会报错，只是没有源码可显示）。
   */

  it('should_build_classpath_with_target_outputs_and_deps', () => {
    expect(buildJavaClasspath('/proj', '', ':')).toBe(
      '/proj/target/classes:/proj/target/test-classes',
    );
    expect(buildJavaClasspath('/proj', '/root/.m2/a.jar', ':')).toBe(
      '/proj/target/classes:/proj/target/test-classes:/root/.m2/a.jar',
    );
    expect(buildJavaClasspath('', '', ':')).toBe('target/classes:target/test-classes');
  });

  it('should_build_windows_classpath_with_semicolon_separator', () => {
    expect(buildJavaClasspath('C:\\proj', '', ';')).toBe(
      'C:\\proj/target/classes;C:\\proj/target/test-classes',
    );
    expect(buildJavaClasspath('C:\\proj', 'C:\\m2\\a.jar;C:\\m2\\b.jar', ';')).toBe(
      'C:\\proj/target/classes;C:\\proj/target/test-classes;C:\\m2\\a.jar;C:\\m2\\b.jar',
    );
  });
});

describe('buildJavaClasspathEntries', () => {
  /**
   * Windows 目标：分隔符必须是 `;`，且 `deps` 要按 `;` **正确拆分**。
   * 若仍按 `:` 处理，`C:\a.jar;C:\b.jar` 会被当成**单条**条目 —— 交给 host 后
   * 静默解析不到依赖源码（不会报错，只是没有源码可显示）。
   */

  it('should_expose_classpath_entries_for_host_source_lookup', () => {
    expect(buildJavaClasspathEntries('/proj', '', ':')).toEqual([
      '/proj/target/classes',
      '/proj/target/test-classes',
    ]);
    expect(buildJavaClasspathEntries('/proj', '/root/.m2/a.jar:/root/.m2/b.jar', ':')).toEqual([
      '/proj/target/classes',
      '/proj/target/test-classes',
      '/root/.m2/a.jar',
      '/root/.m2/b.jar',
    ]);
    // 与拼接串同源：entries.join(sep) === buildJavaClasspath(...)
    const deps = '/root/.m2/a.jar:/root/.m2/b.jar';
    expect(buildJavaClasspathEntries('/proj', deps, ':').join(':')).toBe(
      buildJavaClasspath('/proj', deps, ':'),
    );
  });

  it('should_split_windows_deps_into_separate_entries', () => {
    const deps = 'C:\\m2\\a.jar;C:\\m2\\b.jar';
    expect(buildJavaClasspathEntries('C:\\proj', deps, ';')).toEqual([
      'C:\\proj/target/classes',
      'C:\\proj/target/test-classes',
      'C:\\m2\\a.jar',
      'C:\\m2\\b.jar',
    ]);
    // 关键反例：用错分隔符会把 `C:\m2\a.jar;C:\m2\b.jar` 当 `:` 切开 ——
    // 得到 `C` / `\m2\a.jar;C` / `\m2\b.jar` 三段碎片，两个 jar 都不作为条目出现。
    const garbled = buildJavaClasspathEntries('C:\\proj', deps, ':');
    expect(garbled).not.toContain('C:\\m2\\a.jar');
    expect(garbled).not.toContain('C:\\m2\\b.jar');
    expect(garbled).not.toEqual(buildJavaClasspathEntries('C:\\proj', deps, ';'));
    // 拼接串同源
    expect(buildJavaClasspathEntries('C:\\proj', deps, ';').join(';')).toBe(
      buildJavaClasspath('C:\\proj', deps, ';'),
    );
  });
});

describe('buildJavaMainRunCommand', () => {
  it('Java：java -cp target 输出 + FQCN', async () => {
    const javaEnv: JavaRunEnv = {
      launcherPath: `/Users/tester/.neeko/${junitLauncherJarName()}`,
      readText: async () => null,
      classpathSeparator: ':',
    };
    await expect(
      mainRunCmd('src/main/java/com/example/App.java', '/tmp/proj', { javaEnv }),
    ).resolves.toBe(
      "java -cp '/tmp/proj/target/classes:/tmp/proj/target/test-classes' com.example.App",
    );
  });
});

describe('buildMainJavaDebugCommand', () => {
  it('java -agentlib:jdwp + -cp target 输出 + FQCN（无选择器）', async () => {
    const env: JavaRunEnv = { readText: async () => null, classpathSeparator: ':' };
    await expect(
      mainJavaDebugCmdWithEnv('src/main/java/com/example/App.java', '/tmp/proj', env),
    ).resolves.toBe(
      'java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0' +
        " -cp '/tmp/proj/target/classes:/tmp/proj/target/test-classes' com.example.App",
    );
  });
});

describe("buildJavaLauncherArgs / javaClassName — 选择器单点（B' 与 Run/Debug 同源）", () => {
  const testCase: TestCaseInfo = { name: 'testAdd', line: 9, lang: 'java', variant: 'test' };
  const nestedCase: TestCaseInfo = {
    name: 'testNested',
    line: 20,
    lang: 'java',
    variant: 'test',
    containerPath: ['InnerCases'],
  };

  it('DAP launch.args 复用同一份选择器（含 @Nested 的 $ 链）', () => {
    expect(
      buildJavaLauncherArgs(testCase, 'src/test/java/com/example/CalcTest.java', '/proj'),
    ).toEqual([
      '-m',
      'com.example.CalcTest#testAdd',
      '--reports-dir=/proj/.neko/junit-reports'.replace('.neko', '.neeko'),
    ]);
    expect(
      buildJavaLauncherArgs(nestedCase, 'src/test/java/com/example/CalcTest.java', '/proj')[1],
    ).toBe('com.example.CalcTest$InnerCases#testNested');
  });

  it('runRoot 为空时回退相对 reports 目录（与 Run 一致）', () => {
    expect(
      buildJavaLauncherArgs(testCase, 'src/test/java/com/example/CalcTest.java', null)[2],
    ).toBe('--reports-dir=.neeko/junit-reports');
  });

  it('javaClassName 产出探测用的类名（嵌套用 $ 连接），并驱动 javaMethodSelector', () => {
    expect(javaClassName('com.example.CalcTest', nestedCase)).toBe(
      'com.example.CalcTest$InnerCases',
    );
    expect(javaMethodSelector('com.example.CalcTest', nestedCase)).toBe(
      'com.example.CalcTest$InnerCases#testNested',
    );
  });

  it('Console Launcher main 类常量与 java-debug 期望一致', () => {
    expect(JUNIT_CONSOLE_LAUNCHER_MAIN_CLASS).toBe('org.junit.platform.console.ConsoleLauncher');
  });
});

describe('isMavenAggregatePom — 聚合根必须被拒（不得静默退化）', () => {
  it('识别 <packaging>pom</packaging>（含空白/大小写变体）', () => {
    expect(isMavenAggregatePom('<project><packaging>pom</packaging></project>')).toBe(true);
    expect(isMavenAggregatePom('<packaging>\n  pom\n</packaging>')).toBe(true);
    expect(isMavenAggregatePom('<PACKAGING>POM</PACKAGING>')).toBe(true);
  });

  it('普通 jar/war 工程与缺省 packaging 不算聚合根', () => {
    expect(isMavenAggregatePom('<project><packaging>jar</packaging></project>')).toBe(false);
    expect(isMavenAggregatePom('<project><artifactId>x</artifactId></project>')).toBe(false);
    // 只出现 pom 字样但不是 packaging 元素（如依赖坐标）不得误判。
    expect(isMavenAggregatePom('<dependency><artifactId>pom</artifactId></dependency>')).toBe(
      false,
    );
  });
});

describe('buildMavenTestCompileCommand — 缺产物时的一次性编译（仅 Maven）', () => {
  it('输出非交互的 Maven 编译命令（跨平台：mvn 三端同名）', () => {
    expect(buildMavenTestCompileCommand()).toBe('mvn -q -B test-compile');
  });
});

describe('mavenArtifactId — JDT 项目名候选（必须剥掉 <parent>）', () => {
  it('取本项目 artifactId；父 POM 的必须被剥掉', () => {
    const pom = `<project>
      <parent><groupId>com.acme</groupId><artifactId>parent-pom</artifactId><version>1.0</version></parent>
      <groupId>com.acme</groupId><artifactId>tomgs-java-core</artifactId><version>1.0</version>
    </project>`;
    expect(mavenArtifactId(pom)).toBe('tomgs-java-core');
  });

  it('依赖项的 artifactId 不得被误取（本项目 artifactId 在最前）', () => {
    const pom = `<project><artifactId>app</artifactId>
      <dependencies><dependency><artifactId>guava</artifactId></dependency></dependencies>
    </project>`;
    expect(mavenArtifactId(pom)).toBe('app');
  });

  it('缺 artifactId / 带空白 / 空串 → null 或去空白值', () => {
    expect(mavenArtifactId('<project><groupId>x</groupId></project>')).toBeNull();
    expect(mavenArtifactId('<artifactId>  spaced  </artifactId>')).toBe('spaced');
    expect(mavenArtifactId('')).toBeNull();
  });
});
