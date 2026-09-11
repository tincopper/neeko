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
