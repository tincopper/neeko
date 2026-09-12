/**
 * 文件身份的唯一所有权模块 —— 边界解析 → canonical 表示 → 身份比较。
 *
 * 所有「是不是同一个文件」的判定只允许在 `FileRef` 形态上进行（`sameFile`）；
 * 调用方不得自行发明字符串归一（正则/startsWith 拼 root 等）。本模块仅有的
 * 三处形态换算边界：
 * - `canonicalFsPath`：tab/项目相对路径 → canonical fs path（lexical only）；
 * - `relativeToRoot`：canonical fs path → root 下相对路径（展示用，非身份比较）；
 * - `fileRefFromLspUri`：LSP uri（file:// / jdt://）→ FileRef。
 *
 * `..` 不在词法层解析（lexical only）——后端读取前的 canonicalize 是安全兜底。
 * jdt 文法解析是本模块唯一正则（`file://` 交给浏览器原生 `new URL`）。
 * 零依赖：不 import store / api / 任何项目模块，纯函数。
 */

/** canonical fs 路径：只由本模块边界函数产出（branded，防裸字符串混入比较）。 */
export type CanonicalPath = string & { readonly __brand: 'canonical' };

/** 文件身份：fs 路径，或 jdt 类文件（module + 包路径 + 文件名）。 */
export type FileRef =
  | { kind: 'fs'; path: CanonicalPath }
  // classPath：包路径，源 uri 的点分包已转斜杠（`java.lang` → `java/lang`）；
  // fileName：扩展名 canonical 为 `.java`（.class 反编译与 .java 带源码是
  // 同一类的两种载体，身份统一取 .java 形态，与 jdt 展示路径一致）。
  | { kind: 'jdt'; module: string; classPath: string; fileName: string };

// ── jdt 文法（本模块唯一正则）───────────────────────────────────────────────

/**
 * `<module>/` 之后的类路径文法：`<pkg 段…>/<Name>.<ext>`。
 * g1 = 包目录（点分或斜杠分段，可缺省），g2 = 类名，g3 = 扩展名（不含点/斜杠）。
 * 贪婪回溯语义：包目录吃到最后一个 `/`，类名/扩展名在末段按最后一个 `.` 切分
 * ——与旧 `jdtClassDisplayPath` 正则 `^jdt://contents/([^/]+)/(.+)\.[^.]+$`
 * 在合法输入上等价；扩展名额外排除 `/`，使「包段带点、末段无扩展名」的
 * 退化输入（如 `a.b/c`）被判为不匹配而非误切。
 */
const JDT_CLASS_PATH_RE = /^(?:(.+)\/)?([^/]+)\.([^./]+)$/;

const JDT_URI_PREFIX = 'jdt://contents/';
const JDT_DISPLAY_PREFIX = 'jdt:/';
const FILE_SCHEME = 'file:';

// ── 字符工具（正则禁用约束：模块内唯一正则留给 jdt 文法）────────────────────

