# Technical Design — SSH Executor State Machine Fix

## Changes

### 1. PID framing with suffix preservation

`read_pid` currently returns `u32` and discards overflow bytes. Change to return `(u32, Vec<u8>)` where Vec is everything after the newline in the last consumed frame.

In `spawn()`, reorder to create `stdout_tx` before `read_pid`. After `read_pid` returns, inject overflow bytes into `stdout_tx`.

### 2. Bridge half-close

Add `eof_sent: bool` flag to bridge loop. When stdin sender drops:
- If eof not sent: send `channel.eof()`, set flag, `continue`
- If eof already sent: unreachable (select arm not polled again after recv returns None)

Continue the loop until `channel.wait()` returns Eof/None. On Eof/None: break. `exit_tx` stays alive until natural loop exit.

### 3. wait_from_watch already returns Ok(code) for all numeric exits (child 1)

No change needed.

## Test strategy

- Existing executor tests (6) continue passing
- New `fake_child` tests in sync.rs verify collect_child_output with varying wait patterns
- SSH-specific framing: extract `read_pid` splitting logic into a standalone function accepting `&[u8]` so it can be unit tested without russh

```rust
// Pure function testable without SSH
fn split_pid_frame(data: &[u8]) -> Option<(u32, &[u8])>;
```
