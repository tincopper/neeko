package com.neeko.debug;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.microsoft.java.debug.core.DebugException;
import com.microsoft.java.debug.core.JavaBreakpointLocation;
import com.microsoft.java.debug.core.adapter.IDebugAdapterContext;
import com.microsoft.java.debug.core.adapter.ISourceLookUpProvider;
import com.microsoft.java.debug.core.protocol.Types.SourceBreakpoint;

/**
 * {@link ISourceLookUpProvider} 最小 shim —— 无 JDT，只做文本级路径解析。
 *
 * <p>类职责边界：
 * <ul>
 *   <li>「包相对源码路径 → 绝对源码路径」交给 {@link ClasspathSources}
 *       （classpath 目录 / {@code -sources.jar} / JDK {@code src.zip} + 解压缓存）；</li>
 *   <li>本项目 / 模块内的源码由本类的项目根后缀遍历兜底（多模块
 *       {@code <module>/src/main|test/java} 布局无类路径可依）；</li>
 *   <li>「源码路径 → 全限定类名」由 {@link #resolveClassName} 承担，是断点安装
 *       （{@link #getBreakpointLocations}）的关键路径。</li>
 * </ul>
 *
 * <p>宿主的源码根来自 DAP attach 载荷的 {@code sourcePaths}（契约见 Rust 侧
 * {@code JavaAdapter}）：第 1 条 = 项目根，其后 = debuggee classpath 条目。
 * attach 载荷没有 {@code classPaths} 字段（仅 {@code launch} 有），而
 * {@code AttachRequestHandler} 会把 {@code sourcePaths} 写进 context —— 这是
 * classpath 到达本 provider 的唯一通道。
 *
 * <p>评估 / 补全 / 热替换由 {@link NoopProviders} 顶住，与本 provider 无关。
 */
public final class SimpleSourceLookUpProvider implements ISourceLookUpProvider {

    private static final String JDT_DISPLAY_PREFIX = "jdt:/";
    private static final String JAVA_SUFFIX = ".java";

    /** 项目 / 模块根（`sourcePaths[0]` + 宿主 cwd），项目内源码后缀遍历用。 */
    private volatile List<String> projectRoots = Collections.emptyList();

    /** debuggee classpath 解析器（`sourcePaths[1..]`）。 */
    private volatile ClasspathSources classpath = ClasspathSources.of(Collections.emptyList());

    /**
     * 捕获本次会话的源码根：{@code context.getSourcePaths()} 第 1 条为项目根，
     * 其余为 classpath 条目。宿主 cwd（= 项目根，Rust 侧 spawn 时传入）作为
     * 兜底遍历根，保证模块目录之外的项目源码仍可命中。
     */
    @Override
    public void initialize(IDebugAdapterContext context, Map<String, Object> properties) {
        String[] paths = context == null ? null : context.getSourcePaths();
        List<String> roots = new ArrayList<>();
        List<String> entries = new ArrayList<>();
        if (paths != null) {
            for (String raw : paths) {
                if (raw == null || raw.trim().isEmpty()) {
                    continue;
                }
                if (roots.isEmpty()) {
                    roots.add(raw.trim());
                } else {
                    entries.add(raw.trim());
                }
            }
        }
        String cwd = System.getProperty("user.dir", "");
        if (!cwd.isEmpty() && !roots.contains(cwd)) {
            roots.add(cwd);
        }
        this.projectRoots = Collections.unmodifiableList(roots);
        this.classpath = ClasspathSources.of(entries);
    }

    @Override
    public boolean supportsRealtimeBreakpointVerification() {
        return true;
    }

    @Override
    @Deprecated
    public String[] getFullyQualifiedName(String uri, int[] lines, int[] columns)
            throws DebugException {
        String className = resolveClassName(uri);
        String[] names = new String[lines.length];
        java.util.Arrays.fill(names, className == null ? "" : className);
        return names;
    }

    @Override
    public JavaBreakpointLocation[] getBreakpointLocations(
            String sourceUri, SourceBreakpoint[] sourceBreakpoints) throws DebugException {
        String className = resolveClassName(sourceUri);
        JavaBreakpointLocation[] locations = new JavaBreakpointLocation[sourceBreakpoints.length];
        for (int i = 0; i < sourceBreakpoints.length; i++) {
            SourceBreakpoint bp = sourceBreakpoints[i];
            JavaBreakpointLocation location = new JavaBreakpointLocation(bp.line, bp.column);
            if (className != null) {
                location.setClassName(className);
            }
            locations[i] = location;
        }
        return locations;
    }

