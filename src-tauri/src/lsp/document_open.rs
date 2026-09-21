//! 「确保服务器已打开该文档」的唯一入口。
//!
//! 为什么必须单点（2026-09-21 实证）：`lsp_request` 与 `lsp_go_to_definition`
//! 曾经各自「读盘 + 手写 `version: 1` + 裸发 didOpen」，绕过了转发层的归一与登记。
//! 后果链：请求路径先以 v1 打开 → 编辑器随后以 v0 打开 → 服务器
//! `duplicate DidOpenTextDocument`；即便不报错，服务器之后用 v1 推诊断，而
//! `@codemirror/lsp-client` 手里的文档版本是 v0 → 版本门整批丢弃 → 编辑器没有
//! 波浪线 / gutter 灯泡，Problems 面板却有诊断（两个数据源分叉的经典症状）。
//!
//! 因此：**任何** didOpen 的发送者都走 [`ensure_document_open`]（读盘侧）或
//! `LspManager::send_did_open`（转发侧），版本号一律由登记表推进。

use crate::common::executor::factory::ExecTarget;
use crate::common::file::reader::{read_file, FileAccessScope, FileReadRequest};

/// 下一次打开该文档应使用的 LSP 版本号：登记表推进（首开为 0）。
///
/// 为什么不复用编辑器传来的版本：两侧计数器来源不同（后端读盘 vs CodeMirror 文档），
/// 混用会让服务器与客户端版本分叉并被客户端的版本门丢弃。
#[must_use]
pub fn next_open_version(previous: Option<i64>) -> i64 {
    previous.map_or(0, |v| v + 1)
}

/// 该 uri 是否需要后端代为打开：`jdt://` 是 jdtls 模型内的 IClassFile（非磁盘文件），
/// 无法读盘、也不需要 didOpen（服务器端原生解析）；**编辑器正持有视图**的文档也不代开
/// —— 后端只能读到磁盘旧文本，代开会让服务器按旧文本报出错位诊断，而编辑器自己的
/// didOpen 马上就到（谁编辑谁负责，单一所有权）。
#[must_use]
pub fn needs_backend_open(uri: &str, already_open: bool, editor_owned: bool) -> bool {
    !already_open && !editor_owned && !uri.starts_with("jdt://")
}

/// 确保服务器已打开该文档（唯一入口；已打开或被编辑器持有则不动）。
///
/// 读文件失败按"没打开"处理并记录告警 —— 调用方（请求路径）继续走，让请求自身
/// 去报错，避免把读盘问题伪装成 LSP 失败。
pub async fn ensure_document_open(
    state: &crate::app_state::AppStateWrapper,
    project_path: &str,
    language_id: &str,
    uri: &str,
) -> bool {
    let already_open = state
        .lsp_manager
        .is_document_open(project_path, language_id, uri);
    let editor_owned = state
        .lsp_manager
        .is_editor_owned(project_path, language_id, uri);
    if !needs_backend_open(uri, already_open, editor_owned) {
        if editor_owned && !already_open {
            log::debug!("[LSP] skip auto-open for {} (held by an editor view)", uri);
        }
        return already_open;
    }

    let file_path = uri.strip_prefix("file://").unwrap_or(uri);
    let Ok(text) = read_file(
        FileAccessScope::Trusted,
        FileReadRequest {
            target: ExecTarget::Local,
            base: String::new(),
            path: file_path.to_string(),
            // didOpen 全文发送给 server，不设大小上限（与既有行为一致）
            max_bytes: None,
            detect_binary: false,
        },
    )
    .await
    else {
        log::warn!("[LSP] Could not read file for didOpen: {}", file_path);
        return false;
    };

    let version = next_open_version(state.lsp_manager.open_document_version(
        project_path,
        language_id,
        uri,
    ));
    // 超大文件不代开：didOpen 全文过 IPC（红线 4 的 2MB 边界），且服务器本也吃不消。
    // 调用方的请求照旧发出，由服务器自己回答"未知文档"。
    if text.content.len() > crate::lsp::types::MAX_AUTO_OPEN_FILE_SIZE {
        log::warn!(
            "[LSP] File too large for auto-open: {} ({} bytes)",
            file_path,
            text.content.len()
        );
        return false;
    }
    let _ = state
        .lsp_manager
        .send_did_open(project_path, language_id, uri, &text.content, version);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 版本号由登记表推进：首开 0，之后每次 +1（不再手写 1）。
    #[test]
    fn next_open_version_advances_from_registry() {
        assert_eq!(next_open_version(None), 0);
        assert_eq!(next_open_version(Some(0)), 1);
        assert_eq!(next_open_version(Some(7)), 8);
    }

    /// `jdt://` 虚拟文档永不代开；已打开的文档不重复代开（否则又造一次重复 didOpen）；
    /// **编辑器持有视图**的文档不代开（后端只有磁盘旧文本）。
    #[test]
    fn backend_open_is_skipped_for_virtual_docs_open_documents_and_editor_owned() {
        assert!(needs_backend_open("file:///p/a.rs", false, false));
        assert!(!needs_backend_open("file:///p/a.rs", true, false));
        assert!(!needs_backend_open("file:///p/a.rs", false, true));
        assert!(!needs_backend_open(
            "jdt://contents/java.base/java.lang/String.class",
            false,
            false
        ));
    }
}
