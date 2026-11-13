import { describe, expect, test } from "vitest";
import { AnalysisSession } from "../analysis/session.js";
import type { InlayHint } from "./inlay-hints.js";

const WORLD = "/world.js";
const SAVE = 'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n';

function sessionWith(text: string): AnalysisSession {
  const session = new AnalysisSession();
  session.setFile(WORLD, "");
  session.setFile("/main.hex", text);
  return session;
}

/**
 * The text with every hint drawn in: a type as `⟦…⟧` where it stands, a colour
 * as `  ⟪…⟫`. Hints at one offset are drawn in the order given, as an editor
 * draws them.
 */
function drawn(text: string, hints: readonly InlayHint[]): string {
  let out = text;
  const order = hints.map((hint, index) => ({ hint, index }))
    .sort((left, right) => right.hint.offset - left.hint.offset || right.index - left.index);
  for (const { hint } of order) {
    const shown = hint.kind === "colour" ? `  ⟪${hint.label}⟫` : `⟦${hint.label}⟧`;
    out = out.slice(0, hint.offset) + shown + out.slice(hint.offset);
  }
  return out;
}

/** The program as hints draw it, its header left off. */
function hinted(body: string): string {
  const text = `module Main\n\n${body}`;
  const session = sessionWith(text);
  return drawn(text, session.inlayHints("/main.hex")).slice("module Main\n\n".length);
}

/** Every type hint written into the text, as a dev would write them. */
function written(text: string, hints: readonly InlayHint[]): string {
  return drawn(text, hints.filter(({ kind }) => kind === "type")).replace(/⟦|⟧/g, "");
}

