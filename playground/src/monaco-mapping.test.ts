import { describe, expect, test } from "vitest";

import {
  boundedOffsets,
  codeActionKinds,
  toCodeAction,
  toRenameEdits,
  toRenameLocation,
  toWorkspaceEdit,
  typeOccurrenceAtOffset,
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

  test("carries a refusal, which is the only part Monaco reads", () => {
    // `range` and `text` are pinned because the type demands them, not because
    // they are used: Monaco discards both and rebuilds the location from the
    // word under the cursor. `rejectReason` is the assertion that matters.
    expect(toRenameLocation({ refused: "`Show` is declared in `/Prelude.hex`" }, range, caret))
      .toEqual({
        range: [99, 99],
        text: "",
        rejectReason: "`Show` is declared in `/Prelude.hex`",
      });
  });
});

describe("toRenameEdits", () => {
  test("carries the plan's edits when there is a plan", () => {
    expect(
      toRenameEdits(target, {
        newName: "double",
        edits: [{ startOffset: 4, endOffset: 9, replacement: "double" }],
      }),
    ).toEqual({
      edits: [{
        resource: "inmemory://hexagon/main.hex",
        versionId: 12,
        textEdit: { range: [4, 9], text: "double" },
      }],
    });
  });

  test("rejects with the session's own sentence when the session refused", () => {
    expect(toRenameEdits(target, { refused: "`Show` is declared in `/Prelude.hex`" }))
      .toEqual({ edits: [], rejectReason: "`Show` is declared in `/Prelude.hex`" });
  });

  test("rejects rather than accepting nothing when there is no answer", () => {
    // The failure this prevents: a result without `rejectReason` is Monaco's
    // signal that this provider handled the rename, so an empty edit set would
    // end the chain with a successful no-op instead of a message.
    const rejected = toRenameEdits(target, undefined);

    expect(rejected.edits).toEqual([]);
    expect(rejected.rejectReason).toBe("Hexagon has no rename for this position");
  });
});

describe("boundedOffsets", () => {
  test("leaves a span already inside the document alone", () => {
    expect(boundedOffsets(4, 9, 20)).toEqual([4, 9]);
    expect(boundedOffsets(0, 20, 20)).toEqual([0, 20]);
  });

  test("pulls a span past the end back inside it", () => {
    // A stale reply describes text the model no longer has, and Monaco throws
    // on a position past the end rather than clamping for us.
    expect(boundedOffsets(18, 40, 20)).toEqual([18, 20]);
    expect(boundedOffsets(30, 40, 20)).toEqual([20, 20]);
  });

  test("never returns an inverted span", () => {
    expect(boundedOffsets(9, 4, 20)).toEqual([9, 9]);
    expect(boundedOffsets(-5, -1, 20)).toEqual([0, 0]);
  });
});

describe("typeOccurrenceAtOffset", () => {
  const types = [
    { name: "xs", displayedType: "Seq(Int)", startOffset: 4, endOffset: 6 },
  ];

  test("finds the name the offset is inside", () => {
    expect(typeOccurrenceAtOffset(types, 4)?.name).toBe("xs");
    expect(typeOccurrenceAtOffset(types, 5)?.name).toBe("xs");
  });

  test("finds the name a caret has just moved past", () => {
    // Where a tap most often leaves the caret; without the look-back the
    // iPadOS hover would not open for a name the user tapped the end of.
    expect(typeOccurrenceAtOffset(types, 6)?.name).toBe("xs");
  });

  test("finds nothing beyond that, and never reads before the document", () => {
    expect(typeOccurrenceAtOffset(types, 7)).toBeUndefined();
    expect(typeOccurrenceAtOffset(types, 3)).toBeUndefined();
    expect(typeOccurrenceAtOffset(types, 0)).toBeUndefined();
  });
});

describe("codeActionKinds", () => {
  test("advertises both families the session emits", () => {
    // `refactor` is load-bearing: the variance offer is the only action of that
    // kind, and dropping it here makes Monaco stop asking under `Refactor…`.
    expect([...codeActionKinds].sort()).toEqual(["quickfix", "refactor"]);
  });
});
