import claudeCodeIcon from "../assets/agents/claude-code.png";
import opencodeIcon from "../assets/agents/opencode.png";
import geminiIcon from "../assets/agents/gemini.png";
import codexIcon from "../assets/agents/codex.png";
import qoderIcon from "../assets/agents/qoder.svg";
import codebuddyIcon from "../assets/agents/codebuddy.svg";
import cliIcon from "../assets/agents/cli.svg";

const AGENT_ICONS: Record<string, string> = {
  "claude-code.png": claudeCodeIcon,
  "opencode.png": opencodeIcon,
  "gemini.png": geminiIcon,
  "codex.png": codexIcon,
  "qoder.svg": qoderIcon,
  "codebuddy.svg": codebuddyIcon,
  "cli.svg": cliIcon,
};

export function getAgentIconSrc(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return AGENT_ICONS[icon] ?? null;
}
