import { useState, useCallback } from 'react';
import { checkAgentsInstalled } from '@/features/agent/api/agentApi';
import { getResumeCommand } from '../api/conversationApi';

export interface ResumeData {
  agentId: string;
  resumeCommand: string[] | null;  // null = no native resume support
}

export function useConversationResume(projectId: string | null) {
  const [isResuming, setIsResuming] = useState(false);

  const prepareResume = useCallback(async (conversationId: string, agentId: string): Promise<ResumeData> => {
    if (!projectId) {
      throw new Error('No project selected');
    }
    if (!agentId) {
      throw new Error('Agent ID is missing');
    }

    setIsResuming(true);
    try {
      // Check if agent is installed
      let installed = false;
      try {
        const installedResult = await checkAgentsInstalled([agentId], projectId);
        installed = installedResult[agentId] ?? false;
      } catch {
        // If check fails, assume agent is installed
        installed = true;
      }
      if (!installed) {
        throw new Error(`Agent "${agentId}" is not installed`);
      }

      const cmd = await getResumeCommand(conversationId);

      setIsResuming(false);
      return { agentId, resumeCommand: cmd };
    } catch (err) {
      setIsResuming(false);
      throw err;
    }
  }, [projectId]);

  return { prepareResume, isResuming };
}
