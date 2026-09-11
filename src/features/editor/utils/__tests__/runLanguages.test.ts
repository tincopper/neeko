import { describe, expect, it } from 'vitest';

import { runnerFor } from '../../runner/registry';
import {
  buildMainDebugBuildCommand,
  buildMainRunCommand,
  buildRunCommand,
  capabilitiesFor,
  hasMainEntries,
  hasHierarchicalTestNames,
  isRunnableFile,
  discoverRunTargets,
  resultsSourceFor,
  runLanguageById,
  staticSubtestsForFile,
} from '../runLanguages';
import type { TestCaseInfo } from '../testCases';
import { defaultRunContext } from '../testCommands';

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

describe('runLanguageById — 表驱动的语境解析注册项', () => {
  it('仅需 IO 的语言注册 resolveContext（go/java），其余为 undefined', () => {
    // 新增语言若要解析环境事实，只需在本表加一项 —— resolveRunContext 无 lang 分支。
    expect(runLanguageById('go')?.resolveContext).toBeTypeOf('function');
    expect(runLanguageById('java')?.resolveContext).toBeTypeOf('function');
    expect(runLanguageById('rust')?.resolveContext).toBeUndefined();
    expect(runLanguageById('ts')?.resolveContext).toBeUndefined();
  });

  it('id 反查自洽（新增语言即插即用）', () => {
    expect(runLanguageById('rust')?.id).toBe('rust');
    expect(runLanguageById('go')?.hasMain).toBe(true);
    expect(runLanguageById('ts')?.hasMain).toBe(false);
  });
});

