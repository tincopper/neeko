import type { VariableDto } from './types';

/** One visible line in the variables tree (flattened from nested references). */
export type VariableRow =
  | { kind: 'var'; v: VariableDto; depth: number; path: string }
  | { kind: 'loading'; depth: number; path: string }
  | { kind: 'error'; depth: number; path: string; message: string };

/**
 * Flatten root variables + expanded children into renderable rows.
 *
 * Pure view-model derivation: expansion state (expanded/loading/error keyed by
 * DAP `variablesReference`) decides whether a container node contributes its
 * cached children, a loading placeholder, or an error line to the output.
 */
export function buildVariableRows(
  variables: VariableDto[],
  childrenByRef: Record<number, VariableDto[]>,
  expandedRefs: Record<number, boolean>,
  loadingRefs: Record<number, boolean>,
  varErrors: Record<number, string>,
): VariableRow[] {
  const rows: VariableRow[] = [];
  const walk = (list: VariableDto[], depth: number, prefix: string) => {
    list.forEach((v, i) => {
      const path = `${prefix}${v.name}-${i}`;
      rows.push({ kind: 'var', v, depth, path });
      const ref = v.variablesReference;
      if (ref > 0 && expandedRefs[ref]) {
        if (loadingRefs[ref]) {
          rows.push({ kind: 'loading', depth: depth + 1, path: `${path}/loading` });
          return;
        }
        if (varErrors[ref]) {
          rows.push({
            kind: 'error',
            depth: depth + 1,
            path: `${path}/error`,
            message: varErrors[ref],
          });
          return;
        }
        walk(childrenByRef[ref] ?? [], depth + 1, `${path}/`);
      }
    });
  };
  walk(variables, 0, '');
  return rows;
}
