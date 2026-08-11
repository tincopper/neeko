use super::ProcessTree;

/// macOS：通过 libproc 枚举所有进程，读取 ppid 与 sid。
#[must_use]
pub fn snapshot_process_tree() -> ProcessTree {
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
