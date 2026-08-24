import type { ConversationMessage } from '../types';

/**
 * 从消息提取可复制的纯文本：相邻 text 块直接拼接；thinking 块标注；工具调用/结果带名称与内容。
 */
export function messageToText(message: ConversationMessage): string {
  if (!message.blocks || message.blocks.length === 0) {
    return message.content ?? '';
  }

  const parts: string[] = [];

  for (const block of message.blocks) {
    switch (block.type) {
      case 'text': {
        // 相邻 text 块视为同一段落，直接拼接
        const last = parts[parts.length - 1];
        if (last !== undefined && last.startsWith('[')) {
          parts.push(block.text);
        } else if (last !== undefined && !last.startsWith('[')) {
          parts[parts.length - 1] = last + block.text;
        } else {
          parts.push(block.text);
        }
        break;
      }
      case 'thinking':
        parts.push(`[Thinking]\n${block.thinking}`);
        break;
      case 'toolUse': {
        const inputText =
          typeof block.input === 'object' ? JSON.stringify(block.input) : String(block.input);
        parts.push(`[Tool: ${block.name}]\n${inputText}`);
        break;
      }
      case 'toolResult': {
        const label = block.isError ? 'Tool Error' : 'Tool Result';
        parts.push(`[${label}]\n${block.content}`);
        break;
      }
    }
  }

  return parts.join('\n\n');
}
