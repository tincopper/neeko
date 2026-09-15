//! Java 断点源路径翻译：**规范源身份 → DAP 适配器可识别的真实文件路径**。
//!
//! ## 为什么必须翻译（java-debug 权威契约，反编译 0.53.1 实证）
//!
//! jdtls 注册给 java-debug 的 `JdtSourceLookUpProvider` 里，断点类名的**唯一**来源是
//! `getBreakpointLocations(sourceUri, …)` → `asCompilationUnit(sourceUri)`，它只接受两种形态：
//!
//! 1. **真实存在的文件路径**（`file:` URI 或裸绝对路径）：`AdapterUtils.toPath(uri)`
//!    成功**且** `Files.isRegularFile` 为真 → 读盘做 JDT AST 解析；类名由 AST 的
//!    package + 类型声明推导（`ValidBreakpointLocationLocator`，**不需要** project
//!    bindings，故工作区外的 JDK 源码同样能推出 `java.io.PrintStream`）。
//! 2. `jdt://contents/<module>/<pkg 段…>/<Name>.class?<JDT handle>`：`resolveClassFile`
//!    逐条要求 `scheme == "jdt"`、`authority == "contents"`、`query` 为 JDT handle identifier。
//!
//! Neeko 的规范身份 `jdt:/<module>/<pkg 段…>/<Name>.java` **两者都不满足**：
//! `new URI("jdt:/…")` 可解析但 `Paths.get(URI)` 抛 `FileSystemNotFoundException`
//! → `toPath` 返回 null（形态 1 不进）；authority 为 null ≠ `"contents"`
//! → `resolveClassFile` 返回 null（形态 2 不进）。于是位置拿不到 `className`，
//! java-debug 建不出 JDI 请求 → 回 `verified:false` → 断点永不命中。
//!
//! 真机证据：`~/.neeko/neeko.log` 中
//! `[DAP] adapter did not resolve 1 breakpoint(s) in jdt:/java.base/java/io/PrintStream.java: lines 1167`。
//!
//! ## 为什么只能走形态 1
//!
//! 形态 2 需要 JDT handle，而 LSP 的 `jdt://contents/…?<attrs>` query 是 jdtls 自己的属性
//! 编码（`JavaCore.create` 认不出），Neeko 无法取得 handle。故唯一可行方向是**下发真实文件
//! 路径** —— 这也让 host（A）与 jdtls（B'）收敛到同一形态，不再需要任何私有约定。
//!
//! ## 单一身份不变式
//!
//! 翻译**只在 DAP 边界发生**：`jdt:/…` 仍是 tab / 断点 key / 黄线 / 导航历史的规范身份
//! （`.neeko/breakpoints.json` 不迁移），只是不再出现在下发给适配器的载荷里。
//! 落盘复用 host 的缓存布局，而前端 `fileRef.jdtIdentityOfJdkCachePath` 会把该真实路径
//! **映射回同一个 `jdt:/…` 身份** —— 因此"落盘"不会产生第二种 tab 身份。
//!
//! ## 跨语言契约：缓存布局
//!
//! 布局由 host 的 `ClasspathSources` 拥有（`tools/java-host/src/com/neeko/debug/ClasspathSources.java`），
//! 本模块**镜像**它以便查找/落盘，两侧各有测试锁定（host `SimpleSourceLookUpProviderTest`
//! 与本模块 `#[cfg(test)]`）：
//!
//! - JDK：`java-src-cache/jdk-src-<ver>/<module>/<pkg 段…>/<Name>.java`
//! - 依赖：`java-src-cache/<stem>/<pkg 段…>/<Name>.java`（stem = 条目 jar 名去 `.jar`）

use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::common::executor::factory::ExecTarget;

/// 源码缓存目录名（相对 `~/.neeko`）—— 与 host `ClasspathSources.CACHE_DIR_NAME` 同源。
pub const CACHE_DIR_NAME: &str = "java-src-cache";

/// JDK 源码缓存 stem 前缀 —— 与 host `ClasspathSources.JDK_STEM_PREFIX` 同源。
pub const JDK_STEM_PREFIX: &str = "jdk-src-";

/// 规范身份前缀（前端 `fileRef.tabIdentityOf` 产出）。
const JDT_IDENTITY_PREFIX: &str = "jdt:/";

