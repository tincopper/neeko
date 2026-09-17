//! Java 断点源路径翻译的 **LSP 侧实现**：把规范身份落成适配器能读的**真实文件**。
//!
//! 端口在 `crate::dap::adapter::java::source_path`（`LanguageBackend::adapter_source_path`
//! 的语言专属实现；依赖倒置：dap 定义抽象，lsp 提供实现，组合根注入）。
//! 为什么必须走真实路径见该模块文档 —— java-debug 的
//! `asCompilationUnit` 只认「真实存在的文件」或「`jdt://…?<JDT handle>`」，而 handle 取不到。
//!
//! ## 落盘位置与 host 一致
//!
//! 复用 host `ClasspathSources` 的缓存布局（本模块**镜像**它，两侧各有测试锁定）：
//!
//! - JDK：`~/.neeko/java-src-cache/jdk-src-<ver>/<module>/<pkg 段…>/<Name>.java`
//!   （条目取自 `<JDK>/lib/src.zip`，条目名本身即 `<module>/<pkg 段…>/<Name>.java`）；
//! - 依赖：`~/.neeko/java-src-cache/<stem>/<pkg 段…>/<Name>.java`
//!   （取自同目录的 `<stem>-sources.jar`）。
//!
//! 幂等 + 原子写（临时文件 + rename），与 host 的 `extract` 同语义：已存在直接复用，
//! 中断/并发不留半文件。
//!
//! ## 来源判定
//!
//! JDK 模块与依赖源码是**互斥**的两条来源。按「`src.zip` 是否含 `<module>/` 前缀条目」
//! 判定，避免把依赖类的失败归因到 JDK（反之亦然）—— 混合的错误信息会把排查引向错方向。

use std::io::Read;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::common::executor::factory::ExecTarget;
use crate::dap::adapter::java::source_path::{
    cached_source_path, parse_identity, JavaSourcePathProvider, SourcePathIdentity, CACHE_DIR_NAME,
    JDK_STEM_PREFIX,
};
use crate::dap::adapter::SourcePathResolution;

/// 依赖来源 jar 的后缀（`foo-1.0.jar` 的源码 jar 是 `foo-1.0-sources.jar`）。
const SOURCES_SUFFIX: &str = "-sources.jar";

/// LSP 支撑的源路径翻译：缓存查找优先，缺失时从 JDK `src.zip` / 依赖 `-sources.jar` 落盘。
pub struct LspJavaSourcePath {
    /// 缓存根（`~/.neeko/java-src-cache`）；测试注入临时目录。
    cache_root: PathBuf,
}

impl Default for LspJavaSourcePath {
    fn default() -> Self {
        Self::new()
    }
}

impl LspJavaSourcePath {
    /// 以默认缓存根（`~/.neeko/java-src-cache`）构造。
    #[must_use]
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self::with_cache_root(home.join(".neeko").join(CACHE_DIR_NAME))
    }

    /// 指定缓存根构造（测试用；生产走 [`Self::new`]）。
    #[must_use]
    pub const fn with_cache_root(cache_root: PathBuf) -> Self {
        Self { cache_root }
    }

    /// 阻塞部分：缓存未命中时尝试落盘。调用方必须放进 `spawn_blocking`。
    fn materialize(
        &self,
        target: &ExecTarget,
        classpath: &[String],
        module: &str,
        package_segments: &[String],
        file_name: &str,
    ) -> Result<PathBuf, String> {
        let jdk_home = crate::lsp::process::resolve_java_home(target);
        if let Some(home) = jdk_home.as_deref() {
            let jdk_home = Path::new(home);
            if jdk_has_module(&jdk_home.join("lib").join("src.zip"), module) {
                return materialize_jdk(
                    jdk_home,
                    module,
                    package_segments,
                    file_name,
                    &self.cache_root,
                );
            }
        }

        match materialize_dependency(classpath, package_segments, file_name, &self.cache_root) {
            Ok(path) => Ok(path),
            // 归因要精确：JDK 分支已确认「该模块不在 src.zip 里」或「归档读不到」，
            // 不要合成一条含糊的原因把用户引向错误方向。
            Err(dep_reason) => Err(match jdk_home {
                Some(home) => format!(
                    "{dep_reason}. No readable JDK sources were found at {home} for module \
                     {module:?} (a WSL / remote project's JDK sources are not cached on the host)"
                ),
                None => format!(
                    "{dep_reason}. The JDK home could not be resolved either (checked the PATH \
                     `java` of the project environment)"
                ),
            }),
        }
    }
}

