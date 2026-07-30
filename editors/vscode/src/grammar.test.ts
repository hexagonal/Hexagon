/**
 * Scope assertions for syntaxes/hexagon.tmLanguage.json.
 *
 * The cases are drawn from the specs the grammar claims to follow — chiefly
 * spec/lexer.md §§3-8 and its §11 acceptance/rejection inventory — so a rule that
 * drifts from the token language fails here rather than in someone's editor.
 */

import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { grammarPath, repositoryRoot, scopeOf, scopePairs, tokenize } from "./tokenize.js";

/** Innermost scope of the first token spelled exactly `text`. */
const scope = (source: string, text: string) => scopeOf(source, text);

/**
 * Every `end` pattern in the grammar, at any depth. Reads the parsed grammar rather
 * than its text so the `//` notes — which quote patterns in prose — cannot be mistaken
 * for rules.
 */
function endPatterns(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) endPatterns(child, found);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "end" && typeof value === "string") found.push(value);
      else endPatterns(value, found);
    }
  }
  return found;
}

describe("identifiers and start class (spec/lexer.md §3.1)", () => {
  it("classifies an uppercase-start name as a type role", async () => {
    expect(await scope("let x: Point = p", "Point")).toBe("entity.name.type.hexagon");
  });

  it("classifies a non-uppercase-start name as a term role", async () => {
    expect(await scope("let y = point", "point")).toBe("variable.other.hexagon");
  });

  it("uses the literal first codepoint, not ASCII case", async () => {
    expect(await scope("let a = Δelta", "Δelta")).toBe("entity.name.type.hexagon");
    expect(await scope("let a = δelta", "δelta")).toBe("variable.other.hexagon");
  });

  it("treats a caseless script as a term role", async () => {
    expect(await scope("let 用户 = 1", "用户")).toBe("variable.other.definition.hexagon");
  });

  it("treats an uppercase role prefix as an ordinary uppercase name", async () => {
    expect(await scope("let x: T用户 = p", "T用户")).toBe("entity.name.type.hexagon");
  });

  it("accepts `$` and `_` starts", async () => {
    expect(await scope("let $税率 = 0.10", "$税率")).toBe("variable.other.definition.hexagon");
    expect(await scope("let _折扣 = 5", "_折扣")).toBe("variable.other.definition.hexagon");
  });

  it("keeps bare `_` a wildcard but `_name` an ordinary name", async () => {
    expect(await scope("match x\n    _ => 1", "_")).toBe("variable.language.wildcard.hexagon");
    expect(await scope("let _name = 1", "_name")).toBe("variable.other.definition.hexagon");
  });

  it("rejects the reserved `__hex_` prefix (§3.2)", async () => {
    expect(await scope("let __hex_temp = 1", "__hex_temp")).toBe(
      "invalid.illegal.reserved-identifier.hexagon",
    );
  });
});

describe("keywords (spec/lexer.md §4)", () => {
  it("scopes hard control keywords", async () => {
    expect(await scope("if a then b else c", "if")).toBe("keyword.control.hexagon");
    expect(await scope("if a then b else c", "then")).toBe("keyword.control.hexagon");
    expect(await scope("while running\n    x", "while")).toBe("keyword.control.hexagon");
  });

  it("scopes word operators rather than leaving them as names", async () => {
    expect(await scope("let x = a and b", "and")).toBe("keyword.operator.word.hexagon");
    expect(await scope("let x = not a", "not")).toBe("keyword.operator.word.hexagon");
    expect(await scope("let x = a implies b", "implies")).toBe("keyword.operator.word.hexagon");
  });

  // #147: Bool is the prelude union `False | True`, so `true`/`false` are reserved
  // spellings with no value meaning. They must read as errors, and the constructors
  // must read as the ordinary UpperNames they are.
  it("paints the reserved redirect words as errors, not literals", async () => {
    expect(await scope("let x = true", "true")).toBe(
      "invalid.illegal.reserved-redirect-word.hexagon",
    );
    expect(await scope("let x = false", "false")).toBe(
      "invalid.illegal.reserved-redirect-word.hexagon",
    );
  });

  it("scopes Bool's constructors as ordinary uppercase names", async () => {
    expect(await scope("let x = True", "True")).toBe("entity.name.type.hexagon");
    expect(await scope("let x = False", "False")).toBe("entity.name.type.hexagon");
    // The same scope `None` gets: nothing about Bool is special at the token level.
    expect(await scope("let x = None", "None")).toBe("entity.name.type.hexagon");
  });

  it("does not treat a §4.3 non-keyword as a keyword", async () => {
    for (const word of ["throw", "ignore", "module", "main", "async", "break", "yield"]) {
      expect(await scope(`let x = ${word}`, word)).toBe("variable.other.hexagon");
    }
  });
});

