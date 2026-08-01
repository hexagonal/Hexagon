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
  readonly onEnterRules: readonly { beforeText: string; afterText?: string }[];
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
    expect(configuration.comments.lineComment).toBe("//");
    expect(configuration.comments.blockComment).toEqual(["(*", "*)"]);
  });

  it("leaves block-comment auto-closing to the `(` pair", () => {
    // A `(*` pair fires only after `(` has already auto-closed, which would strand
    // that pair's `)` after the inserted ` *)`.
    expect(configuration.autoClosingPairs.map(({ open }) => open)).not.toContain("(*");
  });

  it("continues a doc comment, but not spec/doc-comments.md §2.2's carve-outs", () => {
    const openers = configuration.onEnterRules.filter(({ beforeText }) =>
      beforeText.includes("\\(\\*\\*")
    );
    expect(openers).toHaveLength(2);

    for (const { beforeText } of openers) {
      const opener = new RegExp(beforeText);
      expect(opener.test("(** doc")).toBe(true);
      expect(opener.test("    (** doc")).toBe(true);
      // A bare `(**` opens a newline-first body (spec/doc-comments.md §3.1), which is a
      // doc comment, so Enter continues it.
      expect(opener.test("(**")).toBe(true);
      // §2.2: `(**)` is the empty block comment and `(***`, `(****…` are banners and
      // rulers. None is a doc opener, so Enter must not offer to continue one.
      expect(opener.test("(**)")).toBe(false);
      expect(opener.test("(*** banner")).toBe(false);
      expect(opener.test("(**********")).toBe(false);
      // Already closed on its own line, so there is nothing to continue.
      expect(opener.test("(** doc *)")).toBe(false);
    }

    const closer = openers.find(({ afterText }) => afterText !== undefined)?.afterText;
    expect(new RegExp(closer ?? "").test("*)")).toBe(true);

    const continuation = configuration.onEnterRules.find(({ beforeText }) =>
      beforeText.startsWith("^(\\t|[ ])*[ ]\\*")
    );
    expect(continuation).toBeDefined();
    const inside = new RegExp(continuation?.beforeText ?? "");
    expect(inside.test(" * more")).toBe(true);
    expect(inside.test(" * more *)")).toBe(false);
  });

  it("continues no `///` run (spec/doc-comments.md §2.3)", () => {
    // The line-doc reservation was revoked unspent, so `///` is an ordinary comment
    // and an editor that appends `/// ` on Enter would be teaching a form that does
    // not exist. Ordinary `//` runs are not continued either, and never were.
    for (const { beforeText } of configuration.onEnterRules) {
      expect(new RegExp(beforeText).test("/// doc"), beforeText).toBe(false);
    }
  });
});
