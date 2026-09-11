import { describe, expect, it } from 'vitest';

import { type MainEntry } from '../mainEntries';
import { parseMainEntries } from '../runLanguages';

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

describe('parseMainEntries', () => {
  it('Go：识别 func main 行号，忽略注释', () => {
    const doc = `// func main() { not this
package main

func main() {
}
`;
    expect(parseMainEntries('main.go', doc)).toEqual<MainEntry[]>([{ line: 4, language: 'go' }]);
  });

  it('Go：无 func main 返回空', () => {
    expect(parseMainEntries('main.go', goDoc.replace('func main() {', 'func main2() {'))).toEqual(
      [],
    );
  });

  it('Rust：识别 fn main 行号', () => {
    expect(parseMainEntries('src/main.rs', rustDoc)).toEqual<MainEntry[]>([
      { line: 1, language: 'rust' },
    ]);
  });

  it('Rust：非 .rs 文件不识别', () => {
    expect(parseMainEntries('src/lib.ts', rustDoc)).toEqual([]);
  });

  it('Java：识别 static void main（String[] 与 String... 变体）', () => {
    expect(parseMainEntries('App.java', javaDoc)).toEqual<MainEntry[]>([
      { line: 4, language: 'java' },
    ]);
    const varargs = javaDoc.replace('String[] args', 'String... args');
    expect(parseMainEntries('App.java', varargs)).toEqual<MainEntry[]>([
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
    expect(parseMainEntries('A.java', doc)).toEqual([]);
  });

  it('其他扩展名返回空', () => {
    expect(parseMainEntries('a.ts', goDoc)).toEqual([]);
    expect(parseMainEntries('a.py', goDoc)).toEqual([]);
  });
});
