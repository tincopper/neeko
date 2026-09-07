/**
 * 将用户 home 目录前缀替换为 ~（仅非 Windows 平台）。
 * 用于路径展示，title/tooltip 仍保留完整真实路径。
 */
export function displayHomePath(path: string, homeDirPath: string, isWindows: boolean): string {
  if (!homeDirPath || isWindows) return path;
  if (path === homeDirPath) return '~';
  if (path.startsWith(`${homeDirPath}/`)) return `~${path.slice(homeDirPath.length)}`;
  return path;
}

/** 获取相对路径的父目录路径（'' 表示根目录） */
export function getParentPath(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx <= 0 ? '' : filePath.slice(0, idx);
}

/** 获取一个文件路径的所有父目录路径 */
export function getParentPaths(filePath: string): string[] {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const paths: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    paths.push(parts.slice(0, i).join('/'));
  }
  return paths;
}

/**
 * 点击目标是否命中交互控件（按钮 / 输入 / 树节点行 / 菜单项）。
 *
 * 文件面板「空白点击选中项目根」时用于排除交互控件：节点行已 stopPropagation，
 * 此判定兜底新建/重命名输入框、头部按钮、右键菜单项等，避免聚焦输入或点按钮时
 * 误清选中。树容器与面板根共用同一份选择器（单源）。
 */
export function isPanelInteractiveTarget(target: HTMLElement): boolean {
  return Boolean(target.closest('button, input, textarea, [role="treeitem"], [role="menuitem"]'));
}
