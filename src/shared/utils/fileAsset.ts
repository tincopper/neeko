// This wrapper is the single allowed entry point for convertFileSrc outside the
// features/*/api/ directory pattern. Consumer code should import from here
// instead of from @tauri-apps/api/core directly.
/* eslint-disable-next-line no-restricted-imports */
import { convertFileSrc } from '@tauri-apps/api/core';

export { convertFileSrc };
