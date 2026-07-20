//! Built-in language server plugins.
//!
//! Each language (or closely related family) lives in its own module and
//! exports one or more [`LspPlugin`] descriptors. The registry never embeds
//! language tables — it only calls [`all_builtin_plugins`].
//!
//! **Adding a language:** create `foo.rs`, implement `plugins()`, add
//! `mod foo` + `out.extend(foo::plugins())` below.

mod clang_family;
mod csharp;
mod elixir;
mod go;
mod java;
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

use super::types::LspPlugin;

/// All shipped language plugins, in stable registration order.
///
/// Registration order also influences extension conflict resolution
/// (later registrations win) when ids differ.
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
