import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LSP_APPLY_EDIT_EVENT_PREFIX,
  LSP_DIAG_EVENT_PREFIX,
  LSP_INSTALL_PROGRESS_EVENT,
  LSP_PROFILE_EVENT,
  LSP_PROGRESS_EVENT_PREFIX,
  LSP_SESSION_EVENT_PREFIX,
} from '@/shared/events';

/**
 * 跨栈护栏（红线 5 的执行侧）：LSP 事件名只在**两个常量源**里存在 ——
 * 后端 `src-tauri/src/lsp/types.rs` 与前端 `src/shared/events.ts`。
 *
 * # 为什么必须有这一层
 *
 * Rust 侧原有 `types.rs::event_names_match_frontend_mirror` 只比对**同文件内**的字面量，
 * 从不读前端源码 ⇒ 改前端常量 CI 全绿、运行期静默失联（历史事故形态：
 * `LSP_PROGRESS_EVENT_PREFIX` 写成 `lsp-project-`，前端 `listen` 永远不触发）。
 *
 * 这里把后端的**声明**抠出来与前端常量逐字比较；声明缺失 / 出现多次都直接红
 * （重命名后残留旧声明是最常见的半改状态）。形态照
 * `src/shared/__tests__/sessionsEventConstant.test.ts`。
 */
const RUST_TYPES_FILE = resolve(__dirname, '../../../src-tauri/src/lsp/types.rs');

/** 前端镜像表：后端常量名 → 前端值。键集合同时是「覆盖集」判据（见最后一例）。 */
const MIRRORED: Record<string, string> = {
  LSP_DIAG_EVENT_PREFIX,
  LSP_PROGRESS_EVENT_PREFIX,
  LSP_SESSION_EVENT_PREFIX,
  LSP_APPLY_EDIT_EVENT_PREFIX,
  LSP_INSTALL_PROGRESS_EVENT,
  LSP_PROFILE_EVENT,
};

/** 后端唯一声明的值；缺失 / 重复一律返回 `null`（交给用例报红，不在读取阶段抛错）。 */
function backendConst(name: string): string | null {
  const rust = readFileSync(RUST_TYPES_FILE, 'utf8');
  // 只认 `pub const NAME: &str = "…";` 形态：事件名都是 &str，`usize` 之类的
  // 预算常量不参与本护栏。
  const matches = [...rust.matchAll(new RegExp(`pub const ${name}: &str = "([^"]*)";`, 'g'))];
  return matches.length === 1 ? matches[0][1] : null;
}

/** 后端声明的全部 `LSP_*` 字符串常量名（按出现顺序）。 */
function backendLspConstNames(): string[] {
  const rust = readFileSync(RUST_TYPES_FILE, 'utf8');
  return [...rust.matchAll(/pub const (LSP_[A-Z0-9_]+): &str = "/g)].map((m) => m[1]);
}

describe('LSP 事件常量两端互锁', () => {
  for (const [name, value] of Object.entries(MIRRORED)) {
    it(`${name} 在后端恰好声明一次`, () => {
      expect(backendConst(name)).not.toBeNull();
    });

    it(`${name} 两端同值（${value}）`, () => {
      expect(backendConst(name)).toBe(value);
    });
  }

  /**
   * 覆盖集完整性：后端**新增**一个 `LSP_*` 常量却忘了镜像到前端时，上面的逐名用例
   * 全绿（它们只知道自己那六个）—— 只有这一例会红。
   */
  it('后端每个 LSP_* 字符串常量都被本表覆盖', () => {
    expect(backendLspConstNames().sort()).toEqual(Object.keys(MIRRORED).sort());
  });
});
