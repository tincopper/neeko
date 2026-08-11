use super::ProcessTree;

/// Linux：通过 procfs（`/proc/<pid>/stat`）枚举所有进程，读取 ppid 与 sid。
#[must_use]
pub fn snapshot_process_tree() -> ProcessTree {
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
