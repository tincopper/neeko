# Unify ProjectsPanel — Use useUnifiedProjectList

## Goal
Create `useUnifiedProjectList` hook that flattens Local/WSL/Remote projects into a single array, replacing the complex `lastCardId` computation.

## Changes
- New: `src/hooks/useUnifiedProjectList.ts` — unified project list with position info
- Modified: `src/components/panels/ProjectsPanel.tsx` — use unified hook for isEmpty + lastCardId

## Out of Scope
- Render blocks stay as-is (ProjectItem vs WSLItem vs RemoteItem are structurally different due to entry grouping)
