# Redesign project onboarding guide pages

## Goal

Re-design Welcome state (no project) and ProjectGuidePage (project selected) to be more intentional, onboarding-focused, and visually distinctive.

## User Story

As a developer opening a project in Neeko, I want a clear, contextual onboarding experience that helps me understand what I can do next and quickly access my most common actions.

## Requirements

### Welcome Screen (no project selected)

- Display Neeko logo with subtle animation
- Show 3 value propositions highlighting core capabilities:
  1. AI Agent sessions (multiple agents, shared context)
  2. Integrated terminal (auto-locate project directory)
  3. Cross-project Skill library with tag management
- Primary CTA: "Add Your First Project"
- Secondary CTA: "Import from historical sessions"

### Project Guide Page (project selected)

- Show project-specific onboarding steps with progress indicator
- 3 steps:
  1. **Open Terminal** (recommended) — open project terminal
  2. **Start AI Agent Session** — chat with configured agent
  3. **Bind Tag Groups** (recommended, skippable) — assign tags to auto-install skills
- Each step has:
  - Title
  - Description
  - Action button
  - Visual state: pending / completed
- Progress indicator: "X / 3 completed"
- After all required steps completed: collapse into quick action bar
- Quick action bar contains:
  - "Resume Terminal"
  - "Open Agent"
  - "Assign Tags"

### Step Completion Persistence

- Store in `~/.neeko/config.json` under `projectOnboarding` field
- Schema:
  ```typescript
  interface ProjectOnboardingState {
    [projectId: string]: {
      version: number;       // schema version for future migrations
      completedSteps: string[];  // step ids: ['terminal', 'agent', 'tags']
      dismissed: boolean;    // true when user has completed all steps
      updatedAt: number;     // timestamp
    }
  }
  ```
- Frontend reads on project switch, writes on step action

### Component Structure

```
src/app/components/ProjectWorkspace.tsx  (welcome state refactor)
  └── WelcomeScreen.tsx  (new, replaces inline welcome block)
src/features/project/components/ProjectGuidePage.tsx  (refactor)
  ├── OnboardingSteps.tsx  (new, step list + progress)
  └── QuickActionBar.tsx  (new, collapsed post-completion view)
src/features/project/hooks/
  └── useProjectOnboarding.ts  (new, read/write onboarding state)
src/features/project/api/
  └── onboardingApi.ts  (new, invoke read/write config)
```

## Constraints

- Step "Bind Tag Groups" is skippable (recommended but not required)
- Terminal and Agent steps are always available but don't block completion
- When all required steps completed, guide auto-collapses to quick action bar
- Dismissed state persists across sessions
- No backend API changes — reuse existing config read/write commands

## Acceptance Criteria

- [ ] Welcome screen shows logo, 3 value props, primary + secondary CTA
- [ ] Project guide shows 3 onboarding steps with progress indicator
- [ ] Step "Bind Tag Groups" marked as recommended but skippable
- [ ] Clicking a step action triggers corresponding behavior (open terminal, open agent, open skill dialog)
- [ ] Step completion state persists across page reloads
- [ ] After all steps completed, guide collapses to quick action bar
- [ ] Quick action bar contains: Resume Terminal, Open Agent, Assign Tags
- [ ] No TypeScript errors, no ESLint errors
- [ ] Works at 375px, 768px, 1440px viewports

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