describe("contextual keywords are positional (spec/lexer.md §4.2)", () => {
  it("recognizes `when` before an arm arrow but not as a binder", async () => {
    expect(await scope("match v\n    Some(x) when ready => x", "when")).toBe(
      "keyword.other.when.hexagon",
    );
    expect(await scope("let when = True", "when")).toBe("variable.other.definition.hexagon");
  });

  it("recognizes `with` in a record update but not as a field or pun", async () => {
    expect(await scope("let u = {p with x = 3}", "with")).toBe("keyword.other.with.hexagon");
    expect(await scope("let f = {with = 3}", "with")).toBe("variable.other.hexagon");
    expect(await scope("let p = {with}", "with")).toBe("variable.other.hexagon");
  });

  it("recognizes `from` only before a module specifier", async () => {
    expect(await scope('import { a } from "./m"', "from")).toBe("keyword.other.from.hexagon");
    expect(await scope("let from = 1", "from")).toBe("variable.other.definition.hexagon");
  });

  it("recognizes `as` only before an alias", async () => {
    expect(await scope('import { a as b } from "./m"', "as")).toBe("keyword.other.as.hexagon");
    expect(await scope("let as = 1", "as")).toBe("variable.other.definition.hexagon");
  });

  it("recognizes `opaque` only before `record`/`union`", async () => {
    expect(await scope("export opaque record Seq(a) = {}", "opaque")).toBe(
      "storage.modifier.hexagon",
    );
    expect(await scope("let opaque = 1", "opaque")).toBe("variable.other.definition.hexagon");
  });

  it("recognizes `derives` in a declaration header", async () => {
    expect(await scope("union Ordering derives (Eq, Show) =\n    | Less", "derives")).toBe(
      "keyword.other.derives.hexagon",
    );
  });

  it("keeps FFI vocabulary ordinary outside an `extern from` block", async () => {
    for (const word of ["get", "set", "new", "static", "default", "method", "class", "enum"]) {
      expect(await scope(`let x = ${word}`, word)).toBe("variable.other.hexagon");
    }
  });

  it("recognizes FFI vocabulary inside an `extern from` block", async () => {
    const source = [
      'extern from "url-tools"',
      "    export type SearchParams",
      "    export method get(params: SearchParams, key: String): Nullable(String)",
      "    export get status(response: Response): Int",
      "    export static new(value: Int): SearchParams",
      "    enum Direction = Up | Down",
      "let after = get(1)",
    ].join("\n");
    const pairs = await scopePairs(source);

    expect(pairs).toContainEqual(["method", "keyword.other.ffi.hexagon"]);
    expect(pairs).toContainEqual(["static", "storage.modifier.hexagon"]);
    expect(pairs).toContainEqual(["new", "keyword.other.ffi.hexagon"]);
    expect(pairs).toContainEqual(["enum", "keyword.other.ffi.hexagon"]);
    // `get` heads a getter description on one line and names a member on another.
    expect(pairs).toContainEqual(["get", "keyword.other.ffi.hexagon"]);
    expect(pairs).toContainEqual(["get", "entity.name.function.hexagon"]);
  });

  it("closes the extern block at the next top-level line", async () => {
    const source = ['extern from "m"', "    export type T", "let get = 1"].join("\n");
    // Were the block still open, `get` would read as FFI vocabulary.
    expect(await scope(source, "get")).toBe("variable.other.definition.hexagon");
  });
});

describe("declarations name what they declare", () => {
  it("names a `fun` binding", async () => {
    const source = "export fun map(source: Seq(a)): Seq(b) = source";
    expect(await scope(source, "fun")).toBe("storage.type.function.hexagon");
    expect(await scope(source, "map")).toBe("entity.name.function.hexagon");
  });

  it("distinguishes a `let` function from a `let` value", async () => {
    expect(await scope("export let next(s: Seq(a)) = s", "next")).toBe(
      "entity.name.function.hexagon",
    );
    expect(await scope("export let empty: Seq(a) = Seq({})", "empty")).toBe(
      "variable.other.definition.hexagon",
    );
  });

  it("names a type-introducing declaration", async () => {
    expect(await scope("record Point = {x: Float}", "Point")).toBe("entity.name.type.hexagon");
    expect(await scope("union Shape = Circle | Rect", "Shape")).toBe("entity.name.type.hexagon");
  });

  it("names a constraint-introducing declaration as a constraint", async () => {
    expect(await scope("constraint Ord<a: Eq> =\n    compare(l: a): a", "Ord")).toBe(
      "entity.name.type.constraint.hexagon",
    );
    expect(await scope("honor Show<Rat> =\n    show(r: Rat): String = \"\"", "Show")).toBe(
      "entity.name.type.constraint.hexagon",
    );
  });

  it("keeps an instance subject nominal even inside a constraint head", async () => {
    // spec/constraints.md §4.1: `honor C<T>` names a constraint and supplies a type.
    // The two sit adjacent, so the subject must not be dragged into the constraint family.
    const pairs = await scopePairs('honor Show<Rat> =\n    show(r: Rat): String = ""');
    expect(pairs.filter(([text]) => text === "Rat")).toEqual([
      ["Rat", "entity.name.type.hexagon"],
      ["Rat", "entity.name.type.hexagon"],
    ]);
  });

  it("scopes a call head and a constraint member header as a function", async () => {
    expect(await scope("let x = map(xs, f)", "map")).toBe("entity.name.function.hexagon");
    expect(await scope("constraint C<a> =\n    div(left: a): a", "div")).toBe(
      "entity.name.function.hexagon",
    );
  });

  it("scopes a parameter or field before its annotation", async () => {
    expect(await scope("fun f(source: Seq(a)): Int = 1", "source")).toBe(
      "variable.parameter.hexagon",
    );
    expect(await scope("record R = {value: a}", "value")).toBe("variable.parameter.hexagon");
  });

  it("does not mistake `:=` assignment for an annotation", async () => {
    expect(await scope("searching := False", "searching")).toBe("variable.other.hexagon");
    expect(await scope("searching := False", ":=")).toBe("keyword.operator.assignment.hexagon");
  });

  it("never lets a hard keyword read as the name being declared (#154)", async () => {
    // spec/lexer.md §10: "`WORD` is reserved and cannot be used as a name". The
    // binding rules run ahead of #keywords, so without an explicit guard they claim
    // the keyword first and paint a hard error as an ordinary, valid binder.
    expect(await scope("let true = 1", "true")).toBe(
      "invalid.illegal.reserved-redirect-word.hexagon",
    );
    expect(await scope("var false = 1", "false")).toBe(
      "invalid.illegal.reserved-redirect-word.hexagon",
    );
    expect(await scope("fun true(x: Int) = x", "true")).toBe(
      "invalid.illegal.reserved-redirect-word.hexagon",
    );
    expect(await scope("let if = 1", "if")).toBe("keyword.control.hexagon");
    expect(await scope("fun if(x: Int) = x", "if")).toBe("keyword.control.hexagon");
    expect(await scope("var for = 1", "for")).toBe("keyword.control.hexagon");
    expect(await scope("let not = 1", "not")).toBe("keyword.operator.word.hexagon");
  });

  it("still lets a foreign member name be a Hexagon keyword", async () => {
    // FFI Part 5 §2.4: a foreign member name that breaks Hexagon naming is legal
    // precisely because it is aliased, so the #154 guard must not reach this slot.
    const pairs = await scopePairs(
      ['extern from "list-ops"', "    export method for as forEach(xs: T): Unit"].join("\n"),
    );
    expect(pairs.find(([text]) => text === "for")?.[1]).toBe("entity.name.function.hexagon");
  });

  it("still binds names that merely begin with a keyword", async () => {
    // The guard ends in a boundary lookahead, so only the whole word is excluded.
    expect(await scope("let iffy = 1", "iffy")).toBe("variable.other.definition.hexagon");
    expect(await scope("let format = 1", "format")).toBe("variable.other.definition.hexagon");
    expect(await scope("let inner = 1", "inner")).toBe("variable.other.definition.hexagon");
    expect(await scope("let trueish = 1", "trueish")).toBe("variable.other.definition.hexagon");
    expect(await scope("fun compute(x: Int) = x", "compute")).toBe(
      "entity.name.function.hexagon",
    );
  });

  it("scopes an uppercase qualifier before `.` as a namespace", async () => {
    const source = "let n = Vector.size(values)";
    expect(await scope(source, "Vector")).toBe("entity.name.namespace.hexagon");
    expect(await scope(source, "size")).toBe("entity.name.function.hexagon");
  });
});

