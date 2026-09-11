/**
 * 测试结果解析纯函数（P1 结构化结果流，对齐 testCases.ts 形态：零依赖、可独立测试）。
 *
 * - Rust：libtest JSON Lines（`cargo test -- -Z unstable-options --format=json --show-output`，
 *   RUSTC_BOOTSTRAP=1 注入见 testCommands）。逐行 JSON.parse，非 JSON 行丢弃 —— 与
 *   rust-analyzer `test_runner.rs` 的降级策略一致；只消费 `type: "test"` 的终态事件
 *   （ok/failed/ignored），started/suite 事件忽略。
 * - TS：vitest JSON reporter 写文件（jest 兼容格式，`testResults[].assertionResults[]`），
 *   onExit 后整文件读取解析。
 * - Java：JUnit XML（Surefire/Gradle/Console Launcher 兼容，`--reports-dir` 落盘），
 *   每个 `<testcase>` → 一条结果；`<failure>/<error>` → failed、`<skipped>` → skipped。
 * - matchCaseName：libtest/vitest 输出的是扁平全限定名（`mod::fn` / `describe title`），
 *   JUnit 的 `name` 是方法名（`classname` 是 FQCN）——源码侧 parseTestCases 只有 fn 名 →
 *   按「名后缀 + 分隔符边界」对齐（与 R3 子串过滤同语义的查询侧镜像）；参数化/运行时名
 *   无法对齐 → false（不猜，见 synthesis 已知坑 ②）。
 */

/** libtest 单条终态事件（子集，仅保留状态对齐所需字段）。 */
export interface LibtestEvent {
  name: string;
  status: 'passed' | 'failed' | 'ignored';
  /** 用例输出（`--show-output` 时 failed 事件携带，作为 gutter 失败摘要来源）。 */
  stdout?: string;
  /** `exec_time`（秒）换算的毫秒耗时；未开启 report-time 时缺省。 */
  duration?: number;
}

/** vitest JSON 报告中的单条断言结果（子集）。 */
export interface VitestCaseResult {
  fullName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration?: number;
  /** failureMessages[0]（失败摘要来源）。 */
  message?: string;
}

/** JUnit XML（Surefire/Gradle/Console Launcher）中的单条用例结果（`<testcase>` 节点子集）。 */
export interface JunitTestCase {
  /** 方法名（`<testcase name="…">`；`@ParameterizedTest` 时带 invocation 后缀，对齐时被 matchCaseName 拒绝）。 */
  name: string;
  /** 类全限定名（`<testcase classname="…">`）。 */
  classname: string;
  status: 'passed' | 'failed' | 'skipped';
  /** `time`（秒）换算的毫秒耗时；缺省 `time` 时无。 */
  duration?: number;
  /** `<failure>/<error>` 的 message 属性或文本（失败摘要来源）。 */
  message?: string;
}

/** vitest 报告解析上限（沿用 parseTestBinaryPath 的 2MB 先例；超大报告跳过，不猜状态）。 */
export const MAX_REPORT_CHARS = 2_000_000;

/** libtest 终态事件 → status 映射（started/suite 等非终态不进映射，直接丢弃）。 */
const LIBTEST_STATUS: Record<string, LibtestEvent['status']> = {
  ok: 'passed',
  failed: 'failed',
  ignored: 'ignored',
};

/**
 * 解析 libtest JSON Lines 输出。逐行尝试 JSON.parse：编译/运行横幅等非 JSON 行
 * 丢弃；`type: "test"` 的终态事件映射为用例结果，其余（started / suite / bench /
 * 未知 type）忽略。解析失败的行同样丢弃（降级不抛错）。
 */
export function parseLibtestJsonLines(text: string): LibtestEvent[] {
  const events: LibtestEvent[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;
    if (obj['type'] !== 'test') continue;
    const status = LIBTEST_STATUS[obj['event'] as string];
    if (!status) continue;
    const name = obj['name'];
    if (typeof name !== 'string' || name.length === 0) continue;
    const event: LibtestEvent = { name, status };
    const stdout = obj['stdout'];
    if (typeof stdout === 'string' && stdout.length > 0) event.stdout = stdout;
    const execTime = obj['exec_time'];
    if (typeof execTime === 'number' && Number.isFinite(execTime)) {
      event.duration = Math.round(execTime * 1000);
    }
    events.push(event);
  }
  return events;
}

/** go test2json 终态 Action → 统一 status（run/pause/cont/output 非终态不进映射）。 */
const GO2J_STATUS: Record<string, LibtestEvent['status']> = {
  pass: 'passed',
  fail: 'failed',
  skip: 'ignored',
};

/** go test `-v` 横幅行（输出清洗：`=== RUN/PAUSE/CONT <name>`、`--- PASS/FAIL/SKIP: <name>`）。 */
const GO_TEST_BANNER_LINE = /^(?:=== (?:RUN|PAUSE|CONT)|--- (?:PASS|FAIL|SKIP))/;

/**
 * 解析 `go test -json`（test2json）行式事件。逐行 JSON.parse，非 JSON 行丢弃；
 * 消费带 `Test` 字段的终态事件（pass/fail/skip），`Action: output` 累积到该用例
 * 的输出并在终态（failed）时作为 `stdout` 摘要携带（对齐 libtest `--show-output`）。
 * 包级事件（无 `Test` 字段）、run/pause/cont 及未知 Action 忽略。
 * 子测试在 `Test` 字段以 `/` 扁平（`TestFoo/sub`）——匹配时按源码 fn 名后缀对齐，
 * 无法对齐的子测试事件自然丢弃（首期不做 `t.Run` 识别，对齐 vscode-go 局限）。
 */
