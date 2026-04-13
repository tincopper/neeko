import React from "react";
import { getAgentIconSrc } from "../../utils/agents";

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
        className="w-[18px] h-[18px] object-contain"
        src={src}
        width={size}
        height={size}
        alt=""
        style={{ display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }
  return <span>{icon || fallback}</span>;
};

export default React.memo(AgentIcon);
