package com.neeko.debug;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * debuggee classpath 视角的源码解析器：包相对源码路径 {@code com/foo/Bar.java}
 * → 磁盘上的绝对源码路径。
 *
 * <p>JDI 只提供包相对路径（{@code ReferenceType.sourcePaths}），项目根之外的
 * 文件必须靠 classpath 才能定位。两个查询面刻意分开，调用方按序调用：
 * <ol>
 *   <li>{@link #findSource}：目录条目直查 + 依赖 jar 的同名 {@code -sources.jar}；</li>
 *   <li>（provider 自己负责）项目 / 模块根后缀遍历；</li>
 *   <li>{@link #findJdkSource}：JDK {@code $JAVA_HOME/lib/src.zip}。</li>
 * </ol>
 * JDK 一步排在最后：它是最"泛"的来源（仅靠文件名匹配），必须先让项目与依赖
 * 命中，否则同名文件会互相劫持。
 *
 * <p>命中后统一解压到 {@code ~/.neeko/java-src-cache/} 并返回该绝对路径 —— 前端
 * 只读通道（{@code dap_read_external_source}）按普通文件读取，无需理解 zip。
 * 缓存布局由本类唯一拥有，{@link #packageFromCachePath} 是「缓存路径 → 包名」的
 * 权威依据（全限定名推导依赖它）：
 * <ul>
 *   <li>依赖 jar：{@code <stem>/<pkg 段…>/<Name>.java}（stem = 条目 jar 名去 .jar）；</li>
 *   <li>JDK：{@code jdk-src-<ver>/<module>/<pkg 段…>/<Name>.java} —— 模块段刻意
 *       保留，前端据此把「调试打开的 JDK 源码」映射回 jdt 虚拟页身份
 *       （{@code jdt:/<module>/<pkg>/<Name>.java}），使同一个类只占一个 tab。</li>
 * </ul>
 *
 * <p>缓存规模：按「被调试到的类」增长（每个类一个几 KB 的文本文件，同名同版本
 * 幂等复用），不做主动淘汰 —— 量级由调试覆盖面而非运行时吞吐决定，远低于单机
 * 磁盘压力阈值；跨会话复用还省去重复解压。
 *
 * <p>线程安全：provider 可能被不同请求线程调用，缓存与解压均幂等（写入用临时
 * 文件 + 覆盖移动），无需加锁。
 */
final class ClasspathSources {

    /** 缓存目录名（相对 {@code ~/.neeko}，与 host jar 同根，见 build.sh）。 */
    static final String CACHE_DIR_NAME = "java-src-cache";

    /** 未命中缓存值：ConcurrentHashMap 不存 null。 */
    private static final String MISS = "";

    private static final String JAVA_SUFFIX = ".java";

    /** JDK 源码缓存 stem 前缀（布局含模块段，见 {@link #findJdkSource}）。 */
    private static final String JDK_STEM_PREFIX = "jdk-src-";

    private static final String CACHE_ROOT = defaultCacheRoot();
    private static final String CACHE_MARKER = "/" + CACHE_DIR_NAME + "/";

    private final List<Path> dirs;
    /**
     * 带同名 `-sources.jar` 的 classpath jar（源码 jar，stem → 路径）。
     *
     * <p>构造时一次性预筛：`locate` 会被每个栈帧调用，若在此逐个 jar 探测
     * `-sources.jar` 是否存在，上百个依赖就是上百次 stat × 帧数（实测数量级的
     * 无谓 IO）。Maven 本地仓库通常没有 sources 产物，预筛后该列表常态为空。
     */
    private final Map<String, Path> sourcesJars;
    private final Map<String, String> resolved = new ConcurrentHashMap<>();

    private ClasspathSources(List<Path> dirs, Map<String, Path> sourcesJars) {
        this.dirs = dirs;
        this.sourcesJars = sourcesJars;
    }

    /** 按 classpath 条目（目录 / jar 混排）建立解析器；不存在的条目忽略。 */
    static ClasspathSources of(List<String> entries) {
        List<Path> dirs = new ArrayList<>();
        Map<String, Path> sourcesJars = new LinkedHashMap<>();
        for (String entry : entries) {
            if (entry == null || entry.trim().isEmpty()) {
                continue;
            }
            Path path = Paths.get(entry.trim());
            if (Files.isDirectory(path)) {
                dirs.add(path);
                continue;
            }
            if (!isJar(path)) {
                continue;
            }
            String name = path.getFileName().toString();
            String stem = name.substring(0, name.length() - ".jar".length());
            Path sources = path.resolveSibling(stem + "-sources.jar");
            if (Files.isRegularFile(sources)) {
                sourcesJars.put(stem, sources);
            }
        }
        return new ClasspathSources(dirs, sourcesJars);
    }

    /** 包相对源码路径 → 绝对源码路径；未命中返回 {@code null}（结果按 rel 缓存）。 */
    String findSource(String rel) {
        if (rel == null || rel.isEmpty()) {
            return null;
        }
        String key = rel.startsWith("/") ? rel : "/" + rel;
        String cached = resolved.get(key);
        if (cached != null) {
            return cached.equals(MISS) ? null : cached;
        }
        String hit = locate(key.substring(1));
        resolved.put(key, hit == null ? MISS : hit);
        return hit;
    }

    private String locate(String rel) {
        for (Path dir : dirs) {
            Path candidate = dir.resolve(rel);
            if (Files.isRegularFile(candidate)) {
                return candidate.toString();
            }
        }
        for (Map.Entry<String, Path> sourceJar : sourcesJars.entrySet()) {
            String hit = extract(sourceJar.getValue(), rel, rel, sourceJar.getKey());
            if (hit != null) {
                return hit;
            }
        }
        return null;
    }

    /**
     * JDK 模块源码 {@code $JAVA_HOME/lib/src.zip}。
     *
     * <p>布局是 {@code <module>/<pkg 段…>/<Name>.java}，故只接受「剥掉首段 module 后
     * **精确等于** rel」的条目：早先用 {@code endsWith} 宽松后缀匹配，会让 src.zip 里
     * 17 个同名 {@code Main.java} 条目（如 {@code sun/security/tools/keytool}）把默认包
     * 项目类 {@code Main} 劫持成 JDK 文件（实测复现）。
     *
     * <p>调用方还应把本步排在**项目遍历之后**（provider 已如此），双保险。
     */
    String findJdkSource(String rel) {
        if (rel == null || rel.isEmpty()) {
            return null;
        }
        String entryName = jdkIndex().get(rel);
        if (entryName == null) {
            return null;
        }
        Path zip = Paths.get(System.getProperty("java.home", "."), "lib", "src.zip");
        if (!Files.isRegularFile(zip)) {
            return null;
        }
        String stem = "jdk-src-" + System.getProperty("java.version", "unknown");
        // 缓存路径**保留模块段**（`<stem>/<module>/<pkg 段…>/<Name>.java`，即 zip
        // 条目名本身）：前端据此把「调试打开的 JDK 源码」映射回用户 Cmd+Click
        // 打开的 jdt 虚拟页身份（`jdt:/<module>/<pkg 段…>/<Name>.java`），让同一个
        // 类只占一个 tab。
        return extract(zip, entryName, entryName, stem);
    }

    /**
     * src.zip 索引（rel → 条目名）：首次调用扫描一次（约 2.5 万条目），之后 O(1)。
     *
     * <p>逐次调用都开 {@code ZipFile} 会按帧数放大（32 帧 = 32 次中央目录解析），
     * 故建一次索引换掉重复打开；模块段在此剥离，索引值即「要取出的条目名」。
     */
    private volatile Map<String, String> jdkIndex;

    private Map<String, String> jdkIndex() {
        Map<String, String> index = jdkIndex;
        if (index != null) {
            return index;
        }
        synchronized (this) {
            if (jdkIndex == null) {
                jdkIndex = buildJdkIndex();
            }
            return jdkIndex;
        }
    }

    private static Map<String, String> buildJdkIndex() {
        Path zip = Paths.get(System.getProperty("java.home", "."), "lib", "src.zip");
        Map<String, String> index = new HashMap<>();
        if (!Files.isRegularFile(zip)) {
            return index;
        }
        try (ZipFile zf = new ZipFile(zip.toFile())) {
            for (Enumeration<? extends ZipEntry> entries = zf.entries(); entries.hasMoreElements(); ) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName();
                if (!name.endsWith(JAVA_SUFFIX)) {
                    continue;
                }
                // `<module>/<pkg…>/<Name>.java` → 去掉模块段；无模块段时原样。
                int firstSlash = name.indexOf('/');
                String rel = firstSlash < 0 ? name : name.substring(firstSlash + 1);
                if (!rel.isEmpty()) {
                    index.putIfAbsent(rel, name);
                }
            }
        } catch (IOException e) {
            return index; // 空索引 = 后续全部未命中
        }
        return index;
    }

    /**
     * 从 zip 的 {@code entryName} 取出内容，解压到 {@code <cache>/<stem>/<rel>}。
     * 已存在则直接复用（幂等）；写入经临时文件 + 覆盖移动（并发/中断不留半文件）。
     */
    private static String extract(Path zip, String entryName, String rel, String stem) {
        Path target = Paths.get(CACHE_ROOT, stem, rel);
        if (Files.isRegularFile(target)) {
            return target.toString();
        }
        try (ZipFile zf = new ZipFile(zip.toFile())) {
            ZipEntry entry = zf.getEntry(entryName);
            if (entry == null) {
                return null;
            }
            Path parent = target.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
            try (InputStream in = zf.getInputStream(entry)) {
                Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
            }
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            return target.toString();
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * 是否是本缓存的产物路径（{@code …/.neeko/java-src-cache/<stem>/<pkg>/<Name>.java}）。
     */
    static boolean isCachePath(String path) {
        return path != null && path.replace('\\', '/').contains(CACHE_MARKER);
    }

    /**
     * 缓存路径 → 包名；非缓存路径返回 {@code null}，默认包返回空串。
     *
     * <p>布局由 {@link #extract} 按 stem 分两种，均以「文件名之前的段序」定包名：
     * <ul>
     *   <li>依赖 jar：{@code <cache>/<jar-stem>/<pkg 段…>/<Name>.java}；</li>
     *   <li>JDK：{@code <cache>/jdk-src-<ver>/<module>/<pkg 段…>/<Name>.java}
     *       —— 模块段保留（见 {@link #findJdkSource}），推导包名时需先跳过。</li>
     * </ul>
     */
    static String packageFromCachePath(String path) {
        if (!isCachePath(path)) {
            return null;
        }
        String norm = path.replace('\\', '/');
        String rest = norm.substring(norm.indexOf(CACHE_MARKER) + CACHE_MARKER.length());
        int stemEnd = rest.indexOf('/');
        if (stemEnd < 0) {
            return null;
        }
        boolean jdkLayout = rest.startsWith(JDK_STEM_PREFIX);
        String afterStem = rest.substring(stemEnd + 1);
        if (jdkLayout) {
            int moduleEnd = afterStem.indexOf('/');
            if (moduleEnd < 0) {
                return null;
            }
            afterStem = afterStem.substring(moduleEnd + 1);
        }
        int pkgEnd = afterStem.lastIndexOf('/');
        return pkgEnd < 0 ? "" : afterStem.substring(0, pkgEnd).replace('/', '.');
    }

    private static boolean isJar(Path path) {
        return Files.isRegularFile(path) && path.getFileName().toString().endsWith(".jar");
    }

    private static String defaultCacheRoot() {
        String home = System.getProperty("user.home", ".");
        return Paths.get(home, ".neeko", CACHE_DIR_NAME).toAbsolutePath().normalize().toString();
    }
}
