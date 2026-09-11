//! Built-in language server plugins.
//!
//! Each language (or closely related family) lives in its own module and
//! exports one or more [`LspPlugin`] descriptors. The registry never embeds
//! language tables — it only calls [`all_builtin_plugins`].
//!
//! **Adding a language:** create `foo.rs`, implement `plugins()`, add
//! `mod foo` + `out.extend(foo::plugins())` below. 语言专属的**安装配方**放
//! 同语言模块（如 `java_install.rs`），平台层只提供 OS 能力。

mod all;
mod clang_family;
mod csharp;
mod elixir;
mod go;
mod java;
mod java_install;
mod kotlin;
mod lua;
mod php;
mod python;
mod r_lang;
mod ruby;
mod rust_lang;
mod sql;
mod swift;
mod typescript_family;

pub use all::all_builtin_plugins;
