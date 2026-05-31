import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { FileChangedEvent } from '@/shared/types';

type Callback = (event: FileChangedEvent) => void;

let sharedUnlisten: UnlistenFn | null = null;
let subscribers = new Set<Callback>();
let refCount = 0;

function ensureListening() {
  if (refCount === 0) {
    listen<FileChangedEvent>("file-changed", (event) => {
      for (const cb of subscribers) cb(event.payload);
    }).then((unlisten) => {
      sharedUnlisten = unlisten;
    });
  }
  refCount++;
}

function stopListening() {
  refCount--;
  if (refCount === 0 && sharedUnlisten) {
    sharedUnlisten();
    sharedUnlisten = null;
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
