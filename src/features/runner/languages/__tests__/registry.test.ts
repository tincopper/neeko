// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { TestActionContext } from '../../exec/context';
import type { TestCaseInfo } from '../../syntax/contract';
import type { LangIo } from '../contract';
import { capabilitiesFor, discoverRunTargets, hasMainEntries, isRunnableFile } from '../index';
import { allRunners, runnerFor } from '../registry';

/** 语言模块 IO 的测试替身：探测一律「不存在」→ 走各语言的回退路径（不触 Tauri）。 */
const stubIo: LangIo = {
  fileExists: async () => false,
  readText: async () => null,
  homeDir: async () => '/home/u',
  lspRequest: async () => null,
  runBuild: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  notify: () => {},
  confirm: async () => false,
};

const ctxOf = (filePath: string, projectPath = '/tmp/proj'): TestActionContext => ({
  projectId: 'p1',
  filePath,
  projectPath,
});

/**
 * 进列门控的唯一事实源：run / test-status 两个 gutter 贡献与装配层都调
 * `isRunnableFile`。此处锁定该契约 —— 特别是 `.go`（历史上 test-status 漏判、
 * 与 run 漂移）。
 */
describe('isRunnableFile — run/状态 gutter 进列门控（唯一事实源）', () => {
  it('包含 Go：main.go 与 _test.go 均进列（漂移回归）', () => {
    // 漂移根因：test-status 曾写 `isTestFile || .rs || .java`，漏了 .go ——
    // main.go 有 play 图标却无状态列。同源后必须两者都为 true。
    expect(isRunnableFile('main.go')).toBe(true);
    expect(isRunnableFile('pkg/math/calc_test.go')).toBe(true);
  });

  it('包含 Rust / Java 全类文件（测试与 main 共用同一列）', () => {
    expect(isRunnableFile('src/main.rs')).toBe(true);
    expect(isRunnableFile('src/lib.rs')).toBe(true);
    expect(isRunnableFile('App.java')).toBe(true);
    expect(isRunnableFile('com/example/App.java')).toBe(true);
  });

  it('TS/JS 仅 test/spec 命名进列（无 main 概念）', () => {
    expect(isRunnableFile('foo.test.ts')).toBe(true);
    expect(isRunnableFile('foo.spec.tsx')).toBe(true);
    expect(isRunnableFile('foo.ts')).toBe(false);
    expect(isRunnableFile('main.ts')).toBe(false);
  });

  it('非可运行语言/无扩展名 → false', () => {
    expect(isRunnableFile('script.py')).toBe(false);
    expect(isRunnableFile('README.md')).toBe(false);
    expect(isRunnableFile('')).toBe(false);
  });
});

describe('hasMainEntries — main 能力来自同一注册表', () => {
  it('go/rust/java 有 main；ts 无', () => {
    expect(hasMainEntries('main.go')).toBe(true);
    expect(hasMainEntries('main.rs')).toBe(true);
    expect(hasMainEntries('App.java')).toBe(true);
    expect(hasMainEntries('foo.test.ts')).toBe(false);
    expect(hasMainEntries('script.py')).toBe(false);
  });
});

describe('discoverRunTargets.tests — 按语言分发表', () => {
  it('Go 仅 _test.go 解析用例（main.go 不产用例）', () => {
    const doc = 'func TestAdd(t *testing.T) {}\n';
    expect(discoverRunTargets('add_test.go', doc).tests).toEqual([
      { name: 'TestAdd', line: 1, lang: 'go' },
    ]);
    expect(discoverRunTargets('main.go', doc).tests).toEqual([]);
  });

  it('TS 仅 test/spec 命名解析用例', () => {
    const doc = "test('adds', () => {});\n";
    expect(discoverRunTargets('a.test.ts', doc).tests).toEqual([
      { name: 'adds', line: 1, lang: 'ts' },
    ]);
    expect(discoverRunTargets('a.ts', doc).tests).toEqual([]);
  });

  it('Rust 需 #[test] 证据；Java 需 @Test 证据', () => {
    expect(discoverRunTargets('lib.rs', '#[test]\nfn t() {}\n').tests).toEqual([
      { name: 't', line: 1, lang: 'rust' },
    ]);
    expect(discoverRunTargets('lib.rs', 'fn t() {}\n').tests).toEqual([]);
    // Java 侧用**合法的类体**：AST 要求语法结构可识别（裸方法不是合法 Java，旧行正则虽能认但属宽容）
    expect(
      discoverRunTargets('A.java', 'class A {\n    @Test\n    void t() {}\n}\n').tests,
    ).toEqual([{ name: 't', line: 2, lang: 'java' }]);
    expect(discoverRunTargets('A.java', 'class A {\n    void t() {}\n}\n').tests).toEqual([]);
  });

  it('非可运行语言 → []', () => {
    expect(discoverRunTargets('a.py', 'def test_x(): pass\n').tests).toEqual([]);
  });
});

