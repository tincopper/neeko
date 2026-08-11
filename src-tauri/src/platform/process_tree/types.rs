//! 进程树快照类型定义。

use std::collections::HashMap;

/// 进程树快照类型：`(pid → ppid, pid → sid)`。
pub type ProcessTree = (HashMap<i32, i32>, HashMap<i32, i32>);
