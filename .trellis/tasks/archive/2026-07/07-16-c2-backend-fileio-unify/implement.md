# C2 Implementation Plan

## Order

1. Create `common/file/service.rs` with `read_dir_tree`, `read_file_content`, `write_file_content`, `read_file_content_shell` all taking `&ExecTarget`
2. Migrate `wsl_read_dir_tree` from `common/git/wsl.rs` into the new service
3. Migrate `remote_read_dir_tree_fn` from `common/git/remote.rs` into the new service
4. Delete `common/git/wsl.rs` (all content moved)
5. Delete `common/git/remote.rs` (dir-tree content moved; `get_remote_git_info` stays)
6. Update `git/commands.rs`: `read_dir_tree`, `read_file_content`, `write_file_content` → call unified service
7. Remove `exec_target_from_git_transport`, use `ProjectEnvironment::to_exec_target` instead
8. Rename `resolve_agent_for_remote` → `resolve_agent_command` with unified return type

## Validation

```bash
cargo test -p neeko_lib
```
