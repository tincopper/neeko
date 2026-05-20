import claudeCodeIcon from "../assets/agents/claude-code.png";
import opencodeIcon from "../assets/agents/opencode.png";
import geminiIcon from "../assets/agents/gemini.png";
import codexIcon from "../assets/agents/codex.png";
import qoderIcon from "../assets/agents/qoder.svg";
import codebuddyIcon from "../assets/agents/codebuddy.svg";
import piIcon from "../assets/agents/pi.svg";
import cliIcon from "../assets/agents/cli.svg";

const AGENT_ICONS: Record<string, string> = {
  "claude-code.png": claudeCodeIcon,
  "opencode.png": opencodeIcon,
  "gemini.png": geminiIcon,
  "codex.png": codexIcon,
  "qoder.svg": qoderIcon,
  "codebuddy.svg": codebuddyIcon,
  "pi.svg": piIcon,
  "cli.svg": cliIcon,
};

export function getAgentIconSrc(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return AGENT_ICONS[icon] ?? null;
}

/**
 * Agent 品牌色背景映射。
 * 用于 IconTile variant="brand" 的 bg 属性，确保每个 agent 图标
 * 都有关联的品牌色托底，视觉节奏统一。
 */
export const AGENT_TILE_BG: Record<string, string> = {
  "claude-code.png": "#F5E6DA",
  "opencode.png":    "#FFE5D9",
  "gemini.png":      "#E5EEFF",
  "codex.png":       "#2A2A2A",
  "qoder.svg":       "#E8F5E9",
  "codebuddy.svg":   "#FFF4E0",
  "pi.svg":          "#FFE7E0",
  "cli.svg":         "#EDEDED",
};

/**
 * 根据 agent icon 文件名返回品牌色。
 * 未命中时回退到中性灰底。
 */
export function getAgentTileBg(icon: string | null | undefined): string {
  if (!icon) return "#3a3a3c";
  return AGENT_TILE_BG[icon] ?? "#3a3a3c";
}