#[async_trait]
impl JavaSourcePathProvider for LspJavaSourcePath {
    async fn adapter_source_path(
        &self,
        target: &ExecTarget,
        classpath: &[String],
        identity: &str,
    ) -> SourcePathResolution {
        let (module, package_segments, file_name) = match parse_identity(identity) {
            SourcePathIdentity::Fs(path) => return SourcePathResolution::Adapter(path),
            SourcePathIdentity::Unsupported(raw) => {
                return SourcePathResolution::Unresolvable {
                    reason: format!(
                        "Unsupported breakpoint source identity {raw:?}: expected a file path or \
                         `jdt:/<module>/<package path>/<Name>.java`"
                    ),
                };
            }
            SourcePathIdentity::Jdt {
                module,
                package_segments,
                file_name,
            } => (module, package_segments, file_name),
        };

        // 非本地环境（WSL / SSH）：`jdt:` 身份的解析要读源码缓存与 JDK / 依赖归档，而它们
        // 都在**目标环境**里（缓存由 host jar 在那边写 `~/.neeko`，classpath 条目同样是目标
        // 环境路径）。宿主进程读不到就不去猜 —— 明确说清限制，而不是在错误的地方找一遍、
        // 再给出"该 JDK 里没有这个模块"这种误导性原因。宿主侧解压需经 `core::exec` 在目标
        // 环境执行，属独立工作。
        //
        // 注意约束范围：**只有 `jdt:` 身份**受影响。普通文件路径（`Fs`，含 A 路径在 WSL 下
        // 由 host jar 解压出的真实缓存路径）在上面的 match 里已原样返回，仍由执行器在目标
        // 环境读取 —— 那条链路不受影响。
        if !matches!(target, ExecTarget::Local) {
            return SourcePathResolution::Unresolvable {
                reason: "Java source caching is only supported for local projects: a WSL / remote \
                         project's sources live in the target environment, which Neeko cannot read \
                         from the host. Breakpoints in JDK / dependency sources are therefore not \
                         available for this project."
                    .into(),
            };
        }

        // 缓存查找（`read_dir` + `is_file`）与落盘都是**同步文件 IO**：必须一起留在
        // `spawn_blocking` 内 —— 在 async fn 里直接调用会阻塞 Tokio worker（红线 3）。
        let cache_root = self.cache_root.clone();
        let target = target.clone();
        let classpath = classpath.to_vec();
        let resolved = tokio::task::spawn_blocking(move || {
            let resolver = Self::with_cache_root(cache_root);
            if let Some(hit) =
                cached_source_path(&resolver.cache_root, &module, &package_segments, &file_name)
            {
                return Ok(hit);
            }
            resolver.materialize(&target, &classpath, &module, &package_segments, &file_name)
        })
        .await;

        match resolved {
            Ok(Ok(path)) => SourcePathResolution::Adapter(path),
            Ok(Err(reason)) => SourcePathResolution::Unresolvable { reason },
            Err(join_error) => SourcePathResolution::Unresolvable {
                reason: format!("Java source extraction task failed: {join_error}"),
            },
        }
    }
}

/// 相对源码路径 `<pkg 段…>/<Name>.java`（zip 条目名与缓存相对路径共用同一段序）。
fn source_rel_path(package_segments: &[String], file_name: &str) -> String {
    package_segments
        .iter()
        .map(String::as_str)
        .chain(std::iter::once(file_name))
        .collect::<Vec<_>>()
        .join("/")
}

/// JDK 源码条目名（`<module>/<pkg 段…>/<Name>.java`，即 `src.zip` 条目名）。
fn jdk_entry_name(module: &str, package_segments: &[String], file_name: &str) -> String {
    format!("{module}/{}", source_rel_path(package_segments, file_name))
}

/// `src.zip` 是否含 `<module>/` 前缀条目（据此判定「JDK 模块」而非依赖类）。
fn jdk_has_module(archive: &Path, module: &str) -> bool {
    let prefix = format!("{module}/");
    let Ok(file) = std::fs::File::open(archive) else {
        return false;
    };
    let Ok(zip) = zip::ZipArchive::new(file) else {
        return false;
    };
    let found = zip.file_names().any(|name| name.starts_with(&prefix));
    found
}

