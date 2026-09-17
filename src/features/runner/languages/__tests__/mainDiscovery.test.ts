// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { MainEntry } from '../../syntax/contract';
import { discoverRunTargets } from '../index';

const goDoc = `package main

import "fmt"

func main() {
	fmt.Println("hi")
}

func helper() {}
`;

const rustDoc = `fn main() {
    println!("hi");
}
`;

const javaDoc = `package com.example;

public class App {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}
`;

describe('discoverRunTargets.mains', () => {
  it('Go：识别 func main 行号，忽略注释', () => {
    const doc = `// func main() { not this
package main

func main() {
}
`;
    expect(discoverRunTargets('main.go', doc).mains).toEqual<MainEntry[]>([
      { line: 4, language: 'go' },
    ]);
  });

  it('Go：无 func main 返回空', () => {
    expect(
      discoverRunTargets('main.go', goDoc.replace('func main() {', 'func main2() {')).mains,
    ).toEqual([]);
  });

  it('Rust：识别 fn main 行号', () => {
    expect(discoverRunTargets('src/main.rs', rustDoc).mains).toEqual<MainEntry[]>([
      { line: 1, language: 'rust' },
    ]);
  });

  it('Rust：识别带修饰符的 fn main（async/pub/unsafe/extern）', () => {
    // `#[tokio::main] async fn main() -> anyhow::Result<()>` 是 async 应用的标准写法，
    // 行首不再是裸 `fn` —— 漏识别会导致 gutter 无 Run/Debug 按钮。
    const doc = `use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    Ok(())
}

pub async fn serve() {}
`;
    expect(discoverRunTargets('crates/api/src/main.rs', doc).mains).toEqual<MainEntry[]>([
      { line: 4, language: 'rust' },
    ]);
  });

  it('Rust：修饰符组合（可见性含括号 / async / unsafe / extern "C"）均识别', () => {
    const doc = [
      'pub async fn main() {}',
      'unsafe fn main() {}',
      'extern "C" fn main() {}',
      'pub unsafe extern "C" fn main() {}',
      'pub(crate) async fn main() {}',
      'pub(super) fn main() {}',
      'pub(in crate::cli) async unsafe fn main() {}',
      'pub(crate) fn main () {}',
    ].join('\n');
    expect(discoverRunTargets('main.rs', doc).mains).toEqual<MainEntry[]>([
      { line: 1, language: 'rust' },
      { line: 2, language: 'rust' },
      { line: 3, language: 'rust' },
      { line: 4, language: 'rust' },
      { line: 5, language: 'rust' },
      { line: 6, language: 'rust' },
      { line: 7, language: 'rust' },
      { line: 8, language: 'rust' },
    ]);
  });

  it('Rust：非 main 函数（含 async serve / main_helper）不误报', () => {
    const doc = `async fn serve() {}
fn main_helper() {}
fn domain() {}
`;
    expect(discoverRunTargets('main.rs', doc).mains).toEqual([]);
  });

  it('Rust：非 .rs 文件不识别', () => {
    expect(discoverRunTargets('src/lib.ts', rustDoc).mains).toEqual([]);
  });

  it('Java：识别 static void main（String[] 与 String... 变体）', () => {
    expect(discoverRunTargets('App.java', javaDoc).mains).toEqual<MainEntry[]>([
      { line: 4, language: 'java' },
    ]);
    const varargs = javaDoc.replace('String[] args', 'String... args');
    expect(discoverRunTargets('App.java', varargs).mains).toEqual<MainEntry[]>([
      { line: 4, language: 'java' },
    ]);
  });

  it('Java：main 非行首 / 非 void / 注释内不识别', () => {
    const doc = `public class A {
  // public static void main(String[] args) { }
  private void notMain() {}
  public void main(String[] args) {}
}
`;
    expect(discoverRunTargets('A.java', doc).mains).toEqual([]);
  });

  it('Java：多修饰符组合识别；无参 / 非 String[] 形参不识别（AST）', () => {
    const decorated = `public class A {
  public static final synchronized void main(String[] args) {}
}
`;
    expect(discoverRunTargets('A.java', decorated).mains).toEqual<MainEntry[]>([
      { line: 2, language: 'java' },
    ]);

    const noArgs = `public class A {
  public static void main() {}
}
`;
    const wrongParam = `public class A {
  public static void main(int argc) {}
}
`;
    expect(discoverRunTargets('A.java', noArgs).mains).toEqual([]);
    expect(discoverRunTargets('A.java', wrongParam).mains).toEqual([]);
  });

  it('其他扩展名返回空', () => {
    expect(discoverRunTargets('a.ts', goDoc).mains).toEqual([]);
    expect(discoverRunTargets('a.py', goDoc).mains).toEqual([]);
  });
});
