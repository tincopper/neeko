//! DAP 外部源码只读读取 —— 授权凭据是「调试器正停在该文件」。
//!
//! 停在第三方库 / 标准库帧时，源码路径在项目根之外，`read_file_content`
//! （`InProject` 作用域）必然拒绝，于是「停住了却看不到代码」。本模块提供
//! 一条最小授权通道：仅当目标路径与**当前会话调用栈的某一帧路径**精确匹配时
//! 才读，读取复用 `common::file::reader` 的统一核心（Local / WSL / Remote
//! 分发），走 `Trusted` 作用域并设硬上限。
//!
//! 授权无需状态表：停机时栈帧即真相，每次读取向 adapter 重取栈帧核对 ——
//! 零新增状态、零 prune、会话结束即自动失效。会话归属与栈帧查询在
//! [`super::manager::DapManager`]（会话所有权的唯一持有方），本模块只做
//! 「判定 + 读取编排」。

use crate::common::file::reader::{read_file, FileAccessScope, FileReadRequest};
use crate::common::types::FileContent;
use crate::dap::types::{StackFrameDto, MAX_SOURCE_BYTES};
use crate::AppError;
use crate::AppStateWrapper;

/// 统一的拒绝错误：**路径授权**失败的唯一文案。
///
/// 覆盖「项目不匹配 / 非 Stopped / 栈帧重取失败 / 路径不在当前栈」，不区分原因
/// —— 差异化文案会把本命令变成路径探针。缺会话不在此列：它沿用
/// `DapManager::require_session` 的统一 `NotFound`（会话级操作只有那一条查找路径）。
#[must_use]
pub(super) fn deny() -> AppError {
    AppError::InvalidInput("not a readable external debug stop".to_string())
}

/// `path` 是否命中当前调用栈的某个帧路径。
///
/// 精确匹配、大小写敏感：比较对象是 adapter 原样返回的字符串，不做任何归一
/// （归一会在两端形态不一致时产生「授权通过但打开失败」的错配）。
#[must_use]
pub fn frame_paths_match(frames: &[StackFrameDto], path: &str) -> bool {
    frames
        .iter()
        .any(|f| f.source_path.as_deref() == Some(path))
}

/// 读取 `path` 作为外部源码（只读）。
///
/// 前置校验：绝对路径 + 会话正停在该路径
/// （[`super::manager::DapManager::assert_stopped_at_path`]）。
/// 失败 fail-closed；超过上限 / 二进制由 reader 按既有语义处理。
pub async fn read_external_source(
    state: &AppStateWrapper,
    project_id: &str,
    session_id: &str,
    path: &str,
) -> Result<FileContent, AppError> {
    // 相对路径无法与栈帧路径（adapter 原样）对齐，且拼根后会落回项目内，
    // 绕过「外部源码」语义 —— 直接拒绝，不上溯。
    if !std::path::Path::new(path).is_absolute() {
        return Err(deny());
    }
    state
        .dap_manager
        .assert_stopped_at_path(project_id, session_id, path)
        .await?;

    let (target, _root) = state.resolve_project(project_id)?;
    read_file(
        FileAccessScope::Trusted,
        FileReadRequest {
            target,
            base: String::new(),
            path: path.to_string(),
            max_bytes: Some(MAX_SOURCE_BYTES),
            detect_binary: true,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(id: i64, source: Option<&str>) -> StackFrameDto {
        StackFrameDto {
            id,
            name: format!("frame{id}"),
            source_path: source.map(String::from),
            line: 1,
            column: 1,
            source_name: None,
            source_reference: None,
        }
    }

    #[test]
    fn frame_paths_match_is_exact_and_case_sensitive() {
        let frames = vec![frame(1, Some("/opt/lib/src/foo.rs")), frame(2, None)];
        assert!(frame_paths_match(&frames, "/opt/lib/src/foo.rs"));
        // 大小写敏感 / 前缀不算命中
        assert!(!frame_paths_match(&frames, "/OPT/lib/src/foo.rs"));
        assert!(!frame_paths_match(&frames, "/opt/lib/src"));
        assert!(!frame_paths_match(&frames, "/opt/lib/src/foo.rs:12"));
    }

    #[test]
    fn frame_paths_match_rejects_empty_inputs() {
        assert!(!frame_paths_match(&[], "/x"));
        assert!(!frame_paths_match(&[frame(1, Some("/x"))], ""));
        // 帧无 source 时不参与匹配
        assert!(!frame_paths_match(&[frame(1, None)], "/x"));
    }
}
