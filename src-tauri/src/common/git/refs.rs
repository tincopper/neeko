//! Refs classification for `git log --decorate=full` decorate output.

use serde::{Deserialize, Serialize};

/// Kind of a displayable git ref decoration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    /// Local branch (`refs/heads/...` or `HEAD -> refs/heads/...`).
    Branch,
    /// Remote-tracking branch (`refs/remotes/...`).
    Remote,
    /// Tag (`tag: refs/tags/...`).
    Tag,
    /// Stash ref (`refs/stash`).
    Stash,
}

/// A single classified ref decoration with a short name (prefix stripped).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedRef {
    /// Ref category used for display styling.
    pub kind: RefKind,
    /// Short display name (e.g. `main`, `origin/main`, `v1.0.4`, `stash`, `HEAD`).
    pub name: String,
}

/// Parse a `%D` decorate string into displayable refs.
///
/// Only `branch` / `remote` / `tag` / `stash` are kept; any other ref
/// namespace (e.g. `refs/synara/*`, `refs/aider/*`, `refs/bisect/*`)
/// is treated as a tool-private ref and discarded.
#[must_use]
pub fn parse_decorate_refs(decorate: &str) -> Vec<ParsedRef> {
    decorate
        .split(',')
        .map(str::trim)
        .filter_map(classify_item)
        .collect()
}

fn classify_item(item: &str) -> Option<ParsedRef> {
    if let Some(rest) = item.strip_prefix("HEAD -> refs/heads/") {
        return Some(ParsedRef {
            kind: RefKind::Branch,
            name: rest.to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("HEAD -> refs/remotes/") {
        return Some(ParsedRef {
            kind: RefKind::Remote,
            name: rest.to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("HEAD -> refs/tags/") {
        return Some(ParsedRef {
            kind: RefKind::Tag,
            name: rest.to_string(),
        });
    }
    if item == "HEAD -> refs/stash" {
        return Some(ParsedRef {
            kind: RefKind::Stash,
            name: "stash".to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("HEAD -> ") {
        // 其它 refs/* 命名空间（如 refs/synara/*）视为工具私有 ref，丢弃；
        // 短名形式（--decorate=full 下不会出现）防御性归入 Branch 语义。
        if rest.starts_with("refs/") {
            return None;
        }
        return Some(ParsedRef {
            kind: RefKind::Branch,
            name: rest.to_string(),
        });
    }
    if item == "HEAD" {
        return Some(ParsedRef {
            kind: RefKind::Branch,
            name: "HEAD".to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("refs/heads/") {
        return Some(ParsedRef {
            kind: RefKind::Branch,
            name: rest.to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("refs/remotes/") {
        return Some(ParsedRef {
            kind: RefKind::Remote,
            name: rest.to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("tag: refs/tags/") {
        return Some(ParsedRef {
            kind: RefKind::Tag,
            name: rest.to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("tag: ") {
        return Some(ParsedRef {
            kind: RefKind::Tag,
            name: rest.to_string(),
        });
    }
    if let Some(rest) = item.strip_prefix("refs/tags/") {
        return Some(ParsedRef {
            kind: RefKind::Tag,
            name: rest.to_string(),
        });
    }
    if item == "refs/stash" {
        return Some(ParsedRef {
            kind: RefKind::Stash,
            name: "stash".to_string(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_branch_remote_tag_and_head_arrow() {
        let refs = parse_decorate_refs(
            "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0.4",
        );
        assert_eq!(refs.len(), 3);
        assert_eq!(refs[0].kind, RefKind::Branch);
        assert_eq!(refs[0].name, "main");
        assert_eq!(refs[1].kind, RefKind::Remote);
        assert_eq!(refs[1].name, "origin/main");
        assert_eq!(refs[2].kind, RefKind::Tag);
        assert_eq!(refs[2].name, "v1.0.4");
    }

    #[test]
    fn parse_detached_head_as_branch() {
        let refs = parse_decorate_refs("HEAD");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, RefKind::Branch);
        assert_eq!(refs[0].name, "HEAD");
    }

    #[test]
    fn parse_bare_refs_without_head() {
        let refs = parse_decorate_refs("refs/heads/feature, refs/remotes/upstream/feature");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].kind, RefKind::Branch);
        assert_eq!(refs[0].name, "feature");
        assert_eq!(refs[1].kind, RefKind::Remote);
        assert_eq!(refs[1].name, "upstream/feature");
    }

    #[test]
    fn parse_stash_ref_as_stash_kind() {
        let refs = parse_decorate_refs("refs/stash");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, RefKind::Stash);
        assert_eq!(refs[0].name, "stash");
    }

    #[test]
    fn discard_tool_private_refs() {
        let refs = parse_decorate_refs(
            "HEAD -> refs/heads/main, refs/synara/checkpoints/abc, refs/aider/x, refs/bisect/bad",
        );
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "main");
    }

    #[test]
    fn head_arrow_to_tool_namespace_is_discarded() {
        // HEAD 符号引用指向非 heads/remotes/tags 的 refs 命名空间 → 丢弃（tool 类）
        let refs = parse_decorate_refs("HEAD -> refs/synara/checkpoints/abc");
        assert!(refs.is_empty());
    }

    #[test]
    fn head_arrow_to_remote_and_tag_keep_kind() {
        let refs = parse_decorate_refs("HEAD -> refs/remotes/origin/main, HEAD -> refs/tags/v1.0");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].kind, RefKind::Remote);
        assert_eq!(refs[0].name, "origin/main");
        assert_eq!(refs[1].kind, RefKind::Tag);
        assert_eq!(refs[1].name, "v1.0");
    }

    #[test]
    fn empty_and_whitespace_decorate_yield_nothing() {
        assert!(parse_decorate_refs("").is_empty());
        assert!(parse_decorate_refs("   ").is_empty());
        assert!(parse_decorate_refs(",").is_empty());
    }

    #[test]
    fn unknown_non_ref_item_is_discarded() {
        let refs = parse_decorate_refs("some-random-string");
        assert!(refs.is_empty());
    }
}
