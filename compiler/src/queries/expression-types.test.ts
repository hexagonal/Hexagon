import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import { hoverMarkdown } from "../analysis/hover-text.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parseFile } from "../passes/parser/parser.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";
import * as Source from "../support/source.js";
import { selectionRangesAt, type SyntaxNode, syntaxTree } from "./syntax-nodes.js";

/**
 * A program and where in it: `‸` is a caret, `«…»` a selection. Both marks are
 * removed before compiling.
 */
function marked(source: string): { readonly text: string; readonly start: number; readonly end: number } {
  const caret = source.indexOf("‸");
  if (caret >= 0) return { text: source.slice(0, caret) + source.slice(caret + 1), start: caret, end: caret };
  const open = source.indexOf("«");
  const close = source.indexOf("»");
  if (open < 0 || close < open) throw new Error("no caret or selection in the source");
  return {
    text: source.slice(0, open) + source.slice(open + 1, close) + source.slice(close + 1),
    start: open,
    end: close - 1,
  };
}

function sessionOf(text: string): AnalysisSession {
  const session = new AnalysisSession();
  session.setFile("/main.hex", text);
  return session;
}

/** The hover's text, and the text it highlights, or `none`. */
function shown(source: string): string {
  const { text, start, end } = marked(source);
  const session = sessionOf(text);
  const hover = start === end ? session.hover("/main.hex", start) : session.hoverSelection("/main.hex", start, end);
  if (hover === undefined) return "none";
  return `${hoverMarkdown(hover)} @ ${text.slice(hover.span.start.offset, hover.span.end.offset)}`;
}

const HEAD = "module Main\n";

/**
 * The forms the standard library rarely or never writes, each holding names: a
 * `while`, a `for`, an index, an assignment, a record update, a comparison
 * chain, `not` and a minus, `try`, a guard, `attempt` and `assume`, a `match`
 * with a `catch`, a pattern's construction.
 */
const FORMS = [
  "module Main",
  "import Rat",
  "exception Oops(code: Int)",
  "let risky(n: Int): Int = if n > 0 then n else throw^(Oops(n))",
  "let forms(xs: Vector(Int), i: Int, flag: Bool, base: {x: Int, y: Int}): Int =",
  "    var total = 0",
  "    while flag",
  "        total := total + xs[i]",
  "    for value in xs",
  "        total := total - value",
  "    let moved = { base with x = i }",
  "    let ordered = i < total <= moved.y",
  "    let negated = not flag",
  "    let minus = -total",
  "    let tried = try",
  "        risky^(i)",
  "    catch",
  "        Oops(code) when code > i => code",
  "    let made = attempt risky^(i)",
  "    let sure = assume risky^(total)",
  "    let chosen =",
  "        match risky^(i)",
  "            n when n > total => n",
  "            _ => minus",
  "        catch",
  "            Oops(code) => code",
  "    let top: BigInt = 1",
  "    let half = (top, top + 1)rat",
  "    tried + sure + chosen",
  "",
].join("\n");

/** The declarations the standard library rarely or never writes, each holding names. */
const DECLARATIONS = [
  "module Main",
  "import Vector as V",
  "type Pair(a) = (a, a)",
  "type Point = {x: Int, y: V.Vector(Int)}",
  "union Shape = | Dot | Box(width: Int, height: Int)",
  "let halve(n: Int): Option(Int) = Some(n)",
  "let double(n: Int): Int = n",
  "pattern twice(value: Int): Int",
  "    view = halve",
  "    build = double",
  "pattern doubled = Main.twice",
  "fun counter(start: Int): Int = start",
  "let alias<a: Show>: (a) -> String = Show.show",
  "let pick(s: Shape, xs: Vector(Int)): Int = match (s, xs)",
  "    (Main.Box(w, _) as whole, [first, ...rest]) => w",
  "    (Dot | Main.Dot, []) => 0",
  "    ({ x, y = other }, _) => 1",
  "",
].join("\n");