describe('discoverRunTargets.mains — 按语言分发表', () => {
  it('Go/Rust/Java 各自识别；ts 无 main 概念', () => {
    expect(discoverRunTargets('main.go', 'func main() {}\n').mains).toEqual([
      { line: 1, language: 'go' },
    ]);
    expect(discoverRunTargets('main.rs', 'fn main() {}\n').mains).toEqual([
      { line: 1, language: 'rust' },
    ]);
    expect(
      discoverRunTargets(
        'App.java',
        'class App {\n  public static void main(String[] args) {}\n}\n',
      ).mains,
    ).toEqual([{ line: 2, language: 'java' }]);
    expect(discoverRunTargets('main.ts', 'function main() {}\n').mains).toEqual([]);
  });
});

describe('runnerFor — 语言模块反查（唯一清单）', () => {
  it('四语言各有模块，id 自洽（新增语言即插即用）', () => {
    for (const id of ['ts', 'rust', 'go', 'java'] as const) {
      expect(runnerFor(id).id).toBe(id);
    }
    expect(allRunners()).toHaveLength(4);
  });

  it('能力位与模块能力一致（filePolicy 声明，不散落字符串判断）', () => {
    // main 能力：go/rust/java 有；ts 无（无 main 概念）。
    expect(runnerFor('go').filePolicy.hasMain).toBe(true);
    expect(runnerFor('rust').filePolicy.hasMain).toBe(true);
    expect(runnerFor('java').filePolicy.hasMain).toBe(true);
    expect(runnerFor('ts').filePolicy.hasMain).toBe(false);
    // Debug 实现与 capability 声明一一对应（ts 无 Debug 通道）。
    expect(runnerFor('ts').planDebug).toBeUndefined();
    for (const id of ['rust', 'go', 'java'] as const) {
      expect(runnerFor(id).planDebug).toBeTypeOf('function');
    }
  });
});

describe('计划产出 — 表驱动分发（无 lang 分支）', () => {
  const rustCase: TestCaseInfo = { name: 'parse_simple', line: 1, lang: 'rust' };
  const goCase: TestCaseInfo = { name: 'TestAdd', line: 3, lang: 'go' };

  it('planTestRun 按语言出计划：命令 + cwd + configId 一次给全', async () => {
    // Rust：清单探测基准 = 项目根（projectPath 为空 → 不加 --manifest-path，逐字同历史）。
    const rust = await runnerFor('rust').planTestRun({
      ctx: ctxOf('src/lib.rs', ''),
      testCase: rustCase,
      runRoot: '/tmp/proj',
      io: stubIo,
    });
    expect(rust?.command).toContain("RUSTC_BOOTSTRAP=1 cargo test 'parse_simple'");
    expect(rust?.cwd).toBe('/tmp/proj');
    expect(rust?.configId).toBe('testcase:run:rust:src/lib.rs:parse_simple');

    // Go：包目录经 io 探测（此处恒 false → 回退文件所在目录 = cwd 相对）。
    const go = await runnerFor('go').planTestRun({
      ctx: ctxOf('pkg/math/add_test.go'),
      testCase: goCase,
      runRoot: '/tmp/proj',
      io: stubIo,
    });
    expect(go?.command).toBe("go test -run '^TestAdd$' -json './pkg/math'");

    // TS：无 main / 无前置；报告落 run 根（vitest json reporter）。
    const ts = await runnerFor('ts').planTestRun({
      ctx: ctxOf('src/a.test.ts'),
      testCase: { name: 'adds', line: 1, lang: 'ts' },
      runRoot: '/tmp/proj',
      io: stubIo,
    });
    expect(ts?.command).toContain("pnpm vitest run 'src/a.test.ts' -t 'adds'");
  });

  it('planMainRun：main 语言的计划与 run 同根同源（configId 走 main 前缀）', async () => {
    const go = await runnerFor('go').planMainRun({
      ctx: ctxOf('cmd/agent/main.go'),
      entry: { line: 3, language: 'go' },
      runRoot: '/tmp/proj',
      io: stubIo,
    });
    expect(go?.command).toBe("go run './cmd/agent'");
    expect(go?.configId).toBe('main:go:cmd/agent/main.go');

    // ts 无 main 概念 → 显式 null（防御性，不可达）。
    const ts = await runnerFor('ts').planMainRun({
      ctx: ctxOf('src/main.ts'),
      entry: { line: 1, language: 'ts' },
      runRoot: '/tmp/proj',
      io: stubIo,
    });
    expect(ts).toBeNull();
  });
});

