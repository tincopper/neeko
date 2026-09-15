/**
 * LSP runnable 拉取（**副作用层**）：按目标行向 rust-analyzer 请求 `experimental/runnables`，
 * 命中则给出确定性参数；任何不确定/失败都**静默回退**快路径（不阻塞、不报警）。
 *
 * 为什么按 position 逐行请求（实测 1.97.1）：
 * - 响应**不返回 `location`** → 无法用一个整文件请求按行映射；
 * - 单个位置会同时返回多种粒度（`check` / `run` / `test --all-targets` / 具体用例），
 *   所以每行请求后用 `selectRunnable` 显式选择（`runnables/runnable.ts`）。
 *
 * 缓存：键 = 项目 + 文件 + 目标行集合（runnable 只依赖位置与项目结构，不含文档正文）；
 * 目标集合变化（增删用例/入口）自然换 key，无需人为版本号。**有 LRU 上限** ——
 * 换 key 意味着旧条目不再被命中，无上限就会随编辑次数单调增长（见 MAX_CACHE_ENTRIES）。
 */

import { isLspLanguageReady } from '../../utils/lspReadiness';
import type { LineTarget, OverlayProvider } from '../contract';
import { langIo } from '../io';

import { parseRunnables, selectRunnable, type RustOverlay } from './runnables';

interface FetchRunnablesArgs {
  projectId: string;
  /** LSP 会话键（项目根 / worktree 根）。 */
  projectPath: string;
  /** 被编辑文件绝对路径（构造 `file://` uri）。 */
  absFilePath: string;
  targets: readonly LineTarget[];
}

const cache = new Map<string, Map<number, RustOverlay>>();

/**
 * 缓存上限（LRU）。
 *
 * 键含**目标行集合** —— 每次增删用例/入口都会换 key，旧条目不会被再次命中。无上限则
 * 随编辑次数单调增长且永不释放（Neeko 是长驻应用，P6 常驻内存红线）。20 个「文件态」
 * 足以覆盖同时在手的 tab；超出按 LRU 淘汰。命中会刷新位置，因此正在编辑的文件不会被
 * 反复回源。
 */
export const MAX_CACHE_ENTRIES = 20;

/** 命中并刷新 LRU 位置（`Map` 保插入序 → 队尾为最近使用）。 */
function readCache(key: string): Map<number, RustOverlay> | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** 写入并淘汰最旧条目（`Map` 首个键）。 */
function writeCache(key: string, value: Map<number, RustOverlay>): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 供测试隔离。生产代码不调用 —— 缓存已有 LRU 上限（见 {@link MAX_CACHE_ENTRIES}），
 *  无需依赖「关闭项目」时清理，因此没有生命周期接线。 */
export function clearRunnableCache(): void {
  cache.clear();
}

function cacheKey(args: FetchRunnablesArgs): string {
  const lines = args.targets.map((t) => `${t.line}:${t.kind}`).join(',');
  return `${args.projectPath}|${args.absFilePath}|${lines}`;
}

/**
 * rust-analyzer 会话是否就绪（`indexing` 期间不请求：会拿到空/粗粒度结果且浪费往返）。
 *
 * 就绪判据**委托** `isLspLanguageReady`（唯一事实源）—— Java `@Nested` 富化用同一谓词，
 * 两处各写 `status === 'ready'` 就是 code-reuse 指南「模式 5」的副本漂移。
 */
export function isRustAnalyzerReady(projectPath: string): boolean {
  return isLspLanguageReady(projectPath, 'rust');
}

/**
 * 逐目标行拉取并选择 runnable。返回「行号 → runnable」；未命中 / 失败的行不在结果中
 * （调用方据此回退快路径）。绝不抛错 —— 调用点在编辑器渲染路径上。
 */
export async function fetchRunnablesForLines(
  args: FetchRunnablesArgs,
): Promise<Map<number, RustOverlay>> {
  const result = new Map<number, RustOverlay>();
  if (args.targets.length === 0) return result;
  if (!isRustAnalyzerReady(args.projectPath)) return result;

  const key = cacheKey(args);
  const cached = readCache(key);
  if (cached) return cached;

  const uri = `file://${args.absFilePath}`;
  await Promise.all(
    args.targets.map(async ({ line, kind }) => {
      try {
        const raw = await langIo.lspRequest(args.projectPath, 'rust', 'experimental/runnables', {
          textDocument: { uri },
          position: { line: line - 1, character: 0 },
        });
        const chosen = selectRunnable(parseRunnables(raw), kind);
        if (chosen) result.set(line, chosen);
      } catch {
        // 单行失败不影响其它行；整体仍走快路径兜底（不产生用户可见噪音）。
      }
    }),
  );
  if (result.size > 0) writeCache(key, result);
  return result;
}

/**
 * Rust 的 overlay provider（契约 [`OverlayProvider`]）：把 `fetchRunnablesForLines` 包成
 * 「按行覆盖」的通用形态 —— 通用层只问「这个文件的 provider 是谁」，不认识 rust-analyzer。
 */
export const RUST_OVERLAY_PROVIDER: OverlayProvider = {
  load: (args) => fetchRunnablesForLines(args),
};

/**
 * overlay 的稳定比较键（避免 marker 无谓重建 DOM）：**键的构造规则属于语言**
 * （Rust 关心 runnable 的 label 与 cargo/exe 参数），通用层只负责在 eq 里用它。
 */
export function rustOverlayKey(overlay: unknown): string {
  const runnable = overlay as RustOverlay | null;
  if (!runnable) return '';
  return `${runnable.label}|${(runnable.args.cargoArgs ?? []).join(' ')}|${(
    runnable.args.executableArgs ?? []
  ).join(' ')}`;
}
