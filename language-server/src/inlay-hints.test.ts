import { describe, expect, test } from "vitest";
import { InlayHintKind } from "vscode-languageserver";
import type { InlayHint } from "../../compiler/src/index.js";
import { DEFAULT_INLAY_HINT_SETTINGS, inlayHintSettingsOf, toLspInlayHints } from "./inlay-hints.js";

const HINTS: readonly InlayHint[] = [
  { offset: 3, label: ": Int", kind: "type", tooltip: "x: Int" },
  { offset: 9, label: "impure; may fail", kind: "colour", tooltip: "save0: () ->! Unit" },
  { offset: 12, label: "<a: Show>", kind: "type", tooltip: "f: <a: Show> a -> String\ng: Int -> Int" },
  { offset: 20, label: "1", kind: "regexGroup", tooltip: "group 1: `(a)`\n\nRead it with `m.group(1)`." },
];
const at = (offset: number) => ({ line: 0, character: offset });

describe("the inlay hint settings", () => {
  const none = { types: false, colours: false, regexGroups: false };
  const all = { types: true, colours: true, regexGroups: true };

  test("all off until turned on, for a client with nothing to say and for junk", () => {
    expect(DEFAULT_INLAY_HINT_SETTINGS).toEqual(none);
    expect(inlayHintSettingsOf(undefined)).toEqual(none);
    expect(inlayHintSettingsOf(null)).toEqual(none);
    expect(inlayHintSettingsOf({ types: "yes", colours: 1, regexGroups: "on" })).toEqual(none);
  });

  test("each read on its own", () => {
    expect(inlayHintSettingsOf({ types: true })).toEqual({ ...none, types: true });
    expect(inlayHintSettingsOf({ colours: true })).toEqual({ ...none, colours: true });
    expect(inlayHintSettingsOf({ regexGroups: true })).toEqual({ ...none, regexGroups: true });
    expect(inlayHintSettingsOf({ types: true, colours: true, regexGroups: true })).toEqual(all);
  });

  test("by default, no hint of any kind", () => {
    expect(toLspInlayHints(HINTS, at, DEFAULT_INLAY_HINT_SETTINGS)).toEqual([]);
  });
});

describe("hints as the protocol's", () => {
  const ALL = { types: true, colours: true, regexGroups: true };
  test("a type is a type hint, with nothing to write, and the face it is a piece of as its tooltip", () => {
    expect(toLspInlayHints([HINTS[0]!], at, ALL)).toEqual([
      { position: at(3), label: ": Int", kind: InlayHintKind.Type, tooltip: { kind: "markdown", value: "`x: Int`" } },
    ]);
  });

  test("a colour has no kind, stands apart from its line, and carries the face as its tooltip", () => {
    expect(toLspInlayHints([HINTS[1]!], at, ALL)).toEqual([
      {
        position: at(9),
        label: "impure; may fail",
        paddingLeft: true,
        tooltip: { kind: "markdown", value: "`save0: () ->! Unit`" },
      },
    ]);
  });

  test("a `fun` block head's tooltip shows each member's face, one line each", () => {
    expect(toLspInlayHints([HINTS[2]!], at, ALL)[0]?.tooltip)
      .toEqual({ kind: "markdown", value: "`f: <a: Show> a -> String`\n\n`g: Int -> Int`" });
  });

  test("a regex group's number has no kind, sits against its `(`, and carries the group's hover", () => {
    expect(toLspInlayHints([HINTS[3]!], at, ALL)).toEqual([
      { position: at(20), label: "1", tooltip: { kind: "markdown", value: "group 1: `(a)`\n\nRead it with `m.group(1)`." } },
    ]);
  });

  test("a setting turned off leaves its kind out, and only its kind", () => {
    expect(toLspInlayHints(HINTS, at, { types: false, colours: true, regexGroups: true }).map(({ label }) => label))
      .toEqual(["impure; may fail", "1"]);
    expect(toLspInlayHints(HINTS, at, { types: true, colours: false, regexGroups: true }).map(({ label }) => label))
      .toEqual([": Int", "<a: Show>", "1"]);
    expect(toLspInlayHints(HINTS, at, { types: true, colours: true, regexGroups: false }).map(({ label }) => label))
      .toEqual([": Int", "impure; may fail", "<a: Show>"]);
  });
});