describe("inlay hints: a declaration's face, piece by piece", () => {
  test("a function's parameters, result and binder list stand where they would be written", () => {
    expect(hinted([
      'let parseRow(line) = String.split(line, " ").map^((word) => Int.parse^(word))',
      "let total(rows) = Vector.fold(rows, 0, (sum, row) => sum + Vector.sum(row))",
      'let describe(label, value) = "${label}: ${value}"',
      "",
    ].join("\n"))).toBe([
      'let parseRow(line⟦: String⟧)⟦: Vector(Int)⟧ = String.split(line, " ").map^((word⟦: String⟧) => Int.parse^(word))  ⟪pure; may fail⟫',
      "let total⟦<a: Num>⟧(rows⟦: Vector(Vector(a))⟧)⟦: a⟧ = Vector.fold(rows, 0, (sum⟦: a⟧, row⟦: Vector(a)⟧) => sum + Vector.sum(row))",
      'let describe⟦<a: Show, b: Show>⟧(label⟦: a⟧, value⟦: b⟧)⟦: String⟧ = "${label}: ${value}"',
      "",
    ].join("\n"));
  });

  test("one declaration is lettered once: two parameters of two types never share a letter", () => {
    // Hover letters each name from `a` on its own: `first: a`, `second: a`.
    // Side by side that would claim a tie the face, `(a, b) -> (a, b)`, does not have.
    expect(hinted("let pairUp(first, second) = (first, second)\n"))
      .toBe("let pairUp(first⟦: a⟧, second⟦: b⟧)⟦: (a, b)⟧ = (first, second)\n");
  });

  test("the dev's own letters come first, and a minted letter never takes one of them", () => {
    expect(hinted("let g(x: b, y, z) = (z, y, x)\n"))
      .toBe("let g(x: b, y⟦: a⟧, z⟦: c⟧)⟦: (c, a, b)⟧ = (z, y, x)\n");
    expect(hinted("let keep(x, y: k): k = y\n")).toBe("let keep(x⟦: a⟧, y: k): k = y\n");
    expect(hinted("let plus<a: Num>(x: a, y) = x + y\n")).toBe("let plus<a: Num>(x: a, y⟦: a⟧)⟦: a⟧ = x + y\n");
  });

  test("a letter written only in the body is reserved too", () => {
    expect(hinted("let f(x, y) =\n    let z: (Vector(a), a) = ([y], y)\n    (x, z)\n"))
      .toBe("let f(x⟦: b⟧, y⟦: a⟧)⟦: (b, (Vector(a), a))⟧ =\n    let z: (Vector(a), a) = ([y], y)\n    (x, z)\n");
  });

  test("the dev's letters reach through a function's, a record's and an applied type's pieces", () => {
    expect(hinted([
      "let apply(f: (a) -> b, x) = f(x)",
      "let name(r: { name: a }, x) = (r.name, x)",
      "let same(r: { name: a, ...rest }, s) = if True then r else s",
      "let m(table: Map(k, v), key) = (table, key)",
      "let n(value: Nullable(a), x) = (value, x)",
      "let v(values: Vector(a), x) = (values, x)",
      "let o(value: Option(a), x) = (value, x)",
      "",
    ].join("\n"))).toBe([
      "let apply(f: (a) -> b, x⟦: a⟧)⟦: b⟧ = f(x)",
      "let name(r: { name: a }, x⟦: b⟧)⟦: (a, b)⟧ = (r.name, x)",
      "let same(r: { name: a, ...rest }, s⟦: {name: a, ...rest}⟧)⟦: {name: a, ...rest}⟧ = if True then r else s",
      "let m(table: Map(k, v), key⟦: a⟧)⟦: (Map(k, v), a)⟧ = (table, key)",
      "let n(value: Nullable(a), x⟦: b⟧)⟦: (Nullable(a), b)⟧ = (value, x)",
      "let v(values: Vector(a), x⟦: b⟧)⟦: (Vector(a), b)⟧ = (values, x)",
      "let o(value: Option(a), x⟦: b⟧)⟦: (Option(a), b)⟧ = (value, x)",
      "",
    ].join("\n"));
  });

  test("an ascription's letters are the dev's too, and so is a lambda's written result", () => {
    // Functions §4.1: an ascription is a fourth annotation position.
    expect(hinted("let f(x, y) =\n    let z = (x : a)\n    (z, y)\n"))
      .toBe("let f(x⟦: a⟧, y⟦: b⟧)⟦: (a, b)⟧ =\n    let z⟦: a⟧ = (x : a)\n    (z, y)\n");
    expect(hinted("let outer(n) =\n    let g = (x): a => x\n    g(n)\n"))
      .toBe("let outer(n⟦: b⟧)⟦: b⟧ =\n    let g⟦: a -> a⟧ = (x): a => x\n    g(n)\n");
    expect(hinted("let f(xs) = Vector.map(xs, (x): a => x)\n"))
      .toBe("let f(xs⟦: Vector(a)⟧)⟦: Vector(a)⟧ = Vector.map(xs, (x⟦: a⟧): a => x)\n");
  });

  test("a written result, or a binding's written type, letters the pieces that are not written", () => {
    expect(hinted("let wrap(x): Vector(b) = [x]\n")).toBe("let wrap(x⟦: b⟧): Vector(b) = [x]\n");
    expect(hinted("let apply: (Vector(a)) -> Vector(a) = (xs) => xs.map((y) => y)\n"))
      .toBe("let apply: (Vector(a)) -> Vector(a) = (xs) => xs.map((y⟦: a⟧) => y)\n");
  });

  test("through a type alias nothing is paired, and what it writes is still never minted", () => {
    // The alias may reorder its arguments, so `k` and `v` name nothing here;
    // `Pair(a)` is `y`'s type, but only an expansion could say so.
    expect(hinted([
      "type Flip(a, b) = Map(b, a)",
      "let m(t: Flip(k, v), x) = (t, x)",
      "type Pair(a) = (a, a)",
      "let f(x, y) =",
      "    let z: Pair(a) = (y, y)",
      "    (x, z)",
      "",
    ].join("\n"))).toBe([
      "type Flip(a, b) = Map(b, a)",
      "let m(t: Flip(k, v), x⟦: c⟧)⟦: (Map(a, b), c)⟧ = (t, x)",
      "type Pair(a) = (a, a)",
      "let f(x⟦: b⟧, y⟦: c⟧)⟦: (b, (c, c))⟧ =",
      "    let z: Pair(a) = (y, y)",
      "    (x, z)",
      "",
    ].join("\n"));
  });

  test("a letter only a binder list writes is reserved too", () => {
    expect(hinted("let f<a>(x) = x\n")).toBe("let f<a>(x⟦: b⟧)⟦: b⟧ = x\n");
  });

  test("a written binder list takes the entries it leaves out, before its `>`", () => {
    // A declaration takes one list (Functions §4.2), so the rest of the face's goes in it.
    expect(hinted('let describe<a: Show>(label: a, value) = "${label}: ${value}"\n'))
      .toBe('let describe<a: Show⟦, b: Show⟧>(label: a, value⟦: b⟧)⟦: String⟧ = "${label}: ${value}"\n');
    expect(hinted('fun pick<a: (Eq, Show)>(x: a, y) = if x == x then "${y}" else ""\n'))
      .toBe('fun pick<a: (Eq, Show)⟦, b: Show⟧>(x: a, y⟦: b⟧)⟦: String⟧ = if x == x then "${y}" else ""\n');
    expect(hinted('let h = <a: Show>(x: a, y) => "${x}${y}"\n'))
      .toBe('let h⟦: (a, b) -> String⟧ = <a: Show⟦, b: Show⟧>(x: a, y) => "${x}${y}"\n');
    expect(hinted('let alias<a: Show> = (x: a, y) => "${x}${y}"\n'))
      .toBe('let alias<a: Show⟦, b: Show⟧>⟦: (a, b) -> String⟧ = (x: a, y) => "${x}${y}"\n');
    // Written out, a header's list compiles to the same face.
    const text = 'module Main\n\nlet describe<a: Show>(label: a, value) = "${label}: ${value}"\n';
    const session = sessionWith(text);
    const face = (source: string) => session.hover("/main.hex", source.indexOf("describe"))?.displayedType;
    const before = face(text);
    const out = written(text, session.inlayHints("/main.hex"));
    session.setFile("/main.hex", out);
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(face(out)).toBe(before);
    expect(before).toBe("<a: Show, b: Show> (a, b) -> String");
  });

  test("what is written takes no hint: a parameter's type, the result, the binder list", () => {
    expect(hinted("let both<a: Show>(x: a, y: Int): String = \"${x}${y}\"\n"))
      .toBe("let both<a: Show>(x: a, y: Int): String = \"${x}${y}\"\n");
    // A result written up to a `)` of its own is still written.
    expect(hinted("let wrap(x: Int): Vector(Int) = [x]\n")).toBe("let wrap(x: Int): Vector(Int) = [x]\n");
  });

  test("a comment between the name and the parameters leaves a header a header", () => {
    expect(hinted("let f {- c -} (x) = x + 1\n")).toBe("let f⟦<a: Num>⟧ {- c -} (x⟦: a⟧)⟦: a⟧ = x + 1\n");
  });

  test("a pattern parameter takes no hint: it has no name to stand after", () => {
    expect(hinted("let swap((x, y)) = (y, x)\n")).toBe("let swap((x, y))⟦: (b, a)⟧ = (y, x)\n");
  });

  test("in the order of the text, a header's colour after the lambdas in its line", () => {
    const text = 'module Main\n\nlet parseRow(line) = String.split(line, " ").map^((word) => Int.parse^(word))\n';
    const offsets = sessionWith(text).inlayHints("/main.hex").map(({ offset }) => offset);
    expect(offsets).toHaveLength(4);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
  });

  test("a callback parameter shows its own arrow, as the face does, never a following one", () => {
    // Hover on `f` alone reads `() >-> a`, the enclosing function's colour; in a
    // parameter type a following arrow is refused (Effects §2.2.1), and the face
    // spells the callback `() ->! a`.
    expect(hinted("let run(f) = f!()\n"))
      .toBe("let run(f⟦: () ->! a⟧)⟦: a⟧ = f!()  ⟪impure only if `f` is impure; may fail only if `f` may fail⟫\n");
  });

  test("written out, the type hints compile to the same faces", () => {
    const text = [
      "module Main",
      "",
      "import Stdio",
      "",
      'let parseRow(line) = String.split(line, " ").map^((word) => Int.parse^(word))',
      "let total(rows) = Vector.fold(rows, 0, (sum, row) => sum + Vector.sum(row))",
      "let pairUp(first, second) = (first, second)",
      'let describe(label, value) = "${label}: ${value}"',
      "let report(rows) =",
      "    let count = Vector.length(rows)",
      '    Stdio.writeLine~(describe("rows", count))',
      '    Stdio.writeLine~(describe("total", total(rows)))',
      "let rows = String.lines(Stdio.readText~()).map^(parseRow)",
      "report~(rows)",
      "",
    ].join("\n");
    const names = ["parseRow", "total", "pairUp", "describe", "report", "rows"];
    const session = sessionWith(text);
    const faces = (source: string) =>
      names.map((name) => session.hover("/main.hex", source.indexOf(`let ${name}`) + 4)?.displayedType);
    const before = faces(text);
    expect(before).toEqual([
      "String ->^ Vector(Int)",
      "<a: Num> Vector(Vector(a)) -> a",
      "(a, b) -> (a, b)",
      "<a: Show, b: Show> (a, b) -> String",
      "<a: (Num, Show)> Vector(Vector(a)) ->~ Unit",
      "Vector(Vector(Int))",
    ]);
    const out = written(text, session.inlayHints("/main.hex"));
    session.setFile("/main.hex", out);
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(faces(out)).toEqual(before);
  });
});