describe("the type of a selection", () => {
  test("a call: the type it has here, over the call", () => {
    expect(shown(`${HEAD}let h = «Vector.first(["a", "b"])»\n`))
      .toBe('`Option(String)` @ Vector.first(["a", "b"])');
  });

  test("spaces, line breaks and comments at the selection's ends are not part of it", () => {
    expect(shown(`${HEAD}let h = 1 +«  (* two *) 2 »* 3\n`)).toBe("`Int` @ 2");
  });

  test("a selection that is not one expression names the smallest one holding it", () => {
    expect(shown(`${HEAD}let n = 1 «+ 2» * 3\n`)).toBe("`Int` @ 1 + 2 * 3");
    expect(shown(`${HEAD}let n = (1, «"a")»\n`)).toBe('`(Int, String)` @ (1, "a")');
  });

  test("an expression the checker converted in place: the type it has, and the one it became", () => {
    expect(shown(`${HEAD}let s: Seq(Int) = «[1, 2]»\n`))
      .toBe("`Vector(Int)`\n\nconverted to `Seq(Int)` here @ [1, 2]");
    expect(shown(`${HEAD}let m: Nat = 2\nlet w: Int = «m»\n`))
      .toBe("`Nat`\n\nconverted to `Int` here @ m");
    // What a converted expression holds keeps its own types.
    const call = `${HEAD}let m: Nat = 2\nlet f(k: Nat): Nat = k\nlet w: Int = «f(m)»\n`;
    expect(shown(call)).toBe("`Nat`\n\nconverted to `Int` here @ f(m)");
    expect(shown(call.replace("«f(m)»", "f(«m»)"))).toBe("`Nat` @ m");
    expect(shown(`${HEAD}let s: Seq(Int) = [1 ‸+ 2]\n`)).toBe("`Int` @ +");
  });

  test("a selected name: its type here, the instance, where hover shows the declaration's face", () => {
    const source = `${HEAD}let h = «Vector.first»(["a"])\n`;
    expect(shown(source)).toBe("`Vector(String) -> Option(String)` @ Vector.first");
    const { text } = marked(source);
    expect(sessionOf(text).hover("/main.hex", text.indexOf("first"))?.displayedType)
      .toBe("Vector(a) -> Option(a)");
  });

  test("a dot call's operation, selected: its type at the receiver", () => {
    expect(shown(`${HEAD}let n = "abc".«length»()\n`)).toBe("`String -> Int` @ length");
  });

  test("a selection inside a name is the name", () => {
    expect(shown(`${HEAD}let total = 1\nlet n = to«ta»l + 1\n`)).toBe("`Int` @ total");
  });

  test("a group is the expression it holds, where the checker kept no group", () => {
    expect(shown(`${HEAD}let n = 1\nlet g = «(n)»\n`)).toBe("`Int` @ (n)");
  });

  test("a form: its type over the whole form", () => {
    expect(shown(`${HEAD}let n = 3\nlet r = «if n > 2 then n else 0»\n`)).toBe("`Int` @ if n > 2 then n else 0");
  });

  test("inside a generic function, the type's own letters, never an internal number", () => {
    expect(shown(`${HEAD}let pair(m: b, xs: Vector(a)): (b, Vector(a)) = («m, xs»)\n`))
      .toBe("`(a, Vector(b))` @ (m, xs)");
    expect(shown(`${HEAD}let first(xs: Vector(a)): Vector(a) = «xs»\n`)).toBe("`Vector(a)` @ xs");
    // And hover on the parameter itself, which showed `Vector(t1257)` (#995).
    expect(shown(`${HEAD}let first(xs: Vector(a)): Vector(a) = x‸s\n`)).toBe("value `xs: Vector(a)` @ xs");
  });

  test("what is not an expression answers nothing", () => {
    // A pattern, a type, a declaration, a binder.
    expect(shown(`${HEAD}let f(o: Option(Int)): Int = match o\n    «Some(x)» => x\n    None => 0\n`)).toBe("none");
    expect(shown(`${HEAD}let f(o: «Option(Int)»): Int = 0\n`)).toBe("none");
    expect(shown(`${HEAD}«let n = 1»\n`)).toBe("none");
    expect(shown(`${HEAD}let f(«o»: Int): Int = o\n`)).toBe("none");
    // A record literal's field label.
    expect(shown(`${HEAD}let p = { «x» = 1 }\n`)).toBe("none");
    // A pattern parameter that is one name: the checker holds the argument in
    // a binder over the pattern's text (#1434), which is not the pattern's type.
    expect(shown(`${HEAD}let f = («None») => 0\n`)).toBe("none");
  });

  test("a member's body in an `honor` or a constraint answers as any body does", () => {
    const light = `${HEAD}union Light = | Red | Green\n`;
    expect(shown(`${light}honor Eq<Light> =\n    equals(left, right) = 1 ‸< 2\n`)).toBe("`Bool` @ <");
    expect(shown(`${light}honor Eq<Light> =\n    equals(left, right) = «left» == right\n`)).toBe("`Light` @ left");
    // A caret just after the member's documented name is on the name.
    expect(shown(`${light}honor Eq<Light> =\n    (** Same light. *)\n    equals‸(left, right) = left == right\n`))
      .toBe("`equals`\n\nSame light. @ equals");
    // Its header is the member's function, as a `let` function's is.
    expect(shown(`${light}honor Eq<Light> =\n    equals(left, right) ‸= left == right\n`)).toBe("`(Light, Light) -> Bool` @ =");
    expect(shown(`${HEAD}let f(n: Int): Int ‸= n\n`)).toBe("`Int -> Int` @ =");
  });

  test("a captured colour is glossed as hover glosses it (Effects §10)", () => {
    const source = `${HEAD}export let outer(action: () ->! Unit): Unit =\n    let g = «action»\n    g!()\n`;
    expect(shown(source)).toBe(
      "`() >-> Unit`\n\nimpure only if `outer`'s `action` is; may fail only if `outer`'s `action` may @ action",
    );
  });

  test("a piece the checker folded into the one around it answers nothing, rather than borrowing", () => {
    // A module qualifier, a method's `receiver.name`, and a `|>` stage's call.
    expect(shown(`${HEAD}let h = «Vector».first(["a"])\n`)).toBe("none");
    expect(shown(`${HEAD}let n = «"abc".length»()\n`)).toBe("none");
    expect(shown(`${HEAD}let q = [1] |> «Vector.map((v) => v + 1)»\n`)).toBe("none");
  });

  test("a record pun is the name it repeats", () => {
    expect(shown(`${HEAD}let x = 1\nlet p = { «x» }\n`)).toBe("`Int` @ x");
  });

  test("a selection is read in the module it starts in", () => {
    expect(shown("module First\nlet a = «1\n\n»module Second\nlet b = 2\n")).toBe("`Int` @ 1");
  });

  test("nothing selected but spaces answers nothing", () => {
    expect(shown(`${HEAD}let n = 1«   »+ 2\n`)).toBe("none");
  });

  test("an expression the checker could not type answers nothing", () => {
    expect(shown(`${HEAD}let n = «missing»\n`)).toBe("none");
  });
});

