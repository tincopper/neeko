/**
 * Go run/Debug 命令构造（纯函数；`go test` / `go build` 语义与 `-run` 层级锚定）。
 *
 * 从 `utils/testCommands.ts` 迁入（方案 B 阶段 2）：包目录由调用方（`./pkg.ts` 经 IO 探测）
 * 传入，命令构造只吃已解析事实（旧共享 `RunContext` 袋已消失）。
 */
import { shQuote } from '../../exec/shell';
import type { TestCaseInfo } from '../../syntax/contract';

/** Go 正则元字符（RE2 语法）—— 段内出现任一即需 `\Q…\E` 原样引用。 */
const GO_PATTERN_META = /[\\^$.|?*+()[\]{}]/;

/** 单个 `-run` 层级段锚定：裸标识符 → `^Name$`；含元字符 → `^\QName\E$`。 */
function anchorGoPatternSegment(segment: string): string {
  return GO_PATTERN_META.test(segment) ? `^\\Q${segment}\\E$` : `^${segment}$`;
}

/**
 * Go `-run` / `-test.run` 的**层级锚定模式**（GoLand 同款 `^\QTestAdd\E$/^\Qsub\E$`）。
 *
 * Go 的 `-run` 语义：先按 `/` 切分层级，再**逐层做正则匹配**（每层独立锚定）。`t.Run`
 * 的子测试名是任意字符串（可含 `.` `+` `|` 等元字符）—— 实测未引用时 `^a+b$` 匹配不到
 * 字面量 `a+b`，故含元字符的段必须 `\Q…\E` 原样引用。顶层用例名是 Go 标识符
 * （`[A-Za-z0-9_]`，无元字符），走 `^Name$`，与既有命令形态**逐字节一致**。
 *
 * Run（`-run`）与 Debug（delve `-test.run`）共用本函数，避免两条链路各自拼装而漂移
 * （同 Rust `languageSyntax` 单一事实源的教训）。已知边界（与 GoLand 同）：名字段若
 * 字面含 `\E` 会提前结束引用（未处理，实际用例名不可能出现）。
 */
export function goTestRunPattern(name: string): string {
  return name.split('/').map(anchorGoPatternSegment).join('/');
}

/** Go：`-run` 锚定 `^Name$`（子串命中会多跑；debug 0 命中则断点永不触发）。 */
export function buildGoRunCommand(testCase: TestCaseInfo, goPkg: string): string {
  const pkg = shQuote(goPkg);
  const runPattern = shQuote(goTestRunPattern(testCase.name));
  // 基准：`-run '^$'` 关掉用例、`-bench` 锚定基准名、`-count=1` **禁缓存** ——
  // 缓存命中时 go 只回包级事件（无 benchmark 输出/`run` 事件），会被「零命中告警」误判。
  if (testCase.variant === 'benchmark') {
    return `go test -run ${shQuote('^$')} -bench ${runPattern} -count=1 -json ${pkg}`;
  }
  return `go test -run ${runPattern} -json ${pkg}`;
}

export function buildGoMainRunCommand(goPkg: string): string {
  return `go run ${shQuote(goPkg || '.')}`;
}

/** FNV-1a 32 位（8 位 hex）—— 仅作产物文件名去重，非安全用途。 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Go Debug 前置构建产物相对路径（cwd 相对，gitignored `.neeko/` 下）。
 * `go test -c -o` 会自建父目录；产物路径显式（`-o`），启动时按此解析，无 compiler-artifact。
 *
 * `name` 可能是**子测试全名**（P3 动态子测试，`<父>/<层级>`）而 `t.Run` 的名字是任意字符串 →
 * 不能直接当文件名：
 * - `/` 会让产物落到嵌套目录（实测 go 自建父目录、能编译，但把 `.neeko/test-bin` 撑成树）；
 * - Windows 保留字符 `: * ? " < > |` 会让 `-o` 直接失败（本机 macOS/Linux 合法，故本地开发
 *   不暴露、跨平台才炸）。
 *
 * 策略：不安全字符 → `_`；**仅当发生过替换**时追加原名哈希后缀 —— 否则 `TestTable/zero` 与
 * `TestTable_zero` 会清洗成同一个文件名，后者构建覆盖前者的二进制，调试时挂错 target。
 * 顶层用例名是 Go 标识符（无替换）→ 产物名与既有 `.neeko/test-bin/<name>` **逐字节一致**。
 */
export function goDebugBinaryRelPath(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe === name ? `.neeko/test-bin/${name}` : `.neeko/test-bin/${safe}-${shortHash(name)}`;
}

export function buildGoMainDebugBuildCommand(goPkg: string): string {
  const outRel = goDebugBinaryRelPath('main');
  return `go build -o ${shQuote(outRel)} -gcflags ${shQuote('all=-N -l')} ${shQuote(goPkg || '.')}`;
}

/**
 * Go Debug 前置构建命令（delve `pkg/gobuild` 的公开常量，GoLand/Zed mode:exec 一字不差复用）：
 * `go test -c -o <out> -gcflags all=-N -l <pkg>`。
 * `-gcflags all=-N -l` 无优化构建是断点/变量正确性前提（delve#4165）；`-o` 显式产物路径，
 * 比 Rust 的 compiler-artifact 解析更简单（解析 `<out>` 即可）。`<pkg>` 为测试文件所属
 * 包目录（cwd 相对 `./dir` / `.`）。
 */
export function buildGoDebugBuildCommand(pkgDir: string, outRelPath: string): string {
  // `-gcflags` 的值 `all=-N -l` 必须是单个 argv token（delve gobuild 的 `-gcflags=all=-N -l`
  // 是代码内 argv，落到 shell 命令必须引号成 `-gcflags 'all=-N -l'`）——写成
  // `-gcflags=all=-N -l` / `-gcflags all=-N -l` 会让 go 把 `-l` 解析成独立 flag 报错
  // （"unknown flag -l cannot be used with -c"）。
  return `go test -c -o ${shQuote(outRelPath)} -gcflags ${shQuote('all=-N -l')} ${shQuote(pkgDir)}`;
}
