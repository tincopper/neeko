/**
 * 文件身份的唯一所有权模块 —— 边界解析 → canonical 表示 → 身份比较。
 *
 * 所有「是不是同一个文件」的判定只允许在 `FileRef` 形态上进行（`sameFile`）；
 * 调用方不得自行发明字符串归一（正则/startsWith 拼 root 等）。本模块的形态换算边界：
 * - `canonicalFsPath`：tab/项目相对路径 → canonical fs path（lexical only）；
 * - `relativeToRoot`：canonical fs path → root 下相对路径（展示用，非身份比较）；
 * - `fileRefFromLspUri`：LSP uri（file:// / jdt://）→ FileRef；
 * - `fileRefFromTabPath`：tab 身份串 → FileRef（含 `jdt:/`、`dap-source:/` 两种合成身份）；
 * - `virtualSourceIdentity`：适配器虚拟源码的**唯一构造点**（`dap-source:/<ref>/<name>`）。
 *
 * **值域必须等于真实身份种类集合**（切片 3 / R10）：身份函数要**全且幂等**
 * （`id(id(x)) === id(x)`）。任何一种身份只要缺席文法，就会被当成相对路径拼上项目根，
 * 产出伪路径 —— 那正是「同一份源码两种表示」的入口（见 `DAP_SOURCE_PREFIX` 的注释）。
 *
 * `..` 不在词法层解析（lexical only）——后端读取前的 canonicalize 是安全兜底。
 * jdt 文法解析是本模块唯一正则（`file://` 交给浏览器原生 `new URL`；`dap-source:` 走
 * 逐字符解析，不引入第二个正则）。
 * 零依赖：不 import store / api / 任何项目模块，纯函数。
 */

/** canonical fs 路径：只由本模块边界函数产出（branded，防裸字符串混入比较）。 */
export type CanonicalPath = string & { readonly __brand: 'canonical' };

/**
 * 文件身份：fs 路径、jdt 类文件（module + 包路径 + 文件名），或适配器虚拟源码。
 *
 * 三者都是**身份**而不是「路径」：jdt 与 virtual 都不存在于文件系统，只是各自的
 * 内容通道不同（前者由后端翻译成真实文件，后者由 adapter 持字节）。
 */
export type FileRef =
  | { kind: 'fs'; path: CanonicalPath }
  // classPath：包路径，源 uri 的点分包已转斜杠（`java.lang` → `java/lang`）；
  // fileName：扩展名 canonical 为 `.java`（.class 反编译与 .java 带源码是
  // 同一类的两种载体，身份统一取 .java 形态，与 jdt 展示路径一致）。
  | { kind: 'jdt'; module: string; classPath: string; fileName: string }
  // 适配器虚拟源码（DAP `sourceReference`）：`reference` 是会话内引用号，
  // `name` 是适配器给的**标签**（不是文件名 —— 不做路径式归一）。
  | { kind: 'virtual'; reference: number; name: string };

// ── dap-source: 合成身份（适配器虚拟源码）────────────────────────────────────

/**
 * `dap-source:/<reference>/<name>` 前缀。
 *
 * 它是**身份**、不是文件路径：`reference` 只在一个会话内有效，适配器按引用号返回字节。
 * 曾缺席身份文法（`fileRefFromTabPath` 只认 `jdt:`），于是被当相对路径拼根 →
 * `sourceIdentityOf` 不幂等、伪路径成为断点 key 下发后端、新消费者比身份静默不命中。
 */
const DAP_SOURCE_PREFIX = 'dap-source:/';

/** 虚拟源码名的唯一归一：trim + 空回退（构造点与解析点共用，保证两处一致）。 */
function normalizeVirtualName(raw: string | null | undefined): string {
  return raw && raw.trim() ? raw.trim() : 'source';
}

/**
 * 适配器虚拟源码身份（**唯一构造点**）。
 *
 * 与 `sourceIdentityOf`（物理源码）并列：两者是「同一份源码一种身份」的两个构造入口。
 */
