import type { LspGoToDefinitionResult } from '../api/lspApi';

const CACHE_TTL_MS = 3000;
const MAX_CACHE_ENTRIES = 200;
const MAX_PENDING_ENTRIES = 50;

type CacheEntry = {
  data: LspGoToDefinitionResult;
  ts: number;
};

type PendingEntry = {
  promise: Promise<LspGoToDefinitionResult | null>;
  ts: number;
};

/** pending 上限条目数内允许的存活检查（防陈旧 pending 永久占位）。 */
const PENDING_STALE_MS = 30_000;

const defCache = new Map<string, CacheEntry>();
const pendingCache = new Map<string, PendingEntry>();

export function definitionCacheKey(
  projectPath: string,
  uri: string,
  line: number,
  character: number,
): string {
  return `${projectPath}||${uri}||${line}||${character}`;
}

function getCachedDefinition(key: string): LspGoToDefinitionResult | null {
  const entry = defCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    defCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedDefinition(key: string, data: LspGoToDefinitionResult): void {
  defCache.set(key, { data, ts: Date.now() });
  while (defCache.size > MAX_CACHE_ENTRIES) {
    const oldest = defCache.keys().next().value;
    if (oldest === undefined) break;
    defCache.delete(oldest);
  }
}

/** @internal test helper — clears module-level caches between tests. */
export function __resetDefinitionCachesForTests(): void {
  defCache.clear();
  pendingCache.clear();
}

/**
 * Fetch a definition result, deduplicating in-flight requests.
 * If a cached result exists (within TTL), returns it immediately.
 *
 * `sharePendingWithinMs`：复用距今不超过该窗口的 in-flight 请求。
 * - probe（链接高亮）用长窗口（≈ PENDING_TTL_MS），保持 latest-wins 去重。
 * - 显式跳转用短窗口（JUMP_PENDING_SHARE_MS）：双击/跳转通常与 probe 同位
 *   （同 cache key），共享新鲜 pending 消除双倍 LSP 往返；窗口足够小，
 *   不会等到陈旧文档版本上的旧结果。
 * - 未传（0）= 永不共享，总是发起全新请求。
 */
export function getOrFetchDefinition(
  key: string,
  fetchFn: () => Promise<LspGoToDefinitionResult | null>,
  options?: { sharePendingWithinMs?: number },
): Promise<LspGoToDefinitionResult | null> {
  const cached = getCachedDefinition(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const shareWindow = options?.sharePendingWithinMs ?? 0;
  if (shareWindow > 0) {
    const pending = pendingCache.get(key);
    if (pending && Date.now() - pending.ts <= shareWindow) {
      return pending.promise;
    }
  }

  const promise = fetchFn()
    .then((result) => {
      pendingCache.delete(key);
      if (result && result.lspResult) {
        setCachedDefinition(key, result);
      }
      return result;
    })
    .catch((err) => {
      pendingCache.delete(key);
      throw err;
    });

  // 清理陈旧 pending（发起方已弃用但仍占位）
  for (const [k, entry] of pendingCache) {
    if (Date.now() - entry.ts > PENDING_STALE_MS) pendingCache.delete(k);
  }
  while (pendingCache.size > MAX_PENDING_ENTRIES) {
    const oldest = pendingCache.keys().next().value;
    if (oldest === undefined) break;
    pendingCache.delete(oldest);
  }
  pendingCache.set(key, { promise, ts: Date.now() });
  return promise;
}
