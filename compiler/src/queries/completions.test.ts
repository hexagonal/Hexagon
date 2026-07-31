import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { qualifierAt } from "./completions.js";

/**
 * The cursor is written as `‸` in these sources, and removed before compiling.
 *
 * Not `|`, which is Hexagon's union bar: a marker that can occur in the source
 * being marked finds the wrong place, and the test then quietly asks about an
 * offset nobody chose. That is exactly what it did.
 */
function at(marked: string): { readonly text: string; readonly offset: number } {
  const offset = marked.indexOf("‸");
  if (offset < 0) throw new Error("no cursor in the source");
  return { text: marked.slice(0, offset) + marked.slice(offset + 1), offset };
}

function completionsIn(
  marked: string,
  others: Record<string, string> = {},
): readonly string[] {
  const { text, offset } = at(marked);
  const session = new AnalysisSession();
  for (const [path, other] of Object.entries(others)) session.setFile(path, other);
  session.setFile("/main.hex", text);
  return session.completions("/main.hex", offset).map(({ name, kind }) => `${name}:${kind}`);
}

/** Names only, for assertions that do not care what kind each one is. */
function namesIn(marked: string, others: Record<string, string> = {}): readonly string[] {
  return completionsIn(marked, others).map((entry) => entry.slice(0, entry.lastIndexOf(":")));
}

