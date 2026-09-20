// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildCodeMessage } from '../agentPrompt';

describe('buildCodeMessage', () => {
  it('fix：无诊断时保持既有文案（选区工具栏路径不变）', () => {
    expect(buildCodeMessage('fix', { filePath: 'src/a.ts', startLine: 3, endLine: 5 })).toBe(
      'fix any bugs or issues in this ts code at src/a.ts:3-5',
    );
  });

  it('explain：无诊断时保持既有文案', () => {
    expect(buildCodeMessage('explain', { filePath: 'src/a.ts', startLine: 3, endLine: 5 })).toBe(
      'explain the ts code at src/a.ts:3-5',
    );
  });

  it('fix：带诊断时把问题带上（agent 需要知道要修什么）', () => {
    expect(
      buildCodeMessage('fix', {
        filePath: 'src/a.ts',
        startLine: 4,
        endLine: 4,
        diagnostic: "Cannot find name 'foo'.",
      }),
    ).toBe("fix the following problem in this ts code at src/a.ts:4-4: Cannot find name 'foo'.");
  });

  it('explain：带诊断时解释的是这个问题', () => {
    expect(
      buildCodeMessage('explain', {
        filePath: 'src/a.go',
        startLine: 2,
        endLine: 2,
        diagnostic: 'undefined: fmt',
      }),
    ).toBe('explain the following problem in this go code at src/a.go:2-2: undefined: fmt');
  });
});
