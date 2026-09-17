// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createStackFrame } from '@/testing/factories';

import { pickStopFrame } from '../stackFrames';

/** 帧夹具：字面量集中在 `@/testing/factories`，此处只缩短名字。 */
const frame = createStackFrame;

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
