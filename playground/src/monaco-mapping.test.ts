import { describe, expect, test } from "vitest";

import {
  boundedOffsets,
  codeActionKinds,
  completionKindOf,
  INSERT_SNIPPET_COMMAND,
  runSnippetCommand,
  toCompletionItem,
  toCodeAction,
  toInlayHint,
  toRenameEdits,
  toRenameLocation,
  toSignatureHelp,
  toWorkspaceEdit,
  hoverAnswersAtOffset,
  caretHoverAnswers,
  hoverSelectionAt,
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

  test("writes a repair's snippet by the command that selects its stand-ins, against the version it was made at", () => {
    const snippet = { startOffset: 40, endOffset: 40, text: "    B => ${1:Debug.todo(\"B\")}\n" };
    const action = toCodeAction(target, {
      title: "Add the missing arm",
      kind: "quickfix",
      edits: [{ startOffset: 39, endOffset: 39, replacement: "\n    B => Debug.todo(\"B\")", snippet }],
    });
    // Not its edit too: standalone Monaco writes a code action's edit as plain
    // text, and the command would then write the arm again.
    expect(action.edit).toBeUndefined();
    expect(action.command).toEqual({
      id: INSERT_SNIPPET_COMMAND,
      title: "Add the missing arm",
      arguments: [12, { range: [40, 40], text: snippet.text }, { range: [39, 39], text: "\n    B => Debug.todo(\"B\")" }],
    });
    // A repair of several edits is written as it stands.
    const several = toCodeAction(target, {
      title: "Add the missing arm",
      kind: "quickfix",
      edits: [
        { startOffset: 39, endOffset: 39, replacement: "\n    B => Debug.todo(\"B\")", snippet },
        { startOffset: 0, endOffset: 0, replacement: "(* *)" },
      ],
    });
    expect(several.command).toBeUndefined();
    expect(several.edit?.edits).toHaveLength(2);
  });

  test("the command writes its snippet only at the version it was made against", () => {
    const written: [string, readonly [number, number], string][] = [];
    const insert = (range: readonly [number, number], text: string) => { written.push(["snippet", range, text]); };
    const write = (range: readonly [number, number], text: string) => { written.push(["plain", range, text]); };
    const made = [12, { range: [40, 40], text: "${1:x}$0\n" }, { range: [39, 39], text: "\nx" }] as const;
    runSnippetCommand(13, [...made], insert, write);
    runSnippetCommand(13, [...made], undefined, write);
    expect(written).toEqual([]);
    runSnippetCommand(12, [...made], insert, write);
    expect(written).toEqual([["snippet", [40, 40], "${1:x}$0\n"]]);
    // Where the editor has no snippet controller, the repair is still written,
    // as plain text.
    runSnippetCommand(12, [...made], undefined, write);
    expect(written.at(-1)).toEqual(["plain", [39, 39], "\nx"]);
  });

  test("marks the session's preferred repair as the one Auto Fix applies, and no other", () => {
    const plain = { title: "mark the call `!`", kind: "quickfix" as const, edits: [] };
    expect(toCodeAction(target, { ...plain, preferred: true }).isPreferred).toBe(true);
    expect("isPreferred" in toCodeAction(target, plain)).toBe(false);
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

describe("hoverAnswersAtOffset", () => {
  // `xs` at offsets 4..6, as the session publishes it: closed at both ends.
  const spans = [{ startOffset: 4, endOffset: 6 }];

  test("answers inside the name", () => {
    expect(hoverAnswersAtOffset(spans, 4)).toBe(true);
    expect(hoverAnswersAtOffset(spans, 5)).toBe(true);
  });

  test("answers where a caret has just moved past the name", () => {
    // The position a tap most often leaves the caret in, and the session's own
    // rule for every position query it answers — see `occurrencesAt`. The gate
    // reads the published end inclusively rather than looking an offset back,
    // which is what the table it replaced had to do (#254).
    expect(hoverAnswersAtOffset(spans, 6)).toBe(true);
  });

  test("answers nowhere else, including before the document", () => {
    expect(hoverAnswersAtOffset(spans, 7)).toBe(false);
    expect(hoverAnswersAtOffset(spans, 3)).toBe(false);
    expect(hoverAnswersAtOffset(spans, 0)).toBe(false);
    expect(hoverAnswersAtOffset([], 5)).toBe(false);
  });

  test("answers from any span, not only the first", () => {
    // The session publishes one flat set across every file in the buffer, in
    // buffer order but with no claim of disjointness: a record's name is both a
    // type and a constructor, so overlapping spans are normal.
    const many = [{ startOffset: 4, endOffset: 6 }, { startOffset: 20, endOffset: 23 }];
    expect(hoverAnswersAtOffset(many, 21)).toBe(true);
  });
});

describe("codeActionKinds", () => {
  test("advertises both families the session emits", () => {
    // `refactor` is load-bearing: the variance offer is the only action of that
    // kind, and dropping it here makes Monaco stop asking under `Refactor…`.
    expect([...codeActionKinds].sort()).toEqual(["quickfix", "refactor"]);
  });
});

describe("toCompletionItem", () => {
  const range: Recorded = [27, 29];

  test("shows the type as detail and the documentation as untrusted Markdown", () => {
    expect(
      toCompletionItem(
        { name: "twice", kind: "function", detail: "Int -> Int", documentation: "Doubles `n`." },
        range,
      ),
    ).toEqual({
      label: "twice",
      kind: "Function",
      insertText: "twice",
      range: [27, 29],
      detail: "Int -> Int",
      // Untrusted: a doc comment is the completed code's author's text, and a
      // trusted string would let its `command:` links run.
      documentation: { value: "Doubles `n`.", isTrusted: false },
    });
  });

  test("leaves out the fields the session did not send", () => {
    // Present-but-undefined is not the same as absent to Monaco's renderer,
    // which draws an empty detail line for the former.
    const item = toCompletionItem({ name: "Vector", kind: "module" }, range);

    expect(item).toEqual({ label: "Vector", kind: "Module", insertText: "Vector", range });
    expect("detail" in item).toBe(false);
    expect("documentation" in item).toBe(false);
  });

  test("shows a member's mark beside its name, as the language server does", () => {
    const item = toCompletionItem(
      { name: "show", kind: "member", detail: "Point -> String", mark: "Show member" },
      range,
    );

    expect(item).toEqual({
      label: { label: "show", description: "Show member" },
      kind: "Method",
      insertText: "show",
      range: [27, 29],
      detail: "Point -> String",
    });
  });
});

describe("toSignatureHelp", () => {
  test("names each parameter by its place in the label, documentation untrusted", () => {
    expect(
      toSignatureHelp({
        label: "add: (Int, Int) -> Int",
        documentation: "Adds two numbers.",
        parameters: [{ range: [6, 9], documentation: "`a`" }, { range: [11, 14] }],
        activeParameter: 1,
      }),
    ).toEqual({
      signatures: [{
        label: "add: (Int, Int) -> Int",
        documentation: { value: "Adds two numbers.", isTrusted: false },
        // A place, never the text: both parameters read `Int`.
        parameters: [
          { label: [6, 9], documentation: { value: "`a`", isTrusted: false } },
          { label: [11, 14] },
        ],
        activeParameter: 1,
      }],
      activeSignature: 0,
      activeParameter: 1,
    });
  });

  test("leaves out the documentation the session did not send", () => {
    const mapped = toSignatureHelp({
      label: "Some: a -> Option(a)",
      parameters: [{ range: [6, 7] }],
      activeParameter: 0,
    });

    expect("documentation" in mapped.signatures[0]!).toBe(false);
    expect("documentation" in mapped.signatures[0]!.parameters[0]!).toBe(false);
  });
});

describe("toInlayHint", () => {
  test("a type is a `Type` hint, drawn where it stands, with its face, untrusted", () => {
    expect(toInlayHint({ offset: 25, label: ": Int", kind: "type", tooltip: "`x: Int`" }, { line: 3, column: 13 }))
      .toEqual({
        label: ": Int",
        position: { line: 3, column: 13 },
        kind: "Type",
        tooltip: { value: "`x: Int`", isTrusted: false },
      });
  });

  test("a colour has no kind, stands apart from its line, and carries its face, untrusted", () => {
    expect(toInlayHint(
      { offset: 90, label: "pure; may fail", kind: "colour", tooltip: "`parse: String ->^ Int`" },
      { line: 3, column: 78 },
    )).toEqual({
      label: "pure; may fail",
      position: { line: 3, column: 78 },
      paddingLeft: true,
      tooltip: { value: "`parse: String ->^ Int`", isTrusted: false },
    });
  });

  test("a regex group's number has no kind and sits against its `(`, with its group's hover, untrusted", () => {
    expect(toInlayHint({ offset: 40, label: "2", kind: "regexGroup", tooltip: "group 2: `(b)`" }, { line: 3, column: 30 }))
      .toEqual({
        label: "2",
        position: { line: 3, column: 30 },
        tooltip: { value: "group 2: `(b)`", isTrusted: false },
      });
  });

  test("never carries an edit", () => {
    expect("textEdits" in toInlayHint({ offset: 9, label: ": Int", kind: "type", tooltip: "`x: Int`" }, 9)).toBe(false);
    expect("textEdits" in toInlayHint({ offset: 9, label: "impure", kind: "colour", tooltip: "`f: () ->! Unit`" }, 9))
      .toBe(false);
  });
});

describe("completionKindOf", () => {
  test("draws each kind the session sends as the language server does", () => {
    expect(
      [
        "value",
        "function",
        "parameter",
        "constructor",
        "type",
        "module",
        "field",
        "operation",
        "member",
      ].map(completionKindOf),
    ).toEqual([
      "Variable",
      "Function",
      "Variable",
      "Constructor",
      "Class",
      "Module",
      "Field",
      "Method",
      "Method",
    ]);
  });

  test("draws a kind it has never heard of as a plain value rather than failing", () => {
    // The session gains kinds over time; an icon this file has no entry for
    // must not cost the item.
    expect(completionKindOf("keyword")).toBe("Variable");
  });
});

describe("hoverSelectionAt", () => {
  const selected = { startOffset: 4, endOffset: 9 };

  test("a pointer inside a selection, its ends included, hovers the selection", () => {
    expect(hoverSelectionAt([selected], 4)).toBe(selected);
    expect(hoverSelectionAt([selected], 6)).toBe(selected);
    expect(hoverSelectionAt([selected], 9)).toBe(selected);
  });

  test("a pointer outside every selection hovers its position", () => {
    expect(hoverSelectionAt([selected], 3)).toBeUndefined();
    expect(hoverSelectionAt([selected], 10)).toBeUndefined();
  });

  test("an empty selection is a caret", () => {
    expect(hoverSelectionAt([{ startOffset: 6, endOffset: 6 }], 6)).toBeUndefined();
  });

  test("with several, the one holding the pointer, whichever way it was drawn", () => {
    const backwards = { startOffset: 25, endOffset: 20 };
    expect(hoverSelectionAt([selected, backwards], 22)).toBe(backwards);
  });
});

describe("caretHoverAnswers", () => {
  const spans = [{ startOffset: 2, endOffset: 4 }];
  const selected = { startOffset: 10, endOffset: 20 };

  test("a caret in no selection opens where the published spans answer", async () => {
    const never = async (): Promise<unknown> => {
      throw new Error("a caret in no selection asks the worker nothing");
    };
    expect(await caretHoverAnswers(spans, [selected], 3, never)).toBe(true);
    expect(await caretHoverAnswers(spans, [selected], 6, never)).toBe(false);
  });

  test("a caret in a selection opens where the selection answers, whatever the spans say there", async () => {
    const asked: unknown[] = [];
    const answering = async (selection: unknown): Promise<unknown> => {
      asked.push(selection);
      return { markdown: "`Int`" };
    };
    expect(await caretHoverAnswers(spans, [selected], 20, answering)).toBe(true);
    expect(asked).toEqual([selected]);
    // The selection names nothing, though the spans hold the caret.
    const silent = async (): Promise<unknown> => undefined;
    expect(await caretHoverAnswers([{ startOffset: 18, endOffset: 22 }], [selected], 20, silent)).toBe(false);
  });
});
