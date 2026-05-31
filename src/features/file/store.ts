import { create } from "zustand";
import type { FileNode } from '@/shared/types';

interface FileStoreState {
  fileTree: FileNode[];
  fileViewLoading: boolean;
  activeFilePath: string | null;
}

export const useFileStore = create<FileStoreState>(() => ({
  fileTree: [],
  fileViewLoading: false,
  activeFilePath: null,
}));
