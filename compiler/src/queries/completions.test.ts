import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { completionMark, qualifierAt, type Completion } from "./completions.js";

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
    // The binders are named off the prelude's own vocabulary on purpose: a
    // fixture name a prelude member also exports (`first`, `last`) would be
    // offered from the prelude layer whatever the binder does, and the
    // assertion would pass or fail for the wrong reason.
    const source = [
      "fun compute(seed: Int): Int =",
      "    let earlier: Int = ‸seed",
      "    let later: Int = earlier",
      "    later",
      "",
    ].join("\n");
    const offered = namesIn(source);
    expect(offered).toContain("seed");
    expect(offered).not.toContain("earlier");
    expect(offered).not.toContain("later");
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
    const source = ['import Helper as H', "", "let answer: Int = H.‸", ""].join("\n");
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

  /**
   * **The offer list follows the bare layer, so #742 shrank it by construction.**
   * Unqualified completions are built from the scope regions the resolver wrote
   * down, and Modules §5.5 stopped seeding prelude functions and members into
   * the outermost one — so `map`, `empty` and `compare` leave the offer with no
   * completion-side change at all, while the qualified route stays whole.
   *
   * Both halves are asserted, because either alone would pass for the wrong
   * reason: an empty list would satisfy the first, and a list ignoring scope
   * would satisfy the second.
   */
  test("a now-qualified prelude name is not offered bare", () => {
    const offered = namesIn(["let answer: Int = ‸", ""].join("\n"));
    expect(offered).not.toContain("map");
    expect(offered).not.toContain("empty");
    expect(offered).not.toContain("compare");
    expect(offered).not.toContain("log");
    // The sixteen that survive are offered exactly as they were.
    expect(offered).toContain("ignore");
    expect(offered).toContain("show");
    expect(offered).toContain("Some");
    expect(offered).toContain("KeyFault");
  });

  test("and is offered after `Seq.`, where it now has to be written", () => {
    const offered = namesIn(["let answer: Seq(Int) = Seq.‸", ""].join("\n"));
    expect(offered).toContain("map");
    expect(offered).toContain("empty");
    expect(offered).toContain("length");
  });

  test("an imported name is offered under the spelling this module uses", () => {
    const helper = "export let two: Int = 2\n";
    const source = ['import Helper as H', "let deux: Int = H.two", "", "let four: Int = ‸", ""]
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
    expect(offered.some((name) => name.startsWith("__"))).toBe(false);
  });

  test("says nothing inside a block comment, and answers again after it", () => {
    // A closed block comment's span runs one past its `*)`, unlike a line
    // comment's, which stops at the newline. One bound cannot serve both.
        expect(namesIn(["let value: Int = {- here ‸-}1", ""].join("\n"))).toEqual([]);
    expect(namesIn(["let value: Int = {- here -}‸1", ""].join("\n"))).not.toEqual([]);
  });

  test("stays quiet inside a block comment that has not been closed yet", () => {
    // The caret while a comment is being typed sits at the very end of its span,
    // because an unterminated comment runs to the end of the file. Bounding
    // every block exclusively pops the completion list on each keystroke — and
    // "is it a block?" is the wrong question: "was it closed?" is the right one.
    expect(namesIn(["let value: Int = 1", "{- still typing‸", ""].join("\n"))).toEqual([]);
    expect(namesIn(["let value: Int = 1", "{-- doc in progress‸"].join("\n"))).toEqual([]);
    // Block comments nest, so a text ending in `-}` is not proof of closure.
    expect(namesIn(["let value: Int = 1", "{- outer {- inner -}‸"].join("\n"))).toEqual([]);
  });

  test("says nothing inside a comment", () => {
    // A comment cannot hold code. Strings are deliberately left alone: one can
    // hold an interpolation, where names do belong.
    expect(namesIn(["let value: Int = 1", "-- tint ‸", ""].join("\n"))).toEqual([]);
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

  /**
   * `spec/doc-comments.md` §8: what a name documents travels with the offer of
   * that name, so the list answers "which one did I mean?" without a trip to
   * the declaration.
   */
  describe("documentation", () => {
    const DOCUMENTED = [
      "{-- A colour. -}",
      "export union Colour =",
      "    {-- The warm one. -}",
      "    | Red",
      "",
      "{-- Brightens it. -}",
      "export let brighten(colour: Colour): Colour = colour",
      "",
      "export let plain(colour: Colour): Colour = colour",
      "",
      "{-- A box, sealed. -}",
      "opaque record Box = { width: Int }",
      "",
      'extern from "node:fs"',
      "    {-- What the filesystem knows. -}",
      "    type Stats",
      "    {-- Reads the whole file. -}",
      "    fun readFileSync as readFile(path: String) ->! String",
      "",
    ].join("\n");

    /** Every offer at the cursor, as `name :: documentation`. */
    function documented(marked: string, others: Record<string, string> = {}): readonly string[] {
      const { text, offset } = at(marked);
      const session = new AnalysisSession();
      for (const [path, other] of Object.entries(others)) session.setFile(path, other);
      session.setFile("/main.hex", text);
      return session
        .completions("/main.hex", offset)
        .map(({ name, documentation }) => `${name} :: ${documentation ?? "-"}`);
    }

    test("carries what each documented name says, and nothing for the rest", () => {
      const offered = documented(`${DOCUMENTED}let probe: Int = ‸\n`);
      expect(offered).toContain("brighten :: Brightens it.");
      expect(offered).toContain("Red :: The warm one.");
      // A union's name is documented on the declaration; an `extern type` kept
      // only its whole declaration, and is reached by the other key.
      expect(offered).toContain("Colour :: A colour.");
      expect(offered).toContain("Stats :: What the filesystem knows.");
      expect(offered).toContain("plain :: -");
      // A renamed foreign binding is documented under the name this module
      // writes, which is the one being offered.
      expect(offered).toContain("readFile :: Reads the whole file.");
    });

    test("an imported opaque record is documented as the type it is offered as", () => {
      // The one path where a record's documentation is reached by the span the
      // record table kept rather than through its constructor symbol: an opaque
      // record exports no constructor, so the importing module has only the
      // type name to offer.
      const offered = documented(
        'import Helper as Box\n\nlet probe: Int = ‸\n',
        { "/helper.hex": DOCUMENTED },
      );
      expect(offered).toContain("Box :: A box, sealed.");
    });

    test("a name bound from an import carries its own declaration's documentation", () => {
      // What stands where the named import stood (§3.2, #762): an ordinary
      // binding, which is documented by whatever the author wrote above it —
      // the declaring module's doc no longer travels, because no import line
      // carries the name any more. The declaring module's own documentation is
      // reached through the qualified offer below.
      const offered = documented(
        'import Helper as H\n{-- The local one. -}\nlet brighten = H.brighten\n\n' +
          "let probe: Int = ‸\n",
        { "/helper.hex": DOCUMENTED },
      );
      expect(offered).toContain("brighten :: The local one.");
    });

    test("a qualified offer carries it too", () => {
      const offered = documented(
        'import Helper\n\nlet probe: Int = Helper.‸\n',
        { "/helper.hex": DOCUMENTED },
      );
      expect(offered).toContain("brighten :: Brightens it.");
      expect(offered).toContain("plain :: -");
    });
  });
});