/// 从 `<JDK>/lib/src.zip` 取条目并落盘为 `jdk-src-<ver>/<module>/<pkg…>/<Name>.java`。
fn materialize_jdk(
    jdk_home: &Path,
    module: &str,
    package_segments: &[String],
    file_name: &str,
    cache_root: &Path,
) -> Result<PathBuf, String> {
    let archive = jdk_home.join("lib").join("src.zip");
    let stem = format!("{JDK_STEM_PREFIX}{}", jdk_version(jdk_home));
    let target = cache_target(cache_root, &stem, module, package_segments, file_name);
    if target.is_file() {
        return Ok(target);
    }
    let entry_name = jdk_entry_name(module, package_segments, file_name);
    let bytes = read_zip_entry(&archive, &entry_name)?.ok_or_else(|| {
        format!(
            "the JDK source archive {} does not contain {entry_name}",
            archive.display()
        )
    })?;
    write_source(&target, &bytes)?;
    Ok(target)
}

/// 从 classpath（含同目录 sibling）定位依赖 `-sources.jar` 并落盘。
fn materialize_dependency(
    classpath: &[String],
    package_segments: &[String],
    file_name: &str,
    cache_root: &Path,
) -> Result<PathBuf, String> {
    let entry_name = source_rel_path(package_segments, file_name);
    let mut tried: Vec<String> = Vec::new();

    for classpath_entry in classpath {
        let Some((sources_jar, stem)) = sources_jar_for(Path::new(classpath_entry)) else {
            continue;
        };
        let target = cache_target(cache_root, &stem, "", package_segments, file_name);
        if target.is_file() {
            return Ok(target);
        }
        if let Some(bytes) = read_zip_entry(&sources_jar, &entry_name)? {
            write_source(&target, &bytes)?;
            return Ok(target);
        }
        tried.push(sources_jar.display().to_string());
    }

    Err(if tried.is_empty() {
        "no `-sources.jar` was found for any classpath entry, so the dependency source cannot be \
         extracted (attach sources to the dependency, or open the class once so it gets cached)"
            .into()
    } else {
        format!(
            "the available source archive(s) do not contain {entry_name}: {}",
            tried.join(", ")
        )
    })
}

/// 由 classpath 条目给出「来源 jar 与缓存 stem（= 主 jar 名去 `.jar`）」。
fn sources_jar_for(classpath_entry: &Path) -> Option<(PathBuf, String)> {
    if classpath_entry.extension().and_then(|e| e.to_str()) != Some("jar") {
        return None;
    }
    let stem = classpath_entry.file_stem()?.to_str()?.to_string();
    // 条目本身就是源码 jar：stem 去掉 `-sources` 才是主 jar 名（与 host 布局一致）。
    if let Some(main_stem) = stem.strip_suffix("-sources") {
        return Some((classpath_entry.to_path_buf(), main_stem.to_string()));
    }
    // 主 jar：同目录的 sibling `<stem>-sources.jar`。
    let sibling = classpath_entry.with_file_name(format!("{stem}{SOURCES_SUFFIX}"));
    sibling.is_file().then_some((sibling, stem))
}

/// 缓存里的目标文件路径：`<cache_root>/<stem>/<module>/<pkg 段…>/<Name>.java`
/// （`module` 为空段时跳过，用于依赖布局）。
fn cache_target(
    cache_root: &Path,
    stem: &str,
    module: &str,
    package_segments: &[String],
    file_name: &str,
) -> PathBuf {
    let mut target = cache_root.join(stem);
    if !module.is_empty() {
        target.push(module);
    }
    for segment in package_segments {
        target.push(segment);
    }
    target.push(file_name);
    target
}

