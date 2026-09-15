//! DAP 外部源码只读读取 —— 授权凭据是「调试器正停在该文件」。
//!
//! 停在第三方库 / 标准库帧时，源码路径在项目根之外，`read_file_content`
//! （`InProject` 作用域）必然拒绝，于是「停住了却看不到代码」。本模块提供
//! 一条最小授权通道：仅当请求的源码命中**当前会话调用栈的某一帧**时才读，
//! 读取复用 `common::file::reader` 的统一核心（Local / WSL / Remote 分发），
//! 走 `Trusted` 作用域并设硬上限。
//!
//! 命中判定分两个形态（见 [`is_authorized`]）：帧路径**原样**匹配（项目内文件 /
//! 无需翻译的语言），或**翻译成真实文件后**一致 —— 某些语言后端（如 Java B'）
//! 的适配器返回虚拟 uri（`jdt://…`）而前端持有规范身份，原样比较永远不中。
//! **翻译由语言后端在边界完成**（`LanguageBackend::adapter_source_path`），本模块
//! 只消费翻译后的 `FrameSource`，不感知任何语言专属形态 —— 授权与读取共用同一个
//! 解析结果（否则会出现"授权通过但打开失败"）。
//!
//! 授权无需状态表：停机时栈帧即真相，每次读取向 adapter 重取栈帧核对 ——
//! 零新增状态、零 prune、会话结束即自动失效。会话归属与栈帧查询在
//! [`super::manager::DapManager`]（会话所有权的唯一持有方），本模块只做
//! 「判定 + 读取编排」。

use std::path::Path;

use crate::common::file::reader::{read_file, FileAccessScope, FileReadRequest};
use crate::common::types::FileContent;
use crate::dap::types::MAX_SOURCE_BYTES;
use crate::AppError;
use crate::AppStateWrapper;

/// 统一的拒绝错误：**路径授权**失败的唯一文案。
///
/// 覆盖「项目不匹配 / 非 Stopped / 栈帧重取失败 / 不可解析 / 路径不在当前栈」，不区分
/// 原因 —— 差异化文案会把本命令变成路径探针。缺会话不在此列：它沿用
/// `DapManager::require_session` 的统一 `NotFound`（会话级操作只有那一条查找路径）。
#[must_use]
pub(super) fn deny() -> AppError {
    AppError::InvalidInput("not a readable external debug stop".to_string())
}

/// 一帧的两种可用表示：adapter 原样给的路径 + 我们翻译后的真实路径。
///
/// 两种表示都要留着比较，因为「帧给的是哪种」取决于后端：有的给真实文件路径
/// （项目内 / 无需翻译的语言），有的给虚拟 uri（需语言后端翻译成真实文件后才与
/// 前端请求一致）。只有原样与翻译**都**比一遍，才能在不做别名匹配的前提下把
/// 三者对齐。
#[derive(Debug, Clone, Copy)]
pub struct FrameSource<'a> {
    /// adapter 原样返回的 `Source.path`。
    pub raw: &'a str,
    /// 经语言后端翻译后的真实路径（不可解析时即原样路径）。
    pub resolved: &'a Path,
}

/// 授权判定：请求与某一帧在**任一表示**上一致即通过。
///
/// - `raw` 相等 → 覆盖帧与请求同为真实路径的场景（项目内文件 / 无需翻译的语言）；
/// - `resolved` 相等 → 覆盖帧给虚拟 uri、请求给规范身份的场景（翻译后才收敛）。
///
/// 纯函数（无 IO）：授权策略在此可单测；取栈帧与翻译的编排留在
/// [`super::manager::DapManager`]（会话所有权的唯一持有方）。
/// 空 `raw` 的帧**不参与匹配**：adapter 未给路径的帧不应因为"请求也是空"而获得授权。
#[must_use]
pub fn is_authorized(
    requested_raw: &str,
    requested_resolved: &Path,
    frames: &[FrameSource<'_>],
) -> bool {
    frames.iter().any(|frame| {
        !frame.raw.is_empty()
            && (frame.raw == requested_raw || frame.resolved == requested_resolved)
    })
}

/// 读取 `path` 作为外部源码（只读）。
///
/// 前置校验（授权 + 解析为可读真实文件）在
/// [`super::manager::DapManager::resolve_external_source`]：路径必须落在当前栈帧，
/// 且解析结果必须是绝对路径。失败 fail-closed；超过上限 / 二进制由 reader 按既有语义处理。
pub async fn read_external_source(
    state: &AppStateWrapper,
    project_id: &str,
    session_id: &str,
    path: &str,
) -> Result<FileContent, AppError> {
    let (target, resolved) = state
        .dap_manager
        .resolve_external_source(state, project_id, session_id, path)
        .await?;

    read_file(
        FileAccessScope::Trusted,
        FileReadRequest {
            target,
            base: String::new(),
            path: resolved.to_string_lossy().to_string(),
            max_bytes: Some(MAX_SOURCE_BYTES),
            detect_binary: true,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const CACHE: &str = "/h/.neeko/java-src-cache/jdk-src-21/java.base/java/io/PrintStream.java";
    const URI: &str = "jdt://contents/java.base/java.io/PrintStream.class?=api/x";
    const IDENTITY: &str = "jdt:/java.base/java/io/PrintStream.java";

    fn frame<'a>(raw: &'a str, resolved: &'a Path) -> FrameSource<'a> {
        FrameSource { raw, resolved }
    }

    /// 原样相等即通过（A 路径 / 项目内文件）；大小写敏感、前缀不算命中。
    #[test]
    fn authorizes_on_the_raw_frame_path() {
        let frames = [frame(
            "/opt/lib/src/foo.rs",
            Path::new("/opt/lib/src/foo.rs"),
        )];
        assert!(is_authorized(
            "/opt/lib/src/foo.rs",
            Path::new("/opt/lib/src/foo.rs"),
            &frames
        ));
        assert!(!is_authorized(
            "/OPT/lib/src/foo.rs",
            Path::new("/OPT/lib/src/foo.rs"),
            &frames
        ));
        assert!(!is_authorized(
            "/opt/lib/src",
            Path::new("/opt/lib/src"),
            &frames
        ));
    }

    /// **归一判据（B' 现场）**：帧给 `jdt://…` uri、请求给规范身份 `jdt:/…`，
    /// 两者原样永不相等，只有翻译成同一真实文件后才授权。
    #[test]
    fn authorizes_on_the_translated_frame_path() {
        let frames = [frame(URI, Path::new(CACHE))];
        assert!(is_authorized(IDENTITY, Path::new(CACHE), &frames));
        // 翻译到了**另一个**文件不得授权（否则会把"读别的文件"当成当前停点）。
        assert!(!is_authorized(
            IDENTITY,
            Path::new("/h/.neeko/java-src-cache/jdk-src-21/java.base/java/io/PrintWriter.java"),
            &frames
        ));
    }

    /// 空输入一律不授权；帧无 source 时不参与匹配。
    #[test]
    fn never_authorizes_empty_inputs() {
        assert!(!is_authorized("/x", Path::new("/x"), &[]));
        let frames = [frame("", Path::new("/x"))];
        assert!(!is_authorized("", Path::new("/y"), &frames));
    }
}
