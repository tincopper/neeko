import { useState, useMemo, useCallback } from 'react';

import type { ActionContext, ActionRegistryItem } from '../types/actionMenu';
import { filterActions } from '../utils/filterActions';

export function useActionMenu(
  items: ActionRegistryItem[],
  ctx: ActionContext,
  onExecute?: (item: ActionRegistryItem) => void,
) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => filterActions(items, query, ctx), [items, query, ctx]);

  const reset = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(filtered.length, 1));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1));
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onExecute?.(filtered[selectedIndex]);
            ctx.closeMenu();
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          ctx.closeMenu();
          break;
        }
      }
    },
    [filtered, selectedIndex, ctx, onExecute],
  );

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  }, []);

  return {
    query,
    setQuery: handleQueryChange,
    filtered,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    reset,
  };
}
