import claudeCodeIcon from "../../assets/agents/claude-code.png";
import opencodeIcon from "../../assets/agents/opencode.png";
import geminiIcon from "../../assets/agents/gemini.png";
import codexIcon from "../../assets/agents/codex.png";
import qoderIcon from "../../assets/agents/qoder.svg";
import codebuddyIcon from "../../assets/agents/codebuddy.svg";
import piIcon from "../../assets/agents/pi.svg";
import ompIcon from "../../assets/agents/omp.svg";
import reasonixIcon from "../../assets/agents/reasonix.svg";
import grokIcon from "../../assets/agents/grok.ico";
import cliIcon from "../../assets/agents/cli.svg";

const AGENT_ICONS: Record<string, string> = {
  "claude-code.png": claudeCodeIcon,
  "opencode.png": opencodeIcon,
  "gemini.png": geminiIcon,
  "codex.png": codexIcon,
  "qoder.svg": qoderIcon,
  "codebuddy.svg": codebuddyIcon,
  "pi.svg": piIcon,
  "omp.svg": ompIcon,
  "reasonix.svg": reasonixIcon,
  "grok.ico": grokIcon,
  "cli.svg": cliIcon,
};

export const PRESET_AGENT_ICONS = Object.keys(AGENT_ICONS);

export const DEFAULT_AGENT_ICON = "cli.svg";

export function getAgentIconSrc(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return AGENT_ICONS[icon] ?? null;
}
