# C5 Implementation Plan

## Order (execute last, after C1-C4)

1. Search for `ProjectType` and `ENV_TYPE_TO_VIEW_TYPE` usage; replace with `ProjectEnvironment`
2. Fix `AppError::Wsl` → `AppError::Unsupported` for non-WSL platform guards
3. Move/rename files as per design
4. Verify naming: `resolve_agent_config` vs `resolve_agent_command`
5. Update spec docs

## Validation

```bash
pnpm lint
pnpm type-check
pnpm test:run
cargo test
```
