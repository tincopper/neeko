import React from "react";
import { Store } from "lucide-react";

const MarketplaceContent: React.FC = React.memo(() => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
      <Store className="h-12 w-12 opacity-30" />
      <span className="text-sm">Marketplace</span>
      <span className="text-xs">Coming soon</span>
    </div>
  );
});
MarketplaceContent.displayName = "MarketplaceContent";
export default MarketplaceContent;
