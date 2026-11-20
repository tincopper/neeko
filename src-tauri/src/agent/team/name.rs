//! 团队**显示名**（`Team.name`）的唯一判据与派生点。
//!
//! # 为什么单独成一个模块
//!
//! 名字有两条用户可见的写入路径：**建队**（`start_team_session` 的可选入参）与**改名**
//! （`team_rename`）。判据写在任一条里，另一条就得复制一份 —— 而两份漂移的症状是
//! 「建队时能起的名字，改不回去」（或反过来），只在用户第二次改同一个名字时显形。
//!
//! # 名字为什么需要判据（它不只是 UI 文案）
//!
//! | 名字去哪儿 | 没有判据会发生什么 |
//! | --- | --- |
//! | 成员 preamble 的明文（`identity::preamble::identity_block`）| 换行打断那段「你是谁、在哪」的行结构；控制字符污染 prompt |
//! | 每次 `team_list` / `team_snapshot` 的 IPC 载荷 | 没有上界的用户字符串就是一个能把单次载荷推过 2MB 的口子（红线 4）|
//! | 列表行 / 面板头 / tab 标题 | 空串是一块点不中的空白；超长名字把行挤成省略号 |
//!
//! 判据只有一份（[`validate_team_name`]），控制字符那一条复用成员名 / 角色预设的同源实现
//! （`mcp::dispatch::reject_control_chars`）—— 「只有一个实现」优先于「就近再写一条」。

use std::path::Path;

use crate::agent::team::mcp::dispatch::reject_control_chars;
use crate::common::error::AppError;

/// 团队名的**标题**预算（不是标识符预算：名字不参与任何寻址）。
///
/// 与成员名（`MEMBER_NAME_MAX_CHARS = 64`）/ 通知标题（`MAX_TITLE_CHARS = 80`）同量级：
/// 它最终要落在一行列表 / 一个 tab 标题里，两位数的字符预算是这个用途的真实需求。
pub(crate) const MAX_TEAM_NAME_CHARS: usize = 64;

/// 用户给的团队名 → **可落库的形态**（两端空白已裁掉）。
///
/// 三条判据，每条都对应一个具体的坏结果：
///
/// | 判据 | 否则会发生什么 |
/// | --- | --- |
/// | 非空（裁剪后）| 列表里出现一块点不中的空白行，而 `Team.name` 不是 `Option` |
/// | 无控制字符 | 换行打断 preamble 的行结构；`\0` / 其他控制字符污染 prompt 与日志 |
/// | ≤ [`MAX_TEAM_NAME_CHARS`] | 单次 `team_list` 载荷可被一个名字推过红线 4 的 2MB |
///
/// **拒绝而不是截断 / 净化**：用户手写的名字被悄悄改短，比被拒绝更难排查（与
/// `validate_role` 同一条裁定）。
pub(crate) fn validate_team_name(wire: &str, name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "`name` for {wire} must not be blank: an empty name renders as a blank row that \
             cannot be hit, and the default name is derived at creation time, not here"
        )));
    }
    let len = trimmed.chars().count();
    if len > MAX_TEAM_NAME_CHARS {
        return Err(AppError::InvalidInput(format!(
            "`name` for {wire} is {len} characters; the budget for a team name is \
             {MAX_TEAM_NAME_CHARS} (it lands in one list row and one tab title)"
        )));
    }
    reject_control_chars(wire, "name", trimmed)?;
    Ok(trimmed.to_owned())
}

