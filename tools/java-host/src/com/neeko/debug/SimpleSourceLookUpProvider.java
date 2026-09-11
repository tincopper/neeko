package com.neeko.debug;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

import com.microsoft.java.debug.core.DebugException;
import com.microsoft.java.debug.core.JavaBreakpointLocation;
import com.microsoft.java.debug.core.adapter.ISourceLookUpProvider;
import com.microsoft.java.debug.core.protocol.Types.SourceBreakpoint;

/**
 * {@link ISourceLookUpProvider} 最小 shim —— 「相对 cwd/项目根解析 sourcePath」。
 *
 * <p>JDT 实现靠语义模型（ICompilationUnit）解析类名/行映射；本 host 无 JDT，
 * 只做文本级解析：
 * <ul>
 *   <li>{@link #getBreakpointLocations} 是断点安装的关键路径：把 DAP sourcePath
 *       （Neeko 传绝对路径）推导成 {@code <package>.<Class>}（JDI
 *       {@code vm.classesByName} 用它定位类，再按行号找 Location），行号原样透传。</li>
 *   <li>{@link #getSourceFileURI} / {@link #getSourceContents}：宿主 JVM 以项目根为
 *       cwd 启动（Rust {@code process::spawn_adapter} 传 project_path），
 *       相对 sourcePath 据此解析。</li>
 * </ul>
 * 评估/补全/热替换由 {@link NoopProviders} 顶住，与本 provider 无关。
 */
public final class SimpleSourceLookUpProvider implements ISourceLookUpProvider {

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
        if (sourcePath != null && !sourcePath.isEmpty()) {
            Path path = Paths.get(sourcePath);
            if (path.isAbsolute()) {
                return path.toAbsolutePath().normalize().toString();
            }
            // JDI 给的是包相对路径（如 com/tomgs/.../BaseTest.java）：在宿主 cwd
            // （= 项目根）树下按后缀搜索真实文件。直接拼 user.dir + rel 会漏掉
            // <module>/src/main|test/java 前缀（多模块工程实证），导致栈帧指向
            // 不存在的文件 —— 前端帧列表正常但打不开源码、无高亮。
            String hit = lookupSource(sourcePath.replace('\\', '/'));
            if (hit != null) {
                return hit;
            }
            // 搜索无果（如 JDK/JUnit 运行时类）：返回 "" 让上游走 sourcePaths
            // 兜底，而不是返回错误路径（错误路径会误导前端跳转到不存在的文件）。
            return "";
        }
        if (fullyQualifiedName == null || fullyQualifiedName.isEmpty()) {
            return "";
        }
        return fullyQualifiedName.replace('.', '/') + ".java";
    }

    /** 后缀搜索缓存（命中为绝对路径，未命中为 ""，ConcurrentHashMap 不存 null）。 */
    private static final ConcurrentHashMap<String, String> SOURCE_CACHE = new ConcurrentHashMap<>();

    /** 跳过的目录段：隐藏目录与构建产物（源码不可能在其中，跳过保搜索速度）。 */
    private static boolean isSkippedDirName(String name) {
        return name.startsWith(".")
            || name.equals("target")
            || name.equals("build")
            || name.equals("out")
            || name.equals("node_modules");
    }

    private static boolean underSkippedDir(Path root, Path file) {
        Path parent = file.getParent();
        while (parent != null && parent.startsWith(root) && !parent.equals(root)) {
            if (isSkippedDirName(parent.getFileName().toString())) {
                return true;
            }
            parent = parent.getParent();
        }
        return false;
    }

    /**
     * 在宿主 cwd 树下找第一个以 {@code /rel} 结尾的源文件；含 {@code /src/} 段的
     * 命中优先（同一类名在多模块重复时选源码而非拷贝）。命中与未命中都缓存。
     */
    static String lookupSource(String rel) {
        String relSlash = rel.startsWith("/") ? rel : "/" + rel;
        String cached = SOURCE_CACHE.get(relSlash);
        if (cached != null) {
            return cached.isEmpty() ? null : cached;
        }
        Path root = Paths.get(System.getProperty("user.dir", ".")).toAbsolutePath().normalize();
        String first = null;
        try (Stream<Path> stream = Files.walk(root)) {
            for (Iterator<Path> it = stream.iterator(); it.hasNext();) {
                Path p = it.next();
                if (!Files.isRegularFile(p) || !p.toString().endsWith(".java")) {
                    continue;
                }
                if (underSkippedDir(root, p)) {
                    continue;
                }
                String norm = p.toAbsolutePath().normalize().toString().replace('\\', '/');
                if (!norm.endsWith(relSlash)) {
                    continue;
                }
                if (norm.contains("/src/")) {
                    SOURCE_CACHE.put(relSlash, norm);
                    return norm;
                }
                if (first == null) {
                    first = norm;
                }
            }
        } catch (IOException e) {
            // 遍历失败按未命中处理（调用方走上游兜底）。
        }
        SOURCE_CACHE.put(relSlash, first == null ? "" : first);
        return first;
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
     * 绝对 sourceUri（{@code /path/src/test/java/com/example/FooTest.java}）
     * → JDI 全限定类名（{@code com.example.FooTest}）。
     *
     * <p>解析规则：包名取「源码根标记之后」的目录层级。标记按优先级：
     * {@code /src/test/java/}（JUnit 测试类，Neeko Java Debug 主路径）→
     * {@code /src/main/java/} → {@code /src/}（Gradle 默认布局变体）→
     * 无标记则退化为文件名（默认包）。非 {@code .java} 路径返回 {@code null}
     * （调用方按「无法解析」处理，不抛错）。
     */
    static String resolveClassName(String sourceUri) {
        if (sourceUri == null) {
            return null;
        }
        String path = sourceUri.replace('\\', '/');
        int lastSlash = path.lastIndexOf('/');
        String fileName = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
        if (!fileName.endsWith(".java")) {
            return null;
        }
        String className = fileName.substring(0, fileName.length() - ".java".length());

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
                String pkg = rest.substring(0, rest.length() - fileName.length());
                pkg = pkg.replace('/', '.');
                if (pkg.endsWith(".")) {
                    pkg = pkg.substring(0, pkg.length() - 1);
                }
                if (!pkg.isEmpty()) {
                    className = pkg + "." + className;
                }
            }
        }
        return className;
    }
}