describe("completions", () => {
  test("offers what is in scope, and says what each one is", () => {
    const offered = completionsIn(
      [
        "union Shade =",
        "    | Pale",
        "",
        "fun tint(value: Int): Shade =",
        "    let doubled: Int = value * 2",
        "    ‸",
        "",
      ].join("\n"),
    );
    expect(offered).toContain("tint:function");
    expect(offered).toContain("value:parameter");
    expect(offered).toContain("doubled:value");
    expect(offered).toContain("Pale:constructor");
    expect(offered).toContain("Shade:type");
  });

  test("a local binder is offered only inside the scope that owns it", () => {
    const source = [
      "fun outer(inside: Int): Int =",
      "    let hidden: Int = inside",
      "    hidden",
      "",
      "fun other(): Int = ‸0",
      "",
    ].join("\n");
    const offered = namesIn(source);
    expect(offered).toContain("outer");
    expect(offered).toContain("other");
    // `inside` and `hidden` belong to `outer`; offering them here would suggest
    // names that do not resolve at this position.
    expect(offered).not.toContain("inside");
    expect(offered).not.toContain("hidden");
  });

  test("a sequential binder is not offered before its own declaration", () => {
    // Statements §5.1: a `let` scopes over the rest of its block. Before that
    // point the name is not merely unhelpful to offer — using it is an error.
    const source = [
      "fun compute(seed: Int): Int =",
      "    let first: Int = ‸seed",
      "    let second: Int = first",
      "    second",
      "",
    ].join("\n");
    const offered = namesIn(source);
    expect(offered).toContain("seed");
    expect(offered).not.toContain("first");
    expect(offered).not.toContain("second");
  });

  test("an inner binding shadows an outer one rather than appearing twice", () => {
    const source = [
      "fun shadowed(value: Int): Int = match value",
      "    value => ‸value",
      "",
    ].join("\n");
    const offered = completionsIn(source);
    expect(offered.filter((entry) => entry.startsWith("value:"))).toEqual([
      // The arm binder, not the parameter: at this offset that is what `value`
      // means, and the shadowed one has no separate entry to offer.
      "value:value",
    ]);
  });

  test("a qualified request lists that module's members and nothing else", () => {
    const helper = [
      "export let two: Int = 2",
      "export fun triple(value: Int): Int = value * 3",
      "",
    ].join("\n");
    const source = ['import * as H from "./helper"', "", "let answer: Int = H.‸", ""].join("\n");
    const offered = completionsIn(source, { "/helper.hex": helper });
    expect(offered).toEqual(["triple:function", "two:value"]);
  });

  test("a qualifier that names no module answers nothing, not everything", () => {
    // The user has said which module they mean. A list that ignores that is a
    // list of wrong answers, which is worse than an empty one.
    const source = ["let answer: Int = Nowhere.‸", ""].join("\n");
    expect(completionsIn(source)).toEqual([]);
  });

  test("the prelude's companions are reachable by name", () => {
    // `Option.` and the rest arrive through the prelude rather than an import,
    // and are how the library is actually used.
    const offered = namesIn(["let answer: Option(Int) = ‸", ""].join("\n"));
    expect(offered).toContain("Option");
    expect(offered).toContain("None");
    expect(offered).toContain("Some");
  });

  test("an imported name is offered under the spelling this module uses", () => {
    const helper = "export let two: Int = 2\n";
    const source = ['import {two as deux} from "./helper"', "", "let four: Int = ‸", ""]
      .join("\n");
    const offered = namesIn(source, { "/helper.hex": helper });
    expect(offered).toContain("deux");
    expect(offered).not.toContain("two");
  });

  test("answers in a buffer that does not parse", () => {
    // This is the normal case for completion rather than a degraded one: at the
    // moment of the request the line is half-typed. The scope record survives it
    // because the resolver writes each region down as it opens it, rather than
    // it being reconstructed from a finished tree.
    const source = [
      "fun tint(value: Int): Int =",
      "    let doubled: Int = value * 2",
      "    doub‸",
      "",
    ].join("\n");
    const session = new AnalysisSession();
    const { text, offset } = at(source);
    session.setFile("/main.hex", text);
    expect(session.diagnostics("/main.hex").length).toBeGreaterThan(0);
    const offered = session.completions("/main.hex", offset).map(({ name }) => name);
    expect(offered).toContain("doubled");
    expect(offered).toContain("value");
  });

  test("a fresh indented line inside a function is still inside it", () => {
    // The position completion is asked from most often: the user pressed Enter.
    // Every region ends at its last token, so without reaching over the
    // whitespace that follows, this offset is outside all of them and the answer
    // is the module's names only — exactly when the locals are wanted.
    const offered = namesIn(
      [
        "fun tint(value: Int): Int =",
        "    let doubled: Int = value * 2",
        "    ‸",
        "",
      ].join("\n"),
    );
    expect(offered).toContain("doubled");
    expect(offered).toContain("value");
  });

  test("a blank line back at column zero has left the function's body", () => {
    // The bound on reaching over whitespace: between two declarations everything
    // is whitespace too, and a cursor back in column zero is writing the next
    // declaration, not still inside the last one.
    const offered = namesIn(
      [
        "fun tint(value: Int): Int =",
        "    let doubled: Int = value * 2",
        "    doubled",
        "‸",
        "",
      ].join("\n"),
    );
    expect(offered).toContain("tint");
    expect(offered).not.toContain("doubled");
  });

  test("a match arm's binder is gone by the time the next arm is written", () => {
    // The bound has to tell a *body* from a construct with a head. A block's
    // start column is where its statements sit, so a cursor there is inside it;
    // an arm's start column is where the arm itself sits, so a cursor there is
    // writing the next arm, and the previous arm's binder has gone out of scope.
    const offered = namesIn(
      ["fun f(n: Int): Int = match n", "    zero => zero", "    ‸", ""].join("\n"),
    );
    expect(offered).toContain("n");
    expect(offered).not.toContain("zero");
  });

  test("a preceding function's parameters are gone at module level", () => {
    // A lambda's region begins at its parameter list, but the declaration sits
    // in column zero, so this is the same test as the arm one and it must have
    // the same answer.
    const offered = namesIn(
      ["fun tint(value: Int): Int = value", "", "‸", ""].join("\n"),
    );
    expect(offered).toContain("tint");
    expect(offered).not.toContain("value");
  });

  test("offers no name the lexer would refuse to read back", () => {
    // A *pattern parameter* is destructured from a binder the compiler mints,
    // which really is in scope in the body. Offering one hands the user a name
    // the lexer will not read back — `synthetic.ts` states the rule this obeys.
    // (An earlier version of this test used a `try` arm, which binds no such
    // name, so it passed with the filter deleted.)
    const offered = namesIn(
      ["fun swap((a, b): (Int, Int)): Int =", "    ‸a", ""].join("\n"),
    );
    expect(offered).toContain("a");
    expect(offered.some((name) => name.startsWith("__hex_"))).toBe(false);
  });

  test("says nothing inside a block comment, and answers again after it", () => {
    // A block comment's span runs past its closing `*)`, unlike a line
    // comment's, which stops at the newline. One bound cannot serve both.
    expect(namesIn(["let value: Int = (* here ‸*)1", ""].join("\n"))).toEqual([]);
    expect(namesIn(["let value: Int = (* here *)‸1", ""].join("\n"))).not.toEqual([]);
  });

  test("says nothing inside a comment", () => {
    // A comment cannot hold code. Strings are deliberately left alone: one can
    // hold an interpolation, where names do belong.
    expect(namesIn(["let value: Int = 1", "// tint ‸", ""].join("\n"))).toEqual([]);
  });

  test("the loop binder is not in scope inside the thing being iterated", () => {
    // The `for` scope is recorded over the *body*, not the whole construct: the
    // iterable is resolved outside it.
    const source = [
      "fun total(xs: Vector(Int)): Int =",
      "    var sum: Int = 0",
      "    for item in xs‸",
      "        sum := sum + item",
      "    sum",
      "",
    ].join("\n");
    expect(namesIn(source)).not.toContain("item");
  });

  test("a module-level declaration wins over the prelude name it occludes", () => {
    // The prelude layer is registered before the module's own, so on the equal
    // spans they share, the later-recorded one reads as the inner one. Reversed,
    // completion would describe the occluded prelude member instead.
    const source = ["fun map(value: Int): Int = value", "", "let used: Int = map(1)", ""]
      .join("\n");
    const { text, offset } = at(`${source}let probe: Int = ‸\n`);
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    const offered = session.completions("/main.hex", offset).find(({ name }) => name === "map");
    expect(offered?.detail).toBe("Int -> Int");
  });

  test("a file the session does not hold answers with nothing", () => {
    const session = new AnalysisSession();
    session.setFile("/main.hex", "let value: Int = 1\n");
    expect(session.completions("/absent.hex", 0)).toEqual([]);
  });
});

