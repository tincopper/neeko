//! JDTLS 内 **java-debug 插件 bundle** 的解析 / 下载 / 校验。
//!
//! B'（JDTLS 后端）把 `com.microsoft.java.debug.plugin` 作为 `bundles` 注入 jdtls 的
//! `initializationOptions` —— 没有它，`vscode.java.startDebugSession` 不会注册，
//! 能力探测必然返回 `BundleMissing`。
//!
//! ## 约定
//!
//! * **版本 pin**：只认 [`DEBUG_PLUGIN_VERSION`] 对应的坐标，不追 latest（bundle 与
//!   jdtls 版本强耦合；改动版本必须同步改常量并重跑真机验证）。
//! * **摘要 pin**：构件的 SHA-256 固化为 [`DEBUG_PLUGIN_SHA256`] 常量 —— 摘要与被校验
//!   对象来自**不同信道**（源码 vs 网络），才可能挡住"同源同时改 jar 与校验和"。
//!   升级版本必须同时更新版本与摘要常量（见该常量的注释）。
//! * **路径**：`~/.neeko/java-debug/<version>/com.microsoft.java.debug.plugin-<version>.jar`；
//!   可用 `NEEKO_JAVA_DEBUG_PLUGIN` 覆盖（测试 / 私有镜像）。
//! * **校验**：下载后比对固化摘要；此外做结构性检查（PK 头 + 含 `plugin.xml` +
//!   体积下限），使**用户手工放置的 jar** 也能被拒伪。

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// pin 的 java-debug 插件版本（S0 真机验证可用：jdtls 1.61.0 + JDK 21）。
pub const DEBUG_PLUGIN_VERSION: &str = "0.53.1";
/// jar 文件名（Maven 坐标的 artifact 名 + 版本）。
pub const DEBUG_PLUGIN_FILE: &str = "com.microsoft.java.debug.plugin-0.53.1.jar";
/// pin 的构件 SHA-256（小写十六进制）。
///
/// **来源与再生成方式**（升级版本时必须照做，并重跑真机验证）：
/// 1. 从 Maven Central 取构件本身的摘要 —— 注意 **Maven 对本构件不发布 `.sha256`**
///    （`.jar.sha256` 返回 404，只有 `.sha1` / `.md5`），因此不能指望线上校验和；
/// 2. 独立核对：下载构件后本地算 SHA-256，并与 `<artifact>.jar.sha1` 交叉确认；
/// 3. 把得到的 64 位十六进制填回本常量（`pinned_checksum_is_a_well_formed_sha256` 会
///    拦截格式错误）。
///
/// 固化的意义：摘要与被校验对象来自**不同信道**（源码 vs 网络）。只比对同源的
/// `.sha256` 只能证明"传输没坏"，挡不住源端同时替换 jar 与校验和。
pub const DEBUG_PLUGIN_SHA256: &str =
    "4f4778d452a6a0665536f43ce4e32403a24be6593336b80dc85a322912859e24";
/// Maven Central 目录（`repo1` 是对外稳定入口）。
const MAVEN_DIR: &str =
    "https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin";
/// 环境变量覆盖（测试 / 私有镜像）。
const BUNDLE_ENV: &str = "NEEKO_JAVA_DEBUG_PLUGIN";
/// 体积下限（真机 0.53.1 约 2.9 MB）：低于此值基本可判定为下载被截断/占位文件。
const MIN_BUNDLE_BYTES: u64 = 512 * 1024;

/// 默认缓存目录：`~/.neeko/java-debug/<version>`。
#[must_use]
pub fn bundle_dir_in(home: &Path) -> PathBuf {
    home.join(".neeko")
        .join("java-debug")
        .join(DEBUG_PLUGIN_VERSION)
}

/// 默认缓存文件路径（不保证存在）。
#[must_use]
pub fn bundle_path_in(home: &Path) -> PathBuf {
    bundle_dir_in(home).join(DEBUG_PLUGIN_FILE)
}

