import { describe, expect, it } from 'vitest';

import { createStackFrame } from '@/testing/factories';

import { buildStopLocation, withStopLocation } from '../stopLocation';
import type { StopLocation, StopLocationState } from '../stopLocation';

/** 帧夹具：字面量集中在 `@/testing/factories`，此处只缩短名字。 */
const frame = createStackFrame;

const PROJECT = '/Users/me/proj';
const JDK_CACHE =
  '/Users/me/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';

describe('buildStopLocation — 帧 → 停止位置（唯一构造点，规范身份）', () => {
  it('should_keep_absolute_project_path_as_canonical_identity', () => {
    const loc = buildStopLocation(
      frame({ id: 1, name: 'foo', sourcePath: `${PROJECT}/src/main.rs`, line: 12, column: 4 }),
      PROJECT,
    );

    expect(loc).toEqual({ identity: `${PROJECT}/src/main.rs`, line: 12, column: 4 });
  });

  it('should_join_project_root_for_relative_paths', () => {
    // 身份必须经 sourceIdentityOf 归一（相对路径拼根），不得透传原始 sourcePath。
    expect(
      buildStopLocation(frame({ id: 1, name: 'foo', sourcePath: 'src/main.rs' }), PROJECT),
    ).toEqual({ identity: `${PROJECT}/src/main.rs`, line: 1, column: 1 });
  });

  it('should_normalize_jdk_cache_path_to_jdt_identity', () => {
    // 同一份 JDK 源码（解压缓存 / Cmd+Click 的 jdt 页 / 适配器 jdt uri）只允许一种身份，
    // 否则 tab / 断点 key / 黄线会分裂成两套。
    expect(
      buildStopLocation(
        frame({ id: 1, name: 'println', sourcePath: JDK_CACHE, line: 1167 }),
        PROJECT,
      )?.identity,
    ).toBe('jdt:/java.base/java/io/PrintStream.java');
  });

  it('should_normalize_adapter_jdt_uri_to_the_same_jdt_identity', () => {
    const uri = 'jdt://contents/java.base/java.io/PrintStream.class?=neeko/q';

    expect(
      buildStopLocation(frame({ id: 1, name: 'println', sourcePath: uri }), PROJECT)?.identity,
    ).toBe('jdt:/java.base/java/io/PrintStream.java');
  });

  it('should_build_virtual_identity_from_source_reference', () => {
    expect(
      buildStopLocation(
        frame({ id: 1, name: 'remote', sourceReference: 42, sourceName: 'Foo.java', line: 7 }),
        PROJECT,
      ),
    ).toEqual({ identity: 'dap-source:/42/Foo.java', line: 7, column: 1 });
  });

  it('should_fall_back_to_source_when_virtual_source_name_is_blank', () => {
    expect(
      buildStopLocation(
        frame({ id: 1, name: 'remote', sourceReference: 42, sourceName: '   ' }),
        PROJECT,
      )?.identity,
    ).toBe('dap-source:/42/source');
  });

  it('should_prefer_source_path_over_source_reference', () => {
    const loc = buildStopLocation(
      frame({
        id: 1,
        name: 'foo',
        sourcePath: `${PROJECT}/a.go`,
        sourceReference: 42,
        sourceName: 'a.go',
      }),
      PROJECT,
    );

    expect(loc?.identity).toBe(`${PROJECT}/a.go`);
  });

  it('should_return_null_when_frame_has_no_source_entry', () => {
    expect(
      buildStopLocation(frame({ id: 1, name: 'native', sourceReference: 0 }), PROJECT),
    ).toBeNull();
    expect(buildStopLocation(frame({ id: 1, name: 'native' }), PROJECT)).toBeNull();
  });

  it('should_return_null_when_line_is_not_addressable', () => {
    // 有源码但行号非法（native / JIT 帧）：不构成可跳转的停点，不得产出 line<1 的位置。
    expect(
      buildStopLocation(
        frame({ id: 1, name: 'jit', sourcePath: `${PROJECT}/a.go`, line: -1 }),
        PROJECT,
      ),
    ).toBeNull();
    expect(
      buildStopLocation(
        frame({ id: 1, name: 'jit', sourcePath: `${PROJECT}/a.go`, line: 0 }),
        PROJECT,
      ),
    ).toBeNull();
  });
});

describe('withStopLocation — 位置状态对（位置 + 严格单调序号）', () => {
  const IDLE: StopLocationState = { location: null, locationSeq: 0 };
  const AT_7: StopLocation = { identity: `${PROJECT}/src/main.rs`, line: 7, column: 1 };

  it('should_write_location_and_increment_seq', () => {
    expect(withStopLocation(IDLE, AT_7)).toEqual({ location: AT_7, locationSeq: 1 });
  });

  it('should_treat_clear_as_an_event_and_still_increment_seq', () => {
    // 清空也是位置事件：只把 location 置 null 而不动序号，编辑器会把「清空」当成同一次事件
    // 而不释放光标（切片 1+2 的 T6–T10 就是在锁这条）。
    expect(withStopLocation({ location: AT_7, locationSeq: 3 }, null)).toEqual({
      location: null,
      locationSeq: 4,
    });
  });

  it('should_increment_seq_even_when_the_location_value_is_identical', () => {
    // 同一断点在循环里连续命中：字段逐字相等，只有序号能区分「又停了一次」。
    const again = { ...AT_7 };
    expect(withStopLocation({ location: AT_7, locationSeq: 1 }, again).locationSeq).toBe(2);
  });

  it('should_not_mutate_the_current_state', () => {
    const current: StopLocationState = { location: AT_7, locationSeq: 1 };
    withStopLocation(current, null);
    expect(current).toEqual({ location: AT_7, locationSeq: 1 });
  });
});
