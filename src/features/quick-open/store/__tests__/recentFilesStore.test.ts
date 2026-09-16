/**
 * 「最近文件」的**去重键**是「是不是同一个文件」的判定 —— 必须落在身份上。
 *
 * 原实现只做 `\`→`/`（`prev.filter((e) => e.filePath !== norm)`）：同一文件的非规范写法
 * （重复斜杠 / 尾斜杠）会被当成两个文件，列表里出现重复条目。修复走身份所有者
 * （`sameIdentity`），与切片 3 的其余身份收敛同一条不变式。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useRecentFilesStore } from '../recentFilesStore';

describe('recentFilesStore — 去重键走身份（同一文件只留一条 MRU）', () => {
  beforeEach(() => {
    useRecentFilesStore.setState({ byProject: {} });
  });

  it('形态差异（反斜杠）不产生重复条目 —— 对照组（原实现已覆盖）', () => {
    const { record, list } = useRecentFilesStore.getState();
    record('p1', 'C:\\repo\\a.ts');
    record('p1', 'C:/repo/a.ts');

    expect(list('p1')).toHaveLength(1);
  });

  it('形态差异（重复斜杠 / 尾斜杠）同样不产生重复条目', () => {
    const { record, list } = useRecentFilesStore.getState();
    record('p1', '/repo//a.ts');
    record('p1', '/repo/a.ts');
    record('p1', '/repo/a.ts/');

    expect(list('p1')).toHaveLength(1);
  });

  it('重复记录会把该条提升到最前（MRU 语义不因去重丢失）', () => {
    const { record, list } = useRecentFilesStore.getState();
    record('p1', '/repo/a.ts');
    record('p1', '/repo/b.ts');
    record('p1', '/repo//a.ts');

    expect(list('p1').map((e) => e.filePath)).toEqual(['/repo//a.ts', '/repo/b.ts']);
  });

  it('虚拟源码身份（dap-source:）同样按身份去重', () => {
    const { record, list } = useRecentFilesStore.getState();
    record('p1', 'dap-source:/42/Foo.java');
    record('p1', 'dap-source:/42/Foo.java');

    expect(list('p1')).toHaveLength(1);
  });

  it('不同文件各自一条；空入参不记录', () => {
    const { record, list } = useRecentFilesStore.getState();
    record('p1', '/repo/a.ts');
    record('p1', '/repo/b.ts');
    record('', '/repo/c.ts');
    record('p1', '');

    expect(list('p1').map((e) => e.filePath)).toEqual(['/repo/b.ts', '/repo/a.ts']);
  });
});
