//! 项目路径 → 执行环境的匹配（**项目域**的查找规则）。
//!
//! 为什么在这里（原在组合根 `app_state.rs`）：这是"哪个项目拥有这个路径"的领域规则，
//! 组合根只应把已读到的项目列表交给它，不该自己实现匹配。

use crate::core::project::ProjectEnvironment;
use crate::project::types::Project;
use crate::AppError;

/// 按项目文件系统路径匹配其执行环境。
///
/// 匹配规则见 [`paths_equal_for_env`]（分隔符归一 + 去尾斜杠的**宽松相等**）。
/// 未注册的路径返回 `NotFound`（调用方据此提示"先添加项目"）。
pub fn environment_for_path(
    projects: &[Project],
    project_path: &str,
) -> Result<ProjectEnvironment, AppError> {
    projects
        .iter()
        .find(|p| paths_equal_for_env(&p.path.to_string_lossy(), project_path))
        .map(|p| p.environment.clone())
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "No registered project for path '{project_path}' — cannot resolve execution environment"
            ))
        })
}

/// Loose path equality for project environment lookup.
///
/// 归一：`\` → `/`、去尾斜杠。**只用于查找**，不作为文件身份判定
/// （身份判定一律走 `fileRef` / `sameFile` 语义）。
fn paths_equal_for_env(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    norm(a) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_equality_tolerates_separators_and_trailing_slash() {
        assert!(paths_equal_for_env("/p/a", "/p/a"));
        assert!(paths_equal_for_env("/p/a/", "/p/a"));
        // 分隔符归一：同一 Windows 路径的两种写法等价。
        assert!(paths_equal_for_env(r"C:\p\a", "C:/p/a"));
        assert!(paths_equal_for_env(r"C:\p\a\", "C:/p/a"));
        // 只归一形态，不做根转换：不同根不相等。
        assert!(!paths_equal_for_env("/p/a", r"C:\p\a"));
        assert!(!paths_equal_for_env("/p/a", "/p/ab"));
        assert!(!paths_equal_for_env("/p/a", "/p/b"));
    }
}
