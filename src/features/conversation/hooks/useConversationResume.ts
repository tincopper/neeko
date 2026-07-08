import { useState, useCallback } from 'react';
import { checkAgentsInstalled, getAgent } from '@/features/agent/api/agentApi';
import { getResumeCommand, getConversationMessages } from '../api/conversationApi';
import { launchAgentInTerminal, sendToTerminal } from '@/features/terminal/components/terminalCommands';
import type { ConversationMessage } from '../types';

function buildContextPrompt(messages: ConversationMessage[]): string {
  const lines = messages.map((msg) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    return `[${role}]: ${msg.content}`;
  });
  return `Below is the previous conversation. Please continue based on this context:\n\n---\n${lines.join('\n\n')}\n---\n\nContinue:`;
}

export function useConversationResume(projectId: string | null) {
  const [isResuming, setIsResuming] = useState(false);

  const resume = useCallback(async (conversationId: string, agentId: string) => {
    if (!projectId) {
      console.warn('[useConversationResume] No project ID, cannot resume');
      return;
    }

    setIsResuming(true);
    try {
      // 1. Check if agent is installed
      const installedResult = await checkAgentsInstalled([agentId]);
      if (!installedResult[agentId]) {
        throw new Error(`Agent "${agentId}" is not installed`);
      }

      // 2. Get resume command
      const cmd = await getResumeCommand(conversationId);

      // 3. If has native resume command, use launchAgentInTerminal
      if (cmd && cmd.length > 0) {
        const agent = await getAgent(agentId);
        launchAgentInTerminal(projectId, agent.command, cmd);
      } else {
        // 4. No native resume, build context prompt and send to terminal
        const msgs = await getConversationMessages(conversationId);
        const prompt = buildContextPrompt(msgs);
        sendToTerminal(projectId, prompt + '\r');
      }
    } catch (err) {
      console.error('[useConversationResume] Resume failed:', err);
      throw err;
    } finally {
      setIsResuming(false);
    }
  }, [projectId]);

  return { resume, isResuming };
}
