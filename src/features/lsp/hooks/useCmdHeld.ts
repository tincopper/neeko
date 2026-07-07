import { useEffect, useState } from 'react';

import { IS_MACOS } from '@/shared/utils/platform';

/**
 * Tracks whether the modifier key for Cmd+Click (Cmd on macOS, Ctrl on other
 * platforms) is currently held down. Returns true while the key is pressed.
 *
 * Used to provide visual feedback (pointer cursor) before the user clicks.
 */
export function useCmdHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const modKey = IS_MACOS ? 'Meta' : 'Control';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === modKey) setHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === modKey) setHeld(false);
    };
    const onBlur = () => setHeld(false);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return held;
}
