import type { Terminal } from "@xterm/xterm";

export interface TerminalInputController {
  dispose: () => void;
}

export function setupTerminalInput({
  term,
  sendInput,
}: {
  term: Terminal;
  sendInput: (text: string) => void;
}): TerminalInputController {
  const disposable = term.onData((data) => {
    sendInput(data);
  });

  return {
    dispose: () => {
      disposable.dispose();
    },
  };
}
