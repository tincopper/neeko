import React from "react";
import { getAgentIconSrc } from "../../utils/agents";

interface AgentIconProps {
  icon?: string | null;
  size?: number;
  fallback?: string;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = 16, fallback = "🤖" }) => {
  const src = getAgentIconSrc(icon);
  if (src) {
    return (
      <img
        className="agent-icon"
        src={src}
        width={size}
        height={size}
        alt=""
        style={{ display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }
  return <span className="agent-icon">{icon || fallback}</span>;
};

export default React.memo(AgentIcon);
