# Technical Design — 优化统一命令执行器

## 1. Architecture and boundaries

本任务是父级集成任务，不直接承载大段实现。实际改造分为六个子任务，父任务负责统一契约、依赖顺序和最终验收。

### 1.1 Layering

```text
ExecTarget
  └─ create_executor(target) -> Box<dyn CommandExecutor>
       └─ CommandExecutor::spawn(...) -> ExecChild
            ├─ stdin: optional async writer
            ├─ stdout/stderr: optional async readers
            ├─ wait: async exit-status future
            └─ kill: explicit one-shot termination

collection layer
  ├─ collect_child_output(ExecChild) -> ExecOutput
  ├─ collect_output(target, cmd, args) -> ExecOutput
  └─ exec_on(target, cmd, args) -> success stdout / CommandFailed

caller adapters
  ├─ GitTransport: builds Git command, optionally writes stdin, maps ExecOutput to GitExecError
  ├─ GhCli / PrProvider: target-aware async command/API operations
  ├─ theme/terminal: async WSL operations
  └─ Tauri commands: clone state under short lock, release lock, then await
```

### 1.2 Responsibility rules

- `CommandExecutor` only abstracts process/channel spawning and lifecycle; it does not contain Git, PR, theme, timeout, or product semantics.
- `ExecChild` remains the low-level streaming contract.
- The collection layer owns stdin EOF for no-input calls, concurrent output draining, exit collection, and structured output.
- Input-producing callers write through `ExecChild.stdin`, close it, then reuse `collect_child_output`; the trait is not expanded for one caller.
- Domain adapters retain domain-specific command construction, timeout policy, and error classification.

## 2. Core contracts

### 2.1 Structured output

```rust
#[must_use]
pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: i32,
}
```

`collect_output` returns `ExecOutput` for both zero and nonzero process exit. `Err` is reserved for failures to spawn, communicate, collect streams, or obtain an exit status.

### 2.2 Convenience execution

```rust
pub async fn exec_on(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<String, ExecError>;
```

- Zero exit: lossy UTF-8 stdout text, preserving current convenience behavior.
- Nonzero exit: structured `ExecError::CommandFailed { code, stdout, stderr }`.
- SSH transport/auth/channel failures remain `ExecError::Ssh`.
- No `Handle::block_on` compatibility path remains.

### 2.3 Child collection

`collect_child_output` takes ownership of a child after the caller has completed any stdin writing. It concurrently drains stdout and stderr and awaits the exit result without serial pipe backpressure.

For no-input `collect_output`, stdin is taken and closed before collection. For caller-provided input, the caller writes all bytes and explicitly shuts down/drops the writer before collection.

### 2.4 Exit semantics

All executor implementations must make the child wait future report an obtained numeric exit consistently. The collection layer then creates `ExecOutput`; only the convenience layer turns a nonzero status into `CommandFailed`.

## 3. SSH protocol design

### 3.1 PID preamble framing

The remote command emits `PID\n` before `exec`. PID parsing must split at the first newline:

- prefix → parse as PID;
- suffix → preserve as initial stdout;
- arbitrary SSH `Data` frame boundaries are not treated as line boundaries.

The preserved suffix must be delivered before later stdout without reordering.

### 3.2 Half-close state machine

Closing local stdin means “no more input”, not “stop the bridge”:

```text
stdin open --sender closes--> send channel EOF once
                              continue channel.wait
                              forward stdout/stderr
                              record ExitStatus
                              stop on remote EOF/channel close
```

The bridge must not drop its exit-status sender merely because local stdin closed. Normal EOF completion must not map to `Killed`.

State/parsing logic should be extracted enough to test with synthetic events; no real SSH server is required.

## 4. WSL boundary

- `executor/wsl.rs` contains both cfg-specific implementations.
- `mod.rs` declares the module once and does not embed a second stub.
- `WslExecutor` exposes a platform-neutral constructor so `factory.rs` does not branch on struct shape.
- On non-Windows, `ExecTarget::Wsl` remains constructible and execution returns a clear `ExecError::Wsl`.

## 5. Domain migrations

### 5.1 Git stdin

`GitTransport::run_git_with_stdin` builds the target-specific Git invocation but executes all targets through `CommandExecutor::spawn`:

1. construct target and command;
2. spawn;
3. take stdin, write exact bytes, shutdown/drop;
4. collect child output;
5. preserve Local Git's existing 30-second timeout at the domain layer;
6. map nonzero output to `GitExecError` with stdout/stderr retained.

Remove WSL/Remote Base64 stdin pipelines. This is caller adaptation, not a new executor trait method.

### 5.2 GhCli and PR

- `GhCli` command, JSON, API, repository discovery, installed, and authenticated methods become async.
- Installed/authenticated checks execute against `self.target`.
- `PrProvider` uses `#[async_trait]` to remain object-safe behind `Box<dyn PrProvider>`.
- Factory/store construction remains synchronous.
- Owner/repo and PR caches use lookup → release lock → await → update; no mutex guard crosses await.
- Tauri command handlers copy owned project data before releasing state locks and awaiting.

### 5.3 Theme, terminal, and AI Commit

- WSL theme helpers and their service/Tauri call chains become async.
- Pure local filesystem theme operations may remain synchronous.
- AI Commit's WSL branch uses `ExecTarget::Wsl`; command construction and behavior remain unchanged.
- Existing already-async Git remote/file helpers directly await the new API and remove obsolete `spawn_blocking` wrappers around executor calls.

## 6. Child task map and dependencies

1. `07-15-async-executor-contract`
   - Foundation: contracts, collection, errors, WSL consolidation, core tests.
   - No dependency.

2. `07-15-ssh-executor-state-machine`
   - PID framing and EOF/exit-state repair.
   - Depends on the child 1 contract.

3. `07-15-unify-git-stdin-execution`
   - Caller adaptation to real stdin and common collection; preserve Local timeout.
   - Depends on children 1 and 2.

4. `07-15-migrate-ai-commit-wsl`
   - Replace synchronous WSL execution in AI Commit.
   - Depends on child 1; can proceed independently of child 3.

5. `07-15-async-gh-pr-chain`
   - GhCli, PrProvider, caches, PR Tauri commands.
   - Depends on child 1.

6. `07-15-migrate-executor-callers`
   - Theme/terminal and remaining direct callers; remove obsolete sync module after migrations.
   - Depends on child 1; should coordinate/land after child 5 where files overlap.

Parent integration follows all six children.

## 7. Compatibility and migration

- Preserve `ExecTarget` as the public target-selection boundary.
- Preserve success-text behavior for ordinary `exec_on` callers.
- Structured output is additive at the collection layer; domain callers opt into it where needed.
- Tauri command names and frontend IPC argument/result shapes remain unchanged; only Rust handlers become async.
- No global default timeout or cancellation abstraction is introduced.
- Existing Local Git timeout behavior must remain intact.

## 8. Rollback and operational considerations

- Each child is independently reviewable and revertible.
- Child 1 is the contract pivot; downstream children must not land without it.
- If a downstream migration fails, retain the old caller until its child is fixed rather than restoring `Handle::block_on`.
- Do not mix shell-command, prompt, environment, or product behavior changes into mechanical migration children.
- Windows behavior requires CI/cross-target validation where available; otherwise document static cfg review and rely on normal three-platform CI before release.

## 9. Deferred work

A future task may add opt-in timeout/cancellation options and cleanup semantics. It must separately decide durations, caller overrides, process-group termination, SSH kill behavior, and UI/error mapping. This design intentionally adds no unused options abstraction now.
