// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 方案 B 架构护栏：**语言知识必须住在 `languages/<lang>/`，通用层不认识任何具体语言**。
 *
 * 与 `syntax/__tests__/{layering,noRegexDiscovery}.test.ts` 同一手法（源码扫描）——这些不变量
 * 是「结构」而非「行为」，普通单测无法表达，只能钉住源码形态。
 *
 * 十一条不变量（每条对应一次真实泄漏，见重构方案 §0）：
 * 1. 通用层无语言分派（`=== 'java'` / `endsWith('.rs')` / `type === 'go'`）；
 * 2. 共享类型无语言字段（`containerPath` / `kind` / `staticSubtests` / `lsp`）；
 * 3. 已被 `LanguageModule` 取代的旧共享结构、以及已删除的**分发函数名**
 *    （`buildRunCommand` / `buildDebugLaunchConfig` 等，含测试里的薄适配层与 describe 标题）全仓消失；
 * 4. 语言清单**只有一处**（`Record<RunLang, …>`）；
 * 5. 四个语言目录齐全（编译期穷尽之外的目录级兜底）；
 * 6. 语言模块不直接摸 IO（Tauri / file / lsp / settings API / 外部 store）；
 * 7. 语言私有类型不外泄（不跨语言目录、不被通用层直导）；
 * 8. 通用层文件清单恰好是语言无关工具集（`utils/` 与 `syntax/` 白名单）；
 * 9. 语言命名的文件只能住在 `languages/`；
 * 10. Debug store 的切片结构（文件集固定 / slice 间无横向 import / 每片 ≤300 行 / 组合根只拼装）；
 * 11. store 切片对外封闭（跨 feature 只能经 `store/debugStore.ts` 门面）。
 *
 * **全部常开**（无 `describe.skip`）。新增语言或调整通用层结构时若断言失败，
 * 说明语言知识又被塞回了通用层。
 */
const RUNNER = 'src/features/runner';
const LANGS = ['ts', 'rust', 'go', 'java'] as const;