/// 读 zip 条目（不存在返回 `Ok(None)`）。
fn read_zip_entry(archive: &Path, entry_name: &str) -> Result<Option<Vec<u8>>, String> {
    let file = std::fs::File::open(archive)
        .map_err(|e| format!("failed to open source archive {}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("failed to read source archive {}: {e}", archive.display()))?;
    let Ok(mut entry) = zip.by_name(entry_name) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).map_err(|e| {
        format!(
            "failed to read {entry_name} from {}: {e}",
            archive.display()
        )
    })?;
    Ok(Some(bytes))
}

/// 原子落盘（父目录按需创建）—— 与 host `ClasspathSources.extract` 同语义。
///
/// 落盘目标由「缓存根 + stem + module + 包段 + 文件名」拼成，其中 module / 包段来自
/// 前端身份。除身份解析处已拒绝 `..` 外，这里再做一次**兜底**：目标路径含 `..` 组件
/// 直接拒绝（fail-closed），确保任何来源（jar stem 等）都无法把写入引出缓存根。
fn write_source(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if target
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!(
            "refusing to write a source cache file outside the cache root: {}",
            target.display()
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| format!("invalid source cache target: {}", target.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    let tmp = target.with_extension("java.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, target)
        .map_err(|e| format!("failed to install {}: {e}", target.display()))?;
    log::info!("[java-debug] cached Java source at {}", target.display());
    Ok(())
}

/// JDK 版本串（用作缓存 stem），优先 `<JDK>/release` 的 `JAVA_VERSION`，否则取目录名。
fn jdk_version(jdk_home: &Path) -> String {
    if let Ok(release) = std::fs::read_to_string(jdk_home.join("release")) {
        if let Some(version) = parse_release_version(&release) {
            return version;
        }
    }
    jdk_home
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// 从 `release` 文件取 `JAVA_VERSION`（`JAVA_VERSION="21.0.12.1"`，含引号与 CRLF 容错）。
fn parse_release_version(release: &str) -> Option<String> {
    release.lines().find_map(|line| {
        let value = line.trim().strip_prefix("JAVA_VERSION=")?;
        let value = value.trim().trim_matches('"');
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        let file = std::fs::File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, body) in entries {
            zip.start_file(*name, options).expect("start_file");
            zip.write_all(body.as_bytes()).expect("write entry");
        }
        zip.finish().expect("finish zip");
    }

    /// 造一个假 JDK：`lib/src.zip` + `release`。
    fn fake_jdk(root: &Path, version: &str, entries: &[(&str, &str)]) -> PathBuf {
        let home = root.join(format!("openjdk-{version}"));
        write_zip(&home.join("lib/src.zip"), entries);
        std::fs::write(
            home.join("release"),
            format!("JAVA_VERSION=\"{version}\"\n"),
        )
        .expect("write release");
        home
    }

    #[test]
    fn release_version_is_parsed_leniently() {
        assert_eq!(
            parse_release_version("JAVA_VERSION=\"21.0.12.1\"\r\nOS_NAME=\"Mac OS X\"\n"),
            Some("21.0.12.1".to_string())
        );
        assert_eq!(
            parse_release_version("JAVA_VERSION=21\n"),
            Some("21".to_string())
        );
        assert_eq!(parse_release_version("JAVA_VERSION=\"\"\n"), None);
        assert_eq!(parse_release_version(""), None);
    }

    /// 模块判定：`src.zip` 有 `<module>/` 条目才算 JDK 模块（决定归因方向）。
    #[test]
    fn jdk_module_detection_uses_archive_prefix() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = fake_jdk(
            tmp.path(),
            "21",
            &[("java.base/java/lang/String.java", "x")],
        );
        let archive = home.join("lib/src.zip");
        assert!(jdk_has_module(&archive, "java.base"));
        assert!(!jdk_has_module(&archive, "jdk.compiler"));
        // 归档缺失 / 不可读 → false（不 panic）。
        assert!(!jdk_has_module(&tmp.path().join("absent.zip"), "java.base"));
    }

    /// JDK 落盘：路径符合 host 布局、内容正确、幂等（二次调用不重写）。
    #[test]
    fn materializes_jdk_source_into_host_layout() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = fake_jdk(
            tmp.path(),
            "21.0.12.1",
            &[
                ("java.base/java/io/PrintStream.java", "class PrintStream {}"),
                ("java.base/java/lang/String.java", "class String {}"),
            ],
        );
        let cache = tmp.path().join("cache");

        let got = materialize_jdk(
            &home,
            "java.base",
            &["java".into(), "io".into()],
            "PrintStream.java",
            &cache,
        )
        .expect("materialize");
        assert_eq!(
            got,
            cache.join("jdk-src-21.0.12.1/java.base/java/io/PrintStream.java")
        );
        assert_eq!(
            std::fs::read_to_string(&got).expect("read"),
            "class PrintStream {}"
        );

        // 幂等：手工改写内容后再次调用不得覆盖（已存在直接复用）。
        std::fs::write(&got, "manual").expect("write");
        let again = materialize_jdk(
            &home,
            "java.base",
            &["java".into(), "io".into()],
            "PrintStream.java",
            &cache,
        )
        .expect("materialize again");
        assert_eq!(again, got);
        assert_eq!(std::fs::read_to_string(&got).expect("read"), "manual");
    }

    /// 缺 `src.zip` / 条目不存在 → 带可操作信息的错误（不是静默 None）。
    #[test]
    fn jdk_materialization_reports_actionable_errors() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cache = tmp.path().join("cache");

        let home = fake_jdk(
            tmp.path(),
            "21",
            &[("java.base/java/lang/String.java", "x")],
        );
        let err = materialize_jdk(
            &home,
            "java.base",
            &["java".into(), "io".into()],
            "Missing.java",
            &cache,
        )
        .expect_err("missing entry");
        assert!(err.contains("java.base/java/io/Missing.java"), "{err}");
    }

    /// 依赖落盘：classpath 主 jar 的 sibling `-sources.jar` → `<stem>/<pkg…>/<Name>.java`。
    #[test]
    fn materializes_dependency_from_sibling_sources_jar() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let lib = tmp.path().join("lib");
        std::fs::create_dir_all(&lib).expect("mkdir");
        std::fs::write(lib.join("junit-4.13.2.jar"), b"main").expect("write main");
        write_zip(
            &lib.join("junit-4.13.2-sources.jar"),
            &[("org/junit/Assert.java", "class Assert {}")],
        );
        let cache = tmp.path().join("cache");

        let got = materialize_dependency(
            &[lib.join("junit-4.13.2.jar").to_string_lossy().to_string()],
            &["org".into(), "junit".into()],
            "Assert.java",
            &cache,
        )
        .expect("materialize");
        assert_eq!(got, cache.join("junit-4.13.2/org/junit/Assert.java"));
        assert_eq!(
            std::fs::read_to_string(&got).expect("read"),
            "class Assert {}"
        );
    }

    /// classpath 条目本身就是源码 jar → stem 去掉 `-sources`（与 host 布局一致）。
    #[test]
    fn sources_jar_entry_uses_main_jar_stem() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let sources = tmp.path().join("guava-33.0.0-jre-sources.jar");
        write_zip(
            &sources,
            &[("com/google/common/Base.java", "class Base {}")],
        );
        let cache = tmp.path().join("cache");

        let got = materialize_dependency(
            &[sources.to_string_lossy().to_string()],
            &["com".into(), "google".into(), "common".into()],
            "Base.java",
            &cache,
        )
        .expect("materialize");
        assert_eq!(
            got,
            cache.join("guava-33.0.0-jre/com/google/common/Base.java")
        );
    }

    /// 非 jar 条目 / 无来源 jar / 条目不在来源 jar 内 → 明确错误。
    #[test]
    fn dependency_materialization_reports_actionable_errors() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cache = tmp.path().join("cache");
        let err = materialize_dependency(&[], &["org".into()], "Assert.java", &cache)
            .expect_err("no classpath");
        assert!(err.contains("-sources.jar"), "{err}");

        let err = materialize_dependency(
            &["/proj/target/classes".to_string()],
            &["org".into()],
            "Assert.java",
            &cache,
        )
        .expect_err("directory entry is not a jar");
        assert!(err.contains("-sources.jar"), "{err}");

        let lib = tmp.path().join("lib");
        std::fs::create_dir_all(&lib).expect("mkdir");
        std::fs::write(lib.join("junit-4.13.2.jar"), b"main").expect("write");
        write_zip(
            &lib.join("junit-4.13.2-sources.jar"),
            &[("org/junit/Other.java", "x")],
        );
        let err = materialize_dependency(
            &[lib.join("junit-4.13.2.jar").to_string_lossy().to_string()],
            &["org".into(), "junit".into()],
            "Assert.java",
            &cache,
        )
        .expect_err("missing entry");
        assert!(err.contains("org/junit/Assert.java"), "{err}");
    }

    /// 非 jdt 身份原样透传（go/lldb 与项目源码走这条，绝不改动）。
    #[tokio::test]
    async fn plain_file_paths_pass_through_unchanged() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resolver = LspJavaSourcePath::with_cache_root(tmp.path().to_path_buf());
        assert_eq!(
            resolver
                .adapter_source_path(&ExecTarget::Local, &[], "/proj/src/Demo.java")
                .await,
            SourcePathResolution::Adapter(PathBuf::from("/proj/src/Demo.java"))
        );
    }

    /// **本类缺陷的守卫**：无论解析成功与否，下发给适配器的都必须是**真实存在的文件**，
    /// 伪路径 `jdt:/…` 绝不允流到适配器（这正是本 bug 的根因）。
    ///
    /// 两个分支都合法：本机有 JDK 时从 `src.zip` 落盘（结果依赖环境），没有则必须给出
    /// 非空原因 —— 但**任何情况下都不得回落到原伪路径**。
    #[tokio::test]
    async fn jdt_identity_never_falls_back_to_the_pseudo_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cache = tmp.path().join("cache");
        let resolver = LspJavaSourcePath::with_cache_root(cache.clone());
        let resolution = resolver
            .adapter_source_path(
                &ExecTarget::Local,
                &[],
                "jdt:/java.base/java/io/PrintStream.java",
            )
            .await;
        match resolution {
            SourcePathResolution::Adapter(path) => {
                assert!(path.is_file(), "下发的路径必须是真实存在的文件: {path:?}");
                assert!(
                    !path.to_string_lossy().starts_with("jdt:"),
                    "伪路径绝不允许下发: {path:?}"
                );
                assert!(path.starts_with(&cache), "落盘必须落在缓存根内: {path:?}");
            }
            SourcePathResolution::Unresolvable { reason } => {
                assert!(!reason.is_empty(), "不可解析必须给出原因");
            }
        }
    }

    /// 缓存已命中 → 直接下发真实路径（不触碰 JDK／classpath）。
    #[tokio::test]
    async fn cache_hit_is_served_without_materializing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cache = tmp.path().join("cache");
        let cached = cache.join("jdk-src-21.0.12.1/java.base/java/io/PrintStream.java");
        std::fs::create_dir_all(cached.parent().expect("parent")).expect("mkdir");
        std::fs::write(&cached, "class PrintStream {}").expect("write");

        let resolver = LspJavaSourcePath::with_cache_root(cache);
        assert_eq!(
            resolver
                .adapter_source_path(
                    &ExecTarget::Local,
                    &[],
                    "jdt:/java.base/java/io/PrintStream.java"
                )
                .await,
            SourcePathResolution::Adapter(cached)
        );
    }

    /// **现场回归**：适配器给的 `jdt://contents/…` 与前端规范身份**解析结果一致**
    /// （同一份源码不得因表示形式不同而走到不同结论）。
    #[tokio::test]
    async fn jdtls_uri_resolves_like_the_display_identity() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let resolver = LspJavaSourcePath::with_cache_root(tmp.path().join("cache"));
        let from_uri = resolver
            .adapter_source_path(
                &ExecTarget::Local,
                &[],
                "jdt://contents/java.base/java.io/PrintStream.class?=api/x",
            )
            .await;
        let from_identity = resolver
            .adapter_source_path(
                &ExecTarget::Local,
                &[],
                "jdt:/java.base/java/io/PrintStream.java",
            )
            .await;
        assert_eq!(from_uri, from_identity);
        if let SourcePathResolution::Adapter(path) = &from_uri {
            assert!(path.is_file(), "issued path must exist: {path:?}");
            assert!(!path.to_string_lossy().starts_with("jdt:"));
        }
    }

    /// **落盘兜底**：目标路径含 `..` 组件一律拒绝（fail-closed）。
    ///
    /// 身份解析已拒绝 `..` 段，这里防的是"其它来源"（jar stem 等）把写入引出缓存根；
    /// 红线 8 要求前端影响的任何落盘路径都必须校验。
    #[test]
    fn write_source_refuses_parent_dir_components() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let outside = tmp.path().join("escape/pwned.java");
        let err = write_source(&outside.join("../pwned.java"), b"x").expect_err("must refuse");
        assert!(err.contains("outside the cache root"), "{err}");
        assert!(!tmp.path().join("escape/pwned.java").exists());
    }
}
