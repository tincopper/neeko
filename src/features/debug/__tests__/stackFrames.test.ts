import { describe, expect, it } from 'vitest';

import {
  hasUserProjectFrame,
  isSystemDebugSource,
  isUserProjectFrame,
  pickNavigateFrame,
  shouldAutoContinueSystemStop,
} from '../stackFrames';
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

describe('isSystemDebugSource', () => {
  it('should_treat_empty_as_system', () => {
    expect(isSystemDebugSource(null)).toBe(true);
    expect(isSystemDebugSource('')).toBe(true);
  });

  it('should_detect_go_runtime_paths', () => {
    expect(isSystemDebugSource('/usr/local/go/src/runtime/proc.go')).toBe(true);
    expect(isSystemDebugSource('/home/x/go/pkg/mod/github.com/foo@v1/x.go')).toBe(true);
    expect(isSystemDebugSource('C:\\Go\\src\\runtime\\proc.go')).toBe(true);
  });

  it('should_not_flag_project_main', () => {
    expect(isSystemDebugSource('/Users/me/proj/cmd/app/main.go')).toBe(false);
  });

  it('should_not_flag_project_package_named_like_stdlib', () => {
    // Project-local `src/os` must not be treated as GOROOT.
    expect(isSystemDebugSource('/Users/me/proj/src/os/handler.go')).toBe(false);
  });
});

describe('pickNavigateFrame', () => {
  const project = '/Users/me/proj';

  it('should_prefer_user_frame_when_runtime_is_top', () => {
    const frames = [
      frame({
        id: 1,
        name: 'runtime.main',
        sourcePath: '/usr/local/go/src/runtime/proc.go',
        line: 250,
      }),
      frame({
        id: 2,
        name: 'main.main',
        sourcePath: `${project}/cmd/app/main.go`,
        line: 12,
      }),
    ];
    const picked = pickNavigateFrame(frames, project);
    expect(picked?.id).toBe(2);
    expect(picked?.line).toBe(12);
  });

  it('should_return_null_when_only_system_frames', () => {
    const frames = [
      frame({
        id: 1,
        name: 'runtime.exit',
        sourcePath: '/usr/local/go/src/runtime/proc.go',
        line: 10,
      }),
      frame({
        id: 2,
        name: 'runtime.main',
        sourcePath: '/usr/local/go/src/runtime/proc.go',
        line: 20,
      }),
    ];
    expect(pickNavigateFrame(frames, project)).toBeNull();
    expect(hasUserProjectFrame(frames, project)).toBe(false);
  });

  it('should_use_top_user_frame_when_all_user', () => {
    const frames = [
      frame({
        id: 9,
        name: 'foo',
        sourcePath: `${project}/a.go`,
        line: 3,
      }),
      frame({
        id: 8,
        name: 'main.main',
        sourcePath: `${project}/main.go`,
        line: 1,
      }),
    ];
    expect(pickNavigateFrame(frames, project)?.id).toBe(9);
  });

  it('should_fallback_to_non_system_outside_project', () => {
    const f = frame({
      id: 1,
      name: 'other',
      sourcePath: '/tmp/elsewhere/main.go',
      line: 1,
    });
    expect(isUserProjectFrame(f, project)).toBe(false);
    // Still navigable so path-prefix mismatches do not block editor jump.
    expect(pickNavigateFrame([f], project)?.id).toBe(1);
  });
});

describe('shouldAutoContinueSystemStop', () => {
  const project = '/Users/me/proj';

  it('should_auto_continue_when_only_runtime_frames', () => {
    const frames = [
      frame({
        id: 1,
        name: 'runtime.main',
        sourcePath: '/usr/local/go/src/runtime/proc.go',
        line: 250,
      }),
    ];
    expect(shouldAutoContinueSystemStop(frames, project, 'step')).toBe(true);
    expect(shouldAutoContinueSystemStop(frames, project, 'breakpoint')).toBe(true);
  });

  it('should_not_auto_continue_on_user_pause', () => {
    const frames = [
      frame({
        id: 1,
        name: 'runtime.main',
        sourcePath: '/usr/local/go/src/runtime/proc.go',
        line: 250,
      }),
    ];
    expect(shouldAutoContinueSystemStop(frames, project, 'pause')).toBe(false);
  });

  it('should_not_auto_continue_when_user_frame_exists', () => {
    const frames = [
      frame({
        id: 1,
        name: 'runtime.main',
        sourcePath: '/usr/local/go/src/runtime/proc.go',
        line: 250,
      }),
      frame({
        id: 2,
        name: 'main.main',
        sourcePath: `${project}/main.go`,
        line: 10,
      }),
    ];
    expect(shouldAutoContinueSystemStop(frames, project, 'step')).toBe(false);
  });
});
