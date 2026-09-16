import { describe, expect, it } from 'vitest';

import {
  canonicalFsPath,
  fileRefFromLspUri,
  fileRefFromTabPath,
  isJdtRef,
  lspUriOf,
  sameIdentity,
  pathsContainFile,
  relativeToRoot,
  sameFile,
  sourceIdentityOf,
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

  it('非法百分号转义 → null（不抛 URIError，边界输入不得炸调用方）', () => {
    // `decodeURIComponent('%E0%A4%A')` 抛 URIError；真机某些客户端会发出未编码的裸 `%`。
    expect(fileRefFromLspUri('file:///repo/bad%E0%A4%A.ts')).toBeNull();
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

describe('sourceIdentityOf — 源码身份唯一入口（fs 拼根、jdt 绝不拼根）', () => {
  it('fs：与 canonicalFsPath 等价（相对拼根、绝对原样）', () => {
    expect(sourceIdentityOf('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(sourceIdentityOf('/repo', '/abs/a.ts')).toBe('/abs/a.ts');
    expect(sourceIdentityOf('/repo', 'src/a.ts')).toBe(canonicalFsPath('/repo', 'src/a.ts'));
  });

  it('jdt：展示路径原样保留，不得拼上项目根', () => {
    const display = 'jdt:/java.base/java/io/PrintStream.java';
    expect(sourceIdentityOf('/repo', display)).toBe(display);
    // 回归锁：canonicalFsPath 会拼根成 `<root>/jdt:/…`，adapter 侧就再也取不到
    // module/pkg 段（断点退化为默认包类名 → 永远 verified:false）。
    expect(canonicalFsPath('/repo', display)).toBe(`/repo/${display}`);
    expect(sourceIdentityOf('/repo', display)).not.toContain('/repo/jdt:');
  });

  it('jdt：反解析再规范化（.class 源 / 无包段都能收敛成同一身份）', () => {
    expect(sourceIdentityOf('/repo', 'jdt:/java.base/java.lang/System.class')).toBe(
      'jdt:/java.base/java/lang/System.java',
    );
    expect(sourceIdentityOf('/repo', 'jdt:/java.base/Foo.java')).toBe('jdt:/java.base/Foo.java');
  });

  it('jdt：跨 root 稳定（虚拟身份与项目根无关）', () => {
    const display = 'jdt:/java.base/java/lang/System.java';
    expect(sourceIdentityOf('/repo-a', display)).toBe(sourceIdentityOf('/repo-b', display));
  });
});

describe('sourceIdentityOf — JDK 缓存路径归一为 jdt 身份（同一份源码一种身份）', () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';

  it('jdk-src 布局（保留模块段）→ jdt:/<module>/<pkg…>/<Name>.java', () => {
    expect(sourceIdentityOf('/repo', CACHE)).toBe(JDT);
  });

  it('Windows 分隔符同样成立', () => {
    expect(
      sourceIdentityOf(
        '/repo',
        'C:\\Users\\u\\.neeko\\java-src-cache\\jdk-src-21\\java.base\\java\\io\\PrintStream.java',
      ),
    ).toBe(JDT);
  });

  it('依赖 jar 缓存（无模块段）→ canonical 路径身份（不复用 jdt，不影响正确性）', () => {
    const jarCache = '/h/.neeko/java-src-cache/junit-4.13.2/org/junit/Assert.java';
    expect(sourceIdentityOf('/repo', jarCache)).toBe(jarCache);
  });

  it('默认包 JDK 类（模块下直接是文件）→ canonical 路径身份', () => {
    const p = '/h/.neeko/java-src-cache/jdk-src-21/Foo.java';
    expect(sourceIdentityOf('/repo', p)).toBe(p);
  });

  it('非缓存路径：fs 拼根、jdt 原样', () => {
    expect(sourceIdentityOf('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(sourceIdentityOf('/repo', '/repo/src/a.ts')).toBe('/repo/src/a.ts');
    expect(sourceIdentityOf('/repo', JDT)).toBe(JDT);
  });

  it('幂等：归一结果再归一不变（tab 身份即规范身份）', () => {
    const once = sourceIdentityOf('/repo', CACHE);
    expect(sourceIdentityOf('/repo', once)).toBe(once);
  });
});

describe("sourceIdentityOf — 栈帧的 jdt uri 归一为同一 jdt 身份（B' 现场回归）", () => {
  const CACHE =
    '/Users/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';
  const JDT = 'jdt:/java.base/java/io/PrintStream.java';
  /** 真机实测形态：jdtls 内 java-debug 对 JDK / 依赖类返回的 `Source.path`。 */
  const FRAME_URI =
    'jdt://contents/java.base/java.io/PrintStream.class?=api/%5C/opt%5C/homebrew%5C/Cellar%5C/' +
    'openjdk%5C@21%5C/21.0.12.1%5C/libexec%5C/openjdk.jdk%5C/Contents%5C/Home%5C/lib%5C/' +
    'jrt-fs.jar%60java.base=/javadoc_location=/https:%5C/%5C/docs.oracle.com%5C/en%5C/java%5C/' +
    'javase%5C/21%5C/docs%5C/api%5C/=/=/maven.pomderived=/true=/%3Cjava.io(PrintStream.class';

  it('uri 与缓存路径收敛到**同一个**身份（否则 tab 分裂、断点 key 两套）', () => {
    expect(sourceIdentityOf('/repo', FRAME_URI)).toBe(JDT);
    expect(sourceIdentityOf('/repo', FRAME_URI)).toBe(sourceIdentityOf('/repo', CACHE));
  });

  it('uri 不被当成相对路径拼项目根（曾经的现场错误）', () => {
    expect(sourceIdentityOf('/repo', FRAME_URI)).not.toContain('/repo/jdt:');
  });

  it('fileRefFromTabPath 直接解析 uri（identity / loadPath 同源）', () => {
    expect(fileRefFromTabPath('/repo', FRAME_URI)).toEqual({
      kind: 'jdt',
      module: 'java.base',
      classPath: 'java/io',
      fileName: 'PrintStream.java',
    });
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

describe('pathsContainFile — file-changed 消费侧的唯一判定入口', () => {
  const ROOT = '/repo';
  const ABS = '/repo/docs/main.html';

  it('事件给项目相对路径（正常形态）→ 命中', () => {
    expect(pathsContainFile(ROOT, ['docs/main.html'], ABS)).toBe(true);
    expect(pathsContainFile(ROOT, ['other.html', 'docs/main.html'], ABS)).toBe(true);
  });

  it('事件回退为绝对路径（strip_prefix 失败）→ 仍命中', () => {
    expect(pathsContainFile(ROOT, [ABS], ABS)).toBe(true);
  });

  it('两侧形态不齐（重复/尾斜杠、反斜杠）→ 归一后仍命中', () => {
    expect(pathsContainFile(ROOT, ['docs//main.html'], ABS)).toBe(true);
    expect(pathsContainFile(`${ROOT}/`, ['docs/main.html'], ABS)).toBe(true);
    expect(pathsContainFile(ROOT, ['docs\\main.html'], ABS)).toBe(true);
    expect(pathsContainFile(ROOT, ['docs/main.html'], `${ABS}/`)).toBe(true);
  });

  it('别的文件 / 空列表 → 不命中', () => {
    expect(pathsContainFile(ROOT, ['docs/other.html'], ABS)).toBe(false);
    expect(pathsContainFile(ROOT, [], ABS)).toBe(false);
    // 仅同名的不同文件不得命中（旧的后缀匹配会误命中）
    expect(pathsContainFile(ROOT, ['/other/repo/docs/main.html'], ABS)).toBe(false);
  });
});

describe('sameIdentity — 两个源身份字符串是否同一文件', () => {
  it('形态差异（重复/尾斜杠、反斜杠）归一后相等', () => {
    expect(sameIdentity('/repo//a.go', '/repo/a.go')).toBe(true);
    expect(sameIdentity('/repo/a.go/', '/repo/a.go')).toBe(true);
    expect(sameIdentity('C:\\repo\\a.go', 'C:/repo/a.go')).toBe(true);
  });

  it('jdt 展示路径与适配器 uri 收敛为同一身份', () => {
    expect(
      sameIdentity(
        'jdt:/java.base/java/io/PrintStream.java',
        'jdt:/java.base/java/io/PrintStream.java',
      ),
    ).toBe(true);
  });

  it('不同文件 / 空值 → 不相等', () => {
    expect(sameIdentity('/a/x.go', '/b/x.go')).toBe(false);
    expect(sameIdentity('', '/repo/a.go')).toBe(false);
    expect(sameIdentity('/repo/a.go', '')).toBe(false);
  });

  it('不做相对/绝对混比与 basename 猜测（那属边界解析）', () => {
    expect(sameIdentity('/repo/a.go', 'a.go')).toBe(false);
    expect(sameIdentity('/repo/a.go', 'src/a.go')).toBe(false);
  });
});
