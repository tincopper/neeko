# C4 Implementation Plan

## Order

1. Create `strategies/factory.ts` — unified `createTerminalStrategy(environment, options)`
2. Refactor `local.ts`, `wsl.ts`, `remote.ts` to export config objects consumed by factory
3. Consolidate `terminalCache.ts` exports into single manager
4. Create unified `TerminalView.tsx` replacing all 3 view components
5. Update `EditorGroupPane.tsx` — single `<TerminalView>` path
6. Consolidate agent launch functions
7. Delete old strategy files and view components

## Validation

```bash
pnpm lint
pnpm type-check
pnpm test:run
```
