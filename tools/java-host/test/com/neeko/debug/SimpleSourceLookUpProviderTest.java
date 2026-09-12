package com.neeko.debug;

import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import com.microsoft.java.debug.core.adapter.IDebugAdapterContext;

/**
 * {@link SimpleSourceLookUpProvider} / {@link ClasspathSources} 的行为测试。
 *
 * <p>host 无测试框架（无 JUnit 依赖，刻意不加），用单文件 main + 断言 + 退出码：
 * `bash tools/java-host/build.sh` 编译完 host 后自动编译并运行本测试，失败即
 * 构建失败。覆盖解析顺序（项目遍历 / classpath 直查 / `-sources.jar` /
 * JDK `src.zip`）、未命中的 `""` 契约、以及断点 FQN 推导的路径形态。
 */
public final class SimpleSourceLookUpProviderTest {

    private static int failures = 0;
    private static Path work;
    private static final String PROJECT = "proj";
    private static final String LIB_JAR_NAME = "demo-lib-1.0.jar";

    public static void main(String[] args) throws Exception {
        work = Files.createTempDirectory("neeko-java-host-test");
        try {
            run();
        } finally {
            deleteRecursively(work);
        }
        if (failures > 0) {
            System.out.println("java-host tests FAILED: " + failures);
            System.exit(1);
        }
        System.out.println("java-host tests OK");
    }

    private static void run() throws Exception {
        Path project = work.resolve(PROJECT);
        Path pkgDir = project.resolve("src/main/java/com/demo");
        Files.createDirectories(pkgDir);
        Files.writeString(pkgDir.resolve("Direct.java"), "package com.demo; class Direct {}");

        // 默认包类 Main：src.zip 里有 17 个 `*/Main.java`（sun/security/tools/keytool/
        // Main.java 等），是「JDK 源码劫持项目类」的回归样本。
        Path defaultPkgDir = project.resolve("src");
        Files.createDirectories(defaultPkgDir);
        Files.writeString(defaultPkgDir.resolve("Main.java"), "class Main {}");

        Path libDir = work.resolve("lib");
        Files.createDirectories(libDir);
        Path sourcesSrc = work.resolve("src/com/demo");
        Files.createDirectories(sourcesSrc);
        Files.writeString(sourcesSrc.resolve("Foo.java"), "package com.demo; class Foo {}");
        Path libJar = libDir.resolve(LIB_JAR_NAME);
        Files.write(libJar, new byte[0]);
        Path sourcesJar = libDir.resolve("demo-lib-1.0-sources.jar");
        zipSources(sourcesSrc, sourcesJar);

        SimpleSourceLookUpProvider provider = new SimpleSourceLookUpProvider();
        // sourcePaths 契约：第 1 条 = 项目根，其后 = classpath 条目（Rust JavaAdapter）。
        provider.initialize(
                fakeContext(Arrays.asList(
                        project.toString(),
                        project.resolve("target/classes").toString(),
                        project.resolve("target/test-classes").toString(),
                        libJar.toString())),
                Collections.emptyMap());

        String directSrc = pkgDir.resolve("Direct.java").toString();
        // 项目内源码：classpath 直查不中 → 项目根后缀遍历命中
        eq("project.viaWalk", provider.getSourceFileURI("com.demo.Direct", "com/demo/Direct.java"), directSrc);
        // sourcePath 为 null（无 SourceFile 属性）→ 按 FQN 推导 rel，仍命中
        eq("project.byFqn", provider.getSourceFileURI("com.demo.Direct", null), directSrc);
        // 内层类 com.demo.Foo$Bar + sourcePath=null → 取顶层文件名 Foo.java
        String nested = provider.getSourceFileURI("com.demo.Foo$Bar", null);
        ok("dep.nestedClass", nested != null && nested.endsWith("/demo-lib-1.0/com/demo/Foo.java"), nested);
        // 依赖 jar 的 -sources.jar → 解压到 java-src-cache（缓存 stem = classpath 条目名）
        String dep = provider.getSourceFileURI("com.demo.Foo", "com/demo/Foo.java");
        ok("dep.sourcesJar", dep != null && dep.contains(ClasspathSources.CACHE_DIR_NAME)
                && dep.endsWith("/com/demo/Foo.java") && Files.readString(Paths.get(dep)).contains("class Foo"), dep);
        // JDK 类 → $JAVA_HOME/lib/src.zip（模块段剥离）
        String jdk = provider.getSourceFileURI("java.lang.String", "java/lang/String.java");
        // 缓存路径保留模块段（`jdk-src-<ver>/java.base/java/lang/String.java`）：前端据此
        // 映射回 jdt 虚拟页身份，避免同一个类开两个 tab。
        ok("jdk.srcZip", jdk != null && jdk.contains("/jdk-src-")
                && jdk.endsWith("/java.base/java/lang/String.java")
                && Files.readString(Paths.get(jdk)).contains("class String"), jdk);
        // 包名推导需跳过模块段
        eq("jdk.cachePackage", ClasspathSources.packageFromCachePath(jdk), "java.lang");
        eq("fqn.jdkCachePath", SimpleSourceLookUpProvider.resolveClassName(jdk), "java.lang.String");

        // 默认包项目类不得被 src.zip 的同名文件劫持（JDK 查询排在项目遍历之后 +
        // 严格「剥模块段后精确匹配」双保险）
        String mainSrc = provider.getSourceFileURI("Main", "Main.java");
        ok("project.defaultPackageNotHijacked",
                mainSrc != null && mainSrc.equals(defaultPkgDir.resolve("Main.java").toString())
                        && !mainSrc.contains(ClasspathSources.CACHE_DIR_NAME),
                mainSrc);
        // 严格匹配：`<module>/Main.java` 这种「仅同名、无包段」的 src.zip 条目不得命中
        // （直接测解析器，隔离 provider 的项目遍历，避免被项目里的 src/Main.java 掩盖）。
        ClasspathSources jdkOnly = ClasspathSources.of(Collections.emptyList());
        eq("jdk.nameOnlyNoMatch", jdkOnly.findJdkSource("Main.java"), null);
        eq("jdk.deepNameOnlyNoMatch", jdkOnly.findJdkSource("tools/keytool/Main.java"), null);
        // 正确形态（rel 含包段）：剥掉模块段后精确相等 → 命中
        String jdkModule = jdkOnly.findJdkSource("java/lang/String.java");
        ok("jdk.modulePrefixMatch",
                jdkModule != null && jdkModule.contains("/jdk-src-")
                        && jdkModule.endsWith("/java.base/java/lang/String.java"),
                jdkModule);
        // JDK 通道本身仍要工作（严格匹配允许 `<module>/<rel>`）
        String jdkStrict = provider.getSourceFileURI("java.lang.String", "java/lang/String.java");
        ok("jdk.strictModuleMatch",
                jdkStrict != null && jdkStrict.contains("/jdk-src-")
                        && jdkStrict.endsWith("/java.base/java/lang/String.java"),
                jdkStrict);

        // 未命中必须返回 ""：禁止包相对假路径（前端会拼到项目根上打开错文件）
        eq("miss.returnsEmpty", provider.getSourceFileURI("com.absent.Nope", "com/absent/Nope.java"), "");
        eq("miss.returnsEmptyByFqn", provider.getSourceFileURI("com.absent.Nope", null), "");
        // 非 .java 的 sourcePath / 空输入同样不产出路径
        eq("nonJava.sourcePath", provider.getSourceFileURI("com.demo.Direct", "com/demo/Direct.class"), "");
        eq("empty.inputs", provider.getSourceFileURI("", null), "");

        // 断点 FQN 推导（getBreakpointLocations 的关键路径）
        eq("fqn.cachePath", SimpleSourceLookUpProvider.resolveClassName(dep), "com.demo.Foo");
        eq("fqn.jdtPath", SimpleSourceLookUpProvider.resolveClassName("jdt:/java.base/java/lang/String.java"),
                "java.lang.String");
        eq("fqn.jdtDefaultPackage", SimpleSourceLookUpProvider.resolveClassName("jdt:/m/System.java"), "System");
        eq("fqn.srcTestMarker",
                SimpleSourceLookUpProvider.resolveClassName(project + "/src/test/java/com/demo/DirectTest.java"),
                "com.demo.DirectTest");
        eq("fqn.nonJava", SimpleSourceLookUpProvider.resolveClassName("/proj/Foo.class"), null);
        eq("fqn.null", SimpleSourceLookUpProvider.resolveClassName(null), null);
    }