    @Override
    @Deprecated
    public String getSourceFileURI(String fullyQualifiedName, String sourcePath) {
        String rel = toRelativeSourcePath(sourcePath, fullyQualifiedName);
        if (rel == null) {
            return "";
        }
        // 顺序即优先级：依赖/目录（精确）→ 项目遍历（精确）→ JDK src.zip（仅按
        // 文件名）。JDK 放最后是因为它最泛：src.zip 里存在 17 个 `*/Main.java`，
        // 若先查它，默认包的项目类 Main 会被劫持到 `sun/security/tools/keytool/
        // Main.java`（实测复现）。
        String fromClasspath = classpath.findSource(rel);
        if (fromClasspath != null) {
            return fromClasspath;
        }
        String fromProject = lookupSource(rel);
        if (fromProject != null) {
            return fromProject;
        }
        String fromJdk = classpath.findJdkSource(rel);
        if (fromJdk != null) {
            return fromJdk;
        }
        // 未命中：返回 "" 让上游按「无源码」处理（帧无 source）。禁止返回包相对
        // 假路径 —— 前端会把相对路径拼到项目根上，打开不存在的文件。
        return "";
    }

    /**
     * 解析 JDI 给的源码定位信息为包相对路径（{@code com/foo/Bar.java}）。
     *
     * <p>{@code sourcePath} 是 {@code ReferenceType.sourcePaths} 的值（包相对，
     * 可能为 null）；为 null 时退化为按全限定名推导（内层类
     * {@code com.foo.Bar$Baz} → {@code com/foo/Bar.java}）。
     */
    private static String toRelativeSourcePath(String sourcePath, String fullyQualifiedName) {
        if (sourcePath != null && !sourcePath.trim().isEmpty()) {
            String norm = sourcePath.trim().replace('\\', '/');
            while (norm.startsWith("/")) {
                norm = norm.substring(1);
            }
            return norm.endsWith(JAVA_SUFFIX) ? norm : null;
        }
        if (fullyQualifiedName == null || fullyQualifiedName.isEmpty()) {
            return null;
        }
        int inner = fullyQualifiedName.indexOf('$');
        String topLevel = inner < 0 ? fullyQualifiedName : fullyQualifiedName.substring(0, inner);
        return topLevel.replace('.', '/') + JAVA_SUFFIX;
    }

    /**
     * 后缀搜索缓存（命中为绝对路径，未命中为 ""，ConcurrentHashMap 不存 null）。
     * 实例字段而非 static：遍历根随会话（`sourcePaths`）变化，跨会话复用同一
     * host 进程时 static 缓存会串根。
     */
    private final ConcurrentHashMap<String, String> sourceCache = new ConcurrentHashMap<>();

    /** 跳过的目录段：隐藏目录与构建产物（源码不可能在其中，跳过保搜索速度）。 */
    private static boolean isSkippedDirName(String name) {
        return name.startsWith(".")
            || name.equals("target")
            || name.equals("build")
            || name.equals("out")
            || name.equals("node_modules");
    }

    /**
     * 在项目 / 模块根树下找第一个以 {@code /rel} 结尾的源文件；含 {@code /src/}
     * 段的命中优先（同一类名在多模块重复时选源码而非拷贝）。命中与未命中都缓存。
     */
    private String lookupSource(String rel) {
        String relSlash = rel.startsWith("/") ? rel : "/" + rel;
        String cached = sourceCache.get(relSlash);
        if (cached != null) {
            return cached.isEmpty() ? null : cached;
        }
        String first = null;
        roots:
        for (String root : projectRoots) {
            Path base = Paths.get(root);
            if (!Files.isDirectory(base)) {
                continue;
            }
            String[] hit = walkProjectRoot(base, relSlash);
            if (hit[1] != null) {
                first = hit[1];
                break roots;
            }
            if (first == null) {
                first = hit[0];
            }
        }
        sourceCache.put(relSlash, first == null ? "" : first);
        return first;
    }

