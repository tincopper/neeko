export interface TerminalTab {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string;
  status: "Idle" | "Running" | "Failed";
  order: number;
}
