/**
 * Cargo 清单位置探测（editor 单测 Run/Debug 用）。
 *
 * cargo 只自 cwd 向上查找清单，不会向下。Tauri 布局（`src-tauri/Cargo.toml`）
 * 项目根无清单时，`cargo test` 直接 exit 101 —— 因此 Rust 命令构造前需探测
 * 清单位置：根有 → 不加参（默认行为）；根无但 `src-tauri/` 有 →
 * `--manifest-path 'src-tauri/Cargo.toml'`。
 *
 * 探测结果按项目根缓存（会话级）：运行中新增/删除清单文件的极端场景不追踪，
 * 重开项目/重启生效——频率与代价权衡后的取舍。
 */
import { relativeToRoot } from '@/shared/utils/fileRef';

import type { ExistsProbe } from '../contract';

export type { ExistsProbe };

const cache = new Map<string, string | null>();

/** 供测试隔离缓存。 */
export function clearCargoManifestCache(): void {
  cache.clear();
}

/**
 * 解析项目根下 Cargo 清单所在目录（相对路径），决定 `--manifest-path` 是否需要。
 * 返回 null = 根清单布局（cargo 默认行为即可）。
 */
export async function resolveCargoManifestDir(
  projectRoot: string,
  probe: ExistsProbe,
): Promise<string | null> {
  const root = projectRoot.replace(/[/\\]+$/, '');
  if (!root) return null;
  if (cache.has(root)) return cache.get(root) ?? null;

  let dir: string | null = null;
  try {
    if (await probe(`${root}/Cargo.toml`)) {
      dir = null; // 根清单布局
    } else if (await probe(`${root}/src-tauri/Cargo.toml`)) {
      dir = 'src-tauri'; // Tauri 布局
    }
  } catch {
    // 探测失败（IPC 不可用等）不阻塞运行：按根清单布局兜底——根布局下 cargo
    // 本就能自行工作；Tauri 布局用户重新触发时会再次探测。
    dir = null;
  }
  cache.set(root, dir);
  return dir;
}

/**
 * 从被编辑文件向上定位其所属 Cargo 清单目录（crate/member 定位，对齐 RA/IDEA
 * 的 crate 归属推断）。返回相对 projectRoot 的清单目录；根清单返回 null
 * （cargo 默认行为）。覆盖任意布局：单 crate、Tauri `src-tauri/`、
 * workspace member（`packages/foo/src/…`）——`cargo test` 从根跑会编整个
 * workspace 的所有测试二进制导致多候选，必须 `--manifest-path` 指到具体 crate。
 *
 * `filePath` 允许 canonical 绝对（生产链路 tab.filePath）或 projectRoot 相对
 * （单测）——探测以「相对 projectRoot」为逐级拼接前提，故先经 `relativeToRoot`
 * 归一化，否则绝对路径会拼成 `${root}//abs/…`，member 清单永不命中。
 */
export async function resolveCargoManifestDirForFile(
  projectRoot: string,
  filePath: string,
  probe: ExistsProbe,
): Promise<string | null> {
  const root = projectRoot.replace(/[/\\]+$/, '');
  if (!root || !filePath) return resolveCargoManifestDir(root, probe);
  const parts = relativeToRoot(root, filePath).split('/');
  parts.pop(); // 去掉文件名，从所在目录起向上
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/'); // '' = 根
    const manifestPath = dir ? `${root}/${dir}/Cargo.toml` : `${root}/Cargo.toml`;
    try {
      if (await probe(manifestPath)) return dir === '' ? null : dir;
    } catch {
      return resolveCargoManifestDir(root, probe); // 探测失败兜底旧行为
    }
  }
  return resolveCargoManifestDir(root, probe);
}