describe("the type at an operator, a bracket, a literal or a keyword", () => {
  test("an operator: its expression's type, highlighting the operator", () => {
    expect(shown(`${HEAD}let n = 1 + 2 ‸* 3\n`)).toBe("`Int` @ *");
    expect(shown(`${HEAD}let n = 1 ‸+ 2 * 3\n`)).toBe("`Int` @ +");
    expect(shown(`${HEAD}let q = [1] ‸|> Vector.length\n`)).toBe("`Int` @ |>");
    expect(shown(`${HEAD}let b = 1 ‸< 2\n`)).toBe("`Bool` @ <");
    // No gloss and no conversion: those fields are absent, not empty.
    const text = `${HEAD}let n = 1 + 2 * 3\n`;
    expect(sessionOf(text).hover("/main.hex", text.indexOf("*"))).toEqual({
      span: expect.anything(),
      displayedType: "Int",
    });
  });

  test("a bracket: the call, the vector, the group it closes", () => {
    expect(shown(`${HEAD}let h = Vector.first(["a"]‸)\n`)).toBe("`Option(String)` @ )");
    expect(shown(`${HEAD}let h = Vector.first(‸["a"])\n`)).toBe("`Vector(String)` @ [");
    expect(shown(`${HEAD}let n = 2 * ‸(3 - 1)\n`)).toBe("`Int` @ (");
  });

  test("a `(` just after a callee is the callee's, as a caret just after a name is on it", () => {
    expect(shown(`${HEAD}let twice(n: Int): Int = n * 2\nlet t = twice‸(1)\n`)).toBe("value `twice: Int -> Int` @ twice");
    expect(shown(`${HEAD}let twice(n: Int): Int = n * 2\nlet t = twice(1‸)\n`)).toBe("`Int` @ )");
  });

  test("a literal: the type its place gave it", () => {
    expect(shown(`${HEAD}let u: Float = ‸1\n`)).toBe("`Float` @ 1");
    // The run under the pointer: the text between the quotes, or a quote.
    expect(shown(`${HEAD}let s = "a‸bc"\n`)).toBe("`String` @ abc");
    expect(shown(`${HEAD}let s = ‸"abc"\n`)).toBe('`String` @ "');
  });

  test("a keyword: the type of the form it opens", () => {
    const source = `${HEAD}let n = 3\nlet r = ‸if n > 2 then n else 0\n`;
    expect(shown(source)).toBe("`Int` @ if");
    expect(shown(source.replace("‸", "").replace("then", "‸then"))).toBe("`Int` @ then");
    expect(shown(`${HEAD}let o: Option(Int) = None\nlet k = ‸match o\n    Some(x) => x\n    None => 0\n`))
      .toBe("`Int` @ match");
  });

  test("a part of a form's own syntax is the form's: an arm's `=>`, a field's `=`, a string's `${`", () => {
    expect(shown(`${HEAD}let o: Option(Int) = None\nlet k = match o\n    Some(x) ‸=> x\n    None => 0\n`))
      .toBe("`Int` @ =>");
    expect(shown(`${HEAD}let p = { x ‸= 1 }\n`)).toBe("`{x: Int}` @ =");
    expect(shown(`${HEAD}let n = 1\nlet s = "‸a\${n}"\n`)).toBe("`String` @ a");
    expect(shown(`${HEAD}let n = 1\nlet s = "a‸\${n}"\n`)).toBe("`String` @ ${");
  });

  test("a lambda's brackets and arrow are the lambda's", () => {
    expect(shown(`${HEAD}let f = ‸(v: Int) => v + 1\n`)).toBe("`Int -> Int` @ (");
    expect(shown(`${HEAD}let f = (v: Int) ‸=> v + 1\n`)).toBe("`Int -> Int` @ =>");
  });

  test("a converted expression shows the conversion at its brackets too", () => {
    expect(shown(`${HEAD}let s: Seq(Int) = [1‸, 2]\n`)).toBe("`Vector(Int)`\n\nconverted to `Seq(Int)` here @ ,");
  });

  test("a caret just after a bracket is on it; one in spaces is on nothing", () => {
    expect(shown(`${HEAD}let n = (1 + 2)‸\n`)).toBe("`Int` @ )");
    expect(shown(`${HEAD}let n = 1 + 2 ‸ * 3\n`)).toBe("none");
    // A tab is a space: a caret on one just after the `1` is on the `1`.
    expect(shown(`${HEAD}let n = 1‸\t+ 2\n`)).toBe("`Int` @ 1");
    // And a line ends at a `\r` as at a `\n`.
    expect(shown("module Main\r\nlet n = (1 + 2)‸\r\n")).toBe("`Int` @ )");
  });

  test("a pointer on a name is on the name, never on the character before it", () => {
    // A record field's name has no hover of its own; the `.` before it is not it.
    expect(shown(`${HEAD}let p = { x = 1 }\nlet q = p.‸x\n`)).toBe("none");
    expect(shown(`${HEAD}let q = { ‸x = 1 }\n`)).toBe("none");
  });

  test("what is not an expression's own text answers nothing", () => {
    // A comment inside an expression.
    expect(shown(`${HEAD}let n = 1 + (* tw‸o *) 2\n`)).toBe("none");
    // A pattern's bracket.
    expect(shown(`${HEAD}let p: (Int, Int) = (1, 2)\nlet k = match p\n    ‸(a, b) => a\n`)).toBe("none");
    // A type's arrow, and an ascription's.
    expect(shown(`${HEAD}let f: Int ‸-> Int = (v) => v\n`)).toBe("none");
    expect(shown(`${HEAD}let g = ((v) => v : Int ‸-> Int)\n`)).toBe("none");
    // A declaration's own words.
    expect(shown(`${HEAD}‸let n = 1\n`)).toBe("none");
    expect(shown(`${HEAD}let n ‸= 1\n`)).toBe("none");
  });

  test("an ascription's colon is the ascription's", () => {
    expect(shown(`${HEAD}let g = ((v) => v ‸: Int -> Int)\n`)).toBe("`Int -> Int` @ :");
  });
});

