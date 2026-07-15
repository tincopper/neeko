# Technical Design — 异步执行器收集契约

## Boundaries

`CommandExecutor::spawn` 与 `ExecChild` 保持底层流式契约。新 collection 层只负责 stdio 生命周期、并发收集和退出状态，不包含 Git/PR/theme 语义。

## Types

```rust
#[must_use]
pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: i32,
}
```

`ExecError` 增加结构化命令失败变体，包含 code/stdout/stderr；连接、认证、spawn、I/O 和 WSL unsupported 继续保留独立类别。

## Data flow

```text
collect_output(target, cmd, args)
  -> create_executor
  -> spawn.await
  -> take/drop or shutdown stdin
  -> collect_child_output
       -> concurrently drain stdout/stderr
       -> await numeric exit
       -> ExecOutput

exec_on(...)
  -> collect_output.await
  -> exit_code == 0: lossy stdout text
  -> otherwise: CommandFailed
```

Missing stdout/stderr streams are treated as empty readers/results. Collection must not serialize the reads. The child wait contract should produce a numeric exit status consistently rather than pre-classifying SSH nonzero exits as infrastructure errors.

## WSL design

- `mod.rs` declares `mod wsl;` once and contains no inline implementation.
- `wsl.rs` owns cfg-specific struct/impl blocks and a stable constructor accepting distro.
- Non-Windows constructor may discard distro internally; spawn returns `ExecError::Wsl`.
- factory performs one unconditional constructor call.

## Compatibility

- `ExecTarget` remains the target boundary.
- Ordinary callers retain success stdout text through async `exec_on`.
- Downstream code will not compile until migrated; no unsafe sync shim is added to conceal this.

## Tests

Use local commands and fake/in-memory readers. Tests must have finite Tokio timeouts to expose deadlock without hanging the suite. Core tests do not require SSH/WSL services.

## Rollback

If the contract proves insufficient, revert this child and revise design before downstream migration. Do not restore nested `Handle::block_on` as an interim compatibility layer.
