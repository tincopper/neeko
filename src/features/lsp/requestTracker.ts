/**
 * Helpers for reducing LSP request floods (hover / definition under mouse move).
 *
 * - LatestRequestTracker: generation tokens so only the newest request updates UI
 * - createDebouncedLatestRunner: debounce + latest-wins for mousemove-style inputs
 */

/** Tracks request generations so stale async results can be dropped. */
export class LatestRequestTracker {
  private seq = 0;

  /** Start a new generation; returns the token for this request. */
  next(): number {
    this.seq += 1;
    return this.seq;
  }

  /** Bump generation without starting work (e.g. mouseleave). */
  invalidate(): void {
    this.seq += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.seq;
  }

  /**
   * Run async work and return its value only if `token` is still current.
   * Stale tokens resolve to null (caller should ignore).
   */
  async runIfCurrent<T>(token: number, work: () => Promise<T>): Promise<T | null> {
    if (!this.isCurrent(token)) return null;
    const value = await work();
    if (!this.isCurrent(token)) return null;
    return value;
  }
}

export interface DebouncedLatestRunnerOptions {
  debounceMs: number;
}

/**
 * Debounce successive schedule() calls and only execute the latest one.
 * Earlier schedule() promises resolve to null when superseded or cancelled.
 */
export function createDebouncedLatestRunner<TArg>(options: DebouncedLatestRunnerOptions) {
  const { debounceMs } = options;
  const tracker = new LatestRequestTracker();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolve: ((value: unknown) => void) | null = null;

  function rejectPendingAsStale() {
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
  }

  return {
    schedule<TResult>(
      arg: TArg,
      work: (arg: TArg) => Promise<TResult>,
    ): Promise<TResult | null> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      rejectPendingAsStale();

      const token = tracker.next();

      return new Promise<TResult | null>((resolve) => {
        pendingResolve = resolve as (value: unknown) => void;

        timer = setTimeout(() => {
          timer = null;
          pendingResolve = null;

          if (!tracker.isCurrent(token)) {
            resolve(null);
            return;
          }

          void tracker.runIfCurrent(token, () => work(arg)).then(resolve);
        }, debounceMs);
      });
    },

    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      tracker.invalidate();
      rejectPendingAsStale();
    },
  };
}
