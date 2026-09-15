import type { ProjectEnvironment } from '@/shared/types/project';
import { IS_WINDOWS } from '@/shared/utils/platform';

import { shQuote } from '../../exec/shell';
import type { ClasspathSeparator, ReadTextProbe } from '../contract';

export type { ClasspathSeparator };

/**
 * classpath 分隔符由**执行 `mvn` / `java` 的那个 JVM 的目标 OS** 决定，不是 Neeko 宿主平台。
 *
 * 依据：`mvn dependency:build-classpath` 在目标环境内执行、用该 JVM 的 `File.pathSeparator`
 * 写产物文件；`java -cp` / `--class-path` 也在目标环境内执行 —— 拆分与拼接必须同源。
 *
 * - `Local`  → 宿主平台（Windows `;`，其余 `:`）；
 * - `Wsl`    → `:`（Linux 目标）；
 * - `Remote` → `:`（Linux 目标；Java **调试**在该环境已被显式拒绝，但 **Run** 命令同样按目标 JVM 拼串）。
 *
 * 取"目标环境"而非宿主常量：Windows 宿主 + WSL 项目若按宿主取 `;` 会拼出 Linux JVM 读不懂的
 * classpath（`java -cp a;b` 在 Linux 上是一条不存在的路径），而 `Wsl` 是**被放行**的环境。
 *
 * `isWindows` 可注入（默认取平台常量）以便单测覆盖两个平台分支 —— 与
 * `runner/results.ts::shouldReportNoMatch` / `shared/utils/shortcutRegistry.ts` 同一惯例。
 */
/** 目标平台 → classpath 分隔符（Windows JVM 用 `;`，Linux/macOS/WSL 用 `:`）。 */
export function classpathSeparatorForPlatform(platform: 'windows' | 'unix'): ClasspathSeparator {
  return platform === 'windows' ? ';' : ':';
}

export function classpathSeparatorFor(
  env: ProjectEnvironment,
  isWindows: boolean = IS_WINDOWS,
): ClasspathSeparator {
  return classpathSeparatorForPlatform(env.type === 'Local' && isWindows ? 'windows' : 'unix');
}

/**
 * Maven `dependency:build-classpath` 输出文件相对路径（run 根，gitignored `.neeko/` 下）。
 * 读取侧与命令侧共用同一常量，保证路径一致。
 */
export const MAVEN_CLASSPATH_REL_PATH = '.neeko/java-classpath.txt';

/** Maven 依赖 classpath 输出文件绝对路径（run 根 = worktree 根或项目根）；空根回退相对路径。 */
export function buildMavenClasspathPath(runRoot: string): string {
  const root = runRoot.replace(/[/\\]+$/, '');
  return root ? `${root}/${MAVEN_CLASSPATH_REL_PATH}` : MAVEN_CLASSPATH_REL_PATH;
}

/**
 * Maven 依赖 classpath 解析命令（resolveJavaClasspath 的命令构造侧）：
 * `mvn dependency:build-classpath -Dmdep.outputFile=<f>`。
 * MVP 单模块（pom.xml 在 run 根）；Gradle 等价任务后续。
 * `dependency:build-classpath` 的 `includeScope` 默认 test（单测依赖即可达，无需显式传参）。
 */
export function buildMavenClasspathCommand(runRoot: string): string {
  return `mvn dependency:build-classpath -Dmdep.outputFile=${shQuote(buildMavenClasspathPath(runRoot))}`;
}

/**
 * 解析 `mvn dependency:build-classpath` 输出文件内容 → classpath 字符串
 * （resolveJavaClasspath 的输出解析侧）。输出文件为单行（分隔符 = 该 JVM 的
 * `File.pathSeparator`，即 `separator`）；剥首尾空白与空行，多行时以 `separator`
 * 归并（防御性兜底，主路径输入已是单行）。
 *
 * `separator` 必填：它由**产出该文件的目标 JVM** 决定，不由宿主平台决定
 * （见 `classpathSeparatorFor`）。
 */
export function parseClasspathOutput(text: string, separator: ClasspathSeparator): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(separator);
}

/**
 * 解析 Maven 依赖 classpath：读 `.neeko/java-classpath.txt`（buildMavenClasspathPath）
 * → parseClasspathOutput。文件缺失/读取失败返回 ''（退化为仅 target/ 目录 classpath）。
 */
export async function resolveJavaClasspath(
  runRoot: string,
  readText: ReadTextProbe,
  separator: ClasspathSeparator,
): Promise<string> {
  const text = await readText(buildMavenClasspathPath(runRoot));
  if (!text) return '';
  return parseClasspathOutput(text, separator);
}