describe("inlay hints: a function's colour in words", () => {
  test("after a function whose arrow is not `->`, at the end of its header's line, with its face beside", () => {
    const text = `module Main\n\n${SAVE}\nlet saveTwice(doc) =\n    save!(doc)\n    save!(doc)\nlet quiet(x) = x\n`;
    const hints = sessionWith(text).inlayHints("/main.hex");
    const colour = hints.filter(({ kind }) => kind === "colour");
    expect(colour).toEqual([{
      offset: text.indexOf("let saveTwice(doc) =") + "let saveTwice(doc) =".length,
      label: "impure; may fail",
      kind: "colour",
      tooltip: "saveTwice: String ->! Unit",
    }]);
  });

  test("on a one-line function, after its body; after a comment on that line; before a carriage return", () => {
    expect(hinted(`${SAVE}let save1() = save!("x") -- once\n`))
      .toBe(`${SAVE}let save1()⟦: Unit⟧ = save!("x") -- once  ⟪impure; may fail⟫\n`);
    expect(hinted(`${SAVE}let save1() = save!("x")`))
      .toBe(`${SAVE}let save1()⟦: Unit⟧ = save!("x")  ⟪impure; may fail⟫`);
    const text = `module Main\r\n\r\n${SAVE.replace(/\n/g, "\r\n")}let save1() = save!("x")\r\n`;
    const colour = sessionWith(text).inlayHints("/main.hex").find(({ kind }) => kind === "colour");
    expect(colour?.offset).toBe(text.indexOf('save!("x")\r\n') + 'save!("x")'.length);
  });

  test("two functions on one line: the first one's words at its own end, where they read as its", () => {
    expect(hinted(`${SAVE}let a() = save!("x"); let b() = 1\n`))
      .toBe(`${SAVE}let a()⟦: Unit⟧ = save!("x")  ⟪impure; may fail⟫; let b()⟦: Int⟧ = 1\n`);
  });

  test("a header whose `=` starts the next line: at the end of the line the header's last piece is on", () => {
    expect(hinted(`${SAVE}let g(x)\n    = save!(x)\n`))
      .toBe(`${SAVE}let g(x⟦: String⟧)⟦: Unit⟧  ⟪impure; may fail⟫\n    = save!(x)\n`);
  });

  test("on an exported function, whose types are all written, the colour is its only hint", () => {
    expect(hinted("export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =\n    f!()\n    g!()\n"))
      .toBe("export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =  ⟪impure only if `f` or `g` is impure; may fail only if `f` or `g` may fail⟫\n    f!()\n    g!()\n");
  });

  test("a function value bound by `let` shows its colour in its arrow, and takes no words", () => {
    expect(hinted(`${SAVE}let g = () => save!("x")\n`)).toBe(`${SAVE}let g⟦: () ->! Unit⟧ = () => save!("x")\n`);
  });

  test("a local function that runs an enclosing function's callback names whose colour it is", () => {
    expect(hinted([
      "let outer(action: () ->! Unit) =",
      "    let quiet() = action!()",
      "    quiet!()",
      "",
    ].join("\n"))).toBe([
      "let outer(action: () ->! Unit)⟦: Unit⟧ =  ⟪impure only if `action` is impure; may fail only if `action` may fail⟫",
      "    let quiet()⟦: Unit⟧ = action!()  ⟪impure only if `outer`'s `action` is impure; may fail only if `outer`'s `action` may fail⟫",
      "    quiet!()",
      "",
    ].join("\n"));
  });
});

