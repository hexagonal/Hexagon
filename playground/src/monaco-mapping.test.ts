import { describe, expect, test } from "vitest";

import {
  toCodeAction,
  toRenameLocation,
  toWorkspaceEdit,
  type EditTarget,
} from "./monaco-mapping";

/**
 * A stand-in for a model. Ranges are recorded as the offsets they were built
 * from, so a test can say which offsets reached the range-maker — the thing a
 * mistranslated field would get wrong while still producing a well-formed
 * object.
 */
type Recorded = readonly [number, number];

const target: EditTarget<string, Recorded> = {
  uri: "inmemory://hexagon/main.hex",
  versionId: 12,
  range: (startOffset, endOffset) => [startOffset, endOffset],
};

describe("toWorkspaceEdit", () => {
  test("carries each edit's offsets and text, against one resource", () => {
    expect(
      toWorkspaceEdit(target, [
        { startOffset: 4, endOffset: 9, replacement: "double" },
        { startOffset: 43, endOffset: 48, replacement: "double" },
      ]),
    ).toEqual({
      edits: [
        {
          resource: "inmemory://hexagon/main.hex",
          versionId: 12,
          textEdit: { range: [4, 9], text: "double" },
        },
        {
          resource: "inmemory://hexagon/main.hex",
          versionId: 12,
          textEdit: { range: [43, 48], text: "double" },
        },
      ],
    });
  });

  test("stamps the version on every edit, so a moved document rejects the set", () => {
    const stamped = toWorkspaceEdit(target, [
      { startOffset: 0, endOffset: 1, replacement: "a" },
      { startOffset: 2, endOffset: 3, replacement: "b" },
    ]);

    expect(stamped.edits.map(({ versionId }) => versionId)).toEqual([12, 12]);
  });

  test("makes an insertion out of an empty span rather than dropping it", () => {
    expect(
      toWorkspaceEdit(target, [{ startOffset: 20, endOffset: 20, replacement: ": Int" }])
        .edits,
    ).toEqual([
      {
        resource: "inmemory://hexagon/main.hex",
        versionId: 12,
        textEdit: { range: [20, 20], text: ": Int" },
      },
    ]);
  });
});

describe("toCodeAction", () => {
  test("gives an applicable repair its edits and no `disabled`", () => {
    const action = toCodeAction(target, {
      title: "Infer return type",
      kind: "quickfix",
      edits: [{ startOffset: 20, endOffset: 20, replacement: ": Int" }],
    });

    expect(action.disabled).toBeUndefined();
    expect(action).toMatchObject({ title: "Infer return type", kind: "quickfix" });
    expect(action.edit?.edits).toHaveLength(1);
  });

  test("gives a refused repair its reason and no edit at all", () => {
    const action = toCodeAction(target, {
      title: "Infer return type",
      kind: "quickfix",
      edits: [],
      disabled: "`m` is already bound",
    });

    // Not an empty edit: Monaco applies one happily and to no effect, which is
    // the outcome a refusal exists to avoid being mistaken for.
    expect(action.edit).toBeUndefined();
    expect(action.disabled).toBe("`m` is already bound");
  });

  test("keeps the kind, which decides whether a filtered trigger sees it", () => {
    expect(
      toCodeAction(target, { title: "Declare `Box(+a)`", kind: "refactor", edits: [] }).kind,
    ).toBe("refactor");
  });
});

describe("toRenameLocation", () => {
  const range = (startOffset: number, endOffset: number): Recorded =>
    [startOffset, endOffset];
  const caret: Recorded = [99, 99];

  test("pre-fills the identifier the rename would rewrite", () => {
    expect(
      toRenameLocation(
        { name: "twice", range: { startOffset: 4, endOffset: 9 } },
        range,
        caret,
      ),
    ).toEqual({ range: [4, 9], text: "twice" });
  });

  test("carries a refusal at the caret, with nothing to pre-fill", () => {
    expect(toRenameLocation({ refused: "`Show` is declared in `/Prelude.hex`" }, range, caret))
      .toEqual({
        range: [99, 99],
        text: "",
        rejectReason: "`Show` is declared in `/Prelude.hex`",
      });
  });
});
