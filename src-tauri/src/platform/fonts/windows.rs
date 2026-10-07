//! Windows 字体枚举：经统一命令接口调用 PowerShell。
//!
//! `CREATE_NO_WINDOW` 由 `LocalExecutor` 在 `platform::process_spawn::apply_child_flags`
//! 统一附加，本模块不再手工设置。

use crate::common::executor::factory::ExecTarget;
use crate::core::exec::collect_blocking;

/// 列举已安装的字体 family 名（未过滤 / 未排序）。
#[must_use]
pub fn get_system_fonts() -> Vec<String> {
    const SCRIPT: &str = r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null;
(New-Object System.Drawing.Text.InstalledFontCollection).Families |
Where-Object { $_.IsStyleAvailable('Regular') } |
Select-Object -ExpandProperty Name"#;

    match collect_blocking(
        &ExecTarget::Local,
        "powershell",
        &["-NoProfile", "-Command", SCRIPT],
    ) {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(e) => {
            log::warn!("Failed to get Windows fonts via PowerShell: {e}");
            vec![]
        }
    }
}