/// 建队时的显示名：显式名 > 项目目录名 > 团队 id。
///
/// # 「没填」与「填错」是两件事
///
/// - **空白显式名**（`Some("")` / `Some("  ")`）= 没填 ⇒ 照常派生目录名（与前端
///   `useTeamConfigDraft.name` 把全空白归成 `null` 同一条语义：「留空 = 用目录名」不能
///   因为多传了一个空串就变成错误）；
/// - **非空但不合规** ⇒ [`validate_team_name`] 拒绝，建队写库之前就失败（不净合成合法名）。
///
/// 只有**显式名**校验：另外两段是派生值（用户没有手写它们，也没有「改正」的入口），
/// 拒绝它们等于让一个长目录名再也建不出队。派生段同样要求非空 —— 空串会渲染成一块空白，
/// 与显式空名的坏结果是同一个。
pub(crate) fn resolve_name(
    wire: &str,
    name: Option<&str>,
    project_path: &Path,
    team_id: &str,
) -> Result<String, AppError> {
    if let Some(raw) = name.filter(|raw| !raw.trim().is_empty()) {
        return validate_team_name(wire, raw);
    }
    if let Some(dir) = project_path
        .file_name()
        .and_then(|dir| dir.to_str())
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        return Ok(dir.to_owned());
    }
    Ok(team_id.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 空白不是名字（列表里会是一块点不中的空白行）。
    #[test]
    fn blank_names_are_rejected() {
        for blank in ["", "   ", "\t\n"] {
            let err = validate_team_name("team_rename", blank).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidInput(_)),
                "{blank:?}: {err:?}"
            );
        }
    }

    /// 两端空白被裁掉（否则列表里会多出一对看不见的空格）。
    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(
            validate_team_name("team_rename", "  求和小队  ").unwrap(),
            "求和小队"
        );
    }

    /// 控制字符拒绝：名字会进 preamble 的明文（换行打断行结构）与日志。
    #[test]
    fn control_characters_are_rejected() {
        for bad in ["a\nb", "a\0b", "a\u{7f}b"] {
            let err = validate_team_name("team_rename", bad).unwrap_err();
            assert!(matches!(err, AppError::InvalidInput(_)), "{bad:?}: {err:?}");
        }
    }

    /// 上界是**拒绝**而不是截断：恰好 64 字符通过，65 字符拒绝（红线 4 的口子）。
    #[test]
    fn the_length_budget_is_a_rejection_not_a_truncation() {
        let exact = "队".repeat(MAX_TEAM_NAME_CHARS);
        assert_eq!(
            validate_team_name("team_rename", &exact).unwrap(),
            exact,
            "恰好到预算要放行"
        );

        let over = "队".repeat(MAX_TEAM_NAME_CHARS + 1);
        let err = validate_team_name("team_rename", &over).unwrap_err();
        match err {
            AppError::InvalidInput(message) => {
                assert!(message.contains("65"), "{message}");
                assert!(message.contains("64"), "{message}");
            }
            other => panic!("{other:?}"),
        }
    }

    /// 显式名优先（两端空白照裁）；缺省 ⇒ 项目目录名；目录名也不可用 ⇒ 团队 id。
    #[test]
    fn resolve_prefers_the_explicit_name_then_the_directory_then_the_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("小队目录");
        let explicit = resolve_name("start_team_session", Some("  求和小队 "), &path, "tm_1")
            .expect("显式名合法");
        assert_eq!(explicit, "求和小队");

        let derived = resolve_name("start_team_session", None, &path, "tm_1").expect("派生命中");
        assert_eq!(derived, "小队目录");

        // 空白显式名**不**是名字：同样派生成目录名（不是拒绝 —— 它是「没填」，不是「填错」）。
        let blank_falls_back =
            resolve_name("start_team_session", Some("   "), &path, "tm_1").expect("派生命中");
        assert_eq!(blank_falls_back, "小队目录");

        // 没有目录名分量（`..` 的 `file_name()` 是 `None`）：退到团队 id。
        let no_dir_name = resolve_name("start_team_session", None, &dir.path().join(".."), "tm_1")
            .expect("派生命中");
        assert_eq!(no_dir_name, "tm_1");
    }

    /// 显式名不合规 ⇒ 在建队写库之前就拒绝（不是静默净化成合法名）。
    #[test]
    fn resolve_rejects_an_invalid_explicit_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err =
            resolve_name("start_team_session", Some("bad\nname"), dir.path(), "tm_1").unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)), "{err:?}");
    }
}
