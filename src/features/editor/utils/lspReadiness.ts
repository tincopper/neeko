/**
 * LSP 会话就绪谓词 —— **唯一事实源**。
 *
 * 抽成独立模块的理由（`guides/code-reuse-thinking-guide.md` 模式 5「同一派生规则/谓词抄成
 * 多份副本」）：Rust 的 tier ① runnable 拉取与 Java 的 `@Nested` 富化都要判「该语言的 LSP
 * 会话是否 ready」。两处各写一遍 `status === 'ready'`，抄错不会报错 —— 只会**静默少触发**
 * （按钮不出现、修正在该分支不生效），正是该模式点名的隐蔽失效。
 *
 * 只读全局 store（`lspStore` 属跨 feature 直导白名单的 store 面），无副作用。
 */
import { useLspStore } from '@/features/lsp/store/lspStore';

/** 指定项目 + 语言的 LSP 会话是否就绪（`status === 'ready'`）。缺会话/状态缺失 → false。 */
export function isLspLanguageReady(projectPath: string, languageId: string): boolean {
  const session = useLspStore.getState().sessions[projectPath]?.[languageId];
  return session?.status === 'ready';
}
