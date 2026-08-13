import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { FILE_CHANGED_EVENT } from '@/shared/events';
import type { FileChangedEvent } from '@/shared/types';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

type Callback = (event: FileChangedEvent) => void;

let sharedUnlisten: UnlistenFn | null = null;
let subscribers = new Set<Callback>();
let refCount = 0;
/** 代际计数：in-flight listen resolve 时若已换代（stop 后又 ensure）则自清，避免覆盖新监听。 */
let generation = 0;

function ensureListening() {
  if (refCount === 0) {
    const gen = ++generation;
    listen<FileChangedEvent>(FILE_CHANGED_EVENT, (event) => {
      for (const cb of subscribers) cb(event.payload);
    }).then((unlisten) => {
      if (gen !== generation || refCount === 0) {
        safeUnlisten(unlisten)();
        return;
      }
      if (sharedUnlisten) safeUnlisten(sharedUnlisten)();
      sharedUnlisten = unlisten;
    });
  }
  refCount++;
}

function stopListening() {
  refCount--;
  if (refCount === 0) {
    generation++;
    if (sharedUnlisten) {
      safeUnlisten(sharedUnlisten)();
      sharedUnlisten = null;
    }
    subscribers = new Set();
  }
}

/** Subscribe to the centralized file-changed event. Only one IPC subscription exists. */
export function useFileChangedEvent(callback: Callback) {
  useEffect(() => {
    ensureListening();
    subscribers.add(callback);

    return () => {
      subscribers.delete(callback);
      stopListening();
    };
  }, [callback]);
}
