#![allow(missing_docs)]

fn main() {
    tauri_build::build();

    // tauri-build 通过 `rustc-link-arg-bins` 只把 Common-Controls v6 manifest
    // 嵌入 [[bin]] 目标；`--lib` 单元测试二进制没有 manifest，加载时绑定
    // System32 的 ComCtl32 v5.82，缺少 rfd（经 tauri-plugin-dialog 引入）
    // 静态导入的 TaskDialogIndirect 导出，进程启动即
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)。
    // 见 https://github.com/tauri-apps/tauri/issues/13419
    //
    // 注意：必须用不带后缀的 `cargo:rustc-link-arg`（作用于所有链接目标，
    // 包括 --lib 单元测试二进制）；`cargo:rustc-link-arg-tests` 只覆盖
    // [[test]] 集成测试目标，到不了 --lib。主二进制已有 tauri 注入的 v6
    // 依赖，重复声明由链接器无害合并。用 CARGO_CFG_TARGET_OS 判断目标平台，
    // 而非 #[cfg(windows)]（build.rs 编译在宿主上，交叉编译时后者会失真）。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' \
             name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
             processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
