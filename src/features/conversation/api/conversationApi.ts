import { invoke } from '@tauri-apps/api/core';
import type { ConversationMeta, ConversationMessage, ScanReport } from '../types';

export function scanConversations(agentId?: string): Promise<ScanReport[]> {
  return invoke<ScanReport[]>('scan_conversations', { agentId });
}

export function listConversations(projectPath?: string, agentId?: string): Promise<ConversationMeta[]> {
  return invoke<ConversationMeta[]>('list_conversations', { projectPath, agentId });
}

export function getConversationMessages(id: string): Promise<ConversationMessage[]> {
  return invoke<ConversationMessage[]>('get_conversation_messages', { id });
}

export function searchConversations(query: string, projectPath?: string): Promise<ConversationMeta[]> {
  return invoke<ConversationMeta[]>('search_conversations', { query, projectPath });
}

export function updateConversation(id: string, userTitle?: string, tags?: string[]): Promise<void> {
  return invoke<void>('update_conversation', { id, userTitle, tags });
}

export function getResumeCommand(id: string): Promise<string[] | null> {
  return invoke<string[] | null>('get_resume_command', { id });
}

export function exportConversation(id: string): Promise<string> {
  return invoke<string>('export_conversation', { id });
}
