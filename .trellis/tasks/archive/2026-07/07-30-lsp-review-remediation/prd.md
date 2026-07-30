# LSP Code Review Remediation

## Context

This task tracks the remediation of architectural and correctness issues identified in the LSP front/back code review (see `findings.md`).

## Goals

1. Fix all Critical issues affecting correctness, concurrency, and user experience.
2. Fix Major issues affecting robustness, protocol compliance, and layering.
3. Address Minor polish issues to improve maintainability and consistency.

## Subtasks

All subtask PRDs now contain detailed requirements and acceptance criteria.

| Subtask | ID | Priority | Findings Covered | Status |
|---------|----|----------|------------------|--------|
| LSP Critical Stability Fixes | `07-30-lsp-critical-stability` | P0 | #1, #2, #3, #4 | PRD ready |
| LSP Robustness Improvements | `07-30-lsp-robustness` | P1 | #5, #6, #8, #9, #13 | PRD ready |
| LSP Frontend Cleanup | `07-30-lsp-frontend-cleanup` | P1 | #7, #10, #11, #12, #22 | PRD ready |
| LSP Polish and Minor Fixes | `07-30-lsp-polish` | P2 | #14-#21, #23 | PRD ready |

## Acceptance Criteria

1. Each subtask is completed and passes `pnpm lint:fe`, `pnpm type-check`, and `cargo test`.
2. No new `expect("infallible")` mutex patterns are introduced.
3. LSP shutdown follows the protocol: `shutdown` request → response → `exit` notification.
4. `lspStore` lives in `src/features/lsp/store/` and is only re-exported by shared.
5. Hover tooltips work correctly in split-view / multi-pane editor layouts.

## References

- Review findings: `.trellis/tasks/07-30-lsp-review-remediation/findings.md`
- Review agent transcript: `history://LspCodeReview`
