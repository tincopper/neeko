//! Linux 字体枚举：经统一命令接口调用 `fc-list`。

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::collect_blocking;

/// 列举已安装的字体 family 名（未过滤 / 未排序）。
#[must_use]
pub fn get_system_fonts() -> Vec<String> {
    match collect_blocking(&ExecTarget::Local, "fc-list", &["--format=%{family[0]}\n"]) {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            text.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .map(|f| f.split(',').next().unwrap_or(&f).trim().to_string())
                .filter(|f| !f.is_empty())
                .collect()
        }
        Err(e) => {
            log::warn!("Failed to get Linux fonts via fc-list: {e}");
            vec![]
        }
    }
}