describe("inlay hints: bindings, lambdas and patterns", () => {
  test("a binding's type, its binder list on its name; a lambda that is its whole value takes no more", () => {
    expect(hinted("let inc = (n) => n + 1\nlet three = inc(2)\n"))
      .toBe("let inc⟦<a: Num>: a -> a⟧ = (n) => n + 1\nlet three⟦: Int⟧ = inc(2)\n");
  });

  test("a binding whose lambda writes the binder list takes none on its name", () => {
    expect(hinted("let plus = <a: Num>(x: a, y: a): a => x + y\n"))
      .toBe("let plus⟦: (a, a) -> a⟧ = <a: Num>(x: a, y: a): a => x + y\n");
  });

  test("every hint's tooltip is the whole face of the declaration it is a piece of", () => {
    const tooltips = (body: string): readonly (readonly [string, string])[] => {
      const session = sessionWith(`module Main\n\n${body}`);
      return session.inlayHints("/main.hex").map(({ label, tooltip }) => [label, tooltip] as const);
    };
    // Lettered as the hints are, not as hover letters each face on its own.
    expect(tooltips("let pairUp(first, second) =\n    let swap = (p) => p\n    swap((first, second))\n")).toEqual([
      [": a", "pairUp: (a, b) -> (a, b)"],
      [": b", "pairUp: (a, b) -> (a, b)"],
      [": (a, b)", "pairUp: (a, b) -> (a, b)"],
      [": c -> c", "swap: c -> c"],
    ]);
    // A lambda has no name, so its face is its type; a pattern's name, its own.
    expect(tooltips("let sums = [1].map((n) => n + 1)\nlet (x, y) as both = (1, sums)\n")).toEqual([
      [": Vector(Int)", "sums: Vector(Int)"],
      [": Int", "Int -> Int"],
      [": Int", "x: Int"],
      [": Vector(Int)", "y: Vector(Int)"],
      [": (Int, Vector(Int))", "both: (Int, Vector(Int))"],
    ]);
  });

  test("a binding that writes its binder list on its name shows its type after the list", () => {
    const body = 'let alias<a: Show> = (x: a) => "${x}"\nlet pick<a: (Num, Show)> = (x: a, y) => (x, y)\n';
    expect(hinted(body)).toBe(
      'let alias<a: Show>⟦: a -> String⟧ = (x: a) => "${x}"\nlet pick<a: (Num, Show)>⟦: (a, b) -> (a, b)⟧ = (x: a, y) => (x, y)\n',
    );
    // Where `: type` is written (Functions §4.2, #1047), and written there it compiles.
    const text = `module Main\n\n${body}`;
    const session = sessionWith(text);
    session.setFile("/main.hex", written(text, session.inlayHints("/main.hex")));
    expect(session.diagnostics("/main.hex")).toEqual([]);
  });

  test("a lambda's parameters; a bare one is shown in the parentheses a written type needs", () => {
    expect(hinted("let numbers = Seq.iterate(1, number => number + 1)\nlet sums = [1, 2].map((n) => n + 1)\n"))
      .toBe("let numbers⟦: Seq(Int)⟧ = Seq.iterate(1, ⟦(⟧number⟦: Int)⟧ => number + 1)\nlet sums⟦: Vector(Int)⟧ = [1, 2].map((n⟦: Int⟧) => n + 1)\n");
  });

  test("locals letter with their declaration, and a local's own variables take fresh letters", () => {
    expect(hinted([
      "let pairWith(x) =",
      "    let wrap = (y) => [y]",
      "    let twice(z) = (z, z)",
      "    (wrap(x), wrap(1), twice(x))",
      "",
    ].join("\n"))).toBe([
      "let pairWith(x⟦: a⟧)⟦: (Vector(a), Vector(Int), (a, a))⟧ =",
      "    let wrap⟦: b -> Vector(b)⟧ = (y) => [y]",
      "    let twice(z⟦: c⟧)⟦: (c, c)⟧ = (z, z)",
      "    (wrap(x), wrap(1), twice(x))",
      "",
    ].join("\n"));
    // In the order written, however deep: `id1` is lettered before `id2`.
    expect(hinted([
      "let f(x) =",
      "    let inner() =",
      "        let id1(p) = p",
      "        id1",
      "    let id2(q) = q",
      "    (x, inner, id2)",
      "",
    ].join("\n"))).toBe([
      "let f(x⟦: a⟧)⟦: (a, () -> b -> b, c -> c)⟧ =",
      "    let inner()⟦: d -> d⟧ =",
      "        let id1(p⟦: e⟧)⟦: e⟧ = p",
      "        id1",
      "    let id2(q⟦: f⟧)⟦: f⟧ = q",
      "    (x, inner, id2)",
      "",
    ].join("\n"));
  });

  test("a `let` pattern's name with a type written over it takes none (Pattern Matching §2.9, §6.3)", () => {
    expect(hinted([
      'let (a: Float, b) = (1, "x")',
      'let ((c, d): (Int, _)) = (1, "x")',
      "let ((e: Int) as f, g) = (1, 2)",
      'let (h, i): (Int, String) = (1, "x")',
      "",
    ].join("\n"))).toBe([
      'let (a: Float, b⟦: String⟧) = (1, "x")',
      'let ((c, d): (Int, _)) = (1, "x")',
      "let ((e: Int) as f, g⟦: Int⟧) = (1, 2)",
      'let (h, i): (Int, String) = (1, "x")',
      "",
    ].join("\n"));
  });

  test("a `let` pattern's names, a `var`, an instance member's parameters", () => {
    expect(hinted([
      'let (a, b) = (1, "x")',
      "let counted(n) =",
      "    var count = 0",
      "    count + n",
      "union Tree = Leaf | Node(Tree, Int, Tree)",
      "honor Show<Tree> =",
      "    show(tree) = match tree",
      '        Leaf => "."',
      '        Node(_, value, _) => "${value}"',
      "",
    ].join("\n"))).toBe([
      'let (a⟦: Int⟧, b⟦: String⟧) = (1, "x")',
      "let counted(n⟦: Int⟧)⟦: Int⟧ =",
      "    var count⟦: Int⟧ = 0",
      "    count + n",
      "union Tree = Leaf | Node(Tree, Int, Tree)",
      "honor Show<Tree> =",
      "    show(tree⟦: Tree⟧) = match tree",
      '        Leaf => "."',
      '        Node(_, value, _) => "${value}"',
      "",
    ].join("\n"));
  });

  test("an instance member's colour, in words at the end of its header's line", () => {
    expect(hinted(`${SAVE}constraint Loud<a> =\n    loud(s: a) ->! String\nhonor Loud<Int> =\n    loud(s) =\n        save!("x")\n        "y"\n`))
      .toBe(`${SAVE}constraint Loud<a> =\n    loud(s: a) ->! String\nhonor Loud<Int> =\n    loud(s⟦: Int⟧) =  ⟪impure; may fail⟫\n        save!("x")\n        "y"\n`);
  });

  test("an instance member the parser recovered without its `=` takes no colour from the next `=`", () => {
    const fetch = 'extern from "./world.js"\n    export fun fetch(key: String) ->! String\n';
    expect(hinted(`${fetch}constraint Loud<a> =\n    loud(s: a) ->! String\nhonor Loud<Int> =\n    loud(s) fetch!("x")\nlet other = 1\n`))
      .toBe(`${fetch}constraint Loud<a> =\n    loud(s: a) ->! String\nhonor Loud<Int> =\n    loud(s⟦: Int⟧) fetch!("x")\nlet other⟦: Int⟧ = 1\n`);
  });

  test("an instance member's callbacks are its own, named by its parameters in the words", () => {
    const tooltip = sessionWith("module Main\n\nconstraint Runs<a> =\n    run(x: a, f: (a) ->! Unit) >-> Unit\nhonor Runs<Int> =\n    run(x, f) =\n        f!(x)\n")
      .inlayHints("/main.hex").find(({ kind }) => kind === "colour");
    expect(tooltip?.label).toBe("impure only if `f` is impure; may fail only if `f` may fail");
    const two = sessionWith([
      "module Main",
      "",
      "constraint Runs<a> =",
      "    run(x: a, f: (a) ->! Unit, g: (a) ->! Unit) >-> Unit",
      "honor Runs<Int> =",
      "    run(x, f, g) =",
      "        f!(x)",
      "        g!(x)",
      "",
    ].join("\n")).inlayHints("/main.hex").find(({ kind }) => kind === "colour");
    expect(two?.label).toBe("impure only if `f` or `g` is impure; may fail only if `f` or `g` may fail");
  });

  test("an instance's own letters are the honor head's", () => {
    expect(hinted([
      "record Box(a) = { value: a }",
      "honor Show<Box(k)> =",
      '    show(box) = "box"',
      "",
    ].join("\n"))).toBe([
      "record Box(a) = { value: a }",
      "honor Show<Box(k)> =",
      '    show(box⟦: Box(k)⟧) = "box"',
      "",
    ].join("\n"));
  });

  test("an `as` name takes its type; a record field's pun takes none, having no place for one", () => {
    expect(hinted('let (p, q) as pair = (1, "x")\nlet r = {guest = "x", seats = 2}\nlet {guest, seats = s} = r\n')).toBe(
      'let (p⟦: Int⟧, q⟦: String⟧) as pair⟦: (Int, String)⟧ = (1, "x")\n' +
        "let r⟦: {guest: String, seats: Int}⟧ = {guest = \"x\", seats = 2}\nlet {guest, seats = s⟦: Int⟧} = r\n",
    );
  });

  test("a `fun` block's members letter together, and their binder list is the block's, on its head", () => {
    // Functions §7.3: a block's members take no list of their own; the head's is theirs.
    expect(hinted([
      "fun",
      "    isEven(n) = if n == 0 then True else isOdd(n - 1)",
      "    isOdd(n) = if n == 0 then False else isEven(n - 1)",
      "fun count(xs) = xs",
      "",
    ].join("\n"))).toBe([
      "fun⟦<a: (Eq, Signed)>⟧",
      "    isEven(n⟦: a⟧)⟦: Bool⟧ = if n == 0 then True else isOdd(n - 1)",
      "    isOdd(n⟦: a⟧)⟦: Bool⟧ = if n == 0 then False else isEven(n - 1)",
      "fun count(xs⟦: a⟧)⟦: a⟧ = xs",
      "",
    ].join("\n"));
    // One knot, one variable: `second`'s `p` is `first`'s `y`, and reads as it does.
    expect(hinted([
      "fun",
      "    first(x, y) = second(y, x)",
      "    second(p, q) = first(q, p)",
      "",
    ].join("\n"))).toBe([
      "fun",
      "    first(x⟦: a⟧, y⟦: b⟧)⟦: c⟧ = second(y, x)",
      "    second(p⟦: b⟧, q⟦: a⟧)⟦: c⟧ = first(q, p)",
      "",
    ].join("\n"));
  });

  test("a `fun` block's head: each member's entries, the ones it writes kept, its members' faces as its tooltip", () => {
    expect(hinted('fun\n    twice(n) = n + n\n    say(x) = "${x}"\n'))
      .toBe('fun⟦<a: Num, b: Show>⟧\n    twice(n⟦: a⟧)⟦: a⟧ = n + n\n    say(x⟦: b⟧)⟦: String⟧ = "${x}"\n');
    expect(hinted('fun<a: Num>\n    twice(n: a) = n + n\n    say(x) = "${x}"\n'))
      .toBe('fun<a: Num⟦, b: Show⟧>\n    twice(n: a)⟦: a⟧ = n + n\n    say(x⟦: b⟧)⟦: String⟧ = "${x}"\n');
    const text = "module Main\n\nfun\n    twice(n) = n + n\n";
    expect(sessionWith(text).inlayHints("/main.hex")[0]).toEqual({
      offset: text.indexOf("fun") + 3,
      label: "<a: Num>",
      kind: "type",
      tooltip: "twice: <a: Num> a -> a",
    });
    const two = sessionWith('module Main\n\nfun\n    twice(n) = n + n\n    say(x) = "${x}"\n').inlayHints("/main.hex");
    expect(two[0]?.tooltip).toBe("twice: <a: Num> a -> a\nsay: <b: Show> b -> String");
  });

  test("no entry on a `fun` block's head for a spelling another member writes for its own", () => {
    // On the head, the two `a`s would be one variable (Functions §7.3): written
    // there, `g` would take `f`'s `Show`, or the two would be tied.
    expect(hinted('fun\n    f(x: a) = x + x\n    g(y: a) = "${y}"\n'))
      .toBe('fun\n    f(x: a)⟦: a⟧ = x + x\n    g(y: a)⟦: String⟧ = "${y}"\n');
    expect(hinted('fun\n    f(x: a) = "${x}"\n    g(y: a) = y\n'))
      .toBe('fun\n    f(x: a)⟦: String⟧ = "${x}"\n    g(y: a)⟦: a⟧ = y\n');
    expect(hinted('fun\n    f(x: a) = "${x}"\n    g(y: a) = "${y}"\n'))
      .toBe('fun\n    f(x: a)⟦: String⟧ = "${x}"\n    g(y: a)⟦: String⟧ = "${y}"\n');
    // The other entries still have their place, the same member's too.
    expect(hinted('fun\n    f(x: a) = "${x}"\n    g(y: a) = y\n    h(z) = z + 1\n'))
      .toBe('fun⟦<b: Num>⟧\n    f(x: a)⟦: String⟧ = "${x}"\n    g(y: a)⟦: a⟧ = y\n    h(z⟦: b⟧)⟦: b⟧ = z + 1\n');
    expect(hinted('fun\n    f(x: a, w) = "${x}${w}"\n    g(y: a) = y\n'))
      .toBe('fun⟦<b: Show>⟧\n    f(x: a, w⟦: b⟧)⟦: String⟧ = "${x}${w}"\n    g(y: a)⟦: a⟧ = y\n');
    // Nor in a list the head writes.
    expect(hinted('fun<a: Num>\n    twice(n: a) = n + n\n    say(x: b) = "${x}"\n    same(z: b) = z\n'))
      .toBe('fun<a: Num>\n    twice(n: a)⟦: a⟧ = n + n\n    say(x: b)⟦: String⟧ = "${x}"\n    same(z: b)⟦: b⟧ = z\n');
    // Wherever the other member writes it: in its body, or through an alias,
    // where nothing pairs its `a` with a variable but the head would still
    // declare it.
    expect(hinted('fun\n    f(x: a) = "${x}"\n    g(y) =\n        let z: a = y\n        z\n'))
      .toBe('fun\n    f(x: a)⟦: String⟧ = "${x}"\n    g(y⟦: a⟧)⟦: a⟧ =\n        let z: a = y\n        z\n');
    expect(hinted('type Swap(p, q) = (q, p)\n\nfun\n    f(x: Swap(a, Int)): Swap(a, Int) = x\n    g(y: a) = "${y}"\n'))
      .toBe('type Swap(p, q) = (q, p)\n\nfun\n    f(x: Swap(a, Int)): Swap(a, Int) = x\n    g(y: a)⟦: String⟧ = "${y}"\n');
  });

  test("a `fun` block in a body has its own head, and its members' lists go there", () => {
    const knot = [
      "let outer(k) =",
      "    fun",
      "        isEven(n) = if n == 0 then True else isOdd(n - 1)",
      "        isOdd(n) = if n == 0 then False else isEven(n - 1)",
      "    isEven(k)",
      "",
    ].join("\n");
    expect(hinted(knot)).toBe([
      "let outer⟦<a: (Eq, Signed)>⟧(k⟦: a⟧)⟦: Bool⟧ =",
      "    fun⟦<b: (Eq, Signed)>⟧",
      "        isEven(n⟦: b⟧)⟦: Bool⟧ = if n == 0 then True else isOdd(n - 1)",
      "        isOdd(n⟦: b⟧)⟦: Bool⟧ = if n == 0 then False else isEven(n - 1)",
      "    isEven(k)",
      "",
    ].join("\n"));
    // A block inside a block's member: each head takes its own members' lists.
    const nested = 'fun\n    outer(k) =\n        fun\n            say(x) = "${x}"\n        say(k)\n';
    expect(hinted(nested)).toBe(
      'fun⟦<a: Show>⟧\n    outer(k⟦: a⟧)⟦: String⟧ =\n        fun⟦<b: Show>⟧\n            say(x⟦: b⟧)⟦: String⟧ = "${x}"\n        say(k)\n',
    );
    // A spelling two blocks each write for their own is each head's own; one a
    // member of the block writes, in a block of its own, is not the head's.
    const siblings = 'let outer(k) =\n    fun\n        f(x: a) = "${x}"\n    fun\n        g(y: a) = y + 1\n    g(1)\n';
    expect(hinted(siblings)).toBe(
      'let outer(k⟦: b⟧)⟦: Int⟧ =\n    fun⟦<a: Show>⟧\n        f(x: a)⟦: String⟧ = "${x}"\n    fun⟦<a: Num>⟧\n        g(y: a)⟦: a⟧ = y + 1\n    g(1)\n',
    );
    const within = 'fun\n    f(x: a) = "${x}"\n    outer(k) =\n        fun\n            h(z: a) = z + 1\n        h(k)\n';
    expect(hinted(within)).toBe(
      'fun⟦<b: Num>⟧\n    f(x: a)⟦: String⟧ = "${x}"\n    outer(k⟦: b⟧)⟦: b⟧ =\n        fun⟦<a: Num>⟧\n            h(z: a)⟦: a⟧ = z + 1\n        h(k)\n',
    );
    // Written out, each compiles to the same faces, the blocks' members' too.
    for (const body of [knot, nested, siblings, within]) {
      const text = `module Main\n\n${body}`;
      const session = sessionWith(text);
      const at = (source: string, name: string) => source.search(new RegExp(`\\b${name}[<(]`));
      const names = ["outer", "isEven", "isOdd", "say", "f", "g", "h"].filter((name) => at(text, name) !== -1);
      const faces = (source: string) => names.map((name) => session.hover("/main.hex", at(source, name))?.displayedType);
      const before = faces(text);
      expect(before).not.toContain(undefined);
      const out = written(text, session.inlayHints("/main.hex"));
      session.setFile("/main.hex", out);
      expect(session.diagnostics("/main.hex")).toEqual([]);
      expect(faces(out)).toEqual(before);
    }
  });

  test("written out, a `fun` block's hints compile to the same faces", () => {
    const text = [
      "module Main",
      "",
      "fun",
      "    isEven(n) = if n == 0 then True else isOdd(n - 1)",
      "    isOdd(n) = if n == 0 then False else isEven(n - 1)",
      "    twice(m) = m + m",
      "",
    ].join("\n");
    const session = sessionWith(text);
    const faces = (source: string) =>
      ["isEven", "isOdd", "twice"].map((name) => session.hover("/main.hex", source.indexOf(`${name}(`))?.displayedType);
    const before = faces(text);
    const out = written(text, session.inlayHints("/main.hex"));
    expect(out).toContain("fun<a: (Eq, Signed), b: Num>\n");
    session.setFile("/main.hex", out);
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(faces(out)).toEqual(before);
  });
});