describe('capabilitiesFor — UI/动作分支的唯一依据（E4）', () => {
  it('ts 直跑无 Debug；rust/go native；java attach', () => {
    expect(capabilitiesFor('ts')).toEqual({ directRun: true, debug: null });
    expect(capabilitiesFor('rust')).toEqual({ directRun: false, debug: 'native' });
    expect(capabilitiesFor('go')).toEqual({ directRun: false, debug: 'native' });
    expect(capabilitiesFor('java')).toEqual({ directRun: false, debug: 'attach' });
  });
});

describe('readResults — 结果读取由语言自带（与命令形态同源）', () => {
  it('四语言各自声明 reader（报告格式差异留在语言模块内）', () => {
    for (const id of ['ts', 'rust', 'go', 'java'] as const) {
      expect(runnerFor(id).readResults).toBeTypeOf('function');
    }
    // 只有 Rust 声明「0 命中」平台特例（Windows 本地 cmd 无结构化流 → 不报告）。
    expect(runnerFor('rust').reportZeroMatch).toBeTypeOf('function');
    expect(runnerFor('go').reportZeroMatch).toBeUndefined();
    expect(runnerFor('java').reportZeroMatch).toBeUndefined();
    expect(runnerFor('ts').reportZeroMatch).toBeUndefined();
  });
});

describe('caseOverlays — Go 静态子测试索引（菜单去重依据，§7.8.4）', () => {
  const goCase = (name: string): TestCaseInfo => ({ name, line: 1, lang: 'go' });

  it('扁平：父用例 → 其全部静态子测试（按发现顺序）', () => {
    const overlays = runnerFor('go').caseOverlays!([
      goCase('TestFib'),
      goCase('TestFib/zero'),
      goCase('TestFib/one'),
      goCase('TestSlash'),
    ]);
    expect(overlays.get('TestFib')).toEqual({ subtests: ['TestFib/zero', 'TestFib/one'] });
    // 子测试自身只是叶子 → 不作父键（点了它不该再列出自己）
    expect(overlays.has('TestFib/zero')).toBe(false);
    expect(overlays.has('TestSlash')).toBe(false);
  });

  it('嵌套：深层子测试对**每一层**祖先可见（t.Run 可再嵌 t.Run）', () => {
    const overlays = runnerFor('go').caseOverlays!([goCase('T'), goCase('T/a'), goCase('T/a/b')]);
    expect(overlays.get('T')).toEqual({ subtests: ['T/a', 'T/a/b'] });
    expect(overlays.get('T/a')).toEqual({ subtests: ['T/a/b'] });
    expect(overlays.has('T/a/b')).toBe(false);
  });

  it('无子测试 / 空输入 → 空索引（不产空数组键，调用方据此判定「无静态按钮」）', () => {
    expect(runnerFor('go').caseOverlays!([]).size).toBe(0);
    expect(runnerFor('go').caseOverlays!([goCase('TestFib'), goCase('parse_simple')]).size).toBe(0);
  });

  /**
   * **F15 的根治（比原断言更强）**：`/` 只在**声明了层级用例名的语言**里才有语义。
   * 原实现靠 `hasHierarchicalTestNames` 运行时门控兜住「TS 标题含 `/` 被误判为父子」；
   * 现在该索引是 **Go 独有**的 `caseOverlays` hook —— 其它语言**结构上不可能**产出伪造层级。
   */
  it('仅 Go 声明 caseOverlays（TS/Rust/Java 结构上不可能产出伪造层级）', () => {
    expect(runnerFor('go').caseOverlays).toBeTypeOf('function');
    expect(runnerFor('ts').caseOverlays).toBeUndefined();
    expect(runnerFor('rust').caseOverlays).toBeUndefined();
    expect(runnerFor('java').caseOverlays).toBeUndefined();
  });
});
