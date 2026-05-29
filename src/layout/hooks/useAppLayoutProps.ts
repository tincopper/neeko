import { useCallback } from "react";
import { useAppViewStore } from "@/shared/store/appViewStore";
import { IS_WINDOWS } from "@/shared/utils/platform";
import type AppLayout from "../AppLayout";

const noop = () => {};

export function useAppLayoutProps(opts: {
  onAddProject: () => void;
  onOpenWslDialog: () => void;
  onOpenRemoteDialog: () => void;
}): React.ComponentProps<typeof AppLayout> {
  const handleToggleSettings = useCallback(() => {
    const currentView = useAppViewStore.getState().appView;
    useAppViewStore.getState().setAppView(
      currentView === "settings" ? "normal" : "settings"
    );
  }, []);

  return {
    onAddProject: opts.onAddProject,
    onAddWsl: IS_WINDOWS ? opts.onOpenWslDialog : noop,
    onAddRemote: opts.onOpenRemoteDialog,
    onOpenSettings: handleToggleSettings,
  };
}
