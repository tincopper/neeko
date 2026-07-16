# C1 Implementation Plan

## Order

1. Backend types: `session/types.rs` — new `ProjectSession` with `environment`
2. Backend migration: `session/manager.rs` — flatten logic
3. Backend command: `session/commands.rs` — remove wsl/remote params from `save_session`
4. Backend project: `project/mod.rs` — merge add_from_session
5. Frontend types: `session/types.ts` + `connection/types.ts`
6. Frontend API: `session/api/sessionApi.ts`
7. Frontend bootstrap: `useSessionBootstrap.ts`
8. Frontend persistence: `useSessionPersistence.ts`
9. Frontend store: `connection/store.ts` — decouple from persistence
10. Tests: serde round-trip + migration

## Validation

```bash
cargo test -p neeko_lib --test unit
pnpm lint
pnpm type-check
pnpm test:run
```
