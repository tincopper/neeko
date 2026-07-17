/**
 * Ref-counted cache that delays destruction after the last release.
 *
 * Used so that switching tabs of the same language (unmount A → mount B)
 * reuses the same value instead of destroy+recreate, which was a major
 * cost in go-to-definition cross-file navigation.
 */

export interface IdleRefCountedCacheOptions<T> {
  /** How long to keep an unreferenced entry before destroying it. */
  destroyDelayMs: number;
  /** Called when an idle entry is finally destroyed. */
  onDestroy?: (key: string, value: T) => void;
}

interface Entry<T> {
  value: T;
  refCount: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
}

export class IdleRefCountedCache<T> {
  private entries = new Map<string, Entry<T>>();
  private readonly destroyDelayMs: number;
  private readonly onDestroy?: (key: string, value: T) => void;

  constructor(options: IdleRefCountedCacheOptions<T>) {
    this.destroyDelayMs = options.destroyDelayMs;
    this.onDestroy = options.onDestroy;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Get or create a value and increment its refcount.
   * Cancels any pending idle destroy for the key.
   */
  acquire(key: string, create: () => T): T {
    let entry = this.entries.get(key);

    if (entry?.destroyTimer) {
      clearTimeout(entry.destroyTimer);
      entry.destroyTimer = null;
    }

    if (!entry) {
      entry = { value: create(), refCount: 0, destroyTimer: null };
      this.entries.set(key, entry);
    }

    entry.refCount += 1;
    return entry.value;
  }

  /**
   * Decrement refcount. When it hits zero, schedule delayed destroy
   * (so a quick re-acquire can cancel it).
   */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) return;

    if (entry.destroyTimer) {
      clearTimeout(entry.destroyTimer);
    }

    entry.destroyTimer = setTimeout(() => {
      const current = this.entries.get(key);
      // Only destroy if still idle (not re-acquired)
      if (!current || current.refCount > 0 || current !== entry) return;

      this.entries.delete(key);
      current.destroyTimer = null;
      this.onDestroy?.(key, current.value);
    }, this.destroyDelayMs);
  }

  /** Immediate teardown of all entries (e.g. app shutdown tests). */
  clear(): void {
    for (const [key, entry] of this.entries) {
      if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
      this.onDestroy?.(key, entry.value);
    }
    this.entries.clear();
  }
}