/** Every completion at the cursor, whole, for assertions about kinds, details and documentation. */
function offeredAt(marked: string): readonly Completion[] {
  const { text, offset } = at(marked);
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return session.completions("/main.hex", offset);
}

/** A source marked at several places, keeping only the `index`th (from 0) as the cursor. */
function cursorAt(marked: string, index: number): string {
  return marked.split("‸").map((part, at) => (at === index + 1 ? `‸${part}` : part)).join("");
}

/** The compiler's messages for an unmarked source. */
function diagnosticsOf(marked: string): readonly string[] {
  const session = new AnalysisSession();
  session.setFile("/main.hex", marked.replaceAll("‸", ""));
  return session.diagnostics("/main.hex").map(({ message }) => message);
}

/**
 * Method Syntax §8.4: after a value's dot, exactly what the dot consults — read
 * from what the checker decided at that dot.
 */
describe("completions after a value's dot", () => {
  const POINT = [
    "export record Point derives (Eq, Show) = {",
    "    {-- How far across. -}",
    "    x: Int,",
    "    y: Int,",
    "}",
    "",
    "{-- The sum of the two coordinates. -}",
    "export fun norm(p: Point): Int = p.x + p.y",
    "",
    "export fun make(x: Int, y: Int): Point = Point({x, y})",
    "",
  ].join("\n");

  test("a declared record: its fields, its companion's operations, and its members, marked", () => {
    const offered = offeredAt(`${POINT}fun probe(p: Point): Int = p.‸x\n`);
    expect(offered.map(({ name, kind }) => `${name}:${kind}`)).toEqual([
      "equals:member",
      "norm:operation",
      "notEquals:member",
      "show:member",
      "x:field",
      "y:field",
    ]);
    const byName = new Map(offered.map((completion) => [completion.name, completion]));
    expect(byName.get("x")).toMatchObject({ detail: "Int", documentation: "How far across." });
    expect(byName.get("y")?.documentation).toBeUndefined();
    expect(byName.get("norm")).toMatchObject({
      detail: "Point -> Int",
      documentation: "The sum of the two coordinates.",
    });
    expect(byName.get("show")).toMatchObject({ constraint: "Show" });
    expect(byName.get("show")?.needsFace).toBeUndefined();
    // `make` is exported by the home module but does not take a `Point` first,
    // so it is not dot-callable (§4.2) and is not offered after one; neither is
    // `probe`, the scope's own name, since a dot never consults the scope (§1).
    expect(byName.has("make")).toBe(false);
    expect(byName.has("probe")).toBe(false);
  });

  test("a dot nothing follows yet: the same list, read from the receiver as written", () => {
    // Decision 2, ruled (a): the parser keeps the unfinished dot, so the list
    // opens the moment the dot is typed, and the parser's report is the only one.
    const midBlock = `module Main\n${POINT}fun probe(p: Point): Int =\n    let z = p.‸\n    0\n`;
    expect(diagnosticsOf(midBlock)).toEqual(["expected a field name after `.`"]);
    expect(completionsIn(midBlock)).toEqual([
      "equals:member",
      "norm:operation",
      "notEquals:member",
      "show:member",
      "x:field",
      "y:field",
    ]);
    const atEnd = "module Main\nfun probe(v: Vector(Int)) = v.map((n) => n + 1).‸";
    expect(diagnosticsOf(atEnd)).toEqual(["expected a field name after `.`"]);
    expect(namesIn(atEnd)).toEqual(expect.arrayContaining(["filter", "first", "map"]));
    expect(completionsIn("module Main\nfun probe<a: Show>(x: a) = x.‸")).toEqual(["show:member"]);
  });

  test("a dot nothing follows yet is reported once, wherever it stands", () => {
    // A `|>` stage is the callee its rewrite calls, and an enclosing form that
    // holds the unfinished dot knows an earlier pass reported it: neither
    // reports again, as with the recovery node the dot used to be.
    const head = "module Main\nrecord P = { name: String }\n";
    for (const shape of [
      "fun t(q: P): Int = 1 |> q.",
      "fun t(q: P): Int = 1 |> q. |> Vector.length",
      "fun t(q) = 1 |> q.",
      "fun t<a: Show>(v: a) = 1 |> v.",
      "fun t(q: P): Int = throw(q.)",
      "fun t(q: P): Int = q. |> throw",
      "fun t(q: P): Int =\n    let (a, b) = q.\n    a.foo(1)",
      "fun t(q: P): Int = [q.].map((z) => z.foo(1)).length()",
    ]) {
      expect(diagnosticsOf(`${head}${shape}\n`), shape).toEqual(["expected a field name after `.`"]);
    }
  });

  test("a constructor before a dot nothing follows yet is a value, and hover answers on it", () => {
    const text = "module Main\nlet probe = Some.";
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    expect(session.hover("/main.hex", text.indexOf("Some") + 1)).toMatchObject({ name: "Some" });
  });

  test("a dot nothing follows yet after a module is still the module's list, reported once", () => {
    // A qualifier is not a value: `Vector`, an imported alias, a nested module
    // path, or this module's own type name stays the qualifier reading.
    const module = "module Main\nlet probe = Vector.‸";
    expect(diagnosticsOf(module)).toEqual(["expected a field name after `.`"]);
    expect(completionsIn(module)).toContain("map:function");
    const helper = "module Helper\nexport let one: Int = 1\n";
    const aliased = "module Main\nimport Helper\nlet probe = Helper.‸";
    expect(completionsIn(aliased, { "/helper.hex": helper })).toEqual(["one:value"]);
    const nested = "module Main\nlet probe = Regex.Syntax.‸";
    expect(diagnosticsOf(nested)).toEqual(["expected a field name after `.`"]);
    const ownType = "module Point\nexport record Point = { x: Int }\nlet probe = Point.‸";
    expect(diagnosticsOf(ownType)).toEqual(["expected a field name after `.`"]);
    // The module-alias reading comes first even where a term is spelled the
    // same (#829): here a constructor of this module.
    const shadowed = "module Main\nimport Helper as Circle\nunion Shape = Circle | Square\nlet probe = Circle.‸";
    expect(completionsIn(shadowed, { "/helper.hex": helper })).toEqual(["one:value"]);
  });

  test("a dot nothing follows yet, after a subject the text does not decide: nothing", () => {
    const source = "module Main\nfun probe(xs) =\n    let k = Vector.length(xs)\n    xs.‸\n";
    expect(diagnosticsOf(source)).toEqual(["expected a field name after `.`"]);
    expect(completionsIn(source)).toEqual([]);
  });

  test("a dot nothing follows yet after a name that is not there reports the name too", () => {
    // The receiver is resolved as usual, so a name in scope nowhere is
    // reported as it would be with a field after the dot.
    const source = "module Main\nlet probe = nothing.‸";
    expect(diagnosticsOf(source)).toEqual([
      "unknown name `nothing`",
      "expected a field name after `.`",
    ]);
    expect(completionsIn(source)).toEqual([]);
  });

  test("a half-typed name after a vector: the companion's operations, with their types", () => {
    const offered = offeredAt("fun probe(v: Vector(Int)): Vector(Int) = v.ma‸\n");
    const map = offered.find(({ name }) => name === "map");
    expect(map).toMatchObject({ kind: "operation" });
    expect(map?.detail).toMatch(/^\(Vector\(a\), a ->! b\) >-> Vector\(b\)/u);
    expect(offered.map(({ name }) => name)).toContain("filter");
    // `Vector.empty` takes no `Vector` first: correctly invisible after a dot.
    expect(offered.map(({ name }) => name)).not.toContain("empty");
    expect(offered.map(({ name }) => name)).not.toContain("v");
  });

  test("a prelude operation carries its documentation", () => {
    const offered = offeredAt("fun probe(v: Vector(Int)): Option(Int) = v.fi‸rst()\n");
    expect(offered.find(({ name }) => name === "first")).toMatchObject({
      kind: "operation",
      detail: "Vector(a) -> Option(a)",
      documentation: "The first element, or `None` when the vector is empty.",
    });
  });

  test("mid-chain: each link's subject is the call before it", () => {
    const offered = offeredAt(
      "fun probe(v: Vector(Int)): Option(Int) = v.map((n) => n + 1).fi‸\n",
    );
    const names = offered.map(({ name }) => name);
    expect(names).toContain("first");
    expect(names).toContain("filter");
  });

  test("a declared type variable: the subject-first members of its bounds, bases included", () => {
    const offered = offeredAt("fun probe<a: Ord>(x: a, y: a): Ordering = x.‸compare(y)\n");
    expect(offered.map(({ name, kind, constraint }) => `${name}:${kind}:${constraint}`)).toEqual([
      "compare:member:Ord",
      "equals:member:Eq",
      "max:member:Ord",
      "min:member:Ord",
      "notEquals:member:Eq",
    ]);
  });

  test("a declared type variable keeps its bounds while its name is half-typed", () => {
    // A bare read `x.s` asks `a` for a row, and the refusal of that binds the
    // variable after the dot: completion reads the variable the dot saw.
    const offered = offeredAt("fun probe<a: Show>(x: a): String = x.s‸\n");
    expect(offered.map(({ name, kind }) => `${name}:${kind}`)).toEqual(["show:member"]);
  });

  test("a numeric literal takes its default at the dot (§3.3)", () => {
    const names = offeredAt("let probe = (40 + 2).sh‸ow()\n").map(({ name }) => name);
    expect(names).toContain("show");
    expect(names).toContain("div");
  });

  test("a tuple: its positional fields", () => {
    const offered = offeredAt('let pair = (1, "one")\nlet probe = pair.it‸em1\n');
    expect(offered.map(({ name, detail }) => `${name}:${detail}`)).toEqual(["item1:Int", "item2:String"]);
  });

  test("a `widens` binding and the members it supplies are offered once, as the operation", () => {
    const pows = offeredAt("fun probe(b: BigInt): BigInt = b.po‸w(2)\n")
      .filter(({ name }) => name === "pow");
    expect(pows.map(({ kind }) => kind)).toEqual(["operation"]);
  });

  test("a structural record row: its known fields and nothing else", () => {
    const offered = offeredAt("fun probe(r: {x: Int, y: String}): Int = r.‸x\n");
    expect(offered.map(({ name, kind, detail }) => `${name}:${kind}:${detail}`)).toEqual([
      "x:field:Int",
      "y:field:String",
    ]);
  });

  test("an open row: the fields known at the dot, not the ones a later line adds", () => {
    const offered = offeredAt("fun probe(r: {x: Int, ...}): Int = r.‸x + r.width\n");
    expect(offered.map(({ name }) => name)).toEqual(["x"]);
  });

  test("a subject the text does not decide: no companion candidates, though inference knows it", () => {
    // The line above has already made `xs` a `Vector` by the time inference
    // reaches the dot, but the text does not decide `xs`, so the dot is refused
    // (§3.2's own example) — and completion offers what the dot consults,
    // which is nothing. Reading the solved type would offer `length`, and the
    // call it completes would be refused.
    const source = [
      "fun probe(xs) =",
      "    let k = Vector.length(xs)",
      "    xs.le‸ngth() + k",
      "",
    ].join("\n");
    const { text } = at(source);
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toContainEqual(
      expect.stringContaining("the program's text does not decide `xs`'s type here"),
    );
    expect(offeredAt(source)).toEqual([]);
  });

  test("a subject the text does not decide still offers the fields a bare read reaches", () => {
    // §8.4: "record row → known fields; a subject the text does not decide →
    // no companion candidates". The row `r` has at the dot is the one the line
    // above gave it, and a bare read of `x` there is accepted.
    const row = [
      "module Main",
      "fun probe(r) =",
      "    let a: Int = r.x",
      "    r.‸x + a",
      "",
    ].join("\n");
    expect(diagnosticsOf(row)).toEqual([]);
    expect(completionsIn(row)).toEqual(["x:field"]);
    // A nominal record inference already knows at the dot: its fields, which a
    // bare read reaches, and none of its companion's operations or members,
    // which a dot call there would be refused.
    const nominal = [
      "module Main",
      POINT,
      "fun probe(p) =",
      "    let q: Point = p",
      "    p.‸x",
      "",
    ].join("\n");
    expect(diagnosticsOf(nominal)).toEqual([]);
    expect(completionsIn(nominal)).toEqual(["x:field", "y:field"]);
  });

  test("an operation declared below the dot in its own file is not offered (§4.4)", () => {
    const source = [
      "module Main",
      "export record Point = { x: Int, y: Int }",
      "fun before(p: Point): Int = p.‸x",
      "export fun norm(p: Point): Int = p.x + p.y",
      "fun after(p: Point): Int = p.‸x",
      "",
    ].join("\n");
    expect(diagnosticsOf(source)).toEqual([]);
    expect(completionsIn(cursorAt(source, 0))).toEqual(["x:field", "y:field"]);
    expect(completionsIn(cursorAt(source, 1))).toEqual(["norm:operation", "x:field", "y:field"]);
    // The dot's own refusal says the same.
    expect(diagnosticsOf(source.replace("p.‸x", "p.norm()"))).toContainEqual(
      expect.stringContaining("declares `norm` below this call"),
    );
  });

  test("a member of the `fun` block the dot stands in is not offered (§4.4)", () => {
    const source = [
      "module Main",
      "export record Box = { value: Int }",
      "fun",
      "    export twice(b: Box): Int = b.‸value * 2",
      "    export quadruple(b: Box): Int = b.‸value * 2",
      "fun outside(b: Box): Int = b.‸value",
      "",
    ].join("\n");
    expect(diagnosticsOf(source)).toEqual([]);
    expect(completionsIn(cursorAt(source, 0))).toEqual(["value:field"]);
    expect(completionsIn(cursorAt(source, 1))).toEqual(["value:field"]);
    expect(completionsIn(cursorAt(source, 2))).toEqual([
      "quadruple:operation",
      "twice:operation",
      "value:field",
    ]);
  });

  test("a member whose honor stands below the dot in this module is not offered", () => {
    // Constraints §4.8's top-down law: a use of an instance this module
    // declares stands below its honor's knot, or inside it.
    const source = [
      "module Main",
      "export record P = { name: String }",
      "constraint Tag<a> =",
      "    tag(s: a) -> String",
      "fun before(p: P): String = p.‸name",
      "honor Tag<P> =",
      "    tag(s) = s.‸name",
      "fun after(p: P): String = p.‸name",
      "",
    ].join("\n");
    expect(diagnosticsOf(source)).toEqual([]);
    expect(completionsIn(cursorAt(source, 0))).toEqual(["name:field"]);
    expect(completionsIn(cursorAt(source, 1))).toEqual(["name:field", "tag:member"]);
    expect(completionsIn(cursorAt(source, 2))).toEqual(["name:field", "tag:member"]);
    expect(diagnosticsOf(source.replace("p.‸name", "p.tag()"))).toContainEqual(
      expect.stringContaining("its honor is declared below it"),
    );
  });

  test("a `let` operation is not offered inside its own definition (`let` is non-recursive)", () => {
    const source = [
      "module Main",
      "export record Point = { x: Int }",
      "export let first(p: Point): Int = p.‸x",
      "export let second(p: Point): Int = p.‸x + 1",
      "",
    ].join("\n");
    expect(diagnosticsOf(source)).toEqual([]);
    expect(completionsIn(cursorAt(source, 0))).toEqual(["x:field"]);
    expect(completionsIn(cursorAt(source, 1))).toEqual(["first:operation", "x:field"]);
    // The call it would complete is refused in the same words as the bare one.
    expect(diagnosticsOf(source.replace("p.‸x", "p.first()"))).toEqual([
      "`first` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`",
    ]);
  });

  test("a literal's default is the dot's only where the text decides it", () => {
    // `n` is an unannotated lambda parameter nothing writes a type for, so the
    // dot after `(n + 1)` is refused, and offers nothing.
    const source = "module Main\nlet f = (n) => (n + 1).sh‸ow()\n";
    expect(diagnosticsOf(source)).toContainEqual(expect.stringContaining("does not decide"));
    expect(completionsIn(source)).toEqual([]);
  });

  test("a member that does not take its subject first is not offered", () => {
    // `fromNat` builds a value of the subject from a `Nat`: no receiver to put
    // before a dot (§4.2), at a bound or at a concrete type alike.
    expect(namesIn("fun probe<a: Num>(x: a): a = x.‸add(x)\n")).not.toContain("fromNat");
    const atInt = namesIn("fun probe(n: Int): Int = n.‸add(n)\n");
    expect(atInt).toContain("add");
    expect(atInt).not.toContain("fromNat");
  });

  test("each declared type variable keeps its own bounds", () => {
    const source = "fun probe<a: Show, b: Ord>(x: a, y: b): String = x.‸show() + y.‸compare(y).show()\n";
    expect(completionsIn(cursorAt(source, 0))).toEqual(["show:member"]);
    expect(completionsIn(cursorAt(source, 1))).toEqual([
      "compare:member",
      "equals:member",
      "max:member",
      "min:member",
      "notEquals:member",
    ]);
  });

  test("an imported opaque record: its operations, and none of its fields", () => {
    const helper = [
      "module Helper",
      "export opaque record Box = { hidden: Int }",
      "export let peek(box: Box): Int = box.hidden",
      "",
    ].join("\n");
    expect(completionsIn("module Main\nimport Helper\nlet probe(box: Helper.Box): Int = box.pe‸ek()\n", {
      "/helper.hex": helper,
    })).toEqual(["peek:operation"]);
  });

  test("a `Nat` lists the tower members it owns but does not honor, marked as needing a face", () => {
    const offered = offeredAt("fun probe(n: Nat, m: Nat): Int = n.su‸\n");
    const byName = new Map(offered.map((completion) => [completion.name, completion]));
    expect(byName.get("subtract")).toMatchObject({ kind: "member", constraint: "Signed", needsFace: true });
    expect(byName.get("divide")).toMatchObject({ kind: "member", needsFace: true });
    // An honored member needs no face.
    expect(byName.get("add")).toMatchObject({ kind: "member", constraint: "Num" });
    expect(byName.get("add")?.needsFace).toBeUndefined();
  });
});

describe("completionMark", () => {
  test("says whose member it is, and that an owned tower member needs a written type", () => {
    expect(completionMark({ constraint: "Show" })).toBe("Show member");
    expect(completionMark({ constraint: "Signed", needsFace: true }))
      .toBe("Signed member, needs a written type");
    expect(completionMark({})).toBeUndefined();
  });
});

describe("completions after a prelude module", () => {
  test("carry each member's documentation, though nothing has reached the module yet", () => {
    // The companion is not emitted until the program uses it, so its doc blocks
    // were indexed nowhere and every member came back undocumented — while an
    // imported module, always emitted, documented its own.
    for (const [marked, name, documentation] of [
      ["let probe = Vector.‸\n", "first", "The first element, or `None` when the vector is empty."],
      ["let probe = Option.‸\n", "map", "Transforms a present value. `None` stays `None`."],
    ] as const) {
      expect(offeredAt(marked).find((completion) => completion.name === name)?.documentation)
        .toBe(documentation);
    }
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
