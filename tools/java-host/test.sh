#!/usr/bin/env bash
# =============================================================================
# Neeko Java host 自检（无框架 main 断言）
#
# 校验 `src/com/neeko/debug` 的纯逻辑：源码解析顺序（项目遍历 / classpath /
# `-sources.jar` / JDK src.zip）、缓存布局与包名推导、全限定类名（断点 FQN）。
#
# 单一实现、两处复用：
#   - `build.sh` 打包前调用（此时必然能真正执行）；
#   - `pnpm lint` 经 `lint:host` 调用（日常门禁，防止 host 逻辑无护栏）。
#
# 跳过策略（exit 0 + 明确提示，绝不误报为失败）：
#   - Windows POSIX shell（Git Bash/MSYS/CYGWIN）→ 平台门控，见下
#   - 无 javac/java        → 本机无 JDK
#   - host 未编译/依赖缺失 → 尚未 `bash tools/java-host/build.sh`
# 需要「真正把关」时（CI / 本地完整验证）：先跑 `bash tools/java-host/build.sh`。
#
# 依赖：bash + JDK >= 11（与 `lint` 中既有的 `python3` 守卫同属 POSIX 工具链假设；
# CI 的 java-host-check job 在 ubuntu 上跑）。
# =============================================================================
set -euo pipefail

# 平台门控：本脚本与 build.sh 同为 POSIX 构建脚本（classpath 分隔符写死 ':'）。
# Windows 的 Git Bash / MSYS 下 JVM 要求 ';'、且 $HOME 是 POSIX 形态路径 —— 直接
# 跳过，而不是给出误导性的失败。host 是纯 Java，Windows 项目的调试走 WSL/Linux
# 侧运行，故由 CI（ubuntu）+ macOS/Linux 开发机覆盖即可。
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW* | MSYS* | CYGWIN*)
    echo "[java-host] skip: self-check script is POSIX-only (host runs on WSL/Linux side, covered by CI ubuntu)"
    exit 0
    ;;
esac

HOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${NEEKO_JAVA_HOST_DIR:-$HOME/.neeko/java-host}"
LIB_DIR="${DEST_DIR}/lib"
BUILD_DIR="${DEST_DIR}/classes"
TEST_DIR="${HOST_DIR}/test"
TEST_BUILD_DIR="${DEST_DIR}/test-classes"

if ! command -v javac >/dev/null 2>&1 || ! command -v java >/dev/null 2>&1; then
  echo "[java-host] skip: javac/java not found (requires JDK >= 11); retry after installing a JDK"
  exit 0
fi

if [ ! -d "${BUILD_DIR}" ] || [ -z "$(ls -A "${BUILD_DIR}" 2>/dev/null)" ]; then
  echo "[java-host] skip: host not compiled (run bash tools/java-host/build.sh first)"
  exit 0
fi

if [ ! -d "${LIB_DIR}" ] || [ -z "$(ls -A "${LIB_DIR}" 2>/dev/null)" ]; then
  echo "[java-host] skip: dependencies missing (run bash tools/java-host/build.sh first)"
  exit 0
fi

# 编译 classpath = 全部依赖 jar。
CP=""
for jar in "${LIB_DIR}"/*.jar; do
  CP="${CP:+${CP}:}${jar}"
done

rm -rf "${TEST_BUILD_DIR}"
mkdir -p "${TEST_BUILD_DIR}"
# shellcheck disable=SC2046 # 源码文件列表故意按行展开
javac -nowarn -source 11 -target 11 -encoding UTF-8 -cp "${BUILD_DIR}:${CP}" \
  -d "${TEST_BUILD_DIR}" $(find "${TEST_DIR}" -name '*.java')
java -cp "${TEST_BUILD_DIR}:${BUILD_DIR}:${CP}" com.neeko.debug.SimpleSourceLookUpProviderTest
