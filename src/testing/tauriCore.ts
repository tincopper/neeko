// Test re-exports for @tauri-apps/api/core.
//
// The global mock in setup.ts (vi.mock('@tauri-apps/api/core')) ensures these
// resolve to mocked versions in test runs. Import from this file in tests
// instead of from @tauri-apps/api/core directly to comply with the
// no-restricted-imports rule.
/* eslint-disable-next-line no-restricted-imports */
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export { invoke, convertFileSrc };
