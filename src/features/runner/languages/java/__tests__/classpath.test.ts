// @vitest-environment node
import { describe, it, expect } from 'vitest';

import type { ProjectEnvironment } from '@/shared/types/project';

import { type ReadTextProbe } from '../../contract';
import {
  classpathSeparatorFor,
  buildMavenClasspathCommand,
  buildMavenClasspathPath,
  parseClasspathOutput,
  resolveJavaClasspath,
} from '../classpath';

const LOCAL: ProjectEnvironment = { type: 'Local' };
const WSL: ProjectEnvironment = { type: 'Wsl', distro: 'Ubuntu' };
const REMOTE: ProjectEnvironment = {
  type: 'Remote',
  host: 'example.com',
  port: 22,
  username: 'dev',
  auth: { Password: 'x' },
};

describe('classpathSeparatorFor', () => {
  it('Local 目标按宿主平台取分隔符', () => {
    expect(classpathSeparatorFor(LOCAL, true)).toBe(';');
    expect(classpathSeparatorFor(LOCAL, false)).toBe(':');
  });

  /**
   * **本函数存在的理由**：WSL 目标是 Linux JVM，分隔符恒为 `:` —— 即使宿主是 Windows。
   * 若改为"宿主平台常量"，这里会返回 `;`，`java -cp a;b` 在 Linux 上就是一条不存在的路径。
   */
  it('Wsl 目标恒为 `:`，不受宿主平台影响', () => {
    expect(classpathSeparatorFor(WSL, true)).toBe(':');
    expect(classpathSeparatorFor(WSL, false)).toBe(':');
  });

  it('Remote 目标恒为 `:`', () => {
    expect(classpathSeparatorFor(REMOTE, true)).toBe(':');
    expect(classpathSeparatorFor(REMOTE, false)).toBe(':');
  });
});

describe('resolveJavaClasspath', () => {
  /**
   * Windows 目标：分隔符必须是 `;`，且 `deps` 要按 `;` **正确拆分**。
   * 若仍按 `:` 处理，`C:\a.jar;C:\b.jar` 会被当成**单条**条目 —— 交给 host 后
   * 静默解析不到依赖源码（不会报错，只是没有源码可显示）。
   */

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
    expect(parseClasspathOutput(`${line}\n`, ':')).toBe(line);
  });

  it('should_trim_whitespace_and_empty_lines', () => {
    expect(parseClasspathOutput('  /a.jar  \n\n  /b.jar\n', ':')).toBe('/a.jar:/b.jar');
  });

  it('should_join_multi_line_with_the_target_separator', () => {
    // Windows 目标：多行兜底归一并使用 `;`（与产出该文件的 JVM 一致），不是 `:`。
    expect(parseClasspathOutput('C:\\m2\\a.jar\nC:\\m2\\b.jar\n', ';')).toBe(
      'C:\\m2\\a.jar;C:\\m2\\b.jar',
    );
  });

  it('should_resolve_java_classpath_from_maven_artifact_read', async () => {
    const readText: ReadTextProbe = async (absPath) => {
      expect(absPath).toBe('/proj/.neeko/java-classpath.txt');
      return '/root/.m2/a.jar:/root/.m2/b.jar\n';
    };
    expect(await resolveJavaClasspath('/proj', readText, ':')).toBe(
      '/root/.m2/a.jar:/root/.m2/b.jar',
    );
  });

  it('should_resolve_windows_classpath_from_maven_artifact_read', async () => {
    const readText: ReadTextProbe = async () => 'C:\\m2\\a.jar;C:\\m2\\b.jar\n';
    expect(await resolveJavaClasspath('C:\\proj', readText, ';')).toBe(
      'C:\\m2\\a.jar;C:\\m2\\b.jar',
    );
  });

  it('should_resolve_empty_classpath_when_artifact_missing', async () => {
    const readText: ReadTextProbe = async () => null;
    expect(await resolveJavaClasspath('/proj', readText, ':')).toBe('');
  });
});
