import React from "react";
import { getAgentIconSrc, getAgentTileBg } from "../../utils/agents";
import { IconTile } from "../ui";
import type { IconTileSize } from "../ui/IconTile";

interface AgentIconProps {
  icon?: string | null;
  size?: IconTileSize;
  fallback?: string;
  /** 是否为激活态（显示 accent ring） */
  active?: boolean;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = "xs", fallback = "", active = false }) => {
  const src = getAgentIconSrc(icon);
  if (src) {
    return (
      <IconTile
        variant="brand"
        size={size}
        bg={getAgentTileBg(icon)}
        src={src}
        active={active}
      />
    );
  }
  return <span>{icon || fallback}</span>;
};

export default React.memo(AgentIcon);