describe("hoverSpans with expressions", () => {
  /**
   * The gate and the answer agree at every offset (#254's property), over a
   * program where most of the text is an expression's own: operators,
   * brackets, literals, keywords, arms, a string, a conversion, a pattern, a
   * comment and a type annotation.
   */
  const SOURCE = [
    "module Main",
    "let o: Option(Int) = Some(1)",
    "let s: Seq(Int) = [1, 2]",
    "let n: Int = 1 + 2 * (3 - 1)",
    "let k = match o",
    "    Some(x) => x + n (* a comment *)",
    "    None => 0",
    'let t = "a${n}b"',
    "let f = (v: Int) => if v > 0 then v else -v",
    "let p: (Int, Int) = (1, 2)",
    "let q = [3, 1] |> Vector.map((v) => v + 1)",
    "let r = { x = 1 }.x",
    "",
  ].join("\n");

  test.each([["a program of the common forms", SOURCE], ["the rarer forms", FORMS]])(
    "names every offset hover answers at, and no other, over %s",
    (_, source) => {
      const session = sessionOf(source);
      expect(session.diagnostics("/main.hex")).toEqual([]);
      const spans = session.hoverSpans("/main.hex");
      const disagreements: string[] = [];
      let expressionAnswers = 0;
      for (let offset = 0; offset <= source.length; offset += 1) {
        const hover = session.hover("/main.hex", offset);
        if (hover !== undefined && hover.name === undefined) expressionAnswers += 1;
        const gate = spans.some(({ start, end }) => offset >= start && offset <= end);
        if (gate !== (hover !== undefined)) {
          disagreements.push(`${offset} ${JSON.stringify(source.slice(offset - 4, offset + 4))}: gate ${gate}`);
        }
      }
      expect(disagreements).toEqual([]);
      // Not vacuous: expressions answer, and so the gate opens, at many places.
      expect(expressionAnswers).toBeGreaterThan(50);
    },
  );
});

