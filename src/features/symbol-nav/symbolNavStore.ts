/**
 * Structure popup + Find Usages result list (IDEA-like).
 */
import { create } from "zustand";

import { lspRequest } from "@/features/lsp/api/lspApi";
import { fromFileUri } from "@/features/lsp/languageMap";
import type { LspLocation } from "@/features/lsp/types";
import { openProjectFile } from "@/features/quick-open/openFile";
import { fuzzyFilter } from "@/features/quick-open/fuzzy";

import {
  flattenDocumentSymbols,
  symbolKindLabel,
  type FlatSymbol,
} from "./documentSymbols";

export type SymbolNavMode = "structure" | "findUsages";

export interface SymbolNavItem {
  id: string;
  label: string;
  description: string;
  filePath: string;
  line: number;
  column: number;
  depth: number;
}

interface SymbolNavState {
  open: boolean;
  mode: SymbolNavMode;
  title: string;
  query: string;
  loading: boolean;
  allItems: SymbolNavItem[];
  items: SymbolNavItem[];
  selectedIndex: number;
  projectId: string | null;

  openStructure: (opts: {
    projectId: string;
    projectPath: string;
    languageId: string;
    uri: string;
    filePath: string;
  }) => void;
  openFindUsages: (opts: {
    projectId: string;
    locations: LspLocation[];
    symbolHint?: string;
  }) => void;
  setQuery: (q: string) => void;
  moveSelection: (delta: number) => void;
  confirm: () => Promise<void>;
  close: () => void;
}

function structureItems(symbols: FlatSymbol[], filePath: string): SymbolNavItem[] {
  return symbols.map((s, i) => {
    const indent = s.depth > 0 ? `${"  ".repeat(s.depth)}` : "";
    const kind = symbolKindLabel(s.kind);
    const detail = s.detail ? ` · ${s.detail}` : "";
    const container = s.containerName ? ` in ${s.containerName}` : "";
    return {
      id: `sym-${i}-${s.line}-${s.name}`,
      label: `${indent}${s.name}`,
      description: `${kind}${detail}${container} · L${s.line + 1}`,
      filePath,
      line: s.line + 1,
      column: s.character,
      depth: s.depth,
    };
  });
}

function usagesItems(locations: LspLocation[]): SymbolNavItem[] {
  return locations.map((loc, i) => {
    const filePath = fromFileUri(loc.uri);
    const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
    const line = loc.range.start.line + 1;
    const col = loc.range.start.character;
    return {
      id: `ref-${i}-${filePath}-${line}-${col}`,
      label: `${base}:${line}:${col + 1}`,
      description: filePath,
      filePath,
      line,
      column: col,
      depth: 0,
    };
  });
}

function filterItems(all: SymbolNavItem[], query: string): SymbolNavItem[] {
  return fuzzyFilter(all, query, (it) => `${it.label} ${it.description}`, 200);
}

export const useSymbolNavStore = create<SymbolNavState>((set, get) => ({
  open: false,
  mode: "structure",
  title: "File Structure",
  query: "",
  loading: false,
  allItems: [],
  items: [],
  selectedIndex: 0,
  projectId: null,

  openStructure: ({ projectId, projectPath, languageId, uri, filePath }) => {
    set({
      open: true,
      mode: "structure",
      title: "File Structure",
      query: "",
      loading: true,
      allItems: [],
      items: [],
      selectedIndex: 0,
      projectId,
    });

    void (async () => {
      try {
        const raw = await lspRequest(
          projectPath,
          languageId,
          "textDocument/documentSymbol",
          { textDocument: { uri } },
        );
        if (!get().open || get().mode !== "structure") return;
        const flat = flattenDocumentSymbols(raw);
        const allItems = structureItems(flat, filePath);
        set({
          loading: false,
          allItems,
          items: allItems.slice(0, 200),
          selectedIndex: 0,
        });
      } catch (e) {
        console.error("[LSP] documentSymbol failed:", e);
        if (!get().open) return;
        set({ loading: false, allItems: [], items: [] });
      }
    })();
  },

  openFindUsages: ({ projectId, locations, symbolHint }) => {
    const allItems = usagesItems(locations);
    const title = symbolHint
      ? `Find Usages: ${symbolHint}`
      : `Find Usages (${allItems.length})`;
    set({
      open: true,
      mode: "findUsages",
      title,
      query: "",
      loading: false,
      allItems,
      items: allItems.slice(0, 200),
      selectedIndex: 0,
      projectId,
    });
  },

  setQuery: (q) => {
    const { allItems } = get();
    const items = filterItems(allItems, q);
    set({ query: q, items, selectedIndex: 0 });
  },

  moveSelection: (delta) => {
    const { items, selectedIndex } = get();
    if (items.length === 0) return;
    const next = (selectedIndex + delta + items.length) % items.length;
    set({ selectedIndex: next });
  },

  confirm: async () => {
    const { items, selectedIndex, projectId, open } = get();
    if (!open || !projectId || items.length === 0) {
      get().close();
      return;
    }
    const item = items[selectedIndex];
    if (!item) return;
    get().close();
    await openProjectFile({
      projectId,
      filePath: item.filePath,
      line: item.line,
      column: item.column,
    });
  },

  close: () => {
    set({
      open: false,
      query: "",
      loading: false,
      allItems: [],
      items: [],
      selectedIndex: 0,
      projectId: null,
    });
  },
}));
