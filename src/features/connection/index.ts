// Components
export { default as ConnectionProjectCard } from "./components/ConnectionProjectCard";
export { default as ConnectionWorktreeList } from "./components/ConnectionWorktreeList";
export { RemoteAuthDialog } from "./components/RemoteAuthDialog";
export { RemoteDialog } from "./components/RemoteDialog";
export { WSLDialog } from "./components/WSLDialog";

// Domain Types
export type {
  WSLProject,
  WSLEntrySession,
  RemoteProject,
  AuthMethod,
  RemoteEntrySession,
} from "./types";

// Component Types
export type {
  ConnectionSource,
  ConnectionProjectCardProps,
} from "./components/types";

// Store
export { useConnectionStore } from "./store";

// Hooks (re-exported for backwards compatibility; prefer the unified versions from project/)
/** @deprecated Use useConnectionProjects from features/project/hooks instead */
export { useWslProjects } from "./hooks/useWslProjects";
/** @deprecated Use useConnectionProjects from features/project/hooks instead */
export type { SaveSessionFn } from "./hooks/useWslProjects";
/** @deprecated Use useProjectActions from features/project/hooks instead */
export { useWslActions } from "./hooks/useWslActions";
/** @deprecated Use useConnectionProjects from features/project/hooks instead */
export { useRemoteProjects } from "./hooks/useRemoteProjects";
/** @deprecated Use useProjectActions from features/project/hooks instead */
export { useRemoteActions } from "./hooks/useRemoteActions";
export { useRemoteAuthActions } from "./hooks/useRemoteAuthActions";

// Contexts (re-exported for backwards compatibility; prefer ConnectionProjectContext)
/** @deprecated Use ConnectionProjectContext from features/project/contexts instead */
export { WslProvider, useWslContext } from "./contexts/WslContext";
/** @deprecated Use ConnectionProjectContext from features/project/contexts instead */
export type { WslContextValue } from "./contexts/WslContext";
/** @deprecated Use ConnectionProjectContext from features/project/contexts instead */
export { RemoteProvider, useRemoteContext } from "./contexts/RemoteContext";
/** @deprecated Use ConnectionProjectContext from features/project/contexts instead */
export type { RemoteContextValue } from "./contexts/RemoteContext";
