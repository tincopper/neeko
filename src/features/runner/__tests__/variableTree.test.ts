// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildVariableRows } from '../variableTree';

import type { VariableDto } from './types';

function varOf(name: string, ref = 0, value = 'v'): VariableDto {
  return { name, value, type: null, variablesReference: ref };
}

describe('buildVariableRows', () => {
  const children = { 100: [varOf('fetched_at', 0, '2026-09-04'), varOf('nested', 200)] };

  it('should_render_roots_flat_when_nothing_expanded', () => {
    const rows = buildVariableRows([varOf('m', 100)], children, {}, {}, {});
    expect(rows).toEqual([{ kind: 'var', v: varOf('m', 100), depth: 0, path: 'm-0' }]);
  });

  it('should_include_cached_children_after_expanded_container', () => {
    const rows = buildVariableRows([varOf('m', 100)], children, { 100: true }, {}, {});
    expect(rows.map((r) => (r.kind === 'var' ? `${r.depth}:${r.path}` : r.kind))).toEqual([
      '0:m-0',
      '1:m-0/fetched_at-0',
      '1:m-0/nested-1',
    ]);
  });

  it('should_render_loading_placeholder_while_fetching', () => {
    const rows = buildVariableRows([varOf('m', 100)], {}, { 100: true }, { 100: true }, {});
    expect(rows[1]).toEqual({ kind: 'loading', depth: 1, path: 'm-0/loading' });
  });

  it('should_render_error_line_when_expansion_failed', () => {
    const rows = buildVariableRows([varOf('m', 100)], {}, { 100: true }, {}, { 100: 'stale ref' });
    expect(rows[1]).toEqual({
      kind: 'error',
      depth: 1,
      path: 'm-0/error',
      message: 'stale ref',
    });
  });

  it('should_not_recurse_into_collapsed_or_leaf_nodes', () => {
    const roots = [varOf('leaf'), varOf('collapsed', 100)];
    const rows = buildVariableRows(roots, children, { 100: false }, {}, {});
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'var')).toBe(true);
  });

  it('should_support_deep_nesting_with_stable_paths', () => {
    const deep = { 100: [varOf('a', 200)], 200: [varOf('b', 0)] };
    const rows = buildVariableRows([varOf('root', 100)], deep, { 100: true, 200: true }, {}, {});
    expect(rows.map((r) => (r.kind === 'var' ? `${r.depth}:${r.path}` : r.kind))).toEqual([
      '0:root-0',
      '1:root-0/a-0',
      '2:root-0/a-0/b-0',
    ]);
  });
});
