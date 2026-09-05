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
import { fileExists } from '@/features/file/api/fileApi';

export type ExistsProbe = (absPath: string) => Promise<boolean>;

/** Tauri `file_exists` 命令（O(1) stat，不读内容）——经 file 域 api 门面。 */
const tauriExists: ExistsProbe = (absPath) => fileExists(absPath);

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
  probe: ExistsProbe = tauriExists,
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