/// jdtls 的类文件 **LSP uri** 前缀（`jdt://contents/…`）。
///
/// B' 下 java-debug 对 JDK / 依赖类的 `Source.path` 就是该形态（真机实测），
/// 因此它也必须是可解析的输入 —— 但它**不是**可下发形态（query 是 jdtls 的属性编码，
/// 不是 java-debug 要求的 JDT handle，见模块文档）。
const JDT_URI_PREFIX: &str = "jdt://contents/";

/// 规范身份要求的源码后缀。
const JAVA_SUFFIX: &str = ".java";

/// 规范源身份的解析结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourcePathIdentity {
    /// 普通文件路径（项目源码；也涵盖非 Java 语言）—— 原样下发。
    Fs(PathBuf),
    /// JDK / 依赖源码的规范身份：`jdt:/<module>/<pkg 段…>/<Name>.java`。
    Jdt {
        /// 模块段（JDK 为 `java.base` 之类；依赖为 jdtls 给的模块名）。
        module: String,
        /// 包段（`java.io` → `["java", "io"]`；默认包为空）。
        package_segments: Vec<String>,
        /// 文件名（恒以 `.java` 结尾）。
        file_name: String,
    },
    /// 无法解析 / 不支持的身份（空串、`jdt://` 原始 uri、非 `.java`、缺模块段…）。
    Unsupported(String),
}

/// 解析规范源身份。
///
/// 接受两种输入（两者指向同一份源码，文法同前端 `fileRef`）：
///
/// - **规范身份** `jdt:/<module>/<pkg 段…>/<Name>.java`（前端 tab 身份）；
/// - **jdtls LSP uri** `jdt://contents/<module>/<pkg 段…>/<Name>.<ext>?<query>` ——
///   B' 下适配器给的 `Source.path` 就是它。query 被忽略（那是 jdtls 的属性编码，
///   java-debug 要的 JDT handle 不在其中），扩展名一律归一为 `.java`。
///
/// 判定刻意保守：
/// - 非 `jdt:` 前缀一律视为普通文件路径（Windows 盘符路径也走这条）；
/// - 缺模块段 / 空串同样拒绝（下游 `resolveClassName` / AST 推导也只能从 `.java` 入手）。
#[must_use]
pub fn parse_identity(identity: &str) -> SourcePathIdentity {
    let trimmed = identity.trim();
    if trimmed.is_empty() {
        return SourcePathIdentity::Unsupported(identity.to_string());
    }
    // uri 形态必须先判：`jdt://contents/…` 也满足 `jdt:/` 前缀。
    if let Some(rest) = trimmed.strip_prefix(JDT_URI_PREFIX) {
        let path_only = rest.split('?').next().unwrap_or("");
        return parse_identity_segments(path_only, identity);
    }
    let Some(rest) = trimmed.strip_prefix(JDT_IDENTITY_PREFIX) else {
        return SourcePathIdentity::Fs(PathBuf::from(trimmed));
    };
    // `jdt://…` 但不在 `contents/` 下：不是已知文法，明确拒绝而不是当文件路径。
    if rest.starts_with('/') {
        return SourcePathIdentity::Unsupported(identity.to_string());
    }
    parse_identity_segments(rest, identity)
}