    /** 最小 zip（含一个 .java 条目），避免引入 commons-compress 之外的依赖。 */
    private static void zipSources(Path root, Path jar) throws Exception {
        try (java.util.zip.ZipOutputStream out =
                new java.util.zip.ZipOutputStream(Files.newOutputStream(jar))) {
            Path file = root.resolve("Foo.java");
            out.putNextEntry(new java.util.zip.ZipEntry("com/demo/Foo.java"));
            out.write(Files.readAllBytes(file));
            out.closeEntry();
        }
    }

    /** 仅实现 getSourcePaths（provider 唯一消费的 context 方法），其余返回默认值。 */
    private static IDebugAdapterContext fakeContext(final List<String> sourcePaths) {
        return (IDebugAdapterContext) Proxy.newProxyInstance(
                SimpleSourceLookUpProviderTest.class.getClassLoader(),
                new Class<?>[] {IDebugAdapterContext.class},
                (proxy, method, args) -> {
                    if ("getSourcePaths".equals(method.getName())) {
                        return sourcePaths.toArray(new String[0]);
                    }
                    Class<?> returnType = method.getReturnType();
                    if (returnType == boolean.class) {
                        return false;
                    }
                    if (returnType == int.class) {
                        return 0;
                    }
                    if (returnType == long.class) {
                        return 0L;
                    }
                    return null;
                });
    }

    private static void eq(String label, Object actual, Object expected) {
        ok(label, expected == null ? actual == null : expected.equals(actual),
                "actual=[" + actual + "] expected=[" + expected + "]");
    }

    private static void ok(String label, boolean pass, String detail) {
        if (pass) {
            System.out.println("  [ok]   " + label);
        } else {
            failures++;
            System.out.println("  [FAIL] " + label + " :: " + detail);
        }
    }

    private static void deleteRecursively(Path root) throws Exception {
        if (!Files.exists(root)) {
            return;
        }
        try (java.util.stream.Stream<Path> stream = Files.walk(root)) {
            for (Path path : stream.sorted(java.util.Comparator.reverseOrder()).toArray(Path[]::new)) {
                Files.deleteIfExists(path);
            }
        }
    }
}