describe("qualifierAt", () => {
  test("reads the module name behind a dot", () => {
    expect(qualifierAt("Vector.", 7)).toBe("Vector");
    expect(qualifierAt("Vector.ma", 9)).toBe("Vector");
    expect(qualifierAt("  H.two", 7)).toBe("H");
    // Whitespace around the dot is how the occurrence index already reads a
    // qualified name, so completion reads it the same way.
    expect(qualifierAt("Vector . ", 9)).toBe("Vector");
  });

  test("is not fooled by the forms that merely contain a dot", () => {
    // `..` joins two expressions; a number is not an identifier start. Both fall
    // out of the same two tests rather than needing cases of their own.
    expect(qualifierAt("xs..", 4)).toBeUndefined();
    expect(qualifierAt("1..n", 4)).toBeUndefined();
    expect(qualifierAt("1.", 2)).toBeUndefined();
    expect(qualifierAt("1.5", 3)).toBeUndefined();
    expect(qualifierAt("value", 5)).toBeUndefined();
    expect(qualifierAt("", 0)).toBeUndefined();
    expect(qualifierAt(".", 1)).toBeUndefined();
  });

  test("reads a qualifier outside the basic plane", () => {
    // Walking back one UTF-16 code unit at a time would split a surrogate pair
    // and test half a character against a Unicode property, which answers no for
    // every astral identifier.
    expect(qualifierAt("𝐌odule.x", "𝐌odule.x".length)).toBe("𝐌odule");
  });
});