describe("hoverSpans over a broken program", () => {
  test("agrees with hover at every offset where the checker could not type an expression", () => {
    const source = [
      "module Main",
      "let n = missing + (1 * 2)",
      "let s: Int = \"text\" + 1",
      "let f(v: Int): Int = v.nothing() + [1, (2]",
      "",
    ].join("\n");
    const session = sessionOf(source);
    expect(session.diagnostics("/main.hex").length).toBeGreaterThan(0);
    const spans = session.hoverSpans("/main.hex");
    const disagreements: string[] = [];
    for (let offset = 0; offset <= source.length; offset += 1) {
      const hover = session.hover("/main.hex", offset);
      const gate = spans.some(({ start, end }) => offset >= start && offset <= end);
      if (gate !== (hover !== undefined)) {
        disagreements.push(`${offset} ${JSON.stringify(source.slice(offset - 4, offset + 4))}: gate ${gate}`);
      }
    }
    expect(disagreements).toEqual([]);
    // What the checker did type still answers, in among what it could not.
    expect(shown(source.replace("(1 * 2)", "(‸1 * 2)"))).toBe("`Int` @ 1");
    expect(shown(source.replace("(1 * 2)", "‸(1 * 2)"))).toBe("none");
  });
});

describe("selection ranges", () => {
  /** Each range around the caret, as its text, innermost first. */
  function grown(source: string): readonly string[] {
    const { text, start } = marked(source);
    const [ranges = []] = sessionOf(text).selectionRanges("/main.hex", [start]);
    return ranges.map(({ start: from, end }) => text.slice(from, end));
  }

  test("from inside a name: the name, then each piece around it out to the module", () => {
    const source = `${HEAD}let h = Vector.fi‸rst(["a"])\n`;
    expect(grown(source)).toEqual([
      "first",
      "Vector.first",
      'Vector.first(["a"])',
      'let h = Vector.first(["a"])',
      marked(source).text,
    ]);
  });

  test("from an operator, a pattern, a type: each grows through its own kind", () => {
    expect(grown(`${HEAD}let n = 1 + 2 ‸* 3\n`).slice(0, 3)).toEqual(["2 * 3", "1 + 2 * 3", "let n = 1 + 2 * 3"]);
    expect(grown(`${HEAD}let f = ((‸a, b): (Int, Int)) => a + b\n`).slice(0, 4))
      .toEqual(["a", "(a, b)", "(a, b): (Int, Int)", "((a, b): (Int, Int)) => a + b"]);
    expect(grown(`${HEAD}let f: Int -> I‸nt = (v) => v\n`).slice(0, 3)).toEqual(["Int", "Int -> Int", "let f: Int -> Int = (v) => v"]);
  });

  test("a caret just after a word starts at the word; one in a comment starts at the comment", () => {
    expect(grown(`${HEAD}let total‸ = 1\n`)[0]).toBe("total");
    expect(grown(`${HEAD}let n = 1 + (* tw‸o *) 2\n`).slice(0, 2)).toEqual(["(* two *)", "1 + (* two *) 2"]);
    // At a comment's first character, and just after it, as just after a word.
    expect(grown(`${HEAD}let n = 1 + ‸(* two *) 2\n`)[0]).toBe("(* two *)");
    expect(grown(`${HEAD}let n = 1 + (* two *)‸ 2\n`)[0]).toBe("(* two *)");
    // A character just after a comment is that character's.
    expect(grown(`${HEAD}let n = 1 + (* two *)‸2\n`)[0]).toBe("2");
    // A caret on a space where one piece ends and the next begins is on the one it is just after.
    expect(grown(`${HEAD}let n = 1\nlet s = "\${n}‸ y"\n`)[0]).toBe("${n}");
  });

  test("a binder list's closing bracket is the declaration's, not the function's", () => {
    expect(grown(`${HEAD}let same<a: Eq‸>(x: a, y: a): Bool = x == y\n`)[0]).toBe("let same<a: Eq>(x: a, y: a): Bool = x == y");
  });

  test("each range holds the one before it, and is wider, at every offset", () => {
    const text = [
      "module Main",
      "let k = match Some(1)",
      "    Some(x) => [x, x * 2] |> Vector.length",
      "    None => 0 (* none *)",
      "let g(b: Bool): Unit =",
      "    var n = 0",
      "    if b then n := 1",
      "    log(n)",
      "",
    ].join("\n");
    const session = sessionOf(text);
    const offsets = Array.from({ length: text.length + 1 }, (_, offset) => offset);
    const failures: string[] = [];
    session.selectionRanges("/main.hex", offsets).forEach((ranges, offset) => {
      for (let index = 1; index < ranges.length; index += 1) {
        const inner = ranges[index - 1]!;
        const outer = ranges[index]!;
        const holds = outer.start <= inner.start && inner.end <= outer.end;
        const wider = outer.end - outer.start > inner.end - inner.start;
        if (!holds || !wider) failures.push(`${offset}: ${JSON.stringify(inner)} then ${JSON.stringify(outer)}`);
      }
      if (ranges.length === 0) failures.push(`${offset}: none`);
    });
    expect(failures).toEqual([]);
  });

  test("a function's binder list and a constraint's default body are pieces of their own", () => {
    expect(grown(`${HEAD}let same<a: E‸q>(x: a, y: a): Bool = x == y\n`).slice(0, 2)).toEqual(["Eq", "a: Eq"]);
    const constraint = [
      HEAD + "export constraint Twice<a> =",
      "    once(value: a) -> a",
      "    twice(value: a) -> a = once(on‸ce(value))",
      "",
    ].join("\n");
    expect(grown(constraint).slice(0, 4)).toEqual([
      "once",
      "once(value)",
      "once(once(value))",
      "twice(value: a) -> a = once(once(value))",
    ]);
    expect(shown(constraint.replace("on‸ce(value)", "«once(value)»"))).toBe("`a` @ once(value)");
  });

  /**
   * Every name is reachable: the innermost piece at a name's first character
   * is that name, across the whole standard library and the rarer forms, so no
   * declaration or expression kind they write drops what it holds.
   */
  test("every name the standard library and the rarer forms write is a piece of its own", () => {
    // Words the lexer reads as names that stand as keywords where written.
    const keywords = new Set([
      "as", "default", "derives", "fault", "from", "get", "method", "module", "opaque", "pattern", "set", "union",
      "when", "widened", "widens", "with",
    ]);
    const failures: string[] = [];
    let checked = 0;
    const sources = { ...STDLIB_SOURCES, "forms.hex": FORMS, "declarations.hex": DECLARATIONS };
    for (const [path, text] of Object.entries(sources)) {
      const file = new Source.File(Source.fileId(0), path, text);
      const lexed = lex(file);
      const modules = parseFile(applyLayout(lexed), path);
      for (const token of lexed.tokens) {
        if (token.kind !== "NonUpperName" && token.kind !== "UpperName") continue;
        const { start, end } = { start: token.span.start.offset, end: token.span.end.offset };
        const word = text.slice(start, end);
        if (keywords.has(word)) continue;
        const module = modules.find(({ span }) => span.start.offset <= start && start < span.end.offset);
        const [first] = module === undefined ? [] : selectionRangesAt(file, module, start);
        checked += 1;
        if (first?.start.offset === start && first.end.offset === end) continue;
        // An intrinsic type row's parameter is one piece with its variance.
        if (first?.end.offset === end && /^[+-]$/.test(text.slice(first.start.offset, start))) continue;
        failures.push(`${path}: ${word} at ${start}, innermost ${first === undefined ? "none" : text.slice(first.start.offset, first.end.offset).slice(0, 40)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(10000);
  });

  /**
   * The tree's shape, which the runs of text an expression answers in and
   * "Expand Selection" both stand on: every piece inside the one that holds it,
   * with width, and its pieces in the text's order, none sharing text.
   */
  test("in the standard library and beyond, every piece's pieces are in order, inside it, and apart", () => {
    // What the standard library does not write: puns, each of which the parser
    // keeps as one piece twice, and a lambda that writes its own binder list.
    const puns = [
      "module Main",
      "let x = 1",
      "let p = { x }",
      "let f(q: {x: Int}): Int = match q",
      "    { x } => x",
      "let g({ x }: {x: Int}): Int = x",
      "let same = <a: Eq>(left: a, right: a) => left == right",
      "",
    ].join("\n");
    const sources = { ...STDLIB_SOURCES, "forms.hex": FORMS, "declarations.hex": DECLARATIONS, "puns.hex": puns };
    const failures: string[] = [];
    let nodes = 0;
    const visit = (path: string, text: string, node: SyntaxNode): void => {
      nodes += 1;
      let at = node.span.start.offset;
      for (const child of node.children) {
        const { start, end } = { start: child.span.start.offset, end: child.span.end.offset };
        if (start < at || end > node.span.end.offset || start >= end) {
          failures.push(`${path}: ${JSON.stringify(text.slice(start, end).slice(0, 30))} at ${start} in ${node.role}`);
        }
        at = Math.max(at, end);
        visit(path, text, child);
      }
    };
    for (const [path, text] of Object.entries(sources)) {
      const file = new Source.File(Source.fileId(0), path, text);
      const modules = parseFile(applyLayout(lex(file)), path);
      for (const module of modules) visit(path, text, syntaxTree(module));
    }
    expect(failures).toEqual([]);
    expect(nodes).toBeGreaterThan(50000);
    expect(sessionOf(puns).diagnostics("/main.hex")).toEqual([]);
  });

  test("in a file of two modules, the outermost is the module, not the file", () => {
    const text = "module First\nlet a = 1\n\nmodule Second\nlet b = 2\n";
    const [ranges = []] = sessionOf(text).selectionRanges("/main.hex", [text.indexOf("2")]);
    expect(ranges.map(({ start, end }) => text.slice(start, end)).at(-1)).toBe("module Second\nlet b = 2\n");
  });

  test("a file that declares no module grows through its own text, not a module name made for it", () => {
    expect(grown("let n = 1 ‸+ 2\n")).toEqual(["1 + 2", "let n = 1 + 2", "let n = 1 + 2\n"]);
  });

  test("a file the session does not hold has none", () => {
    expect(sessionOf(`${HEAD}let n = 1\n`).selectionRanges("/absent.hex", [3])).toEqual([[]]);
  });
});
