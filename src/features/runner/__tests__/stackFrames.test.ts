import { describe, expect, it } from 'vitest';

import { buildStopLocation, pickStopFrame } from '../stackFrames';
import type { StackFrameDto } from '../types';

function frame(
  partial: Partial<StackFrameDto> & Pick<StackFrameDto, 'id' | 'name'>,
): StackFrameDto {
  return {
    line: 1,
    column: 1,
    sourcePath: null,
    ...partial,
  };
}

const PROJECT = '/Users/me/proj';
const GO_RUNTIME = '/usr/local/go/src/runtime/proc.go';
const JDK_CACHE =
  '/Users/me/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java';

describe('pickStopFrame — 停止位置 = 栈顶第一个带源码的帧', () => {
  it('should_pick_library_frame_over_caller_project_frame', () => {
    // 回归：单步进入 JDK 后编辑器必须跟栈顶帧。此前「优先项目帧」会把编辑器
    // 拉回调用方文件，表现为「无法跳转到 System.out.println」。
    const frames = [
      frame({ id: 1, name: 'PrintStream.println(String)', sourcePath: JDK_CACHE, line: 1167 }),
      frame({
        id: 2,
        name: 'ArrayTest.test1()',
        sourcePath: `${PROJECT}/src/test/ArrayTest.java`,
        line: 7,
      }),
    ];
    expect(pickStopFrame(frames)?.id).toBe(1);
  });

  it('should_pick_top_project_frame_when_it_has_a_source', () => {
    const frames = [
      frame({ id: 9, name: 'foo', sourcePath: `${PROJECT}/a.go`, line: 3 }),
      frame({ id: 8, name: 'runtime.main', sourcePath: GO_RUNTIME, line: 250 }),
    ];
    expect(pickStopFrame(frames)?.id).toBe(9);
  });

  it('should_skip_sourceless_top_frames_and_take_the_next_with_source', () => {
    // 栈顶是 native / JIT 帧（line=-1、无 source）→ 下探到最近的有源码帧
    const frames = [
      frame({ id: 1, name: 'LambdaForm$DMH/0x…invokeVirtual', sourcePath: null, line: -1 }),
      frame({ id: 2, name: 'LambdaForm$MH/0x…invoke', sourcePath: null, line: -1 }),
      frame({ id: 3, name: 'PrintStream.println(String)', sourcePath: JDK_CACHE, line: 1167 }),
    ];
    expect(pickStopFrame(frames)?.id).toBe(3);
  });

  it('should_accept_adapter_virtual_source_frames', () => {
    // 适配器自带源码（sourceReference）：无磁盘路径也算「有源码」，同样按栈序选
    const frames = [
      frame({ id: 1, name: 'remote.frame', sourceReference: 42, sourceName: 'Foo.java' }),
      frame({ id: 2, name: 'caller', sourcePath: `${PROJECT}/a.java` }),
    ];
    expect(pickStopFrame(frames)?.id).toBe(1);
  });

  it('should_ignore_non_positive_source_reference', () => {
    const frames = [
      frame({ id: 1, name: 'native', sourcePath: null, sourceReference: 0 }),
      frame({ id: 2, name: 'foo', sourcePath: GO_RUNTIME, line: 250 }),
    ];
    expect(pickStopFrame(frames)?.id).toBe(2);
  });

  it('should_return_null_when_no_frame_has_a_source', () => {
    const frames = [
      frame({ id: 1, name: 'native', sourcePath: null }),
      frame({ id: 2, name: 'native2', sourcePath: undefined }),
    ];
    expect(pickStopFrame(frames)).toBeNull();
  });

  it('should_return_null_for_empty_frames', () => {
    expect(pickStopFrame([])).toBeNull();
  });
});

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
