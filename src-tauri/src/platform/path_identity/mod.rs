//! 路径身份字母表（host path → platform-independent identity）。
//!
//! 统一接口：
//!
//! - [`portable_render`] —— **宿主形态**（Local 路径）→ 身份串，按宿主平台选择规则；
//! - [`posix_render`] —— **POSIX 形态**（远端 WSL / SSH 路径）→ 身份串，**与宿主平台无关**。
//!
//! 出口只有这两个，且都只做「渲染」：不碰文件系统、不校验、不归一大小写与 Unicode 形态。
//! 身份的定义（canonical 祖先锚定、`..`/NUL 拒绝、非 UTF-8 拒绝）在
//! `common/git/unit_path.rs` —— 本主题只回答「一个已经是规范形态的宿主路径，
//! 在跨端身份空间里该长什么样」。
//!
//! **为什么 `posix_render` 不按宿主分叉**：远端路径的消费侧是远端 Linux，其分隔符语义
//! 属于远端 OS（`common/git/path_guard.rs` 的既有判据）。Windows 宿主上把 `/home/u/p`
//! 交给 Windows 规则渲染会得到 `\home\u\p` ⇒ 身份在宿主间分叉、远端 `cd` 直接失效。
//!
//! **为什么规则体在 `rules.rs` 且不做 cfg 门控**：Windows 形态规则如果只写在 `windows.rs`，
//! 在开发机（macOS）上就是「不可见失败域」（`.trellis/spec/backend/quality-guidelines.md`
//! 点名的风险）。规则是纯字符串函数，三端编译、三端测试；平台差异只体现在**选择**上。
//!
//! NOTE: 本主题与 `platform/host_path`（用户 shell PATH 环境变量）无关，勿混用。

mod rules;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::portable_render;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::portable_render;

pub use rules::render_posix_shaped as posix_render;
