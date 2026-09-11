import { describe, expect, it } from 'vitest';

import {
  canonicalFsPath,
  fileRefFromLspUri,
  fileRefFromTabPath,
  isJdtRef,
  lspUriOf,
  relativeToRoot,
  sameFile,
  tabIdentityOf,
  type FileRef,
} from '../fileRef';

/** 从 LSP uri 取 jdt ref（测试断言用；非 jdt uri 直接失败）。 */
function jdtRef(uri: string): Extract<FileRef, { kind: 'jdt' }> {
  const ref = fileRefFromLspUri(uri);
  if (!ref || ref.kind !== 'jdt') throw new Error(`not a jdt uri: ${uri}`);
  return ref;
}

describe('canonicalFsPath — 边界归一（lexical only）', () => {
  it('相对路径拼项目根（root 去尾斜杠）', () => {
    expect(canonicalFsPath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(canonicalFsPath('/repo/', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(canonicalFsPath('/repo//', 'src/a.ts')).toBe('/repo/src/a.ts');
  });

  it('绝对路径不拼 root（仅做斜杠/尾斜杠归一）', () => {
    expect(canonicalFsPath('/repo', '/abs/a.ts')).toBe('/abs/a.ts');
    expect(canonicalFsPath('/repo', '/abs/a/')).toBe('/abs/a');
    expect(canonicalFsPath('/repo', '/abs//a')).toBe('/abs/a');
  });

  it('反斜杠统一为斜杠（Windows 输入）', () => {
    expect(canonicalFsPath('/repo', 'src\\a.ts')).toBe('/repo/src/a.ts');
    expect(canonicalFsPath('C:\\repo', 'src\\a.ts')).toBe('C:/repo/src/a.ts');
    expect(canonicalFsPath('C:\\repo', 'C:\\other\\a.ts')).toBe('C:/other/a.ts');
  });

  it('盘符开头视为绝对路径，不拼 root', () => {
    expect(canonicalFsPath('/repo', 'C:/other/a.ts')).toBe('C:/other/a.ts');
    expect(canonicalFsPath('C:\\repo', 'c:/other/a.ts')).toBe('c:/other/a.ts');
  });

  it('消除连续斜杠与尾斜杠', () => {
    expect(canonicalFsPath('/repo', 'src//a.ts')).toBe('/repo/src/a.ts');
    expect(canonicalFsPath('/repo', 'src/a/')).toBe('/repo/src/a');
  });

  it('UNC //host 前缀保留（host 不静默丢弃，与 file:// uri 解析自洽）', () => {
    expect(canonicalFsPath('//server/share', 'src/a.ts')).toBe('//server/share/src/a.ts');
    expect(canonicalFsPath('/repo', '//server/share/src/a.ts')).toBe('//server/share/src/a.ts');
    expect(canonicalFsPath('/repo', '\\\\server\\share\\src\\a.ts')).toBe(
      '//server/share/src/a.ts',
    );
  });

  it('不解析 ..（lexical only，后端读取前 canonicalize 兜底）', () => {
    expect(canonicalFsPath('/repo', 'a/../b.ts')).toBe('/repo/a/../b.ts');
  });

  it('空路径回落到归一后的 root', () => {
    expect(canonicalFsPath('/repo', '')).toBe('/repo');
  });
});

describe('fileRefFromLspUri — file:// 边界（new URL + 逐段 decode）', () => {
  it('标准 file uri → fs ref', () => {
    expect(fileRefFromLspUri('file:///repo/src/a.ts')).toEqual({
      kind: 'fs',
      path: '/repo/src/a.ts',
    });
  });

  it('pathname 逐段 decodeURIComponent（%20 空格）', () => {
    expect(fileRefFromLspUri('file:///repo/my%20file.ts')).toEqual({
      kind: 'fs',
      path: '/repo/my file.ts',
    });
  });

  it('Windows 盘符：host 空 + pathname /C:/ 前缀去前导斜杠', () => {
    expect(fileRefFromLspUri('file:///C:/repo/a.ts')).toEqual({
      kind: 'fs',
      path: 'C:/repo/a.ts',
    });
  });

  it('非 file/jdt scheme → null', () => {
    expect(fileRefFromLspUri('untitled:foo')).toBeNull();
    expect(fileRefFromLspUri('https://example.com/a.ts')).toBeNull();
    expect(fileRefFromLspUri('')).toBeNull();
  });
});

describe('fileRefFromLspUri — jdt:// 文法解析（模块内唯一正则）', () => {
  it('contents uri 三段结构化（包点转斜杠），query 忽略', () => {
    expect(jdtRef('jdt://contents/java.base/java.io/PrintStream.java?=jdtprobe_x/...')).toEqual({
      kind: 'jdt',
      module: 'java.base',
      classPath: 'java/io',
      fileName: 'PrintStream.java',
    });
    expect(jdtRef('jdt://contents/java.base/java.lang/System.class?=p1/=src/Main.java')).toEqual({
      kind: 'jdt',
      module: 'java.base',
      classPath: 'java/lang',
      fileName: 'System.java',
    });
  });

  it('扩展名归一为 .java：.class（反编译）与 .java（带源码）是同一类的两种载体', () => {
    expect(fileRefFromLspUri('jdt://contents/java.base/java.lang/System.class')).toEqual(
      fileRefFromLspUri('jdt://contents/java.base/java.lang/System.java'),
    );
  });

  it('多段包路径逐段转斜杠', () => {
    expect(jdtRef('jdt://contents/m/a.b/C.java')).toEqual({
      kind: 'jdt',
      module: 'm',
      classPath: 'a/b',
      fileName: 'C.java',
    });
  });

  it('无包段：contents/<module>/<Name>.<ext>', () => {
    expect(jdtRef('jdt://contents/java.base/Foo.class')).toEqual({
      kind: 'jdt',
      module: 'java.base',
      classPath: '',
      fileName: 'Foo.java',
    });
  });

  it('非 contents / 结构不完整 → null', () => {
    expect(fileRefFromLspUri('jdt://contents')).toBeNull();
    expect(fileRefFromLspUri('jdt://contents/java.base')).toBeNull();
    expect(fileRefFromLspUri('jdt://contents/java.base/System')).toBeNull();
    // 单斜杠是展示路径形态，不是 LSP uri
    expect(fileRefFromLspUri('jdt:/contents/java.base/System.class')).toBeNull();
  });
});

describe('tabIdentityOf — tab 身份字符串（与旧 jdtClassDisplayPath 输出逐字一致）', () => {
  it('jdt → jdt:/<module>/<classPath>/<fileName>', () => {
    expect(tabIdentityOf(jdtRef('jdt://contents/java.base/java.io/PrintStream.java?=q'))).toBe(
      'jdt:/java.base/java/io/PrintStream.java',
    );
  });

  it('.class 源归一到 .java 身份（格式锁）', () => {
    expect(tabIdentityOf(jdtRef('jdt://contents/java.base/java.lang/System.class?=p1'))).toBe(
      'jdt:/java.base/java/lang/System.java',
    );
  });

  it('无包段不留双斜杠', () => {
    expect(tabIdentityOf(jdtRef('jdt://contents/java.base/Foo.class'))).toBe(
      'jdt:/java.base/Foo.java',
    );
  });

  it('fs → path 原样', () => {
    expect(tabIdentityOf(fileRefFromTabPath('/repo', 'src/a.ts'))).toBe('/repo/src/a.ts');
    expect(tabIdentityOf(fileRefFromTabPath('/repo', '/abs/a.ts'))).toBe('/abs/a.ts');
  });
});

describe('fileRefFromTabPath — tab path 反解析', () => {
  it('空串/相对路径 → fs canonical', () => {
    expect(fileRefFromTabPath('/repo', '')).toEqual({ kind: 'fs', path: '/repo' });
    expect(fileRefFromTabPath('/repo', 'src/a.ts')).toEqual({
      kind: 'fs',
      path: '/repo/src/a.ts',
    });
    expect(fileRefFromTabPath('/repo', '/repo/src/a.ts')).toEqual({
      kind: 'fs',
      path: '/repo/src/a.ts',
    });
  });

  it('jdt 展示路径 → jdt ref，tabIdentityOf 幂等（round-trip）', () => {
    const display = 'jdt:/java.base/java/lang/System.java';
    const ref = fileRefFromTabPath('/repo', display);
    expect(ref).toEqual({
      kind: 'jdt',
      module: 'java.base',
      classPath: 'java/lang',
      fileName: 'System.java',
    });
    expect(tabIdentityOf(ref)).toBe(display);
  });
});

describe('sameFile — 身份相等只在 FileRef 形态上比较', () => {
  it('fs/fs 比 path；相对与绝对归一后相等', () => {
    expect(
      sameFile(fileRefFromTabPath('/repo', 'src/a.ts'), fileRefFromTabPath('/repo', 'src/a.ts')),
    ).toBe(true);
    expect(
      sameFile(fileRefFromTabPath('/repo', 'src/a.ts'), fileRefFromTabPath('/repo', 'src/b.ts')),
    ).toBe(false);
    expect(
      sameFile(
        fileRefFromTabPath('/repo', 'src/a.ts'),
        fileRefFromTabPath('/repo', '/repo/src/a.ts'),
      ),
    ).toBe(true);
  });

  it('jdt/jdt 比 module+classPath+fileName', () => {
    const a = fileRefFromTabPath('/repo', 'jdt:/java.base/java/lang/System.java');
    const b = fileRefFromTabPath('/repo', 'jdt:/java.base/java/lang/System.java');
    const c = fileRefFromTabPath('/repo', 'jdt:/java.base/java/lang/List.java');
    const d = fileRefFromTabPath('/repo', 'jdt:/java.compiler/javax/lang/System.java');
    expect(sameFile(a, b)).toBe(true);
    expect(sameFile(a, c)).toBe(false);
    expect(sameFile(a, d)).toBe(false);
  });

  it('跨 kind 恒 false', () => {
    expect(
      sameFile(
        fileRefFromLspUri('file:///repo/src/a.ts'),
        fileRefFromLspUri('jdt://contents/java.base/java.io/PrintStream.java'),
      ),
    ).toBe(false);
  });

  it('jdt uri 与 jdt 展示路径收敛为同一身份（canonical 化核心收益）', () => {
    const fromUri = fileRefFromLspUri('jdt://contents/java.base/java.lang/System.class?=p1');
    const fromTab = fileRefFromTabPath('/repo', 'jdt:/java.base/java/lang/System.java');
    expect(fromUri).not.toBeNull();
    expect(sameFile(fromUri!, fromTab)).toBe(true);
  });

  it('UNC：file:// host 形态 uri 与 tab 路径（正/反斜杠）收敛为同一身份', () => {
    const fromUri = fileRefFromLspUri('file://server/share/src/a.ts');
    expect(fromUri).toEqual({ kind: 'fs', path: '//server/share/src/a.ts' });
    expect(sameFile(fromUri!, fileRefFromTabPath('/repo', '//server/share/src/a.ts'))).toBe(true);
    expect(sameFile(fromUri!, fileRefFromTabPath('/repo', '\\\\server\\share\\src\\a.ts'))).toBe(
      true,
    );
  });
});

describe('relativeToRoot — 展示用剥根（canonicalFsPath 拼根的逆，非身份比较）', () => {
  it('root 下绝对路径 → 相对路径', () => {
    expect(relativeToRoot('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('不在 root 下 → 原样', () => {
    expect(relativeToRoot('/repo', '/other/a.ts')).toBe('/other/a.ts');
  });

  it('相对路径 → 原样', () => {
    expect(relativeToRoot('/repo', 'src/a.ts')).toBe('src/a.ts');
  });

  it('空 root → 原样', () => {
    expect(relativeToRoot('', '/repo/a.ts')).toBe('/repo/a.ts');
  });

  it('反斜杠统一后剥根', () => {
    expect(relativeToRoot('/repo', '\\repo\\src\\a.ts')).toBe('src/a.ts');
  });

  it('前缀必须整段匹配（/repoX 不误剥）', () => {
    expect(relativeToRoot('/repo', '/repoX/a.ts')).toBe('/repoX/a.ts');
  });

  it('jdt 展示路径不受影响（非 fs 路径）', () => {
    expect(relativeToRoot('/repo', 'jdt:/java.base/java/lang/System.java')).toBe(
      'jdt:/java.base/java/lang/System.java',
    );
  });

  it('与 canonicalFsPath 互逆（root 下绝对路径）', () => {
    expect(canonicalFsPath('/repo', relativeToRoot('/repo', '/repo/src/a.ts'))).toBe(
      '/repo/src/a.ts',
    );
  });
});

describe('lspUriOf — LSP 文档 uri 推导', () => {
  it('fs → file://<path>', () => {
    expect(lspUriOf(fileRefFromTabPath('/repo', 'a.ts'))).toBe('file:///repo/a.ts');
  });

  it('jdt 无 query → null（原始 uri 不可从 canonical 身份重建）', () => {
    expect(
      lspUriOf(fileRefFromTabPath('/repo', 'jdt:/java.base/java/lang/System.java')),
    ).toBeNull();
  });

  it('jdt 带 query → 重建 contents uri（classPath 反转回点分包）', () => {
    const ref = fileRefFromTabPath('/repo', 'jdt:/java.base/java/lang/System.java');
    expect(lspUriOf(ref, { jdtQuery: 'p1/x' })).toBe(
      'jdt://contents/java.base/java.lang/System.java?p1/x',
    );
  });
});

describe('isJdtRef', () => {
  it('按 kind 判定', () => {
    expect(isJdtRef(jdtRef('jdt://contents/java.base/Foo.class'))).toBe(true);
    expect(isJdtRef(fileRefFromTabPath('/repo', 'src/a.ts'))).toBe(false);
  });
});
