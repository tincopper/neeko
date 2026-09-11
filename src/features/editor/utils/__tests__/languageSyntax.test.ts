import { describe, expect, it } from 'vitest';

import {
  GO_FUNC_DECL,
  JAVA_MAIN_DECL,
  JAVA_VOID_METHOD_DECL,
  RUST_FN_DECL,
} from '../languageSyntax';

/**
 * 漂移护栏：这些模式是「同一件事只写一次」的唯一落点 —— 之前 `RUST_FN_LINE`
 * （测试名，含 `async`）与 `RUST_MAIN_LINE`（main 入口，不含）各写一份并漂移，
 * 导致 `#[tokio::main] async fn main()` 没有 Run/Debug 按钮。本文件把「一个模式
 * 同时满足两类消费方（取名字 / 判 main）」钉住。
 */
describe('languageSyntax — 单一事实源', () => {
  const rustNames = (doc: string): (string | null)[] =>
    doc.split('\n').map((line) => RUST_FN_DECL.exec(line.trimStart())?.[1] ?? null);

  it('Rust：一个模式同时覆盖「取函数名」与「判 main」（含修饰符）', () => {
    const doc = [
      'fn main() {',
      'async fn serve() {}',
      'pub async fn main() {}',
      'pub(crate) async fn main() {}',
      'pub(super) fn main() {}',
      'pub(in crate::a) fn main() {}',
      'unsafe fn main() {}',
      'extern "C" fn main() {}',
      'pub async unsafe extern "C" fn main() {}',
      '#[tokio::main]',
      'fn main_helper() {}',
      '#[test]',
      'fn parse_simple() {}',
      '#[tokio::test]',
      'async fn adds_async() {}',
    ].join('\n');
    expect(rustNames(doc)).toEqual([
      'main',
      'serve',
      'main',
      'main',
      'main',
      'main',
      'main',
      'main',
      'main',
      null, // 属性行本身不是函数声明
      'main_helper',
      null,
      'parse_simple',
      null,
      'adds_async',
    ]);
  });

  it('Rust：缩进/制表符由消费方 trimStart（模式本身不吞前导空白）', () => {
    expect(RUST_FN_DECL.exec('    pub(crate) fn main()'.trimStart())?.[1]).toBe('main');
    expect(RUST_FN_DECL.exec('\tasync fn helper()'.trimStart())?.[1]).toBe('helper');
    // 未 trim 的行首空白不匹配（契约：模式锚定行首，消费方负责 trim）
    expect(RUST_FN_DECL.exec('    pub(crate) fn main()')?.[1] ?? null).toBeNull();
  });

  it('Rust：不误报非函数行', () => {
    const lines = ['let x = 1;', '// fn main() {', 'serve();', 'fn() {}', 'fnx() {}'];
    const captured = lines.map((line) => [line, RUST_FN_DECL.exec(line)?.[1] ?? null]);
    expect(captured).toEqual([
      ['let x = 1;', null],
      ['// fn main() {', null],
      ['serve();', null],
      ['fn() {}', null],
      ['fnx() {}', null],
    ]);
  });

  it('Go：取函数名且不匹配方法接收者形态', () => {
    expect(GO_FUNC_DECL.exec('func main() {')?.[1]).toBe('main');
    expect(GO_FUNC_DECL.exec('func TestAdd(t *testing.T) {')?.[1]).toBe('TestAdd');
    expect(GO_FUNC_DECL.exec('func main_helper() {')?.[1]).toBe('main_helper');
    // 接收者形态（`func (s *Suite) TestX()`）不参与入口检测
    expect(GO_FUNC_DECL.exec('func (s *Suite) TestX() {}')?.[1] ?? null).toBeNull();
  });

  it('Java：void 方法取名 + main 需 static 与 String[]/String... 参数', () => {
    expect(JAVA_VOID_METHOD_DECL.exec('public void testAdd() {')?.[1]).toBe('testAdd');
    expect(JAVA_VOID_METHOD_DECL.exec('static void main(String[] args)')?.[1]).toBe('main');

    expect(JAVA_MAIN_DECL.test('public static void main(String[] args) {')).toBe(true);
    expect(JAVA_MAIN_DECL.test('public static final void main(String... args) {')).toBe(true);
    expect(JAVA_MAIN_DECL.test('static void main(final String[] args) {')).toBe(true);
    // 非 static / 非 String[] 参数 → 不是入口
    expect(JAVA_MAIN_DECL.test('public void main(String[] args) {')).toBe(false);
    expect(JAVA_MAIN_DECL.test('public static void main() {')).toBe(false);
    expect(JAVA_MAIN_DECL.test('public static void main(int argc) {')).toBe(false);
  });

  it('Java：修饰符集合含 static/strictfp（两种历史写法的并集）', () => {
    expect(JAVA_VOID_METHOD_DECL.test('public static final synchronized void t()')).toBe(true);
    expect(JAVA_VOID_METHOD_DECL.test('protected strictfp void t()')).toBe(true);
  });
});