/// `<module>/<pkg 段…>/<Name>.<ext>` → 身份（扩展名归一为 `.java`）。
fn parse_identity_segments(path_only: &str, original: &str) -> SourcePathIdentity {
    // 路径穿越防御（红线 8：前端传入的路径必须校验）：任何段为 `.` / `..` 一律**拒绝**
    // 整个身份。刻意不静默过滤 —— 过滤会把 `jdt:/m/../../etc/passwd.java` 悄悄改写成
    // 缓存内的合法路径，等于用归一掩盖非法输入；而 module / 包段会直接参与落盘路径拼接
    // （`cache_target`），放行即等于允许写到缓存根之外。
    if path_only
        .split('/')
        .any(|segment| matches!(segment, "." | ".."))
    {
        return SourcePathIdentity::Unsupported(original.to_string());
    }
    let mut segments: Vec<&str> = path_only.split('/').filter(|s| !s.is_empty()).collect();
    let Some(last) = segments.pop() else {
        return SourcePathIdentity::Unsupported(original.to_string());
    };
    // 至少 `module` + `file`；默认包时 package_segments 为空。
    if segments.is_empty() {
        return SourcePathIdentity::Unsupported(original.to_string());
    }
    let Some((stem, ext)) = last.rsplit_once('.') else {
        return SourcePathIdentity::Unsupported(original.to_string());
    };
    // 只接受 Java 源码/类文件：其它扩展名说明这不是我们认得的源码引用，
    // 归一化到 `.java` 会指向**另一份**源码（错源码 = 错类错行，比不解析更难排查）。
    if stem.is_empty() || !matches!(ext, "java" | "class") {
        return SourcePathIdentity::Unsupported(original.to_string());
    }
    let module = segments.remove(0).to_string();
    // 包段形态归一：jdtls 的 uri 用**点**分隔（`java.io`），展示身份用斜杠（`java/io`）。
    // 两者必须收敛到同一身份（否则同一份源码会有两套断点 key / 两个 tab）。
    // 注意只归一包段：**模块段本身含点**（`java.base`），不能一起替换。
    let package_segments = segments
        .join("/")
        .replace('.', "/")
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    SourcePathIdentity::Jdt {
        module,
        package_segments,
        file_name: format!("{stem}{JAVA_SUFFIX}"),
    }
}