export function parseTest2JsonLines(text: string): LibtestEvent[] {
  const outputs: Record<string, string> = {};
  const events: LibtestEvent[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;
    const action = obj['Action'];
    const test = obj['Test'];
    if (typeof action !== 'string' || typeof test !== 'string' || test.length === 0) continue;
    if (action === 'output') {
      const chunk = obj['Output'];
      if (typeof chunk === 'string' && chunk.length > 0) {
        // 剥 go test `-v` 横幅（`=== RUN/PAUSE/CONT`、`--- PASS/FAIL/SKIP`）：
        // libtest 的 stdout 只含真实用例输出，对齐失败摘要语义。
        const cleaned = chunk
          .split('\n')
          .filter((l) => !GO_TEST_BANNER_LINE.test(l))
          .join('\n');
        if (cleaned.length > 0) outputs[test] = (outputs[test] ?? '') + cleaned;
      }
      continue;
    }
    const status = GO2J_STATUS[action];
    if (!status) continue;
    const event: LibtestEvent = { name: test, status };
    const elapsed = obj['Elapsed'];
    if (typeof elapsed === 'number' && Number.isFinite(elapsed)) {
      event.duration = Math.round(elapsed * 1000);
    }
    if (status === 'failed') {
      const stdout = outputs[test];
      if (stdout) event.stdout = stdout;
    }
    delete outputs[test];
    events.push(event);
  }
  return events;
}

/** vitest/jest 状态 → 统一 status（todo/pending 等非通过非失败态归入 skipped）。 */
const VITEST_STATUS: Record<string, VitestCaseResult['status']> = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  todo: 'skipped',
  pending: 'skipped',
};

/**
 * 解析 vitest JSON reporter 报告文本（`testResults[].assertionResults[]`）。
 * 超过 2MB 上限或 JSON 非法 → 空数组（调用方空结果语义 = 本次运行无状态可落）。
 */
export function parseVitestJsonReport(json: string): VitestCaseResult[] {
  if (json.length > MAX_REPORT_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const testResults = (parsed as Record<string, unknown>)['testResults'];
  if (!Array.isArray(testResults)) return [];

  const results: VitestCaseResult[] = [];
  for (const suite of testResults) {
    if (typeof suite !== 'object' || suite === null) continue;
    const assertions = (suite as Record<string, unknown>)['assertionResults'];
    if (!Array.isArray(assertions)) continue;
    for (const assertion of assertions) {
      if (typeof assertion !== 'object' || assertion === null) continue;
      const a = assertion as Record<string, unknown>;
      const status = VITEST_STATUS[a['status'] as string];
      const fullName = a['fullName'];
      if (!status || typeof fullName !== 'string' || fullName.length === 0) continue;
      const result: VitestCaseResult = { fullName, status };
      if (typeof a['duration'] === 'number' && Number.isFinite(a['duration'])) {
        result.duration = a['duration'];
      }
      const messages = a['failureMessages'];
      if (status === 'failed' && Array.isArray(messages) && typeof messages[0] === 'string') {
        result.message = messages[0];
      }
      results.push(result);
    }
  }
  return results;
}

/**
 * 解析 JUnit XML 报告文本（Surefire/Gradle/Console Launcher 兼容，`--reports-dir` 产物）。
 *
 * 每个 `<testcase name= classname= time=>` → 一条 `JunitTestCase`：
 * - `<failure>` / `<error>` 子节点 → `failed`（message 取属性或文本，作为失败摘要）；
 * - `<skipped>` 子节点 → `skipped`；
 * - 无子节点 → `passed`；
 * - `time`（秒）换算毫秒；`<testsuite>/<properties>/<system-out>` 等容器节点忽略。
 *
 * 超过 2MB 上限、XML 非法（DOMParser 解析错误 / 抛错）→ 空数组（调用方空结果语义 =
 * 本次运行无状态可落）。依赖 Web DOMParser（Tauri webview / jsdom 均可用，零依赖）。
 */
export function parseJunitXml(xml: string): JunitTestCase[] {
  if (xml.length > MAX_REPORT_CHARS) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return [];
  }
  // DOMParser 对非法 XML 会在文档里注入 <parsererror>（而非抛错）。
  if (doc.querySelector('parsererror')) return [];

  const results: JunitTestCase[] = [];
  const nodes = doc.getElementsByTagName('testcase');
  for (const tc of Array.from(nodes)) {
    const name = tc.getAttribute('name');
    const classname = tc.getAttribute('classname');
    if (!name || name.length === 0 || !classname || classname.length === 0) continue;
    const result: JunitTestCase = { name, classname, status: 'passed' };
    const failure = tc.getElementsByTagName('failure')[0] ?? tc.getElementsByTagName('error')[0];
    if (failure) {
      result.status = 'failed';
      result.message = failure.getAttribute('message') ?? failure.textContent?.trim() ?? 'failed';
    } else if (tc.getElementsByTagName('skipped').length > 0) {
      result.status = 'skipped';
    }
    const time = tc.getAttribute('time');
    if (time) {
      const secs = Number(time);
      if (Number.isFinite(secs)) result.duration = Math.round(secs * 1000);
    }
    results.push(result);
  }
  return results;
}

/**
 * 结果全限定名与源码用例名对齐：全等，或后缀匹配且边界为 libtest 的 `::` /
 * vitest 的空格分隔符。拒绝无边界后缀（`my_parse_simple` ≠ `parse_simple`）与
 * 参数化运行时名（`adds 1` 对不上源码模板名 `adds`）。
 */
export function matchCaseName(fullName: string, caseName: string): boolean {
  if (fullName === caseName) return true;
  return fullName.endsWith(`::${caseName}`) || fullName.endsWith(` ${caseName}`);
}
