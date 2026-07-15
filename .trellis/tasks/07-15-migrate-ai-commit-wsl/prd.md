# 迁移 AI Commit WSL 执行

## Goal

Replace synchronous `wsl.exe` blocking calls in the AI Commit WSL path with async `tokio::process::Command` + `collect_child_output`, eliminating async-runtime blocking while preserving the WSL-specific execution flags (-u user, -ic bash, env_remove PATH).

## Acceptance Criteria

- [ ] `whoami` call uses async `tokio::process::Command` + `.await`.
- [ ] Agent execution call uses async `tokio::process::Command` + `collect_child_output` instead of `spawn_blocking`.
- [ ] WSL flags `-d <distro>`, `-u <user>`, `bash -ic`, `env_remove("PATH")` are preserved.
- [ ] `spawn_blocking` no longer wraps the wsl.exe agent command.
- [ ] Command construction, prompt, environment loading, logging, and result mapping are unchanged.
- [ ] `cargo test` passes; no build warnings specific to this task.
