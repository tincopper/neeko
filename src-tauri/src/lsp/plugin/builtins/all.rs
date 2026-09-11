//! 内置语言插件的注册清单（**稳定顺序**：id 冲突时后注册者胜出）。

use crate::lsp::plugin::types::LspPlugin;

use super::{
    clang_family, csharp, elixir, go, java, kotlin, lua, php, python, r_lang, ruby, rust_lang, sql,
    swift, typescript_family,
};

/// All shipped language plugins, in stable registration order.
///
/// Registration order also influences extension conflict resolution
/// (later registrations win) when ids differ.
#[must_use]
pub fn all_builtin_plugins() -> Vec<LspPlugin> {
    let mut out = Vec::with_capacity(24);
    out.extend(rust_lang::plugins());
    out.extend(go::plugins());
    out.extend(python::plugins());
    out.extend(typescript_family::plugins());
    out.extend(java::plugins());
    out.extend(clang_family::plugins());
    out.extend(csharp::plugins());
    out.extend(ruby::plugins());
    out.extend(php::plugins());
    out.extend(swift::plugins());
    out.extend(kotlin::plugins());
    out.extend(lua::plugins());
    out.extend(elixir::plugins());
    out.extend(r_lang::plugins());
    out.extend(sql::plugins());
    out
}
