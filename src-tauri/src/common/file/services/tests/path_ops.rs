//! path_ops：目录创建 / 删除 / 重命名测试。

use super::{block_on, temp_root};
use crate::common::executor::factory::ExecTarget;
use crate::common::file::services::{create_directory, delete_path, rename_path};
use crate::AppError;
use std::fs;

#[test]
fn create_directory_creates_nested_dirs() {
    let root = temp_root("create_dir");
    let base = root.to_str().unwrap();
    block_on(create_directory(&ExecTarget::Local, base, "a/b/c")).unwrap();
    assert!(root.join("a/b/c").is_dir());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn create_directory_rejects_empty_and_traversal() {
    let root = temp_root("create_dir_invalid");
    let base = root.to_str().unwrap();
    assert!(block_on(create_directory(&ExecTarget::Local, base, "")).is_err());
    assert!(block_on(create_directory(&ExecTarget::Local, base, "../evil")).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn create_directory_rejects_absolute_and_backslash_traversal() {
    let root = temp_root("create_dir_abs");
    let base = root.to_str().unwrap();
    assert!(block_on(create_directory(
        &ExecTarget::Local,
        base,
        "/tmp/neeko_evil"
    ))
    .is_err());
    assert!(block_on(create_directory(&ExecTarget::Local, base, "..\\..\\evil")).is_err());
    assert!(block_on(create_directory(
        &ExecTarget::Local,
        base,
        "sub\\..\\..\\evil"
    ))
    .is_err());
    // 正常相对路径仍可创建
    block_on(create_directory(&ExecTarget::Local, base, "good/sub")).unwrap();
    assert!(root.join("good/sub").is_dir());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_path_removes_file() {
    let root = temp_root("delete_file");
    let base = root.to_str().unwrap();
    fs::write(root.join("a.txt"), "content").unwrap();
    block_on(delete_path(&ExecTarget::Local, base, "a.txt")).unwrap();
    assert!(!root.join("a.txt").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_path_removes_nested_directory() {
    let root = temp_root("delete_dir");
    let base = root.to_str().unwrap();
    fs::create_dir_all(root.join("sub/deep")).unwrap();
    fs::write(root.join("sub/deep/x.txt"), "x").unwrap();
    block_on(delete_path(&ExecTarget::Local, base, "sub")).unwrap();
    assert!(!root.join("sub").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_path_rejects_traversal_and_root() {
    let root = temp_root("delete_invalid");
    let base = root.to_str().unwrap();
    assert!(block_on(delete_path(&ExecTarget::Local, base, "../evil")).is_err());
    assert!(block_on(delete_path(&ExecTarget::Local, base, ".")).is_err());
    assert!(block_on(delete_path(&ExecTarget::Local, base, "/")).is_err());
    assert!(block_on(delete_path(&ExecTarget::Local, base, "")).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_path_rejects_absolute_and_backslash_traversal() {
    let root = temp_root("delete_abs");
    let base = root.to_str().unwrap();
    fs::write(root.join("ok.txt"), "x").unwrap();
    // 绝对路径（根外）应被拒绝
    assert!(block_on(delete_path(&ExecTarget::Local, base, "/etc")).is_err());
    // Windows 风格反斜杠穿越应被拒绝
    assert!(block_on(delete_path(&ExecTarget::Local, base, "..\\..\\evil")).is_err());
    assert!(block_on(delete_path(&ExecTarget::Local, base, "sub\\..\\..\\evil")).is_err());
    // 根内文件仍可正常删除
    block_on(delete_path(&ExecTarget::Local, base, "ok.txt")).unwrap();
    assert!(!root.join("ok.txt").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_path_missing_file_returns_not_found() {
    let root = temp_root("delete_missing");
    let base = root.to_str().unwrap();
    let err = block_on(delete_path(&ExecTarget::Local, base, "nope.txt")).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_path_renames_file_and_dir() {
    let root = temp_root("rename_ok");
    let base = root.to_str().unwrap();
    fs::create_dir_all(root.join("sub")).unwrap();
    fs::write(root.join("sub/a.txt"), "x").unwrap();
    block_on(rename_path(&ExecTarget::Local, base, "sub/a.txt", "b.txt")).unwrap();
    assert!(!root.join("sub/a.txt").exists());
    assert_eq!(fs::read_to_string(root.join("sub/b.txt")).unwrap(), "x");
    // 目录重命名
    fs::create_dir_all(root.join("sub/inner")).unwrap();
    block_on(rename_path(&ExecTarget::Local, base, "sub/inner", "inner2")).unwrap();
    assert!(!root.join("sub/inner").exists());
    assert!(root.join("sub/inner2").is_dir());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_path_rejects_invalid_names_and_traversal() {
    let root = temp_root("rename_invalid");
    let base = root.to_str().unwrap();
    fs::write(root.join("a.txt"), "x").unwrap();
    // 新名含分隔符/穿越/空 → 拒绝
    assert!(block_on(rename_path(&ExecTarget::Local, base, "a.txt", "b/c.txt")).is_err());
    assert!(block_on(rename_path(&ExecTarget::Local, base, "a.txt", "../evil")).is_err());
    assert!(block_on(rename_path(&ExecTarget::Local, base, "a.txt", "")).is_err());
    // 旧路径穿越/绝对路径 → 拒绝
    assert!(block_on(rename_path(&ExecTarget::Local, base, "../evil", "x")).is_err());
    assert!(block_on(rename_path(&ExecTarget::Local, base, "/etc", "x")).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_path_missing_source_returns_not_found() {
    let root = temp_root("rename_missing");
    let base = root.to_str().unwrap();
    let err = block_on(rename_path(&ExecTarget::Local, base, "nope.txt", "x.txt")).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
    let _ = fs::remove_dir_all(&root);
}
