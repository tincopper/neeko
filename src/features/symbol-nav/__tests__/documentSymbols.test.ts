import { describe, it, expect } from "vitest";
import {
  flattenDocumentSymbols,
  symbolKindLabel,
} from "../documentSymbols";

describe("documentSymbols", () => {
  it("should_flatten_document_symbol_tree_with_depth", () => {
    const raw = [
      {
        name: "Foo",
        kind: 5,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 20, character: 1 },
        },
        selectionRange: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 9 },
        },
        children: [
          {
            name: "Bar",
            kind: 6,
            range: {
              start: { line: 2, character: 0 },
              end: { line: 5, character: 1 },
            },
            selectionRange: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 7 },
            },
          },
        ],
      },
    ];

    const flat = flattenDocumentSymbols(raw);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toMatchObject({
      name: "Foo",
      kind: 5,
      line: 0,
      character: 6,
      depth: 0,
    });
    expect(flat[1]).toMatchObject({
      name: "Bar",
      kind: 6,
      line: 2,
      character: 4,
      depth: 1,
    });
  });

  it("should_parse_symbol_information_list", () => {
    const raw = [
      {
        name: "main",
        kind: 12,
        location: {
          uri: "file:///tmp/main.go",
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 9 },
          },
        },
        containerName: "main",
      },
    ];

    const flat = flattenDocumentSymbols(raw);
    expect(flat).toEqual([
      {
        name: "main",
        kind: 12,
        line: 10,
        character: 5,
        depth: 0,
        containerName: "main",
      },
    ]);
  });

  it("should_return_empty_for_null_or_non_array", () => {
    expect(flattenDocumentSymbols(null)).toEqual([]);
    expect(flattenDocumentSymbols({})).toEqual([]);
    expect(flattenDocumentSymbols(undefined)).toEqual([]);
  });

  it("should_map_symbol_kind_labels", () => {
    expect(symbolKindLabel(5)).toBe("Class");
    expect(symbolKindLabel(12)).toBe("Function");
    expect(symbolKindLabel(999)).toBe("Symbol");
  });
});
