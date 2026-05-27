# Inline useRefreshGitInfo — Remove Pass-Through Module

## Goal
Delete `src/hooks/useRefreshGitInfo.ts` (44-line pass-through hook). Inline the store mutation into `DockPanelWrappers.tsx`.

## Why
- Hook provided zero leverage — one `refreshGitInfo()` call + one `setState()`  
- Deletion test: removing it concentrates complexity, not dissipate it
