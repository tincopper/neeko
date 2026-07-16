# C1 Design: Session Schema Flattening

## Goal

Flatten `sessions.json` from a 3-array structure (`projects` + `wsl_entries` + `remote_entries`) to a single unified `projects: Vec<ProjectSession>` list where each entry carries a `ProjectEnvironment` discriminant.

## New Schema

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStore {
    pub projects: Vec<ProjectSession>,
    pub active_project_id: Option<String>,
    pub last_updated: String,
    #[serde(default)]
    pub sidebar_width: Option<u32>,
    #[serde(default)]
    pub worktree_state: HashMap<String, String>,
}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSession {
    pub id: String,
    pub name: String,
    pub path: String,                 // was PathBuf, String for uniform serde
    pub environment: ProjectEnvironment,  // NEW — discriminant
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    #[serde(default)]
    pub terminal_history: Vec<String>,
    #[serde(default)]
    pub last_status: TerminalStatus,
    #[serde(default = "default_collapsed")]
    pub collapsed: bool,
    #[serde(default)]
    pub avatar_color: Option<String>,
    // WSL-only fields (always present, unused for non-WSL)
    #[serde(default)]
    pub distro: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
    // Remote-only fields
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub saved_auth: Option<String>,
}
```

Actually — better approach: embed a `ConnectionMetadata` enum or keep flat optional fields. Keep it simple with optional fields for now, serde(default) on all.

## Migration Path

1. On `load_session()`, detect if `wsl_entries` or `remote_entries` exist in the JSON
2. If yes: flatten them into `projects` with appropriate `ProjectEnvironment` tags
3. Write back the flattened format on next save
4. Old format fields annotated `#[serde(default, alias = "wsl_entries")]` is NOT possible (different structure), so use custom deserialize or post-load migration

**Migration strategy:** In `manager.rs`, after deserialization, check `!store.wsl_entries.is_empty() || !store.remote_entries.is_empty()`. If so, flatten and clear.

## Key Changes

### Backend

| File | Change |
|------|--------|
| `session/types.rs` | Remove `wsl_entries`, `remote_entries` from `SessionStore`. Add `environment` to `ProjectSession`. Keep old fields with `#[serde(default)]` for backward compat. |
| `session/manager.rs` | Remove `collect_wsl_projects`, `collect_remote_projects`. Simplify `create_session_from_projects` to single loop. Add migration logic. |
| `session/commands.rs` | `save_session` drops `_wsl_entries` and `_remote_entries` params. Frontend needs to match. |
| `project/mod.rs` | Merge `add_local_project_from_session`, `add_wsl_project_from_session`, `add_remote_project_from_session` into single `add_project_from_session`. |

### Frontend

| File | Change |
|------|--------|
| `session/types.ts` | Remove `wsl_entries`, `remote_entries` from `SessionStore`. Add `environment` to `ProjectSession`. |
| `session/api/sessionApi.ts` | `saveSession` drops wsl/remote params → becomes `saveSession(sidebarWidth?, worktreeState?)`. |
| `session/hooks/useSessionPersistence.ts` | Remove wsl/remote from save path. |
| `session/hooks/useSessionBootstrap.ts` | `wsl_entries`/`remote_entries` handling removed; just use unified `projects`. |
| `connection/store.ts` | Keep for runtime UI state but decouple from persistence. `wslEntries`/`remoteEntries` become derived from `projectStore` + `connectionStore` (or removed if unused elsewhere). |

## Backward Compatibility

- `#[serde(default)]` on all old fields
- Migration: flatten + rewrite on first load
- No data loss: old `WSLEntrySession.distro` → `ProjectSession.distro`, `RemoteEntrySession.host/port/username` → `ProjectSession.host/port/username`
- `saved_auth` base64 decoded and stored per-project