function isAsciiLetter(c: string): boolean {
  const code = c.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** 盘符开头判定（`C:` / `c:`），用于区分相对路径与 Windows 绝对路径。 */
function isDriveStart(s: string): boolean {
  return s.length >= 2 && s.charCodeAt(1) === 58 /* ':' */ && isAsciiLetter(s[0]);
}

/** 压缩连续斜杠、去尾斜杠；绝对路径保留单个前导斜杠；UNC `//host` 前缀保留（host 不得静默丢弃）。 */
function normalizeSlashes(s: string): string {
  const unc = s.startsWith('//');
  const absolute = s.startsWith('/');
  const segments = s.split('/').filter((seg) => seg.length > 0);
  const joined = segments.join('/');
  if (unc) return `//${joined}`;
  return absolute ? `/${joined}` : joined;
}

// ── 边界解析 ────────────────────────────────────────────────────────────────

/**
 * fs 路径边界归一：反斜杠→斜杠；相对路径（非 `/` 或盘符开头）拼 `projectRoot`
 * （root 去尾斜杠）；绝对路径原样。结果消除连续斜杠与尾斜杠。
 *
 * lexical only：不解析 `..`——后端 `read_file_content` 消费前有 canonicalize
 * 安全校验兜底，前端不做路径穿越判定。
 */
export function canonicalFsPath(projectRoot: string, p: string): CanonicalPath {
  const unified = p.replaceAll('\\', '/');
  if (unified.startsWith('/') || isDriveStart(unified)) {
    return normalizeSlashes(unified) as CanonicalPath;
  }
  const root = normalizeSlashes(projectRoot.replaceAll('\\', '/'));
  const rel = normalizeSlashes(unified);
  if (rel === '') return root as CanonicalPath;
  return (root ? `${root}/${rel}` : rel) as CanonicalPath;
}

/**
 * 展示用剥根：canonical fs path 在 `root` 下时剥去前缀返回相对路径，否则原样。
 * 与 `canonicalFsPath` 拼根互逆（root 下绝对路径恒有
 * `canonicalFsPath(root, relativeToRoot(root, p)) === p`）。仅供消费方语义需要
 * 相对形态的展示/匹配场景（文件树定位、agent 消息可读性）——身份判定一律走
 * `sameFile`，不得用本函数的输出做相等比较。
 */
export function relativeToRoot(root: string, p: string): string {
  const unified = p.replaceAll('\\', '/');
  const r = normalizeSlashes(root.replaceAll('\\', '/'));
  if (r === '') return unified;
  const prefix = `${r}/`;
  return unified.startsWith(prefix) ? unified.slice(prefix.length) : unified;
}

interface JdtParts {
  module: string;
  classPath: string;
  fileName: string;
}

/**
 * 解析 `<module>/<pkg 段…>/<Name>.<ext>`（前缀与 query 已由调用方剥离）。
 * 包点转斜杠；fileName 扩展名归一为 `.java`。结构不完整返回 null。
 */
function parseJdtClassPath(moduleAndRest: string): JdtParts | null {
  const slash = moduleAndRest.indexOf('/');
  if (slash <= 0) return null; // 缺 module 或缺类段
  const m = JDT_CLASS_PATH_RE.exec(moduleAndRest.slice(slash + 1));
  if (!m) return null;
  return {
    module: moduleAndRest.slice(0, slash),
    classPath: (m[1] ?? '').replaceAll('.', '/'),
    fileName: `${m[2]}.java`,
  };
}

/**
 * LSP uri → FileRef（jdtls / rust-analyzer 等 definition 目标的唯一入口）。
 *
 * - `jdt://contents/<module>/<pkg(. 分隔)…>/<Name>.<ext>?<query 忽略>`
 *   → `{ kind: 'jdt', module, classPath: 'java/io', fileName: 'PrintStream.java' }`；
 * - `file://…` → `new URL` 解析（浏览器原生管编码/盘符），pathname 逐段
 *   decodeURIComponent（`%2F` 不产生假分隔符）；Windows host 空 + pathname
 *   `/C:/…` 前缀去前导斜杠；非 localhost host 视为 UNC 保留 `//host` 前缀；
 * - 其余 scheme / 非法 uri / jdt 结构不完整 → null。
 */
export function fileRefFromLspUri(uri: string): FileRef | null {
  if (uri.startsWith(JDT_URI_PREFIX)) {
    const pathOnly = uri.slice(JDT_URI_PREFIX.length).split('?')[0] ?? '';
    const jdt = parseJdtClassPath(pathOnly);
    return jdt ? { kind: 'jdt', ...jdt } : null;
  }
  if (!uri.startsWith(FILE_SCHEME)) return null;
  try {
    const url = new URL(uri);
    const segments = url.pathname
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .filter((seg) => seg.length > 0);
    let path = `/${segments.join('/')}`;
    if (url.host && url.host !== 'localhost') {
      path = `//${url.host}${path}`; // UNC：host 不能静默丢弃
    } else if (url.host === '' && path.length >= 3 && path[2] === ':' && isAsciiLetter(path[1])) {
      path = path.slice(1); // Windows 盘符形态：/C:/… → C:/…
    }
    return { kind: 'fs', path: path as CanonicalPath };
  } catch {
    return null;
  }
}

/**
 * tab 存储路径 → FileRef（tab.filePath 的唯一入口）。
 * `jdt:/` 前缀为 jdt 展示路径（`tabIdentityOf` 的产出形态），反解析回 jdt ref；
 * 其余（含空串）走 fs canonical。非本模块产出的 `jdt:` 形态按不透明路径兜底，
 * 保持全函数。
 */
export function fileRefFromTabPath(projectRoot: string, p: string): FileRef {
  if (p.startsWith(JDT_DISPLAY_PREFIX)) {
    const jdt = parseJdtClassPath(p.slice(JDT_DISPLAY_PREFIX.length));
    if (jdt) return { kind: 'jdt', ...jdt };
  }
  return { kind: 'fs', path: canonicalFsPath(projectRoot, p) };
}

// ── 身份操作 ────────────────────────────────────────────────────────────────

/**
 * tab 身份字符串：fs → canonical path；jdt → `jdt:/${module}/${classPath}/${fileName}`
 * （无包段不留双斜杠）。与旧 `jdtClassDisplayPath` 输出逐字一致。
 */
export function tabIdentityOf(ref: FileRef): string {
  if (ref.kind === 'fs') return ref.path;
  return ref.classPath
    ? `jdt:/${ref.module}/${ref.classPath}/${ref.fileName}`
    : `jdt:/${ref.module}/${ref.fileName}`;
}

/**
 * **源码身份的唯一边界**：把任意「源引用」归一到规范 tab 身份。
 *
 * 同一份源码只允许有一种身份 —— tab、断点 key、黄线、导航历史全部以它为准，
 * 因此不在消费侧做别名匹配（那只是把重复身份藏起来，断点仍会两套 key）。
 *
 * 归一规则：
 * - JDK 解压缓存路径（`…/java-src-cache/jdk-src-<ver>/<module>/<pkg>/<Name>.java`）
 *   → `jdt:/<module>/<pkg>/<Name>.java`：与「Cmd+Click 打开的 jdt 虚拟页」同一身份
 *   （两者是同一份 src.zip 源码的两种表示）；
 * - jdt 展示路径 → 原样（`tabIdentityOf` 幂等）；
 * - 其余 → canonical 绝对路径。
 *
 * **限制（刻意保留，非疏漏）**：这里选择的是「**表示形式**」中最通用的一种做规范
 * 身份，而不是「它代表的东西」（`java.io.PrintStream` 这个类）。理论最优是后者 ——
 * 内容由「谁持有这份源码」按表示提供、完全不需要解析任何路径布局。之所以没做：
 * DAP 的 `Source` 只有 `path`，没有类名字段（我们的 host 能算出 FQN，但塞不进
 * java-debug 的 `Source` 结构）。要升级需新增 host↔Rust 协议面，收益/代价不划算。
 * 因此当前是**当前协议约束下的最优**；若将来协议能带类名，本函数应随之收敛为
 * 「类身份」。
 *
 * **禁止对 jdt 形态调用 `canonicalFsPath`**：`jdt:/…` 不以 `/` 开头，会被当相对
 * 路径拼上项目根，得到 `<root>/jdt:/…` 这种不存在的路径；而 adapter 侧要靠
 * `jdt:/` 前缀解析出 module/pkg 段推全限定类名 —— 拼根后前缀消失，断点退化成
 * 默认包类名，永远 `verified: false`（表现为「在库源码里打了断点却停不下来」）。
 *
 * 注：无模块段的 src.zip（JDK ≤ 8）与依赖 jar 的 `-sources.jar` 解压产物没有
 * 等价的 jdt 身份，退化为 canonical 路径身份 —— 只是不复用，不影响正确性。
 */
export function sourceIdentityOf(projectRoot: string, p: string): string {
  const jdtIdentity = jdtIdentityOfJdkCachePath(p);
  if (jdtIdentity) return jdtIdentity;
  return tabIdentityOf(fileRefFromTabPath(projectRoot, p));
}

/**
 * JDK 源码解压缓存标记（host `ClasspathSources` 产出：
 * `…/java-src-cache/jdk-src-<ver>/<module>/<pkg 段…>/<Name>.java`）。
 *
 * 这是**跨语言契约**：host 刻意保留模块段就是为让前端能还原 jdt 身份。两侧各有
 * 测试锁定（host `SimpleSourceLookUpProviderTest` / 本模块 `fileRef.test.ts`）。
 */
const JDK_CACHE_MARKER = '/java-src-cache/jdk-src-';

/**
 * JDK 解压缓存路径 → jdt 身份；非 JDK 缓存路径返回 null。
 *
 * 实现细节，只服务 {@link sourceIdentityOf}：缓存布局解析不对外暴露，避免调用方
 * 各自反解 host 布局（那会把「布局知识」散布到多个 feature）。
 */
function jdtIdentityOfJdkCachePath(p: string): string | null {
  const norm = p.replaceAll('\\', '/');
  const marker = norm.indexOf(JDK_CACHE_MARKER);
  if (marker < 0) return null;
  const afterMarker = norm.slice(marker + JDK_CACHE_MARKER.length);
  const versionEnd = afterMarker.indexOf('/');
  if (versionEnd < 0) return null;
  const jdt = parseJdtClassPath(afterMarker.slice(versionEnd + 1));
  return jdt ? tabIdentityOf({ kind: 'jdt', ...jdt }) : null;
}

/**
 * LSP 文档 uri 推导：fs → `file://${path}`；jdt 需原始 query 才能重建，
 * `jdtQuery` 缺省返回 null。注意 jdt 身份的扩展名已 canonical 为 `.java`，
 * 反编译类（`.class` 源）的原始 uri 无法从 ref 逐字重建——需要原始 uri 时
 * 必须由 tab 的 `virtualUri` 携带，不经此函数。
 */
export function lspUriOf(ref: FileRef, opts?: { jdtQuery?: string }): string | null {
  if (ref.kind === 'fs') return `file://${ref.path}`;
  const query = opts?.jdtQuery;
  if (query === undefined) return null;
  return ref.classPath
    ? `jdt://contents/${ref.module}/${ref.classPath.replaceAll('/', '.')}/${ref.fileName}?${query}`
    : `jdt://contents/${ref.module}/${ref.fileName}?${query}`;
}

/** jdt 类文件判定。 */
export function isJdtRef(ref: FileRef): boolean {
  return ref.kind === 'jdt';
}

/**
 * 身份相等：fs/fs 比 path；jdt/jdt 比 module+classPath+fileName；跨 kind 恒 false。
 * 相对/绝对 fs 路径、jdt uri 与展示路径在此收敛为同一身份。
 */
export function sameFile(a: FileRef, b: FileRef): boolean {
  if (a.kind === 'fs' && b.kind === 'fs') return a.path === b.path;
  if (a.kind === 'jdt' && b.kind === 'jdt') {
    return a.module === b.module && a.classPath === b.classPath && a.fileName === b.fileName;
  }
  return false;
}
