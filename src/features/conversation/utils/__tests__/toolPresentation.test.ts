import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getToolIcon, getToolSummary } from '../toolPresentation';

describe('toolPresentation', () => {
  describe('getToolIcon', () => {
    it('returns a renderable component for known tools', () => {
      const icon = getToolIcon('Read');
      expect(icon).toBeDefined();
      const html = renderToStaticMarkup(createElement(icon, { className: 'x' }));
      expect(html).toContain('svg');
    });

    it('falls back to the terminal icon for unknown tools', () => {
      expect(getToolIcon('UnknownTool')).toBe(getToolIcon('__fallback__'));
    });

    it('is consistent for the same tool name', () => {
      expect(getToolIcon('Bash')).toBe(getToolIcon('Bash'));
    });
  });

  describe('getToolSummary', () => {
    it('extracts file paths from file tools', () => {
      expect(getToolSummary('Read', { file_path: 'src/foo.ts' })).toBe('src/foo.ts');
      expect(getToolSummary('Edit', { path: 'src/bar.ts' })).toBe('src/bar.ts');
      expect(getToolSummary('Write', { file_path: 'a.ts', path: 'b.ts' })).toBe('a.ts');
    });

    it('extracts commands from Bash', () => {
      expect(getToolSummary('Bash', { command: 'pnpm test' })).toBe('pnpm test');
    });

    it('extracts patterns from search tools', () => {
      expect(getToolSummary('Grep', { pattern: 'useEffect' })).toBe('useEffect');
      expect(getToolSummary('Glob', { pattern: '*.tsx' })).toBe('*.tsx');
      expect(getToolSummary('GlobSearch', { pattern: 'foo' })).toBe('foo');
    });

    it('handles LS and Cat like file tools', () => {
      expect(getToolSummary('LS', { path: 'src' })).toBe('src');
      expect(getToolSummary('Cat', { file_path: 'src/foo.ts' })).toBe('src/foo.ts');
    });

    it('returns empty string for null/non-object input', () => {
      expect(getToolSummary('Bash', null)).toBe('');
      expect(getToolSummary('Bash', undefined)).toBe('');
      expect(getToolSummary('Bash', 'not an object')).toBe('');
    });

    it('returns a truncated JSON snippet for unknown tools', () => {
      const summary = getToolSummary('CustomTool', { a: 'x'.repeat(100) });
      expect(summary).toMatch(/CustomTool|"a"/);
      expect(summary.length).toBeLessThanOrEqual(62);
    });
  });
});