export function virtualSourceIdentity(reference: number, name?: string | null): string {
  return `${DAP_SOURCE_PREFIX}${reference}/${normalizeVirtualName(name)}`;
}

/** 逐字符判定十进制非负整数（不引入正则 —— 本模块唯一正则留给 jdt 文法）。 */
function parseNonNegativeInt(s: string): number | null {
  if (s.length === 0) return null;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 48 || code > 57) return null;
  }
  return Number(s);
}

/**
 * 反解析 `dap-source:/<reference>/<name>`；不合文法返回 null。
 *
 * `name` 取**第一个** `/` 之后的全部内容（标签里带 `/` 也照收，保证与构造点互逆）。
 * 顺带归一 `name`，使「同一引用 + 同一标签的不同写法」收敛到同一身份
 * （与 jdt 的 `.class` → `.java` 同一手法：比较语义，不比较文本）。
 */
export function parseVirtualSourceIdentity(p: string): { reference: number; name: string } | null {
  if (!p.startsWith(DAP_SOURCE_PREFIX)) return null;
  const rest = p.slice(DAP_SOURCE_PREFIX.length);
  const slash = rest.indexOf('/');
  const reference = parseNonNegativeInt(slash < 0 ? rest : rest.slice(0, slash));
  if (reference === null) return null;
  return { reference, name: normalizeVirtualName(slash < 0 ? '' : rest.slice(slash + 1)) };
}

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
 *
 * 另外接受 **LSP uri** 形态：栈帧的 DAP `Source.path` 在 B' 下就是
 * `jdt://contents/<module>/<pkg>/<Name>.class?<attrs>`（jdtls 内 java-debug 对
 * JDK / 依赖类返回的形态，真机实测）。它**不是文件路径** —— 拼项目根会得到
 * `<root>/jdt://…`，表现为「停住了却打不开源码」（`not a readable external debug stop`）。
 * 与展示路径走同一文法（`fileRefFromLspUri`），因此两种表示收敛到**同一身份**。
 */
export function fileRefFromTabPath(projectRoot: string, p: string): FileRef {
  if (p.startsWith(JDT_DISPLAY_PREFIX)) {
    const jdt = parseJdtClassPath(p.slice(JDT_DISPLAY_PREFIX.length));
    if (jdt) return { kind: 'jdt', ...jdt };
  }
  if (p.startsWith(JDT_URI_PREFIX)) {
    const byUri = fileRefFromLspUri(p);
    if (byUri) return byUri;
  }
  if (p.startsWith(DAP_SOURCE_PREFIX)) {
    const virtual = parseVirtualSourceIdentity(p);
    // 合文法 → 结构化身份；**不合文法也绝不拼根**（原样保留，保持全函数且幂等）。
    return virtual ? { kind: 'virtual', ...virtual } : { kind: 'fs', path: p as CanonicalPath };
  }
  return { kind: 'fs', path: canonicalFsPath(projectRoot, p) };
}

// ── 身份操作 ────────────────────────────────────────────────────────────────

/**
 * tab 身份字符串：fs → canonical path；jdt → `jdt:/${module}/${classPath}/${fileName}`
 * （无包段不留双斜杠）。与旧 `jdtClassDisplayPath` 输出逐字一致。
 *
 * **这是 Neeko 的进程内身份，不是 DAP 的 `Source.path`**：java-debug 的
 * `asCompilationUnit` 只认真实存在的文件路径或带 JDT handle 的 `jdt://` uri，
 * `jdt:/…` 两者都不满足（下发它 = 适配器回 `verified:false`，断点永不命中）。
 * 适配器侧的真实路径由 Rust 在 DAP 边界翻译（`src-tauri/src/dap/adapter/java/source_path.rs`），
 * 前端**不要把**本身份当作可下发路径使用。
 */
