// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  AUTO_PREFERS_JDTLS,
  parseJavaDebugBackend,
  prefersJdtlsBackend,
  shouldSkipJavaAdapterGate,
} from '../javaDebugBackend';

describe('parseJavaDebugBackend — dap.javaBackend 的唯一解析点', () => {
  it('识别两个显式取值', () => {
    expect(parseJavaDebugBackend('jdtls')).toBe('jdtls');
    expect(parseJavaDebugBackend('host')).toBe('host');
    expect(parseJavaDebugBackend('auto')).toBe('auto');
  });

  it('缺键 / 空值 / 非法值 / 类型不符一律回落到 auto', () => {
    for (const raw of [undefined, null, '', 'JDTLS', 'jdtl', 'nope', 0, 1, {}, [], true]) {
      expect(parseJavaDebugBackend(raw)).toBe('auto');
    }
  });
});

describe('prefersJdtlsBackend / shouldSkipJavaAdapterGate — 后端 dispatch 与门控', () => {
  it('auto 依 AUTO_PREFERS_JDTLS 决定（当前为已验证的 true）', () => {
    expect(prefersJdtlsBackend('auto')).toBe(AUTO_PREFERS_JDTLS);
    expect(prefersJdtlsBackend('jdtls')).toBe(true);
    expect(prefersJdtlsBackend('host')).toBe(false);
  });

  it('门控只对确定走 B 的 java 会话跳过；host 与非 java 一律保留', () => {
    expect(shouldSkipJavaAdapterGate('java', 'jdtls')).toBe(true);
    expect(shouldSkipJavaAdapterGate('java', 'auto')).toBe(AUTO_PREFERS_JDTLS);
    expect(shouldSkipJavaAdapterGate('java', 'host')).toBe(false);
    // 非 java 类型永不受该规则影响（go/lldb 仍照常走门控）。
    for (const t of ['go', 'lldb', 'rust']) {
      expect(shouldSkipJavaAdapterGate(t, 'jdtls')).toBe(false);
      expect(shouldSkipJavaAdapterGate(t, 'auto')).toBe(false);
    }
  });
});