/** 递归收集 .ts/.tsx（顺序稳定：readdir 按目录项名排序）；目录不存在 → 空（阶段 1 前尚无 languages/）。 */
function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkTs(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** 去掉整行注释 —— 注释里出现语言名是合法的（说明性文字）。 */
function codeLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

/** 命中的 (file, line, text) 列表；空数组 = 通过。 */
function hits(files: readonly string[], pattern: RegExp): string[] {
  const out: string[] = [];
  for (const file of files) {
    codeLines(file).forEach((line, i) => {
      if (pattern.test(line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

/** 通用层 = runner 内除 `languages/` 外的所有模块（语言知识一律不许出现在这里）。 */
const GENERIC_FILES = walkTs(RUNNER).filter((f) => !f.startsWith(`${RUNNER}/languages/`));

/** 显式列出的通用核心（用于「无语言字面量」这类较严的断言）。 */
const CORE_FILES = [
  `${RUNNER}/exec/launch.ts`,
  `${RUNNER}/exec/context.ts`,
  `${RUNNER}/exec/debugConsole.ts`,
  `${RUNNER}/exec/results.ts`,
  // Debug store = 组合根 + 全部职责切片。拆 slice 后必须**整目录**纳入：只列组合根会让
  // 「无语言字面量」断言在薄门面上空转，覆盖率静默归零。
  `${RUNNER}/store/debugStore.ts`,
  ...walkTs(`${RUNNER}/store/debug`),
  `${RUNNER}/runTarget.ts`,
  `${RUNNER}/syntax/contract.ts`,
  `${RUNNER}/syntax/lezer.ts`,
  `${RUNNER}/syntax/parsers.ts`,
].filter((f) => existsSync(f));

/** 数组字面量里成对出现的语言名（`'ts' | 'rust' | …`）—— 只有 RunLang 的定义处可以写。 */
const LANG_UNION = /'(ts|rust|go|java)'\s*\||\|\s*'(ts|rust|go|java)'/;

describe('方案 B 护栏 1：通用层无语言分派', () => {
  it('核心通用模块不含语言比较 / 扩展名判定 / adapter type 比较', () => {
    const patterns = [
      /(===|!==)\s*'(ts|rust|go|java)'/,
      /endsWith\(['"]\.(rs|go|java)['"]\)/,
      /\btype\s*===\s*['"](go|java|rust)['"]/,
      /\bcase\s+'(ts|rust|go|java)'\s*:/,
      /type:\s*'(ts|rust|go|java)'/,
    ];
    for (const p of patterns) expect(hits(CORE_FILES, p)).toEqual([]);
  });

  it('语言清单不以字面量联合形式重复（RunLang 定义处除外）', () => {
    const files = CORE_FILES.filter((f) => f !== `${RUNNER}/syntax/contract.ts`);
    expect(hits(files, LANG_UNION)).toEqual([]);
  });

  it('语言字段的**语义**不被通用层读取（variant / containerPath 只透传）', () => {
    // 通用层可以持有这两个字段（类型定义 + 透传），但不得读取其值做判定
    // （按属性访问形态匹配，避免与无关 UI prop 同名误伤）。
    const files = GENERIC_FILES.filter((f) => f !== `${RUNNER}/syntax/contract.ts`);
    expect(hits(files, /\.(variant|containerPath)\s*(===|!==)/)).toEqual([]);
  });

  it('editor 渲染层不认识任何具体语言（overlay provider 化后）', () => {
    const EDITOR_FILES = [
      'src/features/editor/gutter/runMarkers.ts',
      'src/features/editor/gutter/runContribution.ts',
      'src/features/editor/gutter/runLspOverlay.ts',
      'src/features/editor/gutter/runCodelensConfig.ts',
      'src/features/editor/gutter/testStatusContribution.ts',
      'src/features/editor/hooks/useUnifiedGutter.ts',
    ].filter((f) => existsSync(f));
    const patterns = [
      /(===|!==)\s*'(ts|rust|go|java)'/,
      /endsWith\(['"]\.(rs|go|java)['"]\)/,
      /isRustAnalyzerReady|fetchRunnablesForLines/,
    ];
    for (const p of patterns) expect(hits(EDITOR_FILES, p)).toEqual([]);
  });
});

describe('方案 B 护栏 2：共享类型无语言字段', () => {
  it('TestCaseInfo 不含语言私有字段名（containerPath / kind）', () => {
    const contract = readFileSync(`${RUNNER}/syntax/contract.ts`, 'utf8');
    expect(contract).not.toMatch(/nestedClassPath/);
    expect(contract).not.toMatch(/\bkind\??\s*:/);
  });

  it('RunTarget 不含语言私有字段名（staticSubtests / lsp）', () => {
    const target = readFileSync(`${RUNNER}/runTarget.ts`, 'utf8');
    expect(target).not.toMatch(/staticSubtests/);
    expect(target).not.toMatch(/\blsp\??\s*[?:]/);
  });
});

describe('方案 B 护栏 3：旧共享结构已消失', () => {
  it('旧两张表 / 旧共享包 / 旧结果枚举全仓 0 命中（含 MainLang 与命令入参类型）', () => {
    // 本测试文件自身含这些名字（作为断言字面量）→ 排除。
    const SELF = `${RUNNER}/__tests__/architecture.test.ts`;
    const pattern =
      /\b(RunContext|RunPreparation|resolveRunContext|defaultRunContext|enrichTestCase|ResultsSource|resultsSourceFor|LanguageRunner|RunLanguage|MainLang|RunCommandInput|MainRunInput|MainDebugBuildInput|cargoManifestDir)\b/;
    const offenders = hits(
      walkTs('src').filter((f) => f !== SELF),
      pattern,
    );
    expect(offenders).toEqual([]);
  });

  /**
   * 方案 B 删掉的**分发函数名**不得以任何形式复活 —— 包括测试里的「薄适配层」与 describe 标题。
   *
   * 起因（Neeko Check F12）：按语言拆分命令测试时，曾把 `buildRunCommand` / `buildDebugLaunchConfig`
   * 等高危同名辅助留在测试里（有的是纯转发）。后果是后人 grep 这些名字会命中测试块，误以为共享分发
   * 还在；纯转发层又让「测试直调语言构造器」的收益打对折。
   */
  it('已删除的分发函数名（含测试辅助与 describe 标题）全仓 0 命中', () => {
    const SELF = `${RUNNER}/__tests__/architecture.test.ts`;
    const pattern =
      /\b(buildRunCommand|buildMainRunCommand|buildMainDebugBuildCommand|buildDebugLaunchConfig|buildMainDebugLaunchConfig)\b/;
    expect(
      hits(
        walkTs('src').filter((f) => f !== SELF),
        pattern,
      ),
    ).toEqual([]);
  });
});

describe('方案 B 护栏 4/5：语言清单唯一且目录齐全', () => {
  it('语言 → 模块注册表只出现在 languages/registry.ts', () => {
    const SELF = `${RUNNER}/__tests__/architecture.test.ts`;
    const files = walkTs('src')
      .filter((f) => f !== SELF)
      // 只比对**代码行**：文档注释里提到该类型名是说明，不是声明。
      .filter((f) => /Record<RunLang,\s*LanguageModule>/.test(codeLines(f).join('\n')));
    expect(files).toEqual([`${RUNNER}/languages/registry.ts`]);
  });

  it('四个语言目录各有 index.ts（目录级穷尽兜底）', () => {
    const missing = LANGS.filter((l) => !existsSync(`${RUNNER}/languages/${l}/index.ts`));
    expect(missing).toEqual([]);
  });
});

describe('方案 B 护栏 6：语言模块不直接触 IO', () => {
  it('languages/**（除 io.ts）不 import Tauri / file / lsp / settings API 与外部 store', () => {
    // IO 边界按**语言粒度**豁免：通用面 + 每语言各自的 `io.ts`
    // （否则 io.ts 会随语言数量膨胀成「新语言专属 IO 就往这里塞」的垃圾场）。
    const IO_BOUNDARIES = [
      `${RUNNER}/languages/io.ts`,
      ...LANGS.map((lang) => `${RUNNER}/languages/${lang}/io.ts`),
    ];
    const files = walkTs(`${RUNNER}/languages`).filter((f) => !IO_BOUNDARIES.includes(f));
    const pattern =
      /from '@tauri-apps\/api\/|from '@\/features\/(file|lsp|settings)\/api\/|from '@\/shared\/store\//;
    expect(hits(files, pattern)).toEqual([]);
  });
});

describe('方案 B 护栏 7：语言私有类型不外泄', () => {
  it('语言目录之间互不 import（同域内也不越语言边界取实现）', () => {
    const offenders: string[] = [];
    for (const lang of LANGS) {
      const dir = `${RUNNER}/languages/${lang}`;
      if (!existsSync(dir)) continue;
      const pattern = new RegExp(`from '(\\.\\./)*(${LANGS.filter((l) => l !== lang).join('|')})/`);
      offenders.push(...hits(walkTs(dir), pattern));
    }
    expect(offenders).toEqual([]);
  });

  it('通用层不直导具体语言目录（只能经 languages/index.ts 与 languages/registry.ts）', () => {
    const pattern = new RegExp(`from '([^']*\\/)?(languages\\/)?(${LANGS.join('|')})\\/`);
    const files = GENERIC_FILES.filter((f) => !f.includes('__tests__'));
    expect(hits(files, pattern)).toEqual([]);
  });
});

describe('方案 B 护栏 8：通用层文件清单恰好是语言无关工具集', () => {
  /** `utils/` 只放语言无关工具（解析器按**格式**而非语言组织）；语言工具一律进 `languages/<lang>/`。 */
  const UTILS_WHITELIST = ['consoleFilter.ts', 'lspReadiness.ts', 'testResultParsers.ts'].map(
    (n) => `${RUNNER}/utils/${n}`,
  );
  /** `syntax/` 只放语法工具箱（契约/行号索引/parser 映射），语言发现进 `languages/<lang>/discover.ts`。 */
  const SYNTAX_WHITELIST = ['contract.ts', 'lezer.ts', 'parsers.ts'].map(
    (n) => `${RUNNER}/syntax/${n}`,
  );

  it('utils/ 与 syntax/ 的文件集与白名单一致', () => {
    const utils = walkTs(`${RUNNER}/utils`).filter((f) => !f.includes('__tests__'));
    const syntax = walkTs(`${RUNNER}/syntax`).filter((f) => !f.includes('__tests__'));
    expect(utils).toEqual(UTILS_WHITELIST);
    expect(syntax).toEqual(SYNTAX_WHITELIST);
  });
});

describe('方案 B 护栏 9：语言命名的文件必须在 languages/', () => {
  /**
   * 文件名以语言/构建系统/报告格式关键词开头者，只允许住在 `languages/<lang>/`。
   * 例外：`store/javaDebugStore.ts`（语言专属**会话 UI 状态**属 store 域，非语言逻辑）。
   */
  const BANNED_PREFIX = /^(java|junit|maven|cargo|rust|go|ts|kotlin|vitest|libtest|test2json)/i;
  const ALLOWED = [`${RUNNER}/store/javaDebugStore.ts`];

  it('非 languages/ 路径下不存在语言命名的模块', () => {
    const offenders = walkTs(RUNNER)
      .filter((f) => !f.startsWith(`${RUNNER}/languages/`))
      .filter((f) => !ALLOWED.includes(f))
      .filter((f) =>
        BANNED_PREFIX.test(
          f
            .split('/')
            .pop()!
            .replace(/\.tsx?$/, ''),
        ),
      );
    expect(offenders).toEqual([]);
  });
});

/**
 * 护栏 10：Debug store 的**切片结构**。
 *
 * `store/debugStore.ts` 曾是 964 行 / 40+ 动作的混合体（违反单一职责与「组件 ≤300 行」）。
 * 拆成 8 个职责切片后，以下四条把「拆对了」变成结构不变量 —— 否则后续很容易被改回单体：
 * 1. `store/debug/` 文件集固定（切片不多不少，新增切片必须显式登记）；
 * 2. slice **之间不横向 import**（跨 slice 只能经 `get()`，防止切片图退化成网）；
 * 3. 每个切片文件 ≤300 行（与组件同一口径）；
 * 4. 切片**不直导组合根**（否则 `slice → debugStore → slice` 成环）。
 */
describe('护栏 10：Debug store 切片结构', () => {
  const DEBUG_DIR = `${RUNNER}/store/debug`;
  /** 8 个 slice + 叶子（types / shared / stopGeneration）+ 中间件。 */
  const DEBUG_WHITELIST = [
    'breakpointSlice.ts',
    'configSlice.ts',
    'consoleSlice.ts',
    'eventsSlice.ts',
    'middleware.ts',
    'panelSlice.ts',
    'sessionSlice.ts',
    'shared.ts',
    'stackSlice.ts',
    'stopGeneration.ts',
    'types.ts',
    'variableSlice.ts',
  ].map((n) => `${DEBUG_DIR}/${n}`);

  it('store/debug/ 的文件集与白名单一致', () => {
    const files = walkTs(DEBUG_DIR).filter((f) => !f.includes('__tests__'));
    expect(files).toEqual([...DEBUG_WHITELIST].sort());
  });

  it('slice 之间不横向 import，也不直导组合根（跨 slice 一律经 get()）', () => {
    const slices = walkTs(DEBUG_DIR).filter((f) => /Slice\.ts$/.test(f));
    expect(slices.length).toBeGreaterThan(0);
    expect(hits(slices, /from '\.\/\w+Slice'/)).toEqual([]);
    // 直导组合根会形成 slice → debugStore → slice 的循环。
    // 必须按**模块基名**匹配而非枚举字面量：下面这些写法解析到同一个文件，枚举法必漏
    // （Neeko Check F19 就是枚举法漏掉后两种）——
    //   `../debugStore`、`../debugStore.ts`（`allowImportingTsExtensions` 允许）、
    //   `../../store/debugStore`、`@/features/runner/store/debugStore`。
    // `store/debug/` 内不存在别的 `debugStore` 文件，故任何命中都必然是组合根。
    expect(hits(slices, /from '[^']*debugStore(\.ts)?'/)).toEqual([]);
  });

  it('每个切片文件 ≤300 行，组合根只拼装不直连 DAP API', () => {
    const tooLong = walkTs(DEBUG_DIR)
      .map((f) => [f, readFileSync(f, 'utf8').split('\n').length] as const)
      .filter(([, n]) => n > 300)
      .map(([f, n]) => `${f}: ${n} 行`);
    expect(tooLong).toEqual([]);
    // 组合根只做拼装与门面再导出；DAP 调用一律留在各 slice 内。
    expect(hits([`${RUNNER}/store/debugStore.ts`], /from '\.\/api\//)).toEqual([]);
  });
});

/**
 * 护栏 11：store 域内**切片目录对外封闭**。
 *
 * `store/debugStore.ts` 是唯一门面；`store/debug/**` 是组合内部件（导出了 `createXxxSlice`
 * 工厂）。若被别的 feature 直导，对方可自行 `create()` 出**第二个 store 实例**，
 * 直接击穿「单实例」不变量。
 *
 * 注：`.eslintrc.cjs` 的 `sliceZones` 是主防线（`FIREWALL_EXCEPT` 的 `'./store'` 是路径前缀
 * 豁免，会把切片目录一并放行，需单独收窄）；此处是源码扫描侧的第二道，与 `layering.test.ts`
 * 同一手法 —— 两道都在，避免只改一边就静默失守。
 */
describe('护栏 11：store 切片对外封闭（跨 feature 只能经门面）', () => {
  /** 组件的**所有者** feature 目录 —— 只有它自己（含组合根）能引用切片。 */
  const OWNER = 'runner';
  /**
   * 只留 `runner/store/debug/` 这一截：同时覆盖 `@/features/runner/store/debug/x` 与
   * feature 内部相对写法 `../../runner/store/debug/x`（带上 `src/features/` 前缀会漏掉后者）。
   */
  const SLICE_REF = /runner\/store\/debug\//;

  it('runner 之外的 feature 与 app/ 不得直导 store 切片', () => {
    const outsiders = [
      ...readdirSync('src/features', { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== OWNER)
        .map((e) => `src/features/${e.name}`),
      'src/app',
    ].filter((d) => existsSync(d));
    const files = outsiders.flatMap((d) => walkTs(d)).filter((f) => !f.includes('__tests__'));
    expect(hits(files, SLICE_REF)).toEqual([]);
  });
});

/**
 * 护栏 12：编辑器侧的**停点输入面只有一处 store 读取**（单视图订阅槽 = 2）。
 *
 * 停点的编辑器侧链路是 `useDebugStopReveal`（光标）+ `useCurrentLineHighlight`（黄线），
 * 两者都要「位置 + 会话状态」。此前各自 `useVisibleDebugSession()` + `useStopLocation()`
 * 展开后是 6 个订阅槽（`session` / `location` / `locationSeq` / `activeProjectId` 各读多遍），
 * 且「会话属于当前项目」的门控在多处各判一次 —— 任一处漏判就是 #14 的复现（别项目的停点
 * 画到本项目编辑器上）。
 *
 * 为什么用源码扫描而不是行为断言：React 的 `useSyncExternalStore` 会按 `subscribe` 函数
 * **去重**，多个 `useDebugStore(selector)` 在运行时只产生一条订阅 —— 行为上测不出差别，
 * 但「门控有几处」是**结构**属性（先例：本文件其余 11 条护栏、`syntax/__tests__/layering`）。
 * 因此把「消费者不直连 store、输入面恰好两次读取」钉成结构不变量。
 */
describe('护栏 12：停点输入面（单视图 debug/project 订阅槽 = 2）', () => {
  const REVEAL_CONSUMERS = [
    'src/features/editor/hooks/useDebugStopReveal.ts',
    'src/features/editor/hooks/useCurrentLineHighlight.ts',
  ];
  const STOP_INPUT = `${RUNNER}/hooks/useStopLocation.ts`;
  /** 任何「读停点/会话相关 store」的写法：直连 store 或经可见性门控 hook。 */
  const STORE_READ = /use(Debug|Project)Store\s*\(|useVisibleDebugSession\s*\(/;

  const countReads = (file: string, pattern: RegExp): number =>
    existsSync(file) ? codeLines(file).filter((l) => pattern.test(l)).length : 0;

  it('两个编辑器 hook 不自行读 store（订阅与门控都归 useStopLocation）', () => {
    expect(hits(REVEAL_CONSUMERS, STORE_READ)).toEqual([]);
  });

  it('useStopLocation 恰好读两次 store（debug + project 各一次）', () => {
    expect(countReads(STOP_INPUT, /useDebugStore\s*\(/)).toBe(1);
    expect(countReads(STOP_INPUT, /useProjectStore\s*\(/)).toBe(1);
    expect(countReads(STOP_INPUT, STORE_READ)).toBe(2);
  });
});
