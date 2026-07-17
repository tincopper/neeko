import { describe, expect, it } from 'vitest';

import {
  getCachedLanguageExtension,
  getLanguageExtension,
  preloadLanguageExtension,
} from '../codemirror';

describe('language extension cache', () => {
  it('should_return_null_from_sync_cache_before_first_load', () => {
    // Use a rare extension unlikely to be preloaded by other tests
    // — after first load of .go below, .go will be warm; use .lua first check carefully.
    // Just assert API shape: unknown never-loaded path is null.
    // ".neeko-unique-ext" falls into properties fallback after async load only.
    expect(getCachedLanguageExtension('file.neeko-unique-ext-xyz')).toBeNull();
  });

  it('should_populate_sync_cache_after_async_load', async () => {
    const ext = await getLanguageExtension('main.go');
    expect(ext).not.toBeNull();
    expect(getCachedLanguageExtension('pkg/foo.go')).not.toBeNull();
    expect(getCachedLanguageExtension('other/bar.go')).toBe(
      getCachedLanguageExtension('main.go'),
    );
  });

  it('should_no_op_preload_when_already_cached', async () => {
    await getLanguageExtension('sample.go');
    // Should not throw and should keep cache warm
    preloadLanguageExtension('another.go');
    expect(getCachedLanguageExtension('another.go')).not.toBeNull();
  });
});