describe("type variables are nominal-coloured in type positions", () => {
  it("recognizes a constraint subject inside angle brackets", async () => {
    expect(await scope("constraint Show<a> =\n    show(value: Int): String", "a")).toBe(
      "entity.name.type.parameter.hexagon",
    );
  });

  it("recognizes a type variable in a parameter annotation", async () => {
    expect(await scope("fun identity(value: a): Int = 1", "a")).toBe(
      "entity.name.type.parameter.hexagon",
    );
  });

  it("recognizes nested type-variable uses throughout an annotation", async () => {
    const pairs = await scopePairs(
      "fun choose(value: Result(a, Vector(b))): Option((a, b)) = None",
    );
    expect(pairs.filter(([text]) => text === "a" || text === "b")).toEqual([
      ["a", "entity.name.type.parameter.hexagon"],
      ["b", "entity.name.type.parameter.hexagon"],
      ["a", "entity.name.type.parameter.hexagon"],
      ["b", "entity.name.type.parameter.hexagon"],
    ]);
  });

  it("recognizes parenthesized data-declaration parameters", async () => {
    const pairs = await scopePairs("record Pair(a, b) = {left: a, right: b}");
    expect(pairs.filter(([text]) => text === "a" || text === "b")).toEqual([
      ["a", "entity.name.type.parameter.hexagon"],
      ["b", "entity.name.type.parameter.hexagon"],
      ["a", "entity.name.type.parameter.hexagon"],
      ["b", "entity.name.type.parameter.hexagon"],
    ]);
  });

  it("recognizes parameters and uses throughout a type alias", async () => {
    const pairs = await scopePairs("type Handler(a) = a -> Option(a)");
    expect(pairs.filter(([text]) => text === "a")).toEqual([
      ["a", "entity.name.type.parameter.hexagon"],
      ["a", "entity.name.type.parameter.hexagon"],
      ["a", "entity.name.type.parameter.hexagon"],
    ]);
  });

  it("keeps the same spelling term-coloured outside type position", async () => {
    expect(await scope("let value = a", "a")).toBe("variable.other.hexagon");
  });

  it("binds an `honor` prefix binder the same way it binds its use", async () => {
    // spec/constraints.md §4.3. The binder and the subject's `a` are one variable,
    // so painting the binding occurrence as an ordinary parameter would split it.
    const pairs = await scopePairs('honor<a: Show> Show<Vector(a)> =\n    show(xs) = "x"');
    expect(pairs.filter(([text]) => text === "a")).toEqual([
      ["a", "entity.name.type.parameter.hexagon"],
      ["a", "entity.name.type.parameter.hexagon"],
    ]);
  });

  it("scopes a binder's obligations as constraints, in both spec forms", async () => {
    // spec/constraints.md §3. The bound is the one constraint position with no
    // keyword marking it, so casing inside it has to carry the whole distinction.
    expect(await scope("let plus<a: Num>(x: a): a = x", "Num")).toBe(
      "entity.name.type.constraint.hexagon",
    );
    const pairs = await scopePairs("constraint Integral<a: (Num, Ord)> =\n    div(l: a): a");
    expect(pairs.filter(([, s]) => s === "entity.name.type.constraint.hexagon")).toEqual([
      ["Integral", "entity.name.type.constraint.hexagon"],
      ["Num", "entity.name.type.constraint.hexagon"],
      ["Ord", "entity.name.type.constraint.hexagon"],
    ]);
    // The tuple form's own comma must not end the bound early.
    expect(pairs.filter(([text]) => text === "a").every(([, s]) =>
      s === "entity.name.type.parameter.hexagon"
    )).toBe(true);
  });

  it("scopes a derives list as constraints, in both spec forms", async () => {
    // spec/declarations-preamble.md §2.3 gives `derives Eq` and `derives (Eq, Show)`.
    expect(await scope("record Point derives Eq = {x: Float}", "Eq")).toBe(
      "entity.name.type.constraint.hexagon",
    );
    const pairs = await scopePairs("export union Bool derives (Eq, Ord, Show, Hash) =\n    | True");
    expect(pairs.filter(([, s]) => s === "entity.name.type.constraint.hexagon")).toEqual([
      ["Eq", "entity.name.type.constraint.hexagon"],
      ["Ord", "entity.name.type.constraint.hexagon"],
      ["Show", "entity.name.type.constraint.hexagon"],
      ["Hash", "entity.name.type.constraint.hexagon"],
    ]);
    // The declared name and the constructors stay nominal.
    expect(pairs.find(([text]) => text === "Bool")?.[1]).toBe("entity.name.type.hexagon");
    expect(pairs.find(([text]) => text === "True")?.[1]).toBe("entity.name.type.hexagon");
  });

  it("scopes a parameterized instance head and its binder", async () => {
    // spec/constraints.md §4.3: the binders precede the constraint name.
    const pairs = await scopePairs('honor<a: Show> Show<Vector(a)> =\n    show(xs) = "x"');
    expect(pairs.filter(([text]) => text === "Show")).toEqual([
      ["Show", "entity.name.type.constraint.hexagon"],
      ["Show", "entity.name.type.constraint.hexagon"],
    ]);
    expect(pairs.find(([text]) => text === "Vector")?.[1]).toBe("entity.name.type.hexagon");
  });

  it("does not let an indented type member swallow its block", async () => {
    // Collections Part 2 §5.1/§5.3 put `type Item = a` inside an `honor` block, so a
    // type-alias context that ran to the next top-level declaration would repaint the
    // block's member names and value parameters as type variables.
    const pairs = await scopePairs(
      [
        "honor<a> Iterable<Bag(a)> =",
        "    type Item = a",
        "    iterate(xs) = Bag.toSeq(xs)",
        "    other(ys) = length(ys)",
      ].join("\n"),
    );
    expect(pairs.find(([text]) => text === "iterate")?.[1]).toBe("entity.name.function.hexagon");
    expect(pairs.find(([text]) => text === "other")?.[1]).toBe("entity.name.function.hexagon");
    expect(pairs.filter(([text]) => text === "ys").map(([, s]) => s)).toEqual([
      "variable.other.hexagon",
      "variable.other.hexagon",
    ]);
  });

  it("recognizes a `derives` clause on its own continuation line", async () => {
    // Declarations Preamble §2.4 documents this shape verbatim.
    const pairs = await scopePairs(
      ["union Shape", "    derives (Eq, Show) =", "    | Circle(radius: Float)"].join("\n"),
    );
    expect(pairs.find(([text]) => text === "derives")?.[1]).toBe("keyword.other.derives.hexagon");
    expect(pairs.filter(([, s]) => s === "entity.name.type.constraint.hexagon")).toEqual([
      ["Eq", "entity.name.type.constraint.hexagon"],
      ["Show", "entity.name.type.constraint.hexagon"],
    ]);
  });

  it("treats a `>=` tail as the comparison it is", async () => {
    const pairs = await scopePairs("let ok = a<b and c >= d");
    expect(pairs.filter(([, s]) => s.startsWith("entity.name.type"))).toEqual([]);
    expect(pairs.find(([text]) => text === "and")?.[1]).toBe("keyword.operator.word.hexagon");
  });

  it("leaves a spaced comparison chain entirely alone", async () => {
    // A `<` … `>` span whose tail happens to be `(` is still a comparison when the
    // operands are spaced, so nothing inside it may be claimed as a type — and the
    // word operator between them must keep its keyword scope.
    const pairs = await scopePairs("let ok = count < limit and total > (x + y)");
    expect(pairs.filter(([, s]) => s.startsWith("entity.name.type"))).toEqual([]);
    expect(pairs.find(([text]) => text === "and")?.[1]).toBe("keyword.operator.word.hexagon");
    expect(pairs.find(([text]) => text === "limit")?.[1]).toBe("variable.other.hexagon");
  });
});

