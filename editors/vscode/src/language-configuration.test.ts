/**
 * language-configuration.json drives word selection, bracket matching, comment
 * toggling, and auto-indent. None of it goes through the TextMate grammar, so it
 * needs its own tests — a `wordPattern` can be silently wrong in a way nothing in
 * the editor reports.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface LanguageConfiguration {
  readonly comments: { lineComment: string; blockComment: [string, string] };
  readonly wordPattern: { pattern: string; flags?: string };
  readonly indentationRules: {
    increaseIndentPattern: string;
    decreaseIndentPattern: string;
  };
  readonly autoClosingPairs: readonly { open: string; close: string }[];
  readonly onEnterRules: readonly {
    beforeText: string;
    afterText?: string;
    action?: { indent?: string; appendText?: string };
  }[];
}

const configuration = JSON.parse(
  await readFile(fileURLToPath(new URL("../language-configuration.json", import.meta.url)), "utf8"),
) as LanguageConfiguration;

describe("wordPattern", () => {
  it("is the object form, so its flags survive", () => {
    // VS Code compiles a bare-string wordPattern with no flags. Without `u`,
    // every `\p{...}` silently degrades to an identity escape and the class
    // becomes a literal set of the letters in `p{ID_Start}$_`.
    expect(typeof configuration.wordPattern).toBe("object");
    expect(configuration.wordPattern.flags ?? "").toContain("u");
  });

  const word = () =>
    new RegExp(configuration.wordPattern.pattern, configuration.wordPattern.flags ?? "");

  it("selects a whole identifier, per spec/lexer.md §3.1", () => {
    for (const name of ["map", "count", "values", "Seq", "xs", "memoize", "parse_json"]) {
      expect(word().exec(name)?.[0], name).toBe(name);
    }
  });

  it("selects the whole of a Unicode identifier", () => {
    for (const name of ["用户", "café2", "Résultat", "δelta", "$税率", "_折扣"]) {
      expect(word().exec(name)?.[0], name).toBe(name);
    }
  });

  it("does not start a word at a digit", () => {
    expect(word().exec("2x")?.[0]).toBe("x");
  });

  it("stops at a character that cannot continue an identifier", () => {
    expect(word().exec("map(xs)")?.[0]).toBe("map");
    expect(word().exec("a.b")?.[0]).toBe("a");
  });
});

describe("indentation rules", () => {
  const increase = () => new RegExp(configuration.indentationRules.increaseIndentPattern);
  const decrease = () => new RegExp(configuration.indentationRules.decreaseIndentPattern);

  it("opens a block after a header that ends in a block-opening token", () => {
    for (const line of [
      "    if count <= 0 then",
      "    else",
      "let step = () =>",
      "constraint Integral<a: (Num, Ord)> =",
      "honor Ord<Rat> =",
      "        match next(current)",
      "    while searching",
      'extern from "hex:intrinsic"',
    ]) {
      expect(increase().test(line), line).toBe(true);
    }
  });

  it("does not open a block after a complete one-line declaration", () => {
    // spec/lexer.md §4.1: `derive` is legal only as the complete body of an
    // `honor` declaration, so this line opens nothing.
    expect(increase().test("honor Eq<Point> = derive")).toBe(false);
    expect(increase().test("export let empty: Seq(a) = Seq({ pull = () => None })")).toBe(false);
    expect(increase().test("let x = 1")).toBe(false);
  });

  it("dedents `else` onto its parent's column", () => {
    expect(decrease().test("    else")).toBe(true);
    expect(decrease().test("    empty")).toBe(false);
  });
});

describe("comment configuration", () => {
  it("matches the forms spec/comments.md §1 defines", () => {
    expect(configuration.comments.lineComment).toBe("--");
    expect(configuration.comments.blockComment).toEqual(["{-", "-}"]);
  });

  /**
   * The editor's choice of pair, as VS Code and Monaco make it when a character is typed:
   * the longest `open` that ends in the character and whose earlier characters are
   * already there; and, when a shorter pair that `open` contains has its `close` right
   * after the caret, only the part of the longer `close` that is not that one. Modelled
   * so the cases below say what an author sees, not only what the file holds.
   */
  function typeInto(before: string, after: string, typed: string): string {
    const pairs = configuration.autoClosingPairs;
    const text = before + typed;
    const pair = pairs
      .filter(({ open }) => text.endsWith(open))
      .sort((a, b) => b.open.length - a.open.length)[0];
    if (pair === undefined) return `${text}|${after}`;
    const contained = pairs
      .filter(
        (candidate) =>
          candidate.open !== pair.open &&
          pair.open.includes(candidate.open) &&
          pair.close.endsWith(candidate.close),
      )
      .sort((a, b) => b.open.length - a.open.length)[0];
    const close =
      contained !== undefined && after.startsWith(contained.close)
        ? pair.close.slice(0, pair.close.length - contained.close.length)
        : pair.close;
    return `${text}|${close}${after}`;
  }

  it("closes a typed `{-` as a comment, never leaving the unterminated `{-}`", () => {
    // `{` auto-closes to `{}` first; the `-` then completes the comment pair inside it.
    expect(typeInto("let x = ", "", "{")).toBe("let x = {|}");
    expect(typeInto("let x = {", "}", "-")).toBe("let x = {-| -}");
    // A third character makes the doc opener, and no pair fires on it.
    expect(typeInto("{-", " -}", "-")).toBe("{--| -}");
    // A brace and a minus written apart are a brace and a minus (spec/comments.md §3).
    expect(typeInto("let r = { ", "}", "-")).toBe("let r = { -|}");
  });

  it("leaves the `{` of `${` to the string (spec/comments.md §3)", () => {
    // `"${-x}"` interpolates `-x`: the shim pair wins at `${` and adds nothing.
    expect(typeInto('let t = "$', '"', "{")).toBe('let t = "${|}"');
    expect(typeInto('let t = "${', '}"', "-")).toBe('let t = "${-|}"');
  });

  it("lays out a doc comment, but not spec/doc-comments.md §2.2's carve-outs", () => {
    const openers = configuration.onEnterRules.filter(({ beforeText }) =>
      beforeText.includes("\\{--")
    );
    expect(openers).toHaveLength(2);

    for (const { beforeText } of openers) {
      const opener = new RegExp(beforeText);
      expect(opener.test("{-- doc")).toBe(true);
      expect(opener.test("    {-- doc")).toBe(true);
      expect(opener.test("{-- - first item")).toBe(true);
      // A bare `{--` opens a newline-first body (spec/doc-comments.md §3.1), which is a
      // doc comment, so Enter lays it out.
      expect(opener.test("{--")).toBe(true);
      // §2.2: `{--}` is the empty block comment and `{---`, `{----…` are banners and
      // rulers; `{-|` is an ordinary comment. None is a doc opener.
      expect(opener.test("{--}")).toBe(false);
      expect(opener.test("{--- banner")).toBe(false);
      expect(opener.test("{----------")).toBe(false);
      expect(opener.test("{-| haddock")).toBe(false);
      expect(opener.test("{- note")).toBe(false);
      // Already closed on its own line, so there is nothing to lay out.
      expect(opener.test("{-- doc -}")).toBe(false);
    }

    const closer = openers.find(({ afterText }) => afterText !== undefined)?.afterText;
    expect(new RegExp(closer ?? "").test(" -}")).toBe(true);
    expect(new RegExp(closer ?? "").test("-}")).toBe(true);
  });

  it("adds no continuation prefix inside a doc body", () => {
    // spec/doc-comments.md §3.1 dedents the body and keeps everything else, so a ` * `
    // gutter — OCaml's and JSDoc's habit — would be content, a stray list marker.
    for (const rule of configuration.onEnterRules) {
      expect(rule.action?.appendText).toBeUndefined();
    }
  });

  it("continues no line comment (spec/doc-comments.md §2.3)", () => {
    // There is no line documentation form: `---` and `-- |` are ordinary comments, and an
    // editor that continued them would be teaching a form that does not exist.
    for (const { beforeText } of configuration.onEnterRules) {
      for (const line of ["--- doc", "-- | doc", "-- note", "/// doc"]) {
        expect(new RegExp(beforeText).test(line), `${beforeText} on ${line}`).toBe(false);
      }
    }
  });
});
