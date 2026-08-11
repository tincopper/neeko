#![allow(missing_docs)]

fn main() {
    tauri_build::build();

    // tauri-build 通过 `rustc-link-arg-bins` 把 Windows manifest 嵌入 bin，
    // 测试二进制拿不到 manifest，Windows 上 `cargo test` 会以
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) 启动失败。
    // 见 https://github.com/tauri-apps/tauri/issues/13419
    // 这里仅对测试目标单独嵌入 manifest，与 bin 的默认嵌入互不冲突。
    #[cfg(windows)]
    embed_manifest_for_tests();
}

/// Embed the Windows app manifest into test binaries so `cargo test` can start.
#[cfg(windows)]
fn embed_manifest_for_tests() {
    static WINDOWS_MANIFEST_FILE: &str = "windows-app-manifest.xml";

    let manifest = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(dir) => std::path::Path::new(&dir).join(WINDOWS_MANIFEST_FILE),
        Err(_) => return,
    };
    let manifest_str = match manifest.to_str() {
        Some(s) => s,
        None => return,
    };

    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{manifest_str}");
}
