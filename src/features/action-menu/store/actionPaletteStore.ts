import { create } from 'zustand';

interface ActionPaletteState {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

export const useActionPaletteStore = create<ActionPaletteState>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
}));
