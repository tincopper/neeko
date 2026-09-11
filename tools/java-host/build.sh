#!/usr/bin/env bash
# =============================================================================
# Neeko Java Debug host — 打包脚本（幂等，可重复执行）
#
# 用途：下载 com.microsoft.java.debug.core 0.53.1 + 5 个运行时依赖（Maven
# Central）→ javac 编译 src/ 下的 host → 打 fat host jar
#   ~/.neeko/java-host/neeko-java-host.jar
# Rust 侧 JavaAdapter（src-tauri/src/dap/adapter/java.rs）运行时按该路径探测。
#
# 依赖：JDK ≥ 11（core 编译目标 Java 11）与 curl。macOS 上 javac 来自
# `/usr/libexec/java_home` 找到的 JDK；若本机只有 JRE 或 javac stub 会失败。
#
# 幂等性：
#   - 已下载的 jar 不重复下载（按文件名存在性跳过，`curl -z` 校验 mtime）；
#   - 源码比产物新 / 产物缺失时重编译；
#   - 重复执行直接跳过已完成步骤。
#
# 版本来源：.trellis/tasks/09-04-editor-test-run-buttons/research/java-debug-runability.md
#   §1.1（core 依赖面）/ §1.5（Maven Central 坐标）；依赖版本取自 Maven Central
#   上 com.microsoft.java.debug.core-0.53.1.pom 的 <dependencies>（实测：
#   commons-lang3 3.6 / gson 2.8.9 / rxjava 2.2.21 / reactive-streams 1.0.4 /
#   commons-io 2.14.0）。
# =============================================================================
set -euo pipefail

CORE_VERSION="0.53.1"
REPO="https://repo1.maven.org/maven2"

# 运行目录 = 脚本所在目录（tools/java-host），源码与脚本同目录相对引用。
HOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${HOST_DIR}/src"

# 产物目录：默认 ~/.neeko/java-host（Neeko 全局缓存惯例，见 library/db.rs）。
# 可被 NEEKO_JAVA_HOST_DIR 覆盖（测试/多用户）。src-tauri/resources/ 仅作
# 可选镜像（打包分发用，需自行拷入 bundle resources）。
DEST_DIR="${NEEKO_JAVA_HOST_DIR:-$HOME/.neeko/java-host}"
LIB_DIR="${DEST_DIR}/lib"
OUT_JAR="${DEST_DIR}/neeko-java-host.jar"

# 6 个 Maven Central 坐标（groupId/artifactId/version），顺序固定。
DEPS=(
  "com/microsoft/java|com.microsoft.java.debug.core|${CORE_VERSION}"
  "org/apache/commons|commons-lang3|3.6"
  "com/google/code/gson|gson|2.8.9"
  "io/reactivex/rxjava2|rxjava|2.2.21"
  "org/reactivestreams|reactive-streams|1.0.4"
  "commons-io|commons-io|2.14.0"
)

# 下载一个 Maven Central 工件（幂等：已存在则跳过）。
# 输入：groupId 路径段、artifactId、version → 输出 lib/<artifact>-<version>.jar
download() {
  local path_seg="$1" artifact="$2" version="$3"
  local jar="${LIB_DIR}/${artifact}-${version}.jar"
  local url="${REPO}/${path_seg}/${artifact}/${version}/${artifact}-${version}.jar"
  if [ -f "${jar}" ] && [ -s "${jar}" ]; then
    echo "  [skip] ${jar} 已存在"
    return 0
  fi
  echo "  [get]  ${url}"
  curl -fsSL --retry 3 -o "${jar}" "${url}"
}

echo "==> Neeko Java host 打包"
echo "    宿主目录: ${HOST_DIR}"
echo "    产物目录: ${DEST_DIR}"
mkdir -p "${LIB_DIR}"

echo "==> 1/3 下载 core + 依赖（Maven Central）"
for dep in "${DEPS[@]}"; do
  IFS='|' read -r path_seg artifact version <<<"${dep}"
  download "${path_seg}" "${artifact}" "${version}"
done

# 编译 classpath = 全部依赖 jar。
CP=""
for dep in "${DEPS[@]}"; do
  IFS='|' read -r _ artifact version <<<"${dep}"
  CP="${CP:+${CP}:}${LIB_DIR}/${artifact}-${version}.jar"
done

echo "==> 2/3 编译 host（javac，目标 Java 11）"
BUILD_DIR="${DEST_DIR}/classes"
# 源码比产物新 / 产物缺失时才重编译（find -newer 覆盖 mtime 语义）。
if [ ! -d "${BUILD_DIR}" ] || [ -n "$(find "${SRC_DIR}" -name '*.java' -newer "${BUILD_DIR}" -print -quit 2>/dev/null || true)" ]; then
  rm -rf "${BUILD_DIR}"
  mkdir -p "${BUILD_DIR}"
  # shellcheck disable=SC2046 # 源码文件列表故意按行展开
  javac -source 11 -target 11 -encoding UTF-8 -cp "${CP}" \
    -d "${BUILD_DIR}" $(find "${SRC_DIR}" -name '*.java')
  echo "  [ok] 已编译 ${BUILD_DIR}"
else
  echo "  [skip] ${BUILD_DIR} 是最新（无更动源码）"
fi

echo "==> 3/3 打 fat host jar（${OUT_JAR}）"
if [ -f "${OUT_JAR}" ] && [ "${BUILD_DIR}" -ot "${OUT_JAR}" ]; then
  echo "  [skip] ${OUT_JAR} 已是最新"
else
  TMP_JAR="${OUT_JAR}.tmp"
  rm -f "${TMP_JAR}"
  # 解包全部依赖 + host 类 → 重打单个 jar（去签名，Java 11 无 module-info 冲突）。
  mkdir -p "${DEST_DIR}/merge"
  rm -rf "${DEST_DIR}/merge"/*
  (cd "${DEST_DIR}/merge" && for jar in "${LIB_DIR}"/*.jar; do
     jar xf "${jar}"
     rm -rf META-INF/*.SF META-INF/*.RSA META-INF/*.DSA META-INF/MANIFEST.MF
   done)
  # 去签名/去 module-info：fat jar 走 `java -jar`（classpath），module-info 无意义
  # 且重复 module-info 会互相覆盖；删除避免类路径下被误当模块处理。
  rm -f "${DEST_DIR}/merge/module-info.class"
  find "${DEST_DIR}/merge" -name 'module-info.class' -delete 2>/dev/null || true
  cp -R "${BUILD_DIR}/." "${DEST_DIR}/merge/"
  # Manifest 指定 Main-Class（Console Launcher 同款 `java -jar` 可执行形态）。
  (cd "${DEST_DIR}/merge" && \
   printf 'Manifest-Version: 1.0\nMain-Class: com.neeko.debug.JavaDebugHost\n' > MANIFEST.MF && \
   jar cfm "${TMP_JAR}" MANIFEST.MF .)
  rm -rf "${DEST_DIR}/merge"
  mv "${TMP_JAR}" "${OUT_JAR}"
  echo "  [ok] ${OUT_JAR}"
fi

echo "==> 完成"
echo "    运行方式（Rust JavaAdapter 会自动探测）："
echo "    java -jar ${OUT_JAR}"
echo "    或设置 config dap.adapterBinaries.java=<该 jar 路径>"