    /**
     * 遍历单个项目根：返回 {@code [首个任意命中, 首个 /src/ 段命中]}。
     * 构建产物与隐藏目录在遍历层剪枝（{@code preVisitDirectory} 直接
     * {@code SKIP_SUBTREE}）：目录内容不进入遍历、不产生 stat —— 大仓库
     * （{@code target/} / {@code node_modules/} 深树）的未命中路径不再全量 walk。
     */
    private static String[] walkProjectRoot(Path base, String relSlash) {
        String[] hit = { null, null };
        try {
            Files.walkFileTree(base, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    return !dir.equals(base) && isSkippedDirName(dir.getFileName().toString())
                        ? FileVisitResult.SKIP_SUBTREE
                        : FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (!attrs.isRegularFile() || !file.toString().endsWith(JAVA_SUFFIX)) {
                        return FileVisitResult.CONTINUE;
                    }
                    String norm = file.toAbsolutePath().normalize().toString().replace('\\', '/');
                    if (!norm.endsWith(relSlash)) {
                        return FileVisitResult.CONTINUE;
                    }
                    if (norm.contains("/src/")) {
                        hit[1] = norm;
                        return FileVisitResult.TERMINATE;
                    }
                    if (hit[0] == null) {
                        hit[0] = norm;
                    }
                    return hit[1] != null ? FileVisitResult.TERMINATE : FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            // 遍历失败按未命中处理（继续下一个根）
        }
        return hit;
    }

    @Override
    public String getSourceContents(String uri) {
        try {
            return Files.readString(Path.of(uri), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    @Override
    public List<MethodInvocation> findMethodInvocations(String uri, int line) {
        return Collections.emptyList();
    }

    /**
     * 源码 URI → JDI 全限定类名；无法判定返回 {@code null}。
     *
     * <p>规则按「路径形态」分派，覆盖三条真实来源：
     * <ol>
     *   <li>{@code java-src-cache} 解压产物（{@link ClasspathSources} 布局，
     *       包名 = stem 之后的目录段）；</li>
     *   <li>LSP jdt 展示路径 {@code jdt:/<module>/<pkg 段…>/<Name>.java}
     *       （手工跳转打开的 JDK / 依赖类，用户在其上打断点）；</li>
     *   <li>项目源码根标记 {@code /src/test/java/} → {@code /src/main/java/} →
     *       {@code /src/}（Gradle 变体）；均不含则退化为文件名（默认包）。</li>
     * </ol>
     */
    static String resolveClassName(String sourceUri) {
        if (sourceUri == null) {
            return null;
        }
        String path = sourceUri.replace('\\', '/');
        int lastSlash = path.lastIndexOf('/');
        String fileName = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
        if (!fileName.endsWith(JAVA_SUFFIX)) {
            return null;
        }
        String simpleName = fileName.substring(0, fileName.length() - JAVA_SUFFIX.length());

        String fromCache = ClasspathSources.packageFromCachePath(path);
        if (fromCache != null) {
            return qualify(fromCache, simpleName);
        }
        if (path.startsWith(JDT_DISPLAY_PREFIX)) {
            return qualify(packageFromJdtDisplayPath(path), simpleName);
        }

        String className = simpleName;
        int pkgStart = -1;
        for (String marker : new String[] {"/src/test/java/", "/src/main/java/", "/src/"}) {
            int m = path.lastIndexOf(marker);
            if (m >= 0) {
                pkgStart = m + marker.length();
                break;
            }
        }
        if (pkgStart >= 0 && pkgStart < path.length()) {
            String rest = path.substring(pkgStart);
            if (rest.length() > fileName.length()) {
                String pkg = rest.substring(0, rest.length() - fileName.length()).replace('/', '.');
                if (pkg.endsWith(".")) {
                    pkg = pkg.substring(0, pkg.length() - 1);
                }
                if (!pkg.isEmpty()) {
                    className = pkg + "." + simpleName;
                }
            }
        }
        return className;
    }

    /**
     * jdt 展示路径 {@code jdt:/<module>/<pkg 段…>/<Name>.java} → 包名。
     * 缺模块段或落在默认包时返回空串。
     */
    private static String packageFromJdtDisplayPath(String path) {
        String rest = path.substring(JDT_DISPLAY_PREFIX.length());
        int moduleEnd = rest.indexOf('/');
        if (moduleEnd < 0 || moduleEnd + 1 >= rest.length()) {
            return "";
        }
        String afterModule = rest.substring(moduleEnd + 1);
        int pkgEnd = afterModule.lastIndexOf('/');
        return pkgEnd < 0 ? "" : afterModule.substring(0, pkgEnd).replace('/', '.');
    }

    private static String qualify(String pkg, String simpleName) {
        return pkg.isEmpty() ? simpleName : pkg + "." + simpleName;
    }
}