describe('命令构造槽位 — 表驱动分发（无 lang 分支）', () => {
  const rustCase = { name: 'parse_simple', line: 1, lang: 'rust' } as const;
  const goCase = { name: 'TestAdd', line: 3, lang: 'go' } as const;

  it('注册表按语言挂载命令实现（能力差异显式）', () => {
    // ts 只有 run（无 main / 无 debug build）；java 有 run + main run，但无 main debug build。
    expect(runLanguageById('ts')?.buildMainRunCommand).toBeUndefined();
    expect(runLanguageById('java')?.buildMainDebugBuildCommand).toBeUndefined();
    for (const id of ['rust', 'go', 'java', 'ts'] as const) {
      expect(runLanguageById(id)?.buildRunCommand).toBeTypeOf('function');
    }
    expect(runLanguageById('go')?.buildMainDebugBuildCommand).toBeTypeOf('function');
  });

  it('buildRunCommand 按 testCase.lang 分发（注册表实现，非 if 链）', () => {
    expect(buildRunCommand(rustCase, 'src/lib.rs', null, null, defaultRunContext())).toContain(
      "RUSTC_BOOTSTRAP=1 cargo test 'parse_simple'",
    );
    const goCtx = { ...defaultRunContext(), goPkg: './pkg/math' };
    expect(buildRunCommand(goCase, 'pkg/math/add_test.go', null, null, goCtx)).toBe(
      "go test -run '^TestAdd$' -json './pkg/math'",
    );
  });

  it('buildMainRunCommand / buildMainDebugBuildCommand 同源分发', () => {
    const goCtx = { ...defaultRunContext(), goPkg: './cmd/agent' };
    expect(buildMainRunCommand('go', 'cmd/agent/main.go', '/tmp/proj', goCtx)).toBe(
      "go run './cmd/agent'",
    );
    expect(buildMainDebugBuildCommand('go', goCtx)).toBe(
      "go build -o '.neeko/test-bin/main' -gcflags 'all=-N -l' './cmd/agent'",
    );
    expect(
      buildMainDebugBuildCommand('rust', defaultRunContext(), { manifestDir: 'crates/app' }),
    ).toBe("cargo build --manifest-path 'crates/app/Cargo.toml' --message-format=json");
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

describe('resultsSourceFor — 结果读取通道（按产物格式而非语言分支）', () => {
  it('每语言声明其报告格式', () => {
    expect(resultsSourceFor('ts')).toBe('vitest-json');
    expect(resultsSourceFor('rust')).toBe('libtest-json');
    expect(resultsSourceFor('go')).toBe('test2json');
    expect(resultsSourceFor('java')).toBe('junit-xml');
  });
});

describe('staticSubtestsForFile — 静态子测试按父用例归组（菜单去重依据，§7.8.4）', () => {
  const goCase = (name: string): TestCaseInfo => ({ name, line: 1, lang: 'go' });

  it('扁平：父用例 → 其全部静态子测试（按发现顺序）', () => {
    const index = staticSubtestsForFile('pkg/math/fib_test.go', [
      goCase('TestFib'),
      goCase('TestFib/zero'),
      goCase('TestFib/one'),
      goCase('TestSlash'),
    ]);
    expect(index.get('TestFib')).toEqual(['TestFib/zero', 'TestFib/one']);
    // 子测试自身只是叶子 → 不作父键（点了它不该再列出自己）
    expect(index.has('TestFib/zero')).toBe(false);
    expect(index.has('TestFib/one')).toBe(false);
    expect(index.has('TestSlash')).toBe(false);
  });

  it('嵌套：深层子测试对**每一层**祖先可见（t.Run 可再嵌 t.Run）', () => {
    const index = staticSubtestsForFile('f_test.go', [goCase('T'), goCase('T/a'), goCase('T/a/b')]);
    expect(index.get('T')).toEqual(['T/a', 'T/a/b']);
    expect(index.get('T/a')).toEqual(['T/a/b']);
    expect(index.has('T/a/b')).toBe(false);
  });

  it('无子测试 / 空输入 → 空索引（不产空数组键，调用方据此判定「无静态按钮」）', () => {
    expect(staticSubtestsForFile('f_test.go', []).size).toBe(0);
    const index = staticSubtestsForFile('f_test.go', [goCase('TestFib'), goCase('parse_simple')]);
    expect(index.size).toBe(0);
  });

  /**
   * **F15 回归**：`/` 只在**声明了层级用例名**的语言里才表示父子关系。
   * TS 用例标题含 `/` 极常见（`test('GET /users')`），若按前缀猜层级会产出**伪造的
   * 父子关系** —— 菜单去重正是靠这个索引判定「已有静态按钮」，假数据会让去重错杀。
   */
  it('TS 文件：标题含 `/` 也**不得**产生父子关系（F15 回归，F15 前此断言为红）', () => {
    const index = staticSubtestsForFile('api.test.ts', [
      { name: 'auth', line: 1, lang: 'ts' },
      { name: 'auth/login works', line: 2, lang: 'ts' },
      { name: 'GET /users', line: 3, lang: 'ts' },
      { name: 'GET /health', line: 4, lang: 'ts' },
    ]);
    expect(index.size).toBe(0);
  });

  it('Rust / Java 文件：同样不产父子关系（层级语义是每语言声明的能力位）', () => {
    expect(
      staticSubtestsForFile('lib.rs', [{ name: 'parse_simple', line: 1, lang: 'rust' }]).size,
    ).toBe(0);
    expect(
      staticSubtestsForFile('App.java', [{ name: 'testAdd', line: 1, lang: 'java' }]).size,
    ).toBe(0);
  });
});

describe('hasHierarchicalTestNames — 层级用例名的能力位（唯一事实源，§7.8.4）', () => {
  it('仅 Go 声明层级用例名（t.Run + go test -run 的 `/` 逐层锚定）', () => {
    expect(hasHierarchicalTestNames('pkg/math/fib_test.go')).toBe(true);
    expect(hasHierarchicalTestNames('cmd/agent/main.go')).toBe(true);
    expect(hasHierarchicalTestNames('api.test.ts')).toBe(false);
    expect(hasHierarchicalTestNames('lib.rs')).toBe(false);
    expect(hasHierarchicalTestNames('App.java')).toBe(false);
    expect(hasHierarchicalTestNames('script.py')).toBe(false);
  });
});

describe('声明表 × runner 表一致性（防两张表漂移）', () => {
  it('capabilities.debug 与 runner.debug 一一对应（四语言）', () => {
    const mismatched = (['ts', 'rust', 'go', 'java'] as const).filter((id) => {
      const declared = capabilitiesFor(id).debug !== null;
      const implemented = runnerFor(id).debug !== undefined;
      return declared !== implemented;
    });
    expect(mismatched).toEqual([]); // 空数组 = 两张表完全一致（漂移即列出语言）
  });
});
