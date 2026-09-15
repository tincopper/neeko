/**
 * Go 包目录定位（IO 探测；`go.mod` 边界语义）。
 *
 * 从 `utils/testCommands.ts` 迁入（方案 B 阶段 2）：探针由调用方注入（`io.fileExists`），
 * 故本模块可脱离 Tauri 单测。
 */
import { relativeToRoot } from '@/shared/utils/fileRef';

import { isAbsolutePath, runRootRelativeParts } from '../../exec/paths';
import type { ExistsProbe } from '../contract';

/**
 * Go module 根探测：从被编辑文件目录向上找最近 `go.mod`（对齐 Go toolchain 的
 * 模块边界语义），返回相对 `runRoot` 的 module 目录；找不到/探测失败 → null。
 * 复用 `resolveCargoManifestDirForFile` 模式：probe 注入便于测试，默认走
 * Tauri `file_exists`。
 *
 * - 根模块：`go.mod` 在 runRoot → 返回 `''`（module 根 = runRoot）。
 * - 嵌套模块：`go.mod` 在某子目录（如 `submod/`）→ 返回 `'submod'`。
 * - 无 go.mod（runRoot 到文件目录链路均无）→ null（调用方回退文件目录语义）。
 * 搜索有界于 runRoot：module 根在 runRoot 之上时回退 cwd 相对路径（`go` 自会
 * 向上找到 module），无需 `..` 表达。
 */
export async function findGoModuleDir(
  filePath: string,
  runRoot: string,
  probe: ExistsProbe,
): Promise<string | null> {
  const root = runRoot.replace(/[/\\]+$/, '');
  if (!root || !filePath) return null;
  const parts = runRootRelativeParts(filePath, root);
  parts.pop(); // 去掉文件名，从所在目录起向上
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/'); // '' = runRoot 自身
    const goMod = dir ? `${root}/${dir}/go.mod` : `${root}/go.mod`;
    try {
      if (await probe(goMod)) return dir;
    } catch {
      return null; // 探测失败（IPC 不可用等）→ 回退文件目录语义，不阻塞运行
    }
  }
  return null;
}

/** 文件所在目录相对 module 根的路径（moduleDir='' 表示 runRoot 自身）。 */
function pkgDirRelativeToModule(filePath: string, moduleDir: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const body = moduleDir ? normalized.slice(moduleDir.length).replace(/^\/+/, '') : normalized;
  const lastSlash = body.lastIndexOf('/');
  return lastSlash >= 0 ? body.slice(0, lastSlash) : '';
}

/**
 * Go 测试文件路径 → 所属包目录（cwd 相对：`./dir` / `.`）。
 * cwd = run 根（worktree 根或项目根）。优先按 module 边界解析：`go.mod` 位于
 * 嵌套模块（如 `submod/`）时返回相对 module 根的包目录（`./pkg/math`，与
 * `go test` 的 module 内包寻址一致）；无 go.mod（或探测失败/无 runRoot）回退
 * 文件所在目录。`filePath` 允许 canonical 绝对或 runRoot 相对（统一归一化）。
 */
export async function goPkgDir(
  filePath: string,
  runRoot: string | null | undefined,
  probe: ExistsProbe,
): Promise<string> {
  const rel = runRoot ? relativeToRoot(runRoot, filePath) : filePath.replace(/\\/g, '/');
  if (runRoot && !isAbsolutePath(rel)) {
    const moduleDir = await findGoModuleDir(rel, runRoot, probe);
    if (moduleDir !== null) {
      const pkg = pkgDirRelativeToModule(rel, moduleDir);
      return pkg ? `./${pkg}` : '.';
    }
  }
  // 回退：文件所在目录（`./dir` / `.` 为 cwd 相对）。文件在 runRoot 之外时无法
  // 表达为 cwd 相对 —— 兜底 cwd，不产出 `./abs/…` 假包路径。
  if (isAbsolutePath(rel)) return '.';
  const lastSlash = rel.lastIndexOf('/');
  const dir = lastSlash >= 0 ? rel.slice(0, lastSlash) : '';
  return dir ? `./${dir}` : '.';
}