/// 解析当前应使用的 bundle 路径：环境变量优先，否则 `~/.neeko/...`。
#[must_use]
pub fn bundle_path() -> PathBuf {
    if let Ok(p) = std::env::var(BUNDLE_ENV) {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    bundle_path_in(&dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
}

/// jar 的下载地址（pin 版本）。
#[must_use]
pub fn download_url() -> String {
    format!("{MAVEN_DIR}/{DEBUG_PLUGIN_VERSION}/{DEBUG_PLUGIN_FILE}")
}

/// 结构性校验：PK 头 + 含 `plugin.xml` + 体积下限。
///
/// 这是**离线**能做的完整性判断，用于：
/// ① 拒绝被截断的下载；② 拒绝用户手工放置的错误文件（如把 host jar 放到该路径）。
pub fn verify_bundle(path: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("bundle not readable at {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("bundle path is not a file: {}", path.display()));
    }
    if meta.len() < MIN_BUNDLE_BYTES {
        return Err(format!(
            "bundle looks truncated ({} bytes < {MIN_BUNDLE_BYTES}): {}",
            meta.len(),
            path.display()
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("failed to read bundle: {e}"))?;
    // zip/jar 局部文件头魔数。
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(format!(
            "bundle is not a jar/zip archive: {}",
            path.display()
        ));
    }
    // OSGi bundle 必备的扩展声明文件（比逐个解析 zip 目录更省，且足以拒伪）。
    if !bytes.windows(10).any(|w| w == b"plugin.xml") {
        return Err(format!(
            "bundle does not look like the java-debug plugin (no plugin.xml): {}",
            path.display()
        ));
    }
    Ok(())
}

/// 校验下载到的字节是否等于**固化摘要**（[`DEBUG_PLUGIN_SHA256`]）。
///
/// 纯函数（无 IO），便于单测；失败信息同时给出期望值、实际值与官方地址，
/// 便于用户独立核对（Maven 只发布 `.sha1`：`<url>.sha1`）。
fn verify_download(bytes: &[u8]) -> Result<(), String> {
    let actual = sha256_hex(bytes);
    if actual == DEBUG_PLUGIN_SHA256 {
        return Ok(());
    }
    Err(format!(
        "java-debug plugin checksum mismatch: expected {DEBUG_PLUGIN_SHA256} (pinned in Neeko), \
         got {actual}. The artifact at {} does not match the version Neeko was verified against; \
         verify it independently against {} and update the pin only after re-running the \
         real-machine check",
        download_url(),
        format_args!("{}.sha1", download_url())
    ))
}

/// 计算字节流的 SHA-256（小写十六进制）。
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// 确保 bundle 可用（**幂等**）：已存在且结构合法 → 直接返回；否则下载 + 校验 + 落盘。
///
/// 同步实现（reqwest blocking + 文件 IO）：调用方必须放在 `spawn_blocking` 里，
/// 遵守「异步上下文禁止阻塞 IO」的仓库红线。
pub fn ensure_bundle_blocking() -> Result<PathBuf, String> {
    let path = bundle_path();
    if verify_bundle(&path).is_ok() {
        return Ok(path);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    // 只下载构件本身：摘要来自**固化常量**而非网络（见 `DEBUG_PLUGIN_SHA256` 的说明；
    // Maven 对本构件也不发布 `.sha256`，请求它会 404）。
    let bytes = client
        .get(download_url())
        .send()
        .map_err(|e| format!("failed to download java-debug plugin: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download request failed: {e}"))?
        .bytes()
        .map_err(|e| format!("failed to read download body: {e}"))?;

    verify_download(&bytes)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create bundle dir {}: {e}", parent.display()))?;
    }
    // 原子落盘：先写临时文件再 rename，避免半截文件被当成可用 bundle。
    let tmp = path.with_extension("jar.part");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("failed to write bundle: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to install bundle: {e}"))?;

    verify_bundle(&path)?;
    log::info!("[java-debug] bundle installed at {}", path.display());
    Ok(path)
}

/// 返回**已就绪**的 bundle 路径（存在且结构合法），否则 `None`。
///
/// 用于 LSP 初始化载荷注入：只注入可用路径 —— jdtls 的 `BundleUtils.loadBundles`
/// 遇到不存在的路径会报错，可能连带影响整个 Java 语言服务器。
#[must_use]
pub fn existing_bundle() -> Option<PathBuf> {
    existing_bundle_at(&bundle_path())
}

/// [`existing_bundle`] 的路径参数化版本（免环境变量，便于单测）。
#[must_use]
pub fn existing_bundle_at(path: &Path) -> Option<PathBuf> {
    verify_bundle(path).ok().map(|()| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(path, bytes).expect("write");
    }

    #[test]
    fn paths_are_version_pinned_under_neeko() {
        let home = Path::new("/home/u");
        assert_eq!(
            bundle_path_in(home),
            PathBuf::from(
                "/home/u/.neeko/java-debug/0.53.1/com.microsoft.java.debug.plugin-0.53.1.jar"
            )
        );
        assert!(
            download_url().contains("/com/microsoft/java/com.microsoft.java.debug.plugin/0.53.1/")
        );
        assert!(download_url().ends_with(DEBUG_PLUGIN_FILE));
    }

    /// 固化摘要必须是 64 位**小写**十六进制：格式错误会让下载校验永远失败，
    /// 而错误只会在用户首次下载时暴露 —— 这里提前拦住。
    #[test]
    fn pinned_checksum_is_a_well_formed_sha256() {
        assert_eq!(DEBUG_PLUGIN_SHA256.len(), 64, "{DEBUG_PLUGIN_SHA256}");
        assert!(
            DEBUG_PLUGIN_SHA256
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "必须是小写十六进制: {DEBUG_PLUGIN_SHA256}"
        );
    }

    /// **摘要 pin 的守卫**：与固化值不一致的下载一律拒绝，且信息里同时给出期望值、
    /// 实际值与可独立核对的官方地址（Maven 只发布 `.sha1`）。
    #[test]
    fn verify_download_rejects_anything_but_the_pinned_digest() {
        let err = verify_download(b"not the plugin").expect_err("mismatch must be refused");
        assert!(err.contains(DEBUG_PLUGIN_SHA256), "必须给出期望值: {err}");
        assert!(
            err.contains(&sha256_hex(b"not the plugin")),
            "必须给出实际值: {err}"
        );
        assert!(err.contains(".jar.sha1"), "必须给出可独立核对的地址: {err}");
        // 空字节流同样被拒（不是"空即通过"）。
        assert!(verify_download(b"").is_err());
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // 空串的 SHA-256（广为人知的测试向量）。
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// 结构性校验：截断文件 / 非 zip / 缺 plugin.xml 全部拒绝；合法形状通过。
    #[test]
    fn verify_bundle_rejects_lookalikes() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let missing = tmp.path().join("missing.jar");
        assert!(verify_bundle(&missing).is_err());

        let truncated = tmp.path().join("truncated.jar");
        write(&truncated, b"PK\x03\x04plugin.xml");
        assert!(
            verify_bundle(&truncated).is_err(),
            "体积下限必须拦住截断文件"
        );

        let not_zip = tmp.path().join("plain.jar");
        write(&not_zip, &vec![b'x'; (MIN_BUNDLE_BYTES + 1) as usize]);
        assert!(verify_bundle(&not_zip).is_err(), "非 zip 必须被拒");

        let no_plugin_xml = tmp.path().join("other.jar");
        let mut body = vec![b'y'; (MIN_BUNDLE_BYTES + 1) as usize];
        body[..4].copy_from_slice(b"PK\x03\x04");
        write(&no_plugin_xml, &body);
        assert!(
            verify_bundle(&no_plugin_xml).is_err(),
            "缺 plugin.xml 必须被拒"
        );

        let ok = tmp.path().join("ok.jar");
        let mut good = vec![b'z'; (MIN_BUNDLE_BYTES + 1) as usize];
        good[..4].copy_from_slice(b"PK\x03\x04");
        good[100..110].copy_from_slice(b"plugin.xml");
        write(&ok, &good);
        assert!(
            verify_bundle(&ok).is_ok(),
            "合法形状应通过: {:?}",
            verify_bundle(&ok)
        );
    }

    /// 注入前置条件：只返回**已校验**的路径（缺失 / 非法 → `None`）。
    #[test]
    fn existing_bundle_requires_verified_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        assert!(existing_bundle_at(&tmp.path().join("absent.jar")).is_none());

        let bad = tmp.path().join("bad.jar");
        write(&bad, b"not a jar");
        assert!(existing_bundle_at(&bad).is_none());

        let good = tmp.path().join("good.jar");
        let mut body = vec![b'z'; (MIN_BUNDLE_BYTES + 1) as usize];
        body[..4].copy_from_slice(b"PK\x04");
        body[100..110].copy_from_slice(b"plugin.xml");
        write(&good, &body);
        assert_eq!(existing_bundle_at(&good), Some(good.clone()));
    }
}
