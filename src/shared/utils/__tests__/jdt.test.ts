import { describe, expect, it } from 'vitest';

import { isJdtUri, jdtDisplayPath, tabLspDocumentUri } from '../jdt';

describe('isJdtUri — jdt:// 类文件 uri 判定', () => {
  it('只认完整 jdt:// 文法（可结构化解析）', () => {
    expect(isJdtUri('jdt://contents/java.base/java.lang/System.class?=x')).toBe(true);
    expect(isJdtUri('file:///repo/src/lib.rs')).toBe(false);
    expect(isJdtUri('jdt:/contents/java.base/System.class')).toBe(false);
    expect(isJdtUri('')).toBe(false);
  });
});

describe('jdtDisplayPath — 展示/标识路径推导', () => {
  it('contents/<module>/<pkg>.<Name>.class → jdt:/<module>/<pkg>/<Name>.java', () => {
    expect(
      jdtDisplayPath('jdt://contents/java.base/java.io/PrintStream.java?=jdtprobe_9532ff29/...'),
    ).toBe('jdt:/java.base/java/io/PrintStream.java');
    // 带包名的 .class 形态（反编译场景）：扩展名归一为 .java
    expect(
      jdtDisplayPath('jdt://contents/java.base/java.lang/System.class?=p1/=src/Main.java'),
    ).toBe('jdt:/java.base/java/lang/System.java');
    // 解析不出结构时回退原 uri（面包屑仍可辨识）
    expect(jdtDisplayPath('jdt://contents')).toBe('jdt://contents');
  });
});

describe('tabLspDocumentUri — tab 的 LSP 文档 uri 推导', () => {
  it('filePath 本身是 jdt://（旧版直接存原始 uri）→ 原样', () => {
    const uri = 'jdt://contents/java.base/java.lang/System.class?=p1';
    expect(tabLspDocumentUri({ filePath: uri })).toBe(uri);
  });

  it('content.path 是 jdt://（classContents 只读 buffer 恒如此）→ 用它', () => {
    const uri = 'jdt://contents/java.base/java.lang/System.class?=p1';
    expect(
      tabLspDocumentUri({
        filePath: 'jdt:/java.base/java/lang/System.java',
        content: { path: uri },
      }),
    ).toBe(uri);
  });

  it('都不是 → undefined（调用方回落 toFileUri 常规文档）', () => {
    expect(tabLspDocumentUri({ filePath: '/repo/src/A.java' })).toBeUndefined();
    expect(
      tabLspDocumentUri({ filePath: '/repo/src/A.java', content: { path: '/repo/src/A.java' } }),
    ).toBeUndefined();
  });
});
