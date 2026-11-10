import { describe, expect, it } from 'vitest';

import { conversationIdOf, parseConversationId } from '../conversationId';

/**
 * `conversationId` 复合键的唯一铸造点。
 *
 * 判据必须与 Rust `conversation/manager.rs::parse_conversation_id` **逐字对齐**：
 * 按**第一个** `:` 切分，native 段可以再含 `:`（codex 的
 * `2025/01/01/session-uuid` 形态、以及带时间戳前缀的 native id）。
 * 双端在这里分叉的症状是静默的：请求发出去、后端说「会话不存在」。
 */
describe('conversationIdOf', () => {
  it('铸造 `agentId:nativeId`', () => {
    expect(conversationIdOf('claude-code', 'sess-1')).toBe('claude-code:sess-1');
  });

  it('与 parseConversationId 往返一致', () => {
    expect(parseConversationId(conversationIdOf('codex', 'native'))).toEqual({
      agentId: 'codex',
      nativeSessionId: 'native',
    });
  });
});

describe('parseConversationId', () => {
  it('按**第一个**冒号切分（native 段可含冒号）', () => {
    expect(parseConversationId('agent:session-1')).toEqual({
      agentId: 'agent',
      nativeSessionId: 'session-1',
    });
    expect(parseConversationId('codex:2025/01/01/session-uuid')).toEqual({
      agentId: 'codex',
      nativeSessionId: '2025/01/01/session-uuid',
    });
    expect(parseConversationId('pi:a:b:c')).toEqual({
      agentId: 'pi',
      nativeSessionId: 'a:b:c',
    });
  });

  it('无分隔符 / 任一段为空 ⇒ null（与 Rust 同判据）', () => {
    expect(parseConversationId('no-separator')).toBeNull();
    expect(parseConversationId('')).toBeNull();
    expect(parseConversationId(':native')).toBeNull();
    expect(parseConversationId('agent:')).toBeNull();
  });
});
