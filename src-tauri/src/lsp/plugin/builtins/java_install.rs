//! jdtls 安装回退：brew → 官方发行版下载。
//!
//! 语言安装策略属于语言域，故不放在 `platform/`：平台层只保留「当前平台有没有
//! POSIX shell」这一 OS 能力（[`crate::platform::shell_launch::posix_sh`]），
//! 「装什么、怎么装」都在本模块。

use super::super::types::InstallOp;

/// jdtls 官方发行版下载脚本（POSIX：`curl` + `tar`；`[stage] <描述>` 行供进度展示）。
///
/// 语言安装策略属语言域，故随本模块迁出平台层 —— 平台只回答「有没有 POSIX shell」。
///
/// 流程：查询最新 milestone 版本 → 解析 download.php 镜像链接 → 下载解压到
/// `~/.neeko/jdtls/repository` → 生成 `~/.neeko/bin/jdtls` 包装脚本（exec 官方
/// `bin/jdtls`，`-configuration` 指向平台 config、`-data` 按项目路径哈希隔离）。
pub const JDTLS_DOWNLOAD_SCRIPT: &str = r#"
set -e
# 进度协议：`[stage] <描述>` 行由 Rust 侧 ProgressHint::STAGE_PREFIX 解析
# （lsp/installer.rs）——两侧共用的唯一事实源。
stage() { echo "[stage] $1"; }
BASE="http://download.eclipse.org/jdtls/milestones"
DEST="$HOME/.neeko/jdtls"
BIN_DIR="$HOME/.neeko/bin"
mkdir -p "$DEST" "$BIN_DIR"
stage "Querying latest release"
VER="$(curl -fsSL "$BASE/?d" | grep -oE 'jdtls/milestones/[0-9][^"'"'"']*' | grep -v '\.\.' | sed 's#jdtls/milestones/##' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
[ -n "$VER" ] || { stage "Release not found"; exit 1; }
stage "Resolving download link for $VER"
URL="$(curl -fsSL "$BASE/$VER/?d" | grep -oE "href='[^']*download\.php\?file=[^']*\.tar\.gz'" | sed "s/^href='//;s/'$//" | head -1)"
[ -n "$URL" ] || { stage "No package found for $VER"; exit 1; }
stage "Downloading jdtls $VER"
curl -fL "$URL" -o "$DEST/jdtls.tar.gz"
stage "Extracting"
rm -rf "$DEST/repository"
mkdir -p "$DEST/repository"
tar -xzf "$DEST/jdtls.tar.gz" -C "$DEST/repository" --strip-components=1
OS="$(uname -s)"
case "$OS" in
  Darwin) CFG="config_mac" ;;
  Linux) CFG="config_linux" ;;
  *) stage "Unsupported platform $OS"; exit 1 ;;
esac
DATA_DIR="$HOME/.neeko/jdtls/data/$(echo "$PWD" | tr '/' '_')"
printf '#!/bin/sh\nexec "%s/repository/bin/jdtls" -configuration "%s/repository/%s" -data "%s" "$@"\n' "$DEST" "$DEST" "$CFG" "$DATA_DIR" > "$BIN_DIR/jdtls"
chmod +x "$BIN_DIR/jdtls"
stage "Done: $BIN_DIR/jdtls"
"#;

/// brew 回退（macOS / Linux 通用；不可解析时由 installer 自然跳过）。
const BREW_JDTLS: InstallOp = InstallOp::exec("brew", &["install", "jdtls"]);

/// POSIX 平台回退链：brew → 官方发行版下载。
const POSIX_FALLBACKS: &[InstallOp] = &[BREW_JDTLS, InstallOp::script(JDTLS_DOWNLOAD_SCRIPT)];

/// 无 POSIX shell 的平台（Windows）：既无 brew 也无可用下载脚本 → 无回退
/// （安装失败时由 installer 汇总原因并给出手动指引）。
const NO_FALLBACK: &[InstallOp] = &[];

/// 当前平台的 jdtls 非 npm 回退链。
///
/// 平台差异只来自 [`crate::platform::shell_launch::posix_sh`]（OS 能力查询）；
/// 脚本本体与安装策略均在本模块，业务代码无 `#[cfg]`。
#[must_use]
pub const fn jdtls_fallbacks() -> &'static [InstallOp] {
    if crate::platform::shell_launch::posix_sh().is_some() {
        POSIX_FALLBACKS
    } else {
        NO_FALLBACK
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// POSIX 回退链：`brew` → 官方下载脚本；脚本内容与进度协议/产物路径契约一致。
    #[test]
    #[cfg(unix)]
    fn posix_fallbacks_chain_and_script_contract() {
        assert_eq!(POSIX_FALLBACKS.len(), 2, "brew → 官方下载");
        assert_eq!(POSIX_FALLBACKS[0].probe_tool(), "brew");
        match POSIX_FALLBACKS[1] {
            InstallOp::Script { shell, body } => {
                assert_eq!(shell, "sh", "脚本形态探测 sh");
                assert!(
                    body.contains("download.eclipse.org/jdtls"),
                    "来源必须是官方发行版"
                );
                // 与 installer 的 ProgressHint::STAGE_PREFIX 共用的协议标记。
                assert!(body.contains("[stage]"), "脚本必须用 [stage] 进度协议");
                assert!(
                    body.contains("$HOME/.neeko/bin"),
                    "产物落在 Neeko 自管 bin（与 host_path::prepend_neeko_bin 同目录）"
                );
            }
            other => panic!("第二项应为 Script 形态，实为 {other:?}"),
        }
    }

    /// 无 POSIX shell 的平台不提供回退（保持既有 Windows 行为）。
    #[test]
    fn fallbacks_follow_platform_shell_capability() {
        let posix = crate::platform::shell_launch::posix_sh().is_some();
        assert_eq!(
            jdtls_fallbacks().is_empty(),
            !posix,
            "有 POSIX shell 才有回退链"
        );
    }
}
