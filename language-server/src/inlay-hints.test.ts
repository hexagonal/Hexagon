import { describe, expect, test } from "vitest";
import { InlayHintKind } from "vscode-languageserver";
import type { InlayHint } from "../../compiler/src/index.js";
import { DEFAULT_INLAY_HINT_SETTINGS, inlayHintSettingsOf, toLspInlayHints } from "./inlay-hints.js";

const HINTS: readonly InlayHint[] = [
  { offset: 3, label: ": Int", kind: "type", tooltip: "x: Int" },
  { offset: 9, label: "impure; may fail", kind: "colour", tooltip: "save0: () ->! Unit" },
  { offset: 12, label: "<a: Show>", kind: "type", tooltip: "f: <a: Show> a -> String\ng: Int -> Int" },
];
const at = (offset: number) => ({ line: 0, character: offset });

describe("the inlay hint settings", () => {
  test("both on by default, for a client with nothing to say and for junk", () => {
    expect(DEFAULT_INLAY_HINT_SETTINGS).toEqual({ types: true, colours: true });
    expect(inlayHintSettingsOf(undefined)).toEqual({ types: true, colours: true });
    expect(inlayHintSettingsOf(null)).toEqual({ types: true, colours: true });
    expect(inlayHintSettingsOf({ types: "no", colours: 0 })).toEqual({ types: true, colours: true });
  });

  test("each read on its own", () => {
    expect(inlayHintSettingsOf({ types: false })).toEqual({ types: false, colours: true });
    expect(inlayHintSettingsOf({ colours: false })).toEqual({ types: true, colours: false });
  });
});

describe("hints as the protocol's", () => {
  test("a type is a type hint, with nothing to write, and the face it is a piece of as its tooltip", () => {
    expect(toLspInlayHints([HINTS[0]!], at, DEFAULT_INLAY_HINT_SETTINGS)).toEqual([
      { position: at(3), label: ": Int", kind: InlayHintKind.Type, tooltip: { kind: "markdown", value: "`x: Int`" } },
    ]);
  });

  test("a colour has no kind, stands apart from its line, and carries the face as its tooltip", () => {
    expect(toLspInlayHints([HINTS[1]!], at, DEFAULT_INLAY_HINT_SETTINGS)).toEqual([
      {
        position: at(9),
        label: "impure; may fail",
        paddingLeft: true,
        tooltip: { kind: "markdown", value: "`save0: () ->! Unit`" },
      },
    ]);
  });

  test("a `fun` block head's tooltip shows each member's face, one line each", () => {
    expect(toLspInlayHints([HINTS[2]!], at, DEFAULT_INLAY_HINT_SETTINGS)[0]?.tooltip)
      .toEqual({ kind: "markdown", value: "`f: <a: Show> a -> String`\n\n`g: Int -> Int`" });
  });

  test("a setting turned off leaves its kind out, and only its kind", () => {
    expect(toLspInlayHints(HINTS, at, { types: false, colours: true }).map(({ label }) => label))
      .toEqual(["impure; may fail"]);
    expect(toLspInlayHints(HINTS, at, { types: true, colours: false }).map(({ label }) => label))
      .toEqual([": Int", "<a: Show>"]);
  });
});
