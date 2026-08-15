import type { Project } from '@/shared/types';

/**
 * 生成编辑器分组布局的持久化 key（含项目环境前缀）。
 * 从 ProjectWorkspace 抽出为纯函数：Local/WSL/SSH 各自独立布局空间。
 */
export function buildLayoutId(
  project: Project | null,
  groupId: string,
  tabId: string | null,
): string {
  if (!project) return `none:${groupId}:${tabId ?? 'default'}`;
  const env = project.environment;
  let base: string;
  if (env.type === 'Wsl') {
    base = `wsl:${env.distro}:${project.id}`;
  } else if (env.type === 'Remote') {
    base = `remote:${env.host}:${project.id}`;
  } else {
    base = `local:${project.id}`;
  }
  return `${base}:${groupId}:${tabId ?? 'default'}`;
}
