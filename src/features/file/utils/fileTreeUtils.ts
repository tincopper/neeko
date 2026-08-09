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
