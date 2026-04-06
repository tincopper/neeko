import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('buildFontFamily', () => {
  const originalPlatform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      writable: true,
    });
  });

  it('should return custom font with fallback when fontFamily is provided', () => {
    const result = buildFontFamily('Custom Font');
    expect(result).toContain("'Custom Font'");
    expect(result).toContain('monospace');
  });

  it('should return default font stack when fontFamily is empty', () => {
    const result = buildFontFamily('');
    expect(result).not.toContain("''");
    expect(result).toContain('monospace');
  });

  it('should return default font stack when fontFamily is empty string', () => {
    const result = buildFontFamily('');
    expect(result).toBe(DEFAULT_FONT_FAMILY);
  });
});

// Import after describe block to ensure proper hoisting
import { buildFontFamily, DEFAULT_FONT_FAMILY } from '../terminal';
