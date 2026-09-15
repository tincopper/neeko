import { describe, expect, it } from 'vitest';

import type { LangIo } from '../../contract';
import { javaCommandEnv, findJavaModuleDir, javaCompiledClassExists } from '../env';

/**
 * `javaCommandEnv` 契约（Neeko Check F3 回归）：Java 命令入参的**唯一解析点**。
 *
 * 背景：run 链路与调试链路此前各写一份，且 run 侧用**硬编码 `':'`** 兜底分隔符 —— Windows
 * 目标（Local + Windows 宿主）会把 `a.jar;b.jar` 当成**单条** classpath 条目，JVM 静默
 * ClassNotFound。本用例钉住「按目标平台兜底」，以及 run/debug 共用的三项事实。
 */
const ioFor = (platform: 'windows' | 'unix'): LangIo =>
  ({ targetPlatform: () => platform }) as unknown as LangIo;

describe('javaCommandEnv — 命令入参唯一解析点', () => {
  it('env 已带分隔符 → 原样采用（目标环境优先，不覆盖）', async () => {
    const env = await javaCommandEnv('/proj', { classpathSeparator: ':' }, 'p1', ioFor('windows'));
    expect(env.separator).toBe(':');
  });

  it('env 缺分隔符 + Windows 目标 → `;`（此前硬编码 `:` 会拼出 Linux 语义 classpath）', async () => {
    const env = await javaCommandEnv(
      '/proj',
      {} as { classpathSeparator: ':' | ';' },
      'p1',
      ioFor('windows'),
    );
    expect(env.separator).toBe(';');
  });

  it('env 缺分隔符 + Linux/WSL 目标 → `:`', async () => {
    const env = await javaCommandEnv(
      '/proj',
      {} as { classpathSeparator: ':' | ';' },
      'p1',
      ioFor('unix'),
    );
    expect(env.separator).toBe(':');
  });

  it('读 Maven classpath 产物（经 readText）+ launcher 兜底为 bare jar 名', async () => {
    const env = await javaCommandEnv(
      '/proj',
      {
        classpathSeparator: ':',
        launcherPath: '/opt/junit.jar',
        readText: async () => '/root/.m2/a.jar',
      },
      'p1',
      ioFor('unix'),
    );
    expect(env.deps).toBe('/root/.m2/a.jar');
    expect(env.launcher).toBe('/opt/junit.jar');

    const noLauncher = await javaCommandEnv(
      '/proj',
      { classpathSeparator: ':' },
      'p1',
      ioFor('unix'),
    );
    expect(noLauncher.deps).toBe('');
    expect(noLauncher.launcher).toContain('junit-platform-console-standalone');
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
