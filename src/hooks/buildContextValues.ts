import type { EditorContextValue } from "../contexts/editor-context";
import type { ProjectActionsContextValue } from "../contexts/project-actions-context";
import type { ProjectStateContextValue } from "../contexts/project-state-context";
import type { RemoteContextValue } from "../contexts/remote-context";
import type { WslContextValue } from "../contexts/wsl-context";

interface BuildContextValuesParams {
  projectState: ProjectStateContextValue;
  projectActions: ProjectActionsContextValue;
  wsl: WslContextValue;
  remote: RemoteContextValue;
  editor: EditorContextValue;
}

interface BuildContextValuesResult {
  projectStateValue: ProjectStateContextValue;
  projectActionsValue: ProjectActionsContextValue;
  wslValue: WslContextValue;
  remoteValue: RemoteContextValue;
  editorValue: EditorContextValue;
}

export function buildContextValues({
  projectState,
  projectActions,
  wsl,
  remote,
  editor,
}: BuildContextValuesParams): BuildContextValuesResult {
  return {
    projectStateValue: projectState,
    projectActionsValue: projectActions,
    wslValue: wsl,
    remoteValue: remote,
    editorValue: editor,
  };
}
