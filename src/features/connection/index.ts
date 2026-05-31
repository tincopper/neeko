// Components
export { default as ConnectionProjectCard } from "./components/ConnectionProjectCard";
export { default as ConnectionWorktreeList } from "./components/ConnectionWorktreeList";
export { RemoteAuthDialog } from "./components/RemoteAuthDialog";
export { RemoteDialog } from "./components/RemoteDialog";
export { WSLItem, RemoteItem } from "./components/RemoteItems";
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
  ActiveWslKey,
  ActiveRemoteKey,
  ConnectionSource,
  ConnectionProjectCardProps,
  WSLItemProps,
  RemoteItemProps,
} from "./components/types";

// Store
export { useConnectionStore } from "./store";

// Hooks
export { useWslProjects } from "./hooks/useWslProjects";
export type { SaveSessionFn } from "./hooks/useWslProjects";
export { useWslActions } from "./hooks/useWslActions";
export { useRemoteProjects } from "./hooks/useRemoteProjects";
export { useRemoteActions } from "./hooks/useRemoteActions";
export { useRemoteAuthActions } from "./hooks/useRemoteAuthActions";

// Contexts
export { WslProvider, useWslContext } from "./contexts/WslContext";
export type { WslContextValue } from "./contexts/WslContext";
export { RemoteProvider, useRemoteContext } from "./contexts/RemoteContext";
export type { RemoteContextValue } from "./contexts/RemoteContext";
