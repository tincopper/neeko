# Agent Split Button for Onboarding

## Requirements

The "Start AI Agent Session" step button in ProjectGuidePage currently only opens the project's default agent (`selected_agents[0]`). It should support opening any configured agent via a split-button pattern.

### Acceptance Criteria

1. The agent step button renders as a split button: main area opens the default agent (existing behavior), right-side chevron toggles an agent selection dropdown.
2. The dropdown lists all enabled agents with icon, name, and installation status.
3. The currently selected default agent is highlighted with a "Default" badge.
4. Agents not installed in the project environment are shown greyed/disabled with a "Not installed" badge.
5. Selecting an agent from the dropdown:
   - Opens that agent's terminal session
   - Updates the project's default agent (`selected_agents`) via `set_project_agents`
6. When no default agent is configured, the main button still shows the step but clicking it does nothing (existing guard), while the dropdown remains functional.
7. Clicking outside the dropdown closes it.

## Constraints

- Reuse existing `AgentIcon` component for agent icons
- Reuse existing `installedMap` from `ProjectWorkspace` (do not duplicate the check)
- Follow existing dropdown menu styling patterns (reference `AgentSelector.tsx`)
- No new dependencies
- i18n: keep English strings (no i18n framework in use here)