/// 在缓存根下查找已落盘的真实源码文件。
///
/// 优先级（**精确优先，最后才放宽**）：
/// 1. `jdk-src-*/<module>/<pkg 段…>/<Name>.java` —— JDK；多版本时取字典序最大者（最新）；
/// 2. `<module>/<pkg 段…>/<Name>.java` —— stem 恰等于模块名；
/// 3. `*/<pkg 段…>/<Name>.java` —— 依赖布局（无模块段）。**仅当候选唯一**时采信：
///    多个 stem 命中同一 (包, 文件名) 意味着无法判断是哪一份源码，下发错源码会得到
///    "错类 / 错行"的静默错，比不命中更难排查，故一律拒绝。
#[must_use]
pub fn cached_source_path(
    cache_root: &Path,
    module: &str,
    package_segments: &[String],
    file_name: &str,
) -> Option<PathBuf> {
    let mut stems: Vec<String> = std::fs::read_dir(cache_root)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    stems.sort();

    // 包目录 + 文件名（`<pkg 段…>/<Name>.java`）。
    let mut relative = PathBuf::new();
    for segment in package_segments {
        relative.push(segment);
    }
    relative.push(file_name);

    // 1. JDK：`jdk-src-*/<module>/<pkg…>/<file>`（版本降序，取最新）。
    for stem in stems
        .iter()
        .rev()
        .filter(|s| s.starts_with(JDK_STEM_PREFIX))
    {
        let candidate = cache_root.join(stem).join(module).join(&relative);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 2. stem 恰等于模块名。
    if stems.iter().any(|stem| stem == module) {
        let candidate = cache_root.join(module).join(&relative);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 3. 依赖布局：唯一候选才采信。
    let loose: Vec<PathBuf> = stems
        .iter()
        .filter(|stem| !stem.starts_with(JDK_STEM_PREFIX) && stem.as_str() != module)
        .map(|stem| cache_root.join(stem).join(&relative))
        .filter(|candidate| candidate.is_file())
        .collect();
    match loose.len() {
        1 => loose.into_iter().next(),
        _ => None,
    }
}

/// dap 侧窄端口：把规范源身份翻译成适配器可识别的真实路径。
///
/// 实现必须**不阻塞**调用方：JDK 探测会跑一次 `java`（首次数秒）、落盘会解压
/// `src.zip`，实现应把同步 IO 放进 `spawn_blocking`（对齐 `JavaDebugCapabilityProvider`
/// 的契约与仓库红线 3）。
///
/// 返回类型 [`super::super::backend::SourcePathResolution`]（语言无关，见其文档）。
#[async_trait]
pub trait JavaSourcePathProvider: Send + Sync {
    /// 翻译 `identity`（tab / 断点 key 的规范身份）。
    ///
    /// `target` 决定在哪个执行环境里找 JDK（Local / WSL / SSH）。
    /// `classpath` 是**调试目标的运行时 classpath**（B' 由 jdtls `resolveClasspath`
    /// 给出，A 由前端构造）—— 依赖源码要从其中的 `-sources.jar` 取；无上下文时传空切片，
    /// 实现只能靠缓存命中（live toggle 场景，失败时须给出明确原因）。
    async fn adapter_source_path(
        &self,
        target: &ExecTarget,
        classpath: &[String],
        identity: &str,
    ) -> super::super::backend::SourcePathResolution;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jdt(module: &str, package_segments: &[&str], file_name: &str) -> SourcePathIdentity {
        SourcePathIdentity::Jdt {
            module: module.to_string(),
            package_segments: package_segments.iter().map(|s| (*s).to_string()).collect(),
            file_name: file_name.to_string(),
        }
    }

    /// 真机现场身份（本 bug 的输入）必须解析为 Jdt 三段。
    #[test]
    fn parses_real_jdk_identity() {
        assert_eq!(
            parse_identity("jdt:/java.base/java/io/PrintStream.java"),
            jdt("java.base", &["java", "io"], "PrintStream.java")
        );
        // 默认包：包段为空。
        assert_eq!(
            parse_identity("jdt:/m/System.java"),
            jdt("m", &[], "System.java")
        );
    }

    /// **现场回归**：适配器给的 `jdt://contents/…?<query>` 与前端规范身份收敛到同一身份。
    ///
    /// B' 下 java-debug 对 JDK / 依赖类的 `Source.path` 就是前者；后端必须能解析它，
    /// 否则帧源码授权（归一匹配）与源码落盘都无法进行。
    #[test]
    fn parses_jdtls_uri_into_the_same_identity() {
        let uri = "jdt://contents/java.base/java.io/PrintStream.class?=api/%5C/opt%5C/homebrew%5C/\
                   Cellar%5C/openjdk%5C@21%5C/21.0.12.1%5C/libexec%5C/openjdk.jdk%5C/Contents%5C/\
                   Home%5C/lib%5C/jrt-fs.jar%60java.base=/javadoc_location=/https:%5C/%5C/\
                   docs.oracle.com%5C/en%5C/java%5C/javase%5C/21%5C/docs%5C/api%5C/=/=/\
                   maven.pomderived=/true=/%3Cjava.io(PrintStream.class";
        assert_eq!(
            parse_identity(uri),
            parse_identity("jdt:/java.base/java/io/PrintStream.java")
        );
        // 默认包 + `.class` → `.java`。
        assert_eq!(
            parse_identity("jdt://contents/java.base/System.class?=x"),
            jdt("java.base", &[], "System.java")
        );
    }

    /// 非 `jdt:/` 一律是普通文件路径（含 Windows 盘符）。
    #[test]
    fn non_jdt_identity_is_a_plain_path() {
        for path in [
            "/proj/src/test/java/com/demo/DirectTest.java",
            "C:\\proj\\src\\Demo.java",
            "relative/Demo.java",
        ] {
            assert_eq!(
                parse_identity(path),
                SourcePathIdentity::Fs(PathBuf::from(path)),
                "{path}"
            );
        }
        // 前后空白不影响判定。
        assert_eq!(
            parse_identity("  /proj/Demo.java  "),
            SourcePathIdentity::Fs(PathBuf::from("/proj/Demo.java"))
        );
    }

    /// 畸形身份一律拒绝：空串 / 缺模块段 / 非 Java 扩展名 / 未知 jdt 形态。
    #[test]
    fn malformed_identities_are_unsupported() {
        for bad in [
            "",
            "   ",
            "jdt:/",
            "jdt:/java.base",
            "jdt:/java.base/java/io/PrintStream.txt",
            "jdt:/java.base/java/io/.java",
            "jdt://",
            "jdt://other/java.base/Foo.class",
            "jdt://contents/",
        ] {
            assert!(
                matches!(parse_identity(bad), SourcePathIdentity::Unsupported(_)),
                "{bad:?} 必须被拒"
            );
        }
    }

    /// **路径穿越防御**：含 `.` / `..` 段的身份一律拒绝整个身份（不静默过滤掉该段）。
    ///
    /// module / 包段会直接参与落盘路径拼接，放行即等于允许写到缓存根之外；
    /// 而"过滤掉 `..`"会把非法输入悄悄改写成缓存内合法路径 —— 用归一掩盖非法输入。
    #[test]
    fn rejects_path_traversal_segments() {
        for bad in [
            "jdt:/../etc/passwd.java",
            "jdt:/m/../../etc/passwd.java",
            "jdt:/./java.base/Foo.java",
            "jdt:/java.base/../Foo.java",
            "jdt://contents/../Foo.class?=x",
            "jdt://contents/java.base/java/../../Foo.class?=x",
        ] {
            assert!(
                matches!(parse_identity(bad), SourcePathIdentity::Unsupported(_)),
                "{bad:?} 必须被拒（路径穿越）"
            );
        }
        // 形近但不含穿越段的身份仍应正常解析（避免把防御写成误杀）。
        assert!(matches!(
            parse_identity("jdt:/java.base/java/io/Foo.java"),
            SourcePathIdentity::Jdt { .. }
        ));
    }

    fn write_source(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(path, body).expect("write");
    }

    /// JDK 精确命中：模块段匹配、版本无关；多版本取字典序最大（最新）。
    #[test]
    fn finds_jdk_cache_hit_and_prefers_newest_version() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write_source(
            &root.join("jdk-src-21.0.1/java.base/java/io/PrintStream.java"),
            "old",
        );
        write_source(
            &root.join("jdk-src-21.0.12.1/java.base/java/io/PrintStream.java"),
            "new",
        );

        let found = cached_source_path(
            root,
            "java.base",
            &["java".into(), "io".into()],
            "PrintStream.java",
        )
        .expect("hit");
        assert_eq!(
            found,
            root.join("jdk-src-21.0.12.1/java.base/java/io/PrintStream.java"),
            "多版本必须取最新（字典序最大）"
        );
    }

    /// 模块段不匹配 → 不命中（绝不跨模块取同包名文件）。
    #[test]
    fn jdk_cache_requires_matching_module() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write_source(
            &root.join("jdk-src-21/java.base/java/lang/String.java"),
            "x",
        );
        assert!(
            cached_source_path(
                root,
                "java.sql",
                &["java".into(), "lang".into()],
                "String.java"
            )
            .is_none(),
            "module 不匹配不得命中"
        );
    }

    /// stem 恰等于模块名（无版本段）时命中。
    #[test]
    fn finds_stem_equals_module_layout() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write_source(&root.join("java.base/java/lang/String.java"), "x");
        assert_eq!(
            cached_source_path(
                root,
                "java.base",
                &["java".into(), "lang".into()],
                "String.java"
            ),
            Some(root.join("java.base/java/lang/String.java"))
        );
    }

    /// 依赖布局：唯一候选命中。
    #[test]
    fn finds_unique_dependency_layout_candidate() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write_source(&root.join("junit-4.13.2/org/junit/Assert.java"), "x");
        assert_eq!(
            cached_source_path(
                root,
                "learning-java",
                &["org".into(), "junit".into()],
                "Assert.java"
            ),
            Some(root.join("junit-4.13.2/org/junit/Assert.java"))
        );
    }

    /// 依赖布局：多个 stem 命中同一 (包, 文件名) → **拒绝**（错源码比不命中更难排查）。
    #[test]
    fn ambiguous_dependency_candidates_are_refused() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write_source(&root.join("a-1.0/org/junit/Assert.java"), "a");
        write_source(&root.join("b-2.0/org/junit/Assert.java"), "b");
        assert!(
            cached_source_path(root, "m", &["org".into(), "junit".into()], "Assert.java").is_none(),
            "歧义必须拒绝"
        );
    }

    /// 依赖布局不覆盖 JDK 目录：只有 `jdk-src-*` 命中而模块不匹配时，不得放宽到该目录。
    #[test]
    fn jdk_stems_never_match_the_loose_dependency_rule() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write_source(
            &root.join("jdk-src-21/java.base/java/lang/String.java"),
            "x",
        );
        assert!(
            cached_source_path(
                root,
                "other",
                &["java".into(), "lang".into()],
                "String.java"
            )
            .is_none(),
            "jdk-src-* 目录不参与宽松匹配"
        );
    }

    /// 缓存根缺失 / 空 → 不命中（不 panic）。
    #[test]
    fn missing_cache_root_yields_none() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let absent = tmp.path().join("nope");
        assert!(cached_source_path(&absent, "java.base", &[], "A.java").is_none());
        assert!(cached_source_path(tmp.path(), "java.base", &[], "A.java").is_none());
    }
}
