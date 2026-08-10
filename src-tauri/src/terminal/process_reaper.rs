// ─── Session Process Reaper ───────────────────────────────────────────────
//
// Kills the full process tree belonging to a PTY session on Unix.
//
// Background: portable-pty spawns the shell with setsid(), making it the
// leader of a new session AND process group (PGID == PID).  graceful_kill()
// signals -PGID, which reaches every process still in that group.  However
// some tools (CLI agents, language servers, daemons) call setsid() themselves
// and escape the group — those processes survive close_pty_handle().  This
// module closes that gap by enumerating all processes and reaping any whose
// session ID matches the shell OR whose ancestor chain (recursive ppid)
// contains the shell PID.
//
// ⚠ Ordering contract: the process-table snapshot MUST be taken while the
// shell is still alive.  Once the shell is reaped, its surviving children are
// reparented to launchd/init and the ppid chain used by collect_from_maps is
// broken — a post-kill snapshot returns nothing.

#[cfg(unix)]
use std::time::{Duration, Instant};

const GRACEFUL_TIMEOUT_SECS: u64 = 2;

/// Enumerate all PIDs belonging to the PTY session rooted at `shell_pid`.
///
/// A process belongs to the session when any of these hold:
/// - `pid == shell_pid` (the shell itself)
/// - `sid == shell_pid` (same session, i.e. did NOT detach)
/// - walking `ppid` from the process reaches `shell_pid` (detached descendant)
#[cfg(unix)]
#[must_use]
pub fn collect_session_processes(shell_pid: i32) -> Vec<i32> {
    let (ppid_map, sid_map) = snapshot_process_tree();
    collect_from_maps(shell_pid, &ppid_map, &sid_map)
}

/// Pure membership decision shared by all Unix platforms.
///
/// `ppid_map` maps pid → parent pid; `sid_map` maps pid → session id. A pid
/// belongs when it is the shell, shares the shell's session, or is a
/// descendant (walking ppid) of the shell.
#[cfg(unix)]
fn collect_from_maps(
    shell_pid: i32,
    ppid_map: &std::collections::HashMap<i32, i32>,
    sid_map: &std::collections::HashMap<i32, i32>,
) -> Vec<i32> {
    fn is_descendant(
        mut pid: i32,
        shell_pid: i32,
        ppid_map: &std::collections::HashMap<i32, i32>,
    ) -> bool {
        // Guard against pid loops / stale maps.
        for _ in 0..64 {
            if pid == shell_pid {
                return true;
            }
            match ppid_map.get(&pid) {
                Some(&ppid) if ppid > 0 => pid = ppid,
                _ => return false,
            }
        }
        false
    }

    let mut all: std::collections::HashSet<i32> = std::collections::HashSet::new();
    all.extend(ppid_map.keys().copied());
    all.extend(sid_map.keys().copied());
    all.retain(|&pid| {
        pid == shell_pid
            || sid_map.get(&pid) == Some(&shell_pid)
            || is_descendant(pid, shell_pid, ppid_map)
    });
    let mut sorted: Vec<i32> = all.into_iter().collect();
    sorted.sort_unstable();
    sorted
}

/// Snapshot `(pid → ppid, pid → sid)` for every live process on this host.
#[cfg(target_os = "macos")]
fn snapshot_process_tree() -> (
    std::collections::HashMap<i32, i32>,
    std::collections::HashMap<i32, i32>,
) {
    use libproc::libproc::bsd_info::BSDInfo;
    use libproc::libproc::proc_pid::pidinfo;
    use libproc::processes::{pids_by_type, ProcFilter};

    let mut ppid_map = std::collections::HashMap::new();
    let mut sid_map = std::collections::HashMap::new();

    let Ok(pids) = pids_by_type(ProcFilter::All) else {
        return (ppid_map, sid_map);
    };
    for pid in pids {
        let pid = pid.cast_signed();
        if let Ok(info) = pidinfo::<BSDInfo>(pid, 0) {
            ppid_map.insert(pid, info.pbi_ppid.cast_signed());
            let sid = unsafe { libc::getsid(pid) };
            if sid >= 0 {
                sid_map.insert(pid, sid);
            }
        }
    }
    (ppid_map, sid_map)
}

