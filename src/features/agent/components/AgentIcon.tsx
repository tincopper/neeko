import React from "react";
import { getAgentIconSrc } from "../../../utils/agents";

interface AgentIconProps {
  icon?: string | null;
  size?: number;
  fallback?: string;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = 16, fallback = "" }) => {
  const src = getAgentIconSrc(icon);
  if (src) {
    return (
      <img
        className="w-4 h-4 object-contain"
        src={src}
        width={size}
        height={size}
        alt=""
      />
    );
  }
  return <span>{icon || fallback}</span>;
};

export default React.memo(AgentIcon);