describe("an unterminated bracket group stays on its line (#162)", () => {
  // A bracket group in a type context ends at its closing bracket, and TextMate only
  // ever tries the top rule's `end` — so a half-typed group used to run to end of file
  // and paint the rest of it as type parameters. The grammar's //line-bail-guard note
  // records the two halves of the fix; these cases are the side that was chosen, and
  // the ones below them are what it costs. The half-typed state is the state an editor
  // is in most of the time, which is why containment wins the trade.

  /**
   * Asserts that `following` paints exactly as it does on its own when it comes after
   * the half-typed `opening`. Comparing against standalone painting rather than a
   * written-out scope list says "the leak is contained" without also pinning whatever
   * else the grammar happens to do with the continuation.
   */
  async function expectContained(opening: string, following: string) {
    const alone = await scopePairs(following);
    const after = await scopePairs(`${opening}\n${following}`);
    expect(after.slice(after.length - alone.length)).toEqual(alone);
  }

  it.each([
    // The issue's own reproductions, then the rest of the ruling's evidence table.
    ["record P(a", "let after = 1"],
    ["let x: (Int", "let after = 1"],
    ["record P derives (Eq", "let after = compute(1)"],
    ["let x: Vector(Int", "let after = 1"],
    ["type A = Vector(Int", "let after = 1"],
    ["fun f<a: (Num", "let after = 1"],
    ["union U(a", "    | None\n    | Some(a)"],
    // Hanging and never closed: the half the bail-out guard is there for.
    ["record P derives (", "let after = compute(1)"],
    ["record P(", "let after = 1"],
    // Hanging under an annotation, which needs the guard on #annotation-type too.
    ["let x: (", "let after = 1"],
    ["let p: {", "record Point(a) = {x: Int}"],
    ["fun f(): (", "let after = 1"],
    // Hanging inside a bounded group, which needs it on the bounded ends as well:
    // the bounded `end` only matches at `$`, and a bail lands at position zero.
    ["let x: Vector(a, (", "let after = 1"],
    ["let x: {a: (", "let after = 1"],
    ["type A = Vector(a, (", "let after = 1"],
  ])("contains %j", async (opening, following) => {
    await expectContained(opening, following);
  });

  it("recovers below a half-typed signature that sits above its body", async () => {
    // The one residue the hanging split cannot remove: an indented line under a
    // hanging group is indistinguishable from a legitimate multi-line type, so the
    // body paints as type context until a guard line. Expected, not a regression —
    // and the declaration that follows still paints normally.
    const pairs = await scopePairs("fun f(): Vector(\n    compute(1)\nlet after = 1");
    expect(pairs).toContainEqual(["compute", "entity.name.type.parameter.hexagon"]);
    await expectContained("fun f(): Vector(\n    compute(1)", "let after = 1");
  });

  it("keeps the colour of every well-formed multi-line group", async () => {
    // Each of these hangs its opening bracket, which is what makes the trade-off in
    // the issue dissolve: the shapes people actually write keep the unbounded `end`.
    const derives = await scopePairs(
      ["union Shape", "    derives (", "        Eq,", "        Show) =", "    | Circle"].join("\n"),
    );
    expect(derives.filter(([, s]) => s === "entity.name.type.constraint.hexagon")).toEqual([
      ["Eq", "entity.name.type.constraint.hexagon"],
      ["Show", "entity.name.type.constraint.hexagon"],
    ]);

    const annotation = await scopePairs("let p: {\n    x: Float,\n    y: Float\n} = q");
    expect(annotation.filter(([text]) => text === "Float")).toEqual([
      ["Float", "entity.name.type.hexagon"],
      ["Float", "entity.name.type.hexagon"],
    ]);

    const signature = await scopePairs(
      ["fun map<a, b>(", "    xs: Vector(a),", "    f: a -> b", "): Vector(b) =", "    xs"].join("\n"),
    );
    expect(signature.filter(([text]) => text === "a" || text === "b").map(([, s]) => s)).toEqual(
      // The two binders, then each use: `Vector(a)`, `a -> b`, `Vector(b)`.
      Array.from({ length: 6 }, () => "entity.name.type.parameter.hexagon"),
    );
  });

  it("lets a closing bracket in column zero close its group rather than bail", async () => {
    // The `^\S` arm of the guard also matches a `)` at the left margin, so the closer
    // comes first in the alternation and wins by leftmost-alternative preference.
    // Declaration parameter lists are written this way.
    const pairs = await scopePairs("record Pair(\n    a, b\n)\n= {left: a, right: b}");
    expect(pairs.filter(([text]) => text === "a" || text === "b").map(([, s]) => s)).toEqual([
      "entity.name.type.parameter.hexagon",
      "entity.name.type.parameter.hexagon",
      "entity.name.type.parameter.hexagon",
      "entity.name.type.parameter.hexagon",
    ]);

    // Closing and bailing paint the bracket itself the same, so what pins the order is
    // what comes after it: closing leaves the annotation open, and bailing unwinds it.
    // With the guard first, this `a` reads as a term instead of a type variable.
    const functionType = await scopePairs("let x: (\n    Int\n) -> a = f");
    expect(functionType.find(([text]) => text === "a")?.[1]).toBe(
      "entity.name.type.parameter.hexagon",
    );
  });

  it("charges the wrapped-with-content shape a colour family, deliberately", async () => {
    // The whole cost of the ruling, pinned so nobody reads it as a bug: a group with
    // content on its opening line is bounded, so what continues below it is painted
    // in the nominal family rather than as a constraint or a type parameter. Both
    // still paint; writing the bracket hanging restores the finer colour.
    const wrappedDerives = await scopePairs("record P derives (Eq,\n    Show) = {x: Int}");
    expect(wrappedDerives.find(([text]) => text === "Eq")?.[1]).toBe(
      "entity.name.type.constraint.hexagon",
    );
    expect(wrappedDerives.find(([text]) => text === "Show")?.[1]).toBe("entity.name.type.hexagon");

    const wrappedParameters = await scopePairs("record P(a,\n    b) = {left: a}");
    expect(wrappedParameters.find(([text]) => text === "a")?.[1]).toBe(
      "entity.name.type.parameter.hexagon",
    );
    expect(wrappedParameters.find(([text]) => text === "b")?.[1]).toBe("variable.other.hexagon");
  });

  it("leaves a group in term position alone", async () => {
    // Only type contexts are line-bounded. A term-position bracket is not one of the
    // rules the ruling touched, and multi-line strings and comments are meant to span.
    await expectContained("let xs = [1, 2", "let after = 1");
    const spanning = await scopePairs('let s = "one\ntwo"\nlet after = 1');
    expect(spanning).toContainEqual(["two", "string.quoted.double.hexagon"]);
    const commented = await scopePairs("/* one\ntwo */\nlet after = 1");
    expect(commented).toContainEqual(["two ", "comment.block.hexagon"]);
  });

  it("spells the bail-out guard identically wherever it appears", async () => {
    // TextMate cannot share a subpattern, so the guard is written out at every site.
    // A copy that drifts is a rule that silently stops bailing, which is exactly the
    // #162 leak coming back for one shape while the others stay fixed.
    const guards = endPatterns(JSON.parse(await readFile(grammarPath, "utf8")))
      .filter((end) => end.includes("(?=^\\S"))
      .map((end) => end.slice(end.indexOf("(?=^\\S")));

    // Five hanging groups, six bounded ones, and the two contexts that enclose them.
    expect(guards).toHaveLength(13);
    expect(new Set(guards).size).toBe(1);
  });

  it("bails on every hard keyword that can open a declaration", async () => {
    // The guard names the keywords rather than matching any word, so it has to be
    // checked against the grammar's own §4.1 inventories — a keyword added there and
    // not here is a line the guard would sit through.
    /** The words of the first `(?:a|b|c)` alternation in a pattern. */
    const words = (pattern: string): string[] =>
      /\(\?:(?:\(\?:)?([a-z|]+)\)/.exec(pattern)?.[1]?.split("|") ?? [];

    const grammar = JSON.parse(await readFile(grammarPath, "utf8"));
    const guardWords = words(endPatterns(grammar).find((end) => end.includes("(?=^\\S")) ?? "");

    const inventory: string[] = grammar.repository.keywords.patterns
      .filter((rule: { name?: string }) =>
        rule.name === "storage.type.hexagon" || rule.name === "keyword.control.import.hexagon"
      )
      .flatMap((rule: { match: string }) => words(rule.match));

    expect(inventory.length).toBeGreaterThan(0);
    expect([...guardWords].sort()).toEqual([...inventory].sort());
  });
});

describe("numeric literals (spec/lexer.md §5)", () => {
  it("scopes the three literal families", async () => {
    expect(await scope("let x = 1_000", "1_000")).toBe("constant.numeric.integer.hexagon");
    expect(await scope("let x = 0.10", "0.10")).toBe("constant.numeric.float.hexagon");
    expect(await scope("let x = 1.5e-10", "1.5e-10")).toBe("constant.numeric.float.hexagon");
    expect(await scope("let x = 42n", "42n")).toBe("constant.numeric.bigint.hexagon");
  });

  it("reads `1..2` as integer, range, integer — never a malformed float", async () => {
    expect(await scopePairs("let n = 1..10")).toEqual([
      ["let", "storage.type.hexagon"],
      ["n", "variable.other.definition.hexagon"],
      ["=", "keyword.operator.assignment.hexagon"],
      ["1", "constant.numeric.integer.hexagon"],
      ["..", "keyword.operator.range.hexagon"],
      ["10", "constant.numeric.integer.hexagon"],
    ]);
  });

  it("keeps `1.show()` an integer followed by a member access", async () => {
    const pairs = await scopePairs("let x = 1.show()");
    expect(pairs).toContainEqual(["1", "constant.numeric.integer.hexagon"]);
    expect(pairs).toContainEqual([".", "punctuation.accessor.hexagon"]);
    expect(pairs).toContainEqual(["show", "entity.name.function.hexagon"]);
  });

  it("rejects the forms §11 lists as lexical errors", async () => {
    const rejected: [string, string][] = [
      ["let x = 0xFF", "0xFF"],
      ["let x = .5", ".5"],
      ["let x = 1.", "1."],
      ["let x = 1__0", "1__0"],
      ["let x = 12cats", "12cats"],
      ["let x = 1nmore", "1nmore"],
    ];
    for (const [source, text] of rejected) {
      expect(await scope(source, text), `${text} should be invalid`).toMatch(
        /^invalid\.illegal\./,
      );
    }
  });
});

describe("strings and interpolation (spec/lexer.md §6)", () => {
  it("scopes a hole as embedded code, not string text", async () => {
    const source = 'let g = "Hello ${name}."';
    expect(await scope(source, "name")).toBe("variable.other.hexagon");
    expect(await scope(source, "${")).toBe("punctuation.section.interpolation.begin.hexagon");
  });

  it("survives braces nested inside a hole", async () => {
    const source = 'let s = "outer ${ {x = 1}.x } done"';
    expect(await scope(source, " done")).toBe("string.quoted.double.hexagon");
  });

  it("spans physical newlines", async () => {
    const pairs = await scopePairs('let m = "first\nsecond"\nlet after = 1');
    expect(pairs).toContainEqual(["second", "string.quoted.double.hexagon"]);
    expect(pairs).toContainEqual(["let", "storage.type.hexagon"]);
  });

  it("scopes the §6.2 escape inventory and rejects the rest", async () => {
    expect(await scope('let s = "a\\nb"', "\\n")).toBe("constant.character.escape.hexagon");
    expect(await scope('let s = "\\u{1F600}"', "\\u{1F600}")).toBe(
      "constant.character.escape.hexagon",
    );
    expect(await scope('let s = "\\#{x}"', "\\#")).toBe("constant.character.escape.hexagon");
    expect(await scope('let s = "\\q"', "\\q")).toBe("invalid.illegal.unknown-escape.hexagon");
  });

  it("rejects a bare `#{` as the reserved Debug form", async () => {
    expect(await scope('let s = "#{value}"', "#{")).toBe(
      "invalid.illegal.reserved-interpolation.hexagon",
    );
  });
});

describe("comments (spec/comments.md)", () => {
  it("distinguishes doc forms from ordinary forms", async () => {
    expect(await scope("// note", " note")).toBe("comment.line.double-slash.hexagon");
    expect(await scope("/// doc", " doc")).toBe("comment.line.documentation.hexagon");
    expect(await scope("/** doc */", " doc ")).toBe("comment.block.documentation.hexagon");
    expect(await scope("/* note */", " note ")).toBe("comment.block.hexagon");
  });

  it("nests block comments and resumes code after the outer close", async () => {
    const pairs = await scopePairs("/* outer /* inner */ still outer */\nlet x = 1");
    for (const text of [" outer ", "/*", " inner ", "*/", " still outer "]) {
      expect(pairs).toContainEqual([text, "comment.block.hexagon"]);
    }
    expect(pairs).toContainEqual(["let", "storage.type.hexagon"]);
  });

  it("treats `//` inside a block comment and `/*` inside a line comment as text", async () => {
    expect(await scope("/* a // b */", " a // b ")).toBe("comment.block.hexagon");
    expect(await scope("// a /* b", " a /* b")).toBe("comment.line.double-slash.hexagon");
  });

  it("rejects `*/` at depth zero", async () => {
    expect(await scope("let x = 1\n*/", "*/")).toBe(
      "invalid.illegal.unmatched-comment-close.hexagon",
    );
  });

  it("does not lex comments inside strings", async () => {
    expect(await scope('let s = "// not a comment"', "// not a comment")).toBe(
      "string.quoted.double.hexagon",
    );
  });
});

describe("operators and forbidden runs (spec/lexer.md §8)", () => {
  it("applies maximal munch in rule order", async () => {
    const cases: [string, string, string][] = [
      ["let x = a ... b", "...", "keyword.operator.spread.hexagon"],
      ["let x = a .. b", "..", "keyword.operator.range.hexagon"],
      ["let x = a ** b", "**", "keyword.operator.arithmetic.hexagon"],
      ["let x = a ++ b", "++", "keyword.operator.concat.hexagon"],
      ["let x = a |> b", "|>", "keyword.operator.pipe.hexagon"],
      ["let x = a != b", "!=", "keyword.operator.comparison.hexagon"],
      ["let x = a <= b", "<=", "keyword.operator.comparison.hexagon"],
      ["x := 1", ":=", "keyword.operator.assignment.hexagon"],
      ["let f = x => x", "=>", "keyword.operator.arrow.hexagon"],
    ];
    for (const [source, text, expected] of cases) {
      expect(await scope(source, text), text).toBe(expected);
    }
  });

  it("reads `x --1` as two minus tokens, never a comment", async () => {
    const pairs = await scopePairs("let subtract = x --1");
    expect(pairs.filter(([text]) => text === "-")).toHaveLength(2);
    expect(pairs).toContainEqual(["1", "constant.numeric.integer.hexagon"]);
  });

  it("scopes `->`, which the compiler lexes as an Arrow token", async () => {
    expect(await scope("fun f(t: a -> b): Int = 1", "->")).toBe(
      "keyword.operator.type.arrow.hexagon",
    );
  });

  it("keeps `<` and `>` one token in both comparison and binder position", async () => {
    expect(await scope("let x = count <= 0", "count")).toBe("variable.other.hexagon");
    expect(await scope("let x = a < b", "a")).toBe("variable.other.hexagon");
    expect(await scope("fun isEmpty<a>(v: Vector(a)): Bool = True", "isEmpty")).toBe(
      "entity.name.function.hexagon",
    );
  });

  it("rejects the forbidden symbolic logic runs", async () => {
    expect(await scope("let x = a && b", "&&")).toBe("invalid.illegal.operator.hexagon");
    expect(await scope("let x = a || b", "||")).toBe("invalid.illegal.operator.hexagon");
    expect(await scope("let x = !a", "!")).toBe("invalid.illegal.operator.hexagon");
  });

  it("rejects characters §8.3 gives no token", async () => {
    for (const char of ["%", "^", "&", "?", "@", "#", "`", "\\"]) {
      expect(await scope(`let x = a ${char} b`, char), char).toBe(
        "invalid.illegal.character.hexagon",
      );
    }
  });

  it("keeps a union bar distinct from the forbidden `||`", async () => {
    expect(await scope("union S = A | B", "|")).toBe("keyword.operator.bar.hexagon");
  });
});

describe("contextual keywords in a third position", () => {
  it("leaves `when` alone wherever it is not an arm guard", async () => {
    // spec/pattern-matching.md §3: `when` is arm syntax, never pattern syntax, so
    // it can never appear inside a nested pattern. Each line here also has a later
    // `=>`, which is exactly what makes the naive lookahead insufficient.
    const cases = [
      ["match e\n    Event(when, what) => f(when)", "a pattern binder"],
      ["let g = (when) => when + 1", "a lambda parameter"],
      ["fun schedule(when: Instant): Unit = xs.map(x => x)", "a parameter"],
      ["let r = f(when, x => x)", "an ordinary argument"],
      ["match e\n    Event(a, when) => a", "a later pattern binder"],
    ] as const;

    for (const [source, description] of cases) {
      const painted = (await scopePairs(source)).filter(
        ([text, s]) => text === "when" && s.startsWith("keyword"),
      );
      expect(painted, description).toEqual([]);
    }
  });

  it("still recognizes `when` after a complete arm pattern", async () => {
    expect(await scope("match v\n    None when ready => 1", "when")).toBe(
      "keyword.other.when.hexagon",
    );
  });

  it("leaves `with`, `as`, and `derives` alone at the start of a right-hand side", async () => {
    expect(await scope("let ok = with and other", "with")).toBe("variable.other.hexagon");
    expect(await scope("let r = as b", "as")).toBe("variable.other.hexagon");
    expect(await scope("let d = derives Point", "derives")).toBe("variable.other.hexagon");
  });

  it("keeps recognizing them where a subject precedes them", async () => {
    expect(await scope("let u = {p with x = 3}", "with")).toBe("keyword.other.with.hexagon");
    expect(await scope("export fun seqMemoize as memoize<a>(s: Seq(a)): Seq(a)", "as")).toBe(
      "keyword.other.as.hexagon",
    );
    expect(await scope("union O derives (Eq, Show) =\n    | Less", "derives")).toBe(
      "keyword.other.derives.hexagon",
    );
  });
});

describe("characters with no token (spec/lexer.md §2.2, §3.2, §8.3, §10)", () => {
  it("rejects §11's own rejected emoji binding", async () => {
    expect(await scope("let 😀 = 1", "😀")).toBe("invalid.illegal.character.hexagon");
  });

  it("rejects characters the operator inventory never lists", async () => {
    // Deliberately characters the rule does not enumerate, so this cannot pass
    // merely by restating the pattern it is testing.
    for (const char of ["~", "'", "§", "£", "°", "«", "€", "±", "×", "¬"]) {
      expect(await scope(`let x = a ${char} b`, char), char).toBe(
        "invalid.illegal.character.hexagon",
      );
    }
  });

  it("rejects horizontal whitespace that is not space or tab", async () => {
    for (const char of [" ", "　", "​", "", ""]) {
      expect(await scope(`let x =${char}1`, char), JSON.stringify(char)).toBe(
        "invalid.illegal.whitespace.hexagon",
      );
    }
  });

  it("rejects bidirectional controls in code, strings, and comments", async () => {
    const bidi = "‮";
    expect(await scope(`let x = a${bidi}b`, bidi)).toBe(
      "invalid.illegal.bidirectional-control.hexagon",
    );
    expect(await scope(`let s = "a${bidi}b"`, bidi)).toBe(
      "invalid.illegal.bidirectional-control.hexagon",
    );
    expect(await scope(`// a${bidi}b`, bidi)).toBe(
      "invalid.illegal.bidirectional-control.hexagon",
    );
    expect(await scope(`/* a${bidi}b */`, bidi)).toBe(
      "invalid.illegal.bidirectional-control.hexagon",
    );
  });

  it("rejects a tab in leading whitespace but not after a token", async () => {
    expect(await scope("fun f() =\n\tlet x = 1", "\t")).toBe(
      "invalid.illegal.tab-indentation.hexagon",
    );
    expect(await scope("    \tlet x = 1", "    \t")).toBe(
      "invalid.illegal.tab-indentation.hexagon",
    );
    // §2.2: a tab after a non-whitespace token is legal horizontal whitespace.
    const pairs = await scopePairs("let x =\t1");
    expect(pairs).toContainEqual(["1", "constant.numeric.integer.hexagon"]);
    expect(pairs.some(([, s]) => s.startsWith("invalid."))).toBe(false);
  });
});

describe("regressions found in review", () => {
  it("keeps an uppercase name before `..` or `...` a type, not a namespace", async () => {
    expect(await scope("let r = A..B", "A")).toBe("entity.name.type.hexagon");
    expect(await scope("let s = f(Foo...)", "Foo")).toBe("entity.name.type.hexagon");
    // The accessor case must still read as a qualifier.
    expect(await scope("let n = Vector.size(v)", "Vector")).toBe(
      "entity.name.namespace.hexagon",
    );
  });

  it("rejects a `\\u{...}` escape that names no scalar value", async () => {
    for (const escape of ["\\u{D800}", "\\u{DFFF}", "\\u{110000}", "\\u{FFFFFF}", "\\u{0000001}"]) {
      expect(await scope(`let s = "${escape}"`, escape), escape).toBe(
        "invalid.illegal.unicode-escape.hexagon",
      );
    }
    for (const escape of ["\\u{41}", "\\u{1F600}", "\\u{10FFFF}", "\\u{0041}"]) {
      expect(await scope(`let s = "${escape}"`, escape), escape).toBe(
        "constant.character.escape.hexagon",
      );
    }
  });

  it("treats `/*** x ***/` as a doc comment and `/**/` as an empty block comment", async () => {
    expect(await scope("/*** x ***/", "* x **")).toBe("comment.block.documentation.hexagon");
    const pairs = await scopePairs("/**/\nlet x = 1");
    expect(pairs).toContainEqual(["let", "storage.type.hexagon"]);
    expect(pairs.some(([, s]) => s.startsWith("invalid."))).toBe(false);
  });

  it("tokenizes CRLF and lone-CR sources the same as LF (§2.1)", async () => {
    const expected = await scopePairs("let x = 1\nlet y = 2");
    expect(await scopePairs("let x = 1\r\nlet y = 2")).toEqual(expected);
    expect(await scopePairs("let x = 1\rlet y = 2")).toEqual(expected);
  });
});

describe("the whole checked-in corpus", () => {
  // Discovered, not listed. A hand-maintained list silently stops covering the
  // file that matters most the moment one is added — `stdlib/Bool.hex` arrived
  // with #147 and would have been missed. This is also what makes the README's
  // claim ("every `.hex` file in the repository") true rather than aspirational.
  const sources = ["stdlib", "runtime"].flatMap((directory) =>
    readdirSync(join(repositoryRoot, directory))
      .filter((entry) => entry.endsWith(".hex"))
      .sort()
      .map((entry) => `${directory}/${entry}`)
  );

  it("finds the corpus it is meant to be checking", () => {
    expect(sources).toContain("stdlib/Bool.hex");
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });

  it.each(sources)("paints no lexical error in %s", async (relative) => {
    const source = await readFile(join(repositoryRoot, relative), "utf8");
    const offenders = (await tokenize(source))
      .filter((token) => token.scopes.some((s) => s.startsWith("invalid.")))
      .map((token) => `${relative}:${token.line + 1} ${JSON.stringify(token.text)}`);

    expect(offenders).toEqual([]);
  });

  it.each(sources)("leaves no token unscoped in %s", async (relative) => {
    const source = await readFile(join(repositoryRoot, relative), "utf8");
    const unscoped = (await tokenize(source))
      // Layout whitespace is legitimately unscoped; anything else is a rule gap.
      .filter((token) => token.scopes.length === 1 && token.text.trim() !== "")
      .map((token) => `${relative}:${token.line + 1} ${JSON.stringify(token.text)}`);

    expect(unscoped).toEqual([]);
  });
});