/// Snapshot `(pid → ppid, pid → sid)` on Linux via procfs.
#[cfg(target_os = "linux")]
fn snapshot_process_tree() -> (
    std::collections::HashMap<i32, i32>,
    std::collections::HashMap<i32, i32>,
) {
    use std::collections::HashMap;
    use std::fs;

    let mut ppid_map = HashMap::new();
    let mut sid_map = HashMap::new();

    let Ok(entries) = fs::read_dir("/proc") else {
        return (ppid_map, sid_map);
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Ok(pid) = name.parse::<i32>() else {
            continue;
        };
        // /proc/<pid>/stat format: pid (comm) state ppid pgrp session ...
        // comm may contain spaces/parens, so split after the LAST ')'.
        let Ok(stat) = fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some((_, rest)) = stat.rsplit_once(')') else {
            continue;
        };
        let fields: Vec<&str> = rest.split_whitespace().collect();
        if fields.len() >= 4 {
            if let Ok(ppid) = fields[1].parse::<i32>() {
                ppid_map.insert(pid, ppid);
            }
            if let Ok(sid) = fields[3].parse::<i32>() {
                sid_map.insert(pid, sid);
            }
        }
    }
    (ppid_map, sid_map)
}

/// SIGTERM every pid, wait up to [`GRACEFUL_TIMEOUT_SECS`], then SIGKILL
/// the survivors.  Silently ignores already-dead processes.
#[cfg(unix)]
pub fn kill_processes(ids: &[i32]) {
    if ids.is_empty() {
        return;
    }
    for pid in ids {
        unsafe {
            libc::kill(*pid, libc::SIGTERM);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(GRACEFUL_TIMEOUT_SECS);
    loop {
        let any_alive = ids.iter().any(|&pid| unsafe { libc::kill(pid, 0) } == 0);
        if !any_alive || Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    for pid in ids {
        unsafe {
            libc::kill(*pid, libc::SIGKILL);
        }
    }
}

/// Termination helper used by close_pty_handle after the process-group kill.
///
/// `orphans` MUST be snapshotted via [`collect_session_processes`] BEFORE the
/// shell is reaped — once the shell dies, its children are reparented to
/// launchd/init and can no longer be discovered by the ppid chain.
#[cfg(unix)]
pub fn reap_session_tree(orphans: &[i32]) {
    if orphans.is_empty() {
        return;
    }
    log::info!(
        "[PTY] Process tree reaper: {} orphaned process(es)",
        orphans.len()
    );
    kill_processes(orphans);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn wait_ms(ms: u64) {
        std::thread::sleep(Duration::from_millis(ms));
    }

    /// Spawn a fake PTY hierarchy: a "shell" that becomes a session leader,
    /// plus a grandchild that calls setsid() to detach from that session.
    /// Returns `(shell_pid, grandchild_pid)`.
    #[cfg(unix)]
    #[allow(clippy::expect_used)]
    fn spawn_detached_hierarchy() -> (i32, i32) {
        let mut fds = [0i32; 2];
        let rc = unsafe { libc::pipe(fds.as_mut_ptr()) };
        assert_eq!(rc, 0, "pipe() failed");

        let shell_pid = unsafe { libc::fork() };
        assert!(shell_pid >= 0, "fork() failed");
        if shell_pid == 0 {
            // ── shell child ──
            unsafe {
                libc::setsid();
            }
            let grand = unsafe { libc::fork() };
            if grand == 0 {
                // ── grandchild: report pid, detach from session, hang ──
                let msg = format!("{}\n", unsafe { libc::getpid() });
                unsafe {
                    libc::write(fds[1], msg.as_ptr().cast(), msg.len());
                    libc::setsid();
                }
                std::thread::sleep(Duration::from_secs(60));
                unsafe {
                    libc::_exit(0);
                }
            }
            std::thread::sleep(Duration::from_secs(60));
            unsafe {
                libc::_exit(0);
            }
        }

        // ── parent ──
        let mut buf = [0u8; 32];
        #[allow(clippy::cast_sign_loss)]
        let n = unsafe { libc::read(fds[0], buf.as_mut_ptr().cast(), buf.len()) } as usize;
        unsafe {
            libc::close(fds[0]);
            libc::close(fds[1]);
        }
        let grand_pid: i32 = std::str::from_utf8(&buf[..n])
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .expect("grandchild pid over pipe");
        wait_ms(150);
        (shell_pid, grand_pid)
    }

    #[cfg(unix)]
    fn kill_tree(pids: &[i32]) {
        for pid in pids {
            unsafe {
                libc::kill(*pid, libc::SIGKILL);
            }
        }
        for pid in pids {
            let mut status = 0;
            unsafe {
                libc::waitpid(*pid, &mut status, 0);
            }
        }
    }

    #[test]
    #[cfg(unix)]
    fn collect_session_processes_finds_detached_descendants() {
        let (shell_pid, grand_pid) = spawn_detached_hierarchy();
        let collected = collect_session_processes(shell_pid);
        kill_tree(&[shell_pid, grand_pid]);

        assert!(
            collected.contains(&shell_pid),
            "shell itself must be collected, got {collected:?}"
        );
        assert!(
            collected.contains(&grand_pid),
            "detached grandchild must be collected via ppid chain, got {collected:?}"
        );
    }

    /// Poll until `pid` no longer exists (ESRCH).  Used for processes that are
    /// not our direct children (reparented to launchd/init after the shell
    /// dies), where waitpid() returns ECHILD.
    #[cfg(unix)]
    fn wait_gone(pid: i32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let rc = unsafe { libc::kill(pid, 0) };
            if rc != 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            wait_ms(100);
        }
    }

    /// Regression: production order is snapshot → kill shell → reap.  The
    /// detached grandchild must be terminated even though the shell is
    /// already dead by the time the reaper runs.
    #[test]
    #[cfg(unix)]
    fn snapshot_before_kill_reaps_detached_descendant() {
        let (shell_pid, grand_pid) = spawn_detached_hierarchy();
        // 1. Snapshot while the shell is still alive (as close_pty_handle now
        //    does before graceful_kill).
        let orphans = collect_session_processes(shell_pid);
        assert!(
            orphans.contains(&grand_pid),
            "snapshot taken before kill must contain detached grandchild, got {orphans:?}"
        );
        // 2. Kill + reap the shell (as graceful_kill does).
        unsafe {
            libc::kill(shell_pid, libc::SIGKILL);
        }
        let mut status = 0;
        unsafe {
            libc::waitpid(shell_pid, &mut status, 0);
        }
        // 3. Reap using the pre-kill snapshot.
        reap_session_tree(&orphans);
        let gone = wait_gone(grand_pid, Duration::from_secs(3));
        if !gone {
            unsafe {
                libc::kill(grand_pid, libc::SIGKILL);
            }
            let _ = wait_gone(grand_pid, Duration::from_secs(2));
        }
        assert!(
            gone,
            "detached grandchild must be terminated when snapshot precedes the shell kill"
        );
    }

    /// Wait up to `timeout` for `pid` to be reaped via waitpid(WNOHANG).
    #[cfg(unix)]
    fn wait_reaped(pid: i32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let mut status = 0;
            let rc = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            if rc == pid {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            wait_ms(100);
        }
    }

    #[test]
    #[cfg(unix)]
    fn kill_processes_terminates_detached_process() {
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0);
        if pid == 0 {
            unsafe {
                libc::setsid();
            }
            std::thread::sleep(Duration::from_secs(60));
            unsafe {
                libc::_exit(0);
            }
        }
        wait_ms(150);

        kill_processes(&[pid]);

        let reaped = wait_reaped(pid, Duration::from_secs(3));
        if !reaped {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
            let _ = wait_reaped(pid, Duration::from_secs(2));
        }
        assert!(
            reaped,
            "process should have been terminated by kill_processes well before its 60s sleep"
        );
    }
}
