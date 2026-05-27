# Unify TerminalView — Use TerminalViewBase for Local

## Goal

Eliminate the 360-line local-only `TerminalView.tsx` by routing it through the strategy-based `TerminalViewBase.tsx`, matching the pattern already used by WSLTerminalView and RemoteTerminalView.

## Plan

1. Fix `local.ts` strategy — `projectName` with worktree branch suffix
2. Extend `TerminalStrategy` and `TerminalViewBase` with optional task terminal + agent override fields
3. Rewrite `TerminalView.tsx` to use `useLocalTerminalStrategy` + `TerminalViewBase` (~50 lines)

## Out of Scope

- WSL/Remote terminal changes
- Task runner lifecycle changes