export function tabIdentityOf(ref: FileRef): string {
  if (ref.kind === 'fs') return ref.path;
  if (ref.kind === 'virtual') return `${DAP_SOURCE_PREFIX}${ref.reference}/${ref.name}`;
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
 * 身份与**下发形态**分离：断点下发时由 Rust 在 DAP 边界把 `jdt:/…` 翻译成真实文件路径
 * （缓存命中则复用，缺失则从 `src.zip` / `-sources.jar` 落盘，见
 * `src-tauri/src/dap/adapter/java/source_path.rs`）。因此身份只有一种，而下发形态由后端负责 ——
 * 不需要、也不允许为「让适配器看得懂」而新增第二种身份。
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
 * 路径拼上项目根，得到 `<root>/jdt:/…` 这种不存在的路径，破坏「同一份源码一种身份」
 * 的不变式（tab 会分裂成两个、断点 key 也会两套）。
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
 * `jdtQuery` 缺省返回 null；**虚拟源码恒 null**（适配器持字节，没有 LSP 文档）。
 *
 * 注意 jdt 身份的扩展名已 canonical 为 `.java`，
 * 反编译类（`.class` 源）的原始 uri 无法从 ref 逐字重建——需要原始 uri 时
 * 必须由 tab 的 `virtualUri` 携带，不经此函数。
 */
export function lspUriOf(ref: FileRef, opts?: { jdtQuery?: string }): string | null {
  if (ref.kind === 'fs') return `file://${ref.path}`;
  if (ref.kind === 'virtual') return null;
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
 * 两个**源身份字符串**是否指向同一文件？—— 两侧都必须是**规范身份**（无 root 归一）。
 *
 * 用于「两侧都已是规范身份」的消费侧（DAP 停点位置 vs tab 身份）。
 * 任一侧可能是**项目相对形态**时用 `sameFileAt`：没有 root 就无法把相对形态归一，
 * 那条边界不能靠猜（`/repo/a.go` 与 `a.go` 的混比属边界解析）。
 */
export function sameIdentity(a: string, b: string): boolean {
  if (!a || !b) return false;
  return sameFileAt('', a, b);
}

/**
 * 同一文件判定（**允许任一侧是项目相对形态**）：两侧都按 `projectRoot` 归一后比较。
 *
 * 与 `sameIdentity` 是**同一实现的两个入口**，差别只在**前置条件**：
 * - 已知两侧都是规范身份 → `sameIdentity`（不引入 root，语义更窄更明确）；
 * - 可能含项目相对形态（历史 / 会话恢复的 tab）→ 本函数。
 *
 * 两者都是「形态归一 + `sameFile`」，不做 basename / 后缀等别名猜测。
 */
export function sameFileAt(projectRoot: string, a: string, b: string): boolean {
  if (!a || !b) return false;
  return sameFile(fileRefFromTabPath(projectRoot, a), fileRefFromTabPath(projectRoot, b));
}

/**
 * 路径列表里是否有**指向同一文件**的条目？—— `file-changed` 事件的消费侧唯一判定入口。
 *
 * 为什么必须共用：Rust watcher 发出的事件路径是**项目相对**（`strip_prefix` 失败时回退**绝对**），
 * 而消费侧的 `filePath` 通常是规范绝对。三个消费方（tab 刷新 / HTML 预览 / 浏览器面板）
 * 曾各写一套判定（字符串等值、后缀拼接、剥根转相对），其中两套会漏配 —— 后果是
 * 「不刷新、显示过期内容」。此处把「相对/绝对/斜杠形态」双向归一交给身份所有者，
 * 消费侧只调用本函数。
 *
 * @param root 项目根（事件相对路径的基准）
 * @param paths 事件给出的变更路径列表（相对或绝对）
 * @param filePath 待判定的文件路径（相对或绝对）
 */
export function pathsContainFile(
  root: string,
  paths: readonly string[],
  filePath: string,
): boolean {
  const target = fileRefFromTabPath(root, filePath);
  return paths.some((p) => sameFile(fileRefFromTabPath(root, p), target));
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
  // 虚拟源码比较 (reference, name) 元组：name 的归一已在解析/构造边界完成，
  // 故这里不再做文本归一（两种写法收敛到同一身份是在边界发生的事）。
  if (a.kind === 'virtual' && b.kind === 'virtual') {
    return a.reference === b.reference && a.name === b.name;
  }
  return false;
}
