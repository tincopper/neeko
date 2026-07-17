# PRD: PR list load error friendly UX

## Goal

When Pull Requests fail to load, show clear English guidance (especially repo not found / no permission) instead of a generic "Failed to load pull requests" message and opaque technical noise.

## Background

`gh pr list` can fail with GraphQL errors such as:

```text
Could not resolve to a Repository with the name 'owner/repo'
```

This usually means the remote does not exist, is private, or the current GitHub token lacks access. The UI previously collapsed this into a generic failure, and the backend dumped stderr as raw byte arrays under `Unknown error:`.

## Requirements

1. Backend command failures surface UTF-8 stderr text, not byte arrays.
2. Common `gh` failures are classified into stable English user messages (access, auth, network).
3. PR Tauri commands map failures to `AppError::Git` (not `Unknown error`).
4. Frontend correctly extracts Tauri string rejections and maps them to title / detail / hint / actions.
5. PR panel error empty state shows actionable English copy with Retry and Login when appropriate.

## Acceptance criteria

- [x] GraphQL repo resolve failure → "Can't access this repository" with permission guidance
- [x] No `stderr=[71, 114, ...]` in user-visible errors
- [x] String invoke rejections are displayed
- [x] Install / auth empty states unchanged
- [x] Unit tests for Rust classifiers and TS helpers

## Out of scope

- Multi-remote picker
- Gitee/GitLab PR providers
- Global AppError redesign