describe("inlay hints: what the host asks for", () => {
  test("every module of a file", () => {
    const text = "module First\n\nlet two(x) = x\n\nend module First\n\nmodule Second\n\nlet three(y) = [y]\n";
    expect(drawn(text, sessionWith(text).inlayHints("/main.hex"))).toBe(
      "module First\n\nlet two(x⟦: a⟧)⟦: a⟧ = x\n\nend module First\n\nmodule Second\n\nlet three(y⟦: a⟧)⟦: Vector(a)⟧ = [y]\n",
    );
  });

  test("a range that starts inside a declaration shows its hints as the whole file does", () => {
    const text = "module Main\n\nlet pairUp(first, second) =\n    let swap = (p) => p\n    swap((first, second))\nlet other(z) = z\n";
    const session = sessionWith(text);
    const start = text.indexOf("let swap");
    const end = text.indexOf("let other") - 1;
    expect(session.inlayHints("/main.hex", { start, end }))
      .toEqual(session.inlayHints("/main.hex").filter(({ offset }) => offset >= start && offset <= end));
    expect(session.inlayHints("/main.hex", { start, end }).map(({ label }) => label)).toEqual([": c -> c"]);
  });

  test("a range that holds only a hint drawn outside its declaration's items still shows it", () => {
    // A `fun` block's list stands on its head, before its members; a colour
    // after a comment, past its function's end.
    const block = "module Main\n\nfun\n    twice(n) = n + n\n";
    const head = block.indexOf("fun") + 3;
    expect(sessionWith(block).inlayHints("/main.hex", { start: head, end: head }).map(({ label }) => label))
      .toEqual(["<a: Num>"]);
    const line = `module Main\n\n${SAVE}let save1() = save!("x") -- once\nlet two(y) = y\n`;
    const end = line.indexOf(" -- once") + " -- once".length;
    expect(sessionWith(line).inlayHints("/main.hex", { start: end, end }).map(({ label }) => label))
      .toEqual(["impure; may fail"]);
  });

  test("only the range shown", () => {
    const text = "module Main\n\nlet one(x) = x\nlet two(y) = y\n";
    const session = sessionWith(text);
    const start = text.indexOf("let two");
    expect(session.inlayHints("/main.hex", { start, end: text.length }).map(({ label }) => label))
      .toEqual([": a", ": a"]);
    expect(session.inlayHints("/main.hex", { start: 0, end: start - 1 }).map(({ offset }) => offset))
      .toEqual([text.indexOf("x)") + 1, text.indexOf(") = x") + 1]);
  });

  test("no hint shows a type with an error in it, and a file the session does not hold has none", () => {
    const text = [
      "module Main",
      "",
      "let broken(x) = missing(x)",
      "let pair = (missing(1), 2)",
      "let fine(y) = y",
      "",
    ].join("\n");
    const session = sessionWith(text);
    expect(drawn(text, session.inlayHints("/main.hex"))).toBe([
      "module Main",
      "",
      "let broken(x⟦: a⟧) = missing(x)",
      "let pair = (missing(1), 2)",
      "let fine(y⟦: a⟧)⟦: a⟧ = y",
      "",
    ].join("\n"));
    expect(session.inlayHints("/elsewhere.hex")).toEqual([]);
  });

  test("nor a colour whose face has an error in it", () => {
    // The checker's own guess at a body that calls a name it cannot find.
    expect(hinted("let broken(x) =\n    let y: Int = x\n    missing(y)\n"))
      .toBe("let broken(x⟦: Int⟧) =\n    let y: Int = x\n    missing(y)\n");
  });

  test("nor a colour in error, which reads as the impure arrow but claims nothing", () => {
    // Effects §3.5: what a function does where the program failed to say it.
    expect(hinted("let broken(x: Int): Int =\n    missing(x)\n    x\n"))
      .toBe("let broken(x: Int): Int =\n    missing(x)\n    x\n");
    expect(hinted("let pick(r) =\n    r.go()\n    1\n")).toBe("let pick(r⟦: a⟧)⟦: Int⟧ =\n    r.go()\n    1\n");
    // Only its fail colour in error: a `throw` written without its mark.
    const requireName = "let requireName(o: Option(String)): String =\n    match o\n        Some(name) => name\n        None => throw(NotFound)\n";
    expect(hinted(requireName)).toBe(requireName);
    // Only its world colour in error: a mark that names no callee.
    const twice = "export let twice(action: () ->! Unit): Unit =\n    step?()\n";
    expect(hinted(twice)).toBe(twice);
    // Nor a type holding one: a binding's arrow, a lambda's parameter, a bare one's pair.
    expect(hinted("let run = () =>\n    missing(1)\n    1\n")).toBe("let run = () =>\n    missing(1)\n    1\n");
    expect(hinted('let (p, q) = (() => missing(1), "x")\n')).toBe('let (p, q⟦: String⟧) = (() => missing(1), "x")\n');
    expect(hinted("let ys = [() => missing(1)].map((f) => 1)\nlet zs = [() => missing(1)].map(f => 1)\n"))
      .toBe("let ys⟦: Vector(Int)⟧ = [() => missing(1)].map((f) => 1)\nlet zs⟦: Vector(Int)⟧ = [() => missing(1)].map(f => 1)\n");
  });
});
