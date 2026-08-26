import type { LspGoToDefinitionResult } from '../api/lspApi';

const CACHE_TTL_MS = 3000;
const PENDING_TTL_MS = 15000;
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
 * If a request for the same key is already pending, returns that promise.
 * If a cached result exists (within TTL), returns it immediately.
 *
 * `skipPending` bypasses the in-flight dedup: an explicit jump must not wait
 * on a hover probe's pending promise. Probes are best-effort decoration
 * lookups (possibly issued against an older document version); a jump wants a
 * fresh result for the user's actual gesture.
 */
export function getOrFetchDefinition(
  key: string,
  fetchFn: () => Promise<LspGoToDefinitionResult | null>,
  options?: { skipPending?: boolean },
): Promise<LspGoToDefinitionResult | null> {
  const cached = getCachedDefinition(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  if (!options?.skipPending) {
    const pending = pendingCache.get(key);
    if (pending && Date.now() - pending.ts < PENDING_TTL_MS) {
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

  while (pendingCache.size > MAX_PENDING_ENTRIES) {
    const oldest = pendingCache.keys().next().value;
    if (oldest === undefined) break;
    pendingCache.delete(oldest);
  }
  pendingCache.set(key, { promise, ts: Date.now() });
  return promise;
}
