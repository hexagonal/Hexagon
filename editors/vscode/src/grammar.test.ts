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
 * Every `begin` or `end` pattern in the grammar, at any depth. Reads the parsed
 * grammar rather than its text so the `//` notes — which quote patterns in prose —
 * cannot be mistaken for rules.
 */
function patternsUnder(key: "begin" | "end", node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) patternsUnder(key, child, found);
  } else if (node !== null && typeof node === "object") {
    for (const [property, value] of Object.entries(node)) {
      if (property === key && typeof value === "string") found.push(value);
      else patternsUnder(key, value, found);
    }
  }
  return found;
}

const endPatterns = (node: unknown) => patternsUnder("end", node);
const beginPatterns = (node: unknown) => patternsUnder("begin", node);

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

  it("rejects the reserved leading `__` prefix (§3.2)", async () => {
    // Widened from the exact `__hex_` prefix at #425: a double leading
    // underscore means the compiler wrote the name, whatever follows it.
    expect(await scope("let __temp = 1", "__temp")).toBe(
      "invalid.illegal.reserved-identifier.hexagon",
    );
    expect(await scope("let __Eq_Rat = 1", "__Eq_Rat")).toBe(
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

  /**
   * `opaque` fills the head's visibility slot on its own since #590 — no
   * leading `export` — so the bare head is the spelling the grammar has to
   * paint. The refused pair is painted too: it is what a pre-#590 file still
   * says while its migration is pending, and a grammar colours what is written.
   */
  it("recognizes `opaque` only before `record`/`union`", async () => {
    expect(await scope("opaque record Seq(a) = {}", "opaque")).toBe(
      "storage.modifier.hexagon",
    );
    expect(await scope("opaque union Box(a) = Wrap(v: a)", "opaque")).toBe(
      "storage.modifier.hexagon",
    );
    expect(await scope("export opaque record Seq(a) = {}", "opaque")).toBe(
      "storage.modifier.hexagon",
    );
    expect(await scope("let opaque = 1", "opaque")).toBe("variable.other.definition.hexagon");
    expect(await scope("let f(opaque: Int): Int = 1", "opaque")).toBe(
      "variable.parameter.hexagon",
    );
    expect(await scope("let r = { opaque = 1 }", "opaque")).toBe("variable.other.hexagon");
  });

  /**
   * `union` joined the contextual words at the Set step (#373): Collections
   * Part 4 §6.2 mandates `Set.union`, and a reserved word cannot be a member
   * name. The grammar has to follow the parser, or the Playground and the
   * extension render the member as a keyword and mis-scope the binder.
   *
   * Every row can fail on its own: the first two would fail if `union` were
   * dropped from the grammar entirely, the rest if it were left in the bare
   * keyword alternation.
   */
  it("recognizes `union` only at a declaration head", async () => {
    // Keyword where the parser says keyword: a head, bare and after `export`.
    expect(await scope("union Shape = Circle | Rect", "union")).toBe("storage.type.hexagon");
    expect(await scope("export union Shape = Circle | Rect", "union")).toBe(
      "storage.type.hexagon",
    );
    expect(await scope("opaque union Box(a) = Wrap(v: a)", "union")).toBe(
      "storage.type.hexagon",
    );
    // An ordinary name everywhere else, in whichever term role the position
    // gives it — the three call spellings are call heads, and none is a keyword.
    expect(await scope("let u = Set.union(a, b)", "union")).toBe(
      "entity.name.function.hexagon",
    );
    expect(await scope("let u = s.union(t)", "union")).toBe("entity.name.function.hexagon");
    expect(await scope("let u = union(a, b)", "union")).toBe("entity.name.function.hexagon");
    expect(await scope("let union = 1", "union")).toBe("variable.other.definition.hexagon");
    expect(await scope("let f(union: Int): Int = 1", "union")).toBe("variable.parameter.hexagon");
    expect(await scope("let r = { union = 1 }", "union")).toBe("variable.other.hexagon");
    expect(await scope("let x = union", "union")).toBe("variable.other.hexagon");
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

  it("paints `pure` as a modifier on an extern `fun`, and nowhere else", async () => {
    // spec/effects.md §6.1's trusted purity claim. It is contextual, so the
    // rule keys on the `fun` that must follow: the rows FFI Part 4 §4.5 refuses
    // it on get nothing, and a binding called `pure` outside the block is an
    // ordinary name.
    const source = [
      'extern from "./trim.js"',
      "    export pure fun trim(document: String): String",
      "    export fun save(document: String): Unit",
      "    export pure",
      "let pure = 1",
    ].join("\n");
    const pairs = await scopePairs(source);

    expect(pairs).toContainEqual(["pure", "storage.modifier.hexagon"]);
    expect(pairs).toContainEqual(["pure", "variable.other.definition.hexagon"]);
    // The claimed row and the unclaimed one both keep their own name scope.
    expect(pairs).toContainEqual(["trim", "entity.name.function.hexagon"]);
    expect(pairs).toContainEqual(["save", "entity.name.function.hexagon"]);
    // `export pure` with no `fun` behind it is not the claim, so `pure` there is
    // an ordinary term rather than a modifier.
    expect(pairs.filter(([text, scope]) =>
      text === "pure" && scope === "storage.modifier.hexagon"
    )).toHaveLength(1);
  });

  it("paints `conduit` the same way, and nowhere else", async () => {
    // FFI Part 4 §4.5's declared-conduit claim (#409) sits in `pure`'s slot and
    // takes `pure`'s rule, lookahead included. One row carries one claim, so
    // `pure conduit` matches neither word and paints as ordinary terms.
    const source = [
      'extern from "./world.js"',
      "    export conduit fun runner(step: () ->? String): Int",
      "    export pure conduit fun both(step: () ->? String): Int",
      "let conduit = 1",
    ].join("\n");
    const pairs = await scopePairs(source);

    expect(pairs).toContainEqual(["conduit", "storage.modifier.hexagon"]);
    expect(pairs).toContainEqual(["conduit", "variable.other.definition.hexagon"]);
    expect(pairs).toContainEqual(["runner", "entity.name.function.hexagon"]);
    expect(pairs.filter(([text, scope]) =>
      text === "conduit" && scope === "storage.modifier.hexagon"
    )).toHaveLength(1);
    expect(pairs.filter(([text, scope]) =>
      text === "pure" && scope === "storage.modifier.hexagon"
    )).toHaveLength(0);
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
    const source = "let n = Vector.length(values)";
    expect(await scope(source, "Vector")).toBe("entity.name.namespace.hexagon");
    expect(await scope(source, "length")).toBe("entity.name.function.hexagon");
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

  it("paints a variance sigil with the parameter it claims (#205)", async () => {
    const pairs = await scopePairs(
      "opaque record Registry(k, +v) = {get: k -> Option(v)}",
    );
    expect(pairs.filter(([text]) => ["k", "v", "+"].includes(text))).toEqual([
      ["k", "entity.name.type.parameter.hexagon"],
      ["+", "storage.modifier.variance.hexagon"],
      ["v", "entity.name.type.parameter.hexagon"],
      ["k", "entity.name.type.parameter.hexagon"],
      ["v", "entity.name.type.parameter.hexagon"],
    ]);
  });

  it("paints a contravariant sigil the same way", async () => {
    expect(await scope("opaque record Sink(-a) = {accept: a -> Unit}", "-")).toBe(
      "storage.modifier.variance.hexagon",
    );
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
        "    toSeq(xs) = Bag.contents(xs)",
        "    other(ys) = length(ys)",
      ].join("\n"),
    );
    expect(pairs.find(([text]) => text === "toSeq")?.[1]).toBe("entity.name.function.hexagon");
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

  it("colours a type hole with the type-variable scope (#317)", async () => {
    // A hole is a type-position `_` (`decisions-ml-dialect-annotations-2026-08.md`
    // §11): the type-variable scope is what it should read as, and it already
    // does — `_` is in the same start class the type-variable rule matches, so
    // no rule was added and none of #162's bail-out guards were disturbed.
    expect(await scope("let f(x: _) = x", "_")).toBe("entity.name.type.parameter.hexagon");
    expect(await scope("let n: _ = 42", "_")).toBe("entity.name.type.parameter.hexagon");
    expect(await scope("let f(xs: Vector(_)) = xs", "_"))
      .toBe("entity.name.type.parameter.hexagon");
    expect(await scope("let f(g: _ -> Bool) = g", "_"))
      .toBe("entity.name.type.parameter.hexagon");
    expect(await scope("let f(r: {name: _}) = r", "_"))
      .toBe("entity.name.type.parameter.hexagon");
    expect(await scope("let f(x): _ = x", "_")).toBe("entity.name.type.parameter.hexagon");
  });

  it("colours a constrained hole's `_` and its constraints (#326)", async () => {
    // The suffix is Functions §4.2's constraint list attached to a hole
    // (`decisions-ml-dialect-annotations-2026-08.md` §4.4), so it must read as the
    // binder bound does: the hole keeps the type-variable scope, and the names
    // after the colon are constraints. Neither was free — a `_` before a colon
    // is what the record-type field rule looks for, and an uppercase name in a
    // type expression is an ordinary type until a rule says otherwise.
    for (const source of [
      "let f(x: _ : Show) = x",
      "let n: _ : Show = x",
      "let f(xs: Vector(_ : Show)) = xs",
      "let f(g: _ : Show -> Bool) = g",
      "let f(r: {name: _ : Show}) = r",
    ]) {
      expect(await scope(source, "_"), source).toBe("entity.name.type.parameter.hexagon");
      expect(await scope(source, "Show"), source)
        .toBe("entity.name.type.constraint.hexagon");
    }
    // The same scope the binder writes it in — the two forms are one grammar.
    expect(await scope("let f<a: Show>(x: a) = x", "Show"))
      .toBe(await scope("let f(x: _ : Show) = x", "Show"));
  });

  it("colours a constrained hole's parenthesized conjunction (#326)", async () => {
    const pairs = await scopePairs("let f(x: _ : (Eq, Show)) = x");
    expect(pairs.filter(([, s]) => s === "entity.name.type.constraint.hexagon")).toEqual([
      ["Eq", "entity.name.type.constraint.hexagon"],
      ["Show", "entity.name.type.constraint.hexagon"],
    ]);
    expect(pairs.find(([text]) => text === "_")?.[1])
      .toBe("entity.name.type.parameter.hexagon");
  });

  it("colours an ascribed type in expression position (#307)", async () => {
    // The Ascription spec's §9.7 warns against assuming the parameter-annotation
    // rule covers this — the constrained-holes arc falsified exactly that
    // assumption once. It does not cover it, and nothing needed it to:
    // `#annotation-type` opens on any `:` that is not `:=`, with no identifier
    // required before it, so `(42 : Nat)` and `((a, b) : T)` — neither of which
    // has one — colour their types as types.
    expect(await scope("let q = (42 : Nat)", "Nat")).toBe("entity.name.type.hexagon");
    const tuple = await scopePairs("let t = ((a, b) : (Int, String))");
    expect(tuple.filter(([, s]) => s === "entity.name.type.hexagon").map(([text]) => text))
      .toEqual(["Int", "String"]);
    // The ascribed element's own tokens keep their expression colouring.
    expect(tuple.find(([text]) => text === "a")?.[1]).toBe("variable.other.hexagon");
  });

  it("colours holes and constrained holes in an ascription (#307)", async () => {
    // The annotation grammar is one grammar: the ascribed position gets the hole
    // rules the binder position already had, without a rule of its own.
    expect(await scope("let v = (xs : Vector(_))", "_"))
      .toBe("entity.name.type.parameter.hexagon");
    expect(await scope("let s = (v : _ : Num)", "Num"))
      .toBe("entity.name.type.constraint.hexagon");
  });

  it("colours the ascribed type of an eats-right element (#307)", async () => {
    // §2.2: the colon ends the *element*, so what is ascribed here is the lambda
    // and `a -> a` is one type — which is what the annotation context reads it as.
    const pairs = await scopePairs("let f = (x => x : a -> a)");
    expect(pairs.filter(([, s]) => s === "entity.name.type.parameter.hexagon"))
      .toHaveLength(2);
    expect(pairs.find(([text]) => text === "->")?.[1])
      .toBe("keyword.operator.type.arrow.hexagon");
  });

  it("paints a bare-name ascribed element as a binder, deliberately (#307)", async () => {
    // `(x : Int)` is the ascription reading and `(x : Int) => e` the parameter
    // one, and only the token *after* the matching `)` tells them apart — a
    // lookahead a TextMate rule cannot perform. The grammar keys on local shape
    // and so paints both as the binder. Recorded rather than fixed: the
    // alternative loses the parameter colour in every lambda head, and Ascription
    // §6.3 already calls the shared surface a feature. The *type* side, which is
    // what §9.7 requires, is right in both readings.
    expect(await scope("let p = (x : Int)", "x")).toBe("variable.parameter.hexagon");
    expect((await scopePairs("let p = (x : Int) => y")).find(([text]) => text === "x")?.[1])
      .toBe("variable.parameter.hexagon");
    expect(await scope("let p = (x : Int)", "Int")).toBe("entity.name.type.hexagon");
  });

  it("qualifies a constrained hole's constraint by a module alias (#326)", async () => {
    const pairs = await scopePairs("let f(x: _ : Geo.Ord) = x");
    expect(pairs.find(([text]) => text === "Geo")?.[1]).toBe("entity.name.namespace.hexagon");
    expect(pairs.find(([text]) => text === "Ord")?.[1])
      .toBe("entity.name.type.constraint.hexagon");
  });

  it("keeps a half-typed `_ :` a hole rather than a field name (#326)", async () => {
    // `_` is its own token (spec/lexer.md §3.2) and can never be a record-type
    // field name, so the paint should not flicker while the constraint is typed.
    expect(await scope("let f(x: _ : ", "_")).toBe("entity.name.type.parameter.hexagon");
  });

  it("leaves a pattern-position `_` alone", async () => {
    expect(await scope("match x\n    _ => 1", "_")).toBe("variable.language.wildcard.hexagon");
    // Not the wildcard scope — the `let` binder rule claims this one, and has
    // since before holes existed. What matters here is that the type-position
    // meaning did not reach into pattern position.
    expect(await scope("let _ = 1", "_")).not.toBe("entity.name.type.parameter.hexagon");
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
    const commented = await scopePairs("(* one\ntwo *)\nlet after = 1");
    expect(commented).toContainEqual(["two ", "comment.block.hexagon"]);
  });

  it("guards every type-context bracket against a comment opener", async () => {
    // The #171 companion to the guard below: same reason for writing it out at every
    // site, same reason for pinning the copies. Only the two bounded rules change any
    // paint; the rest are uniformity, and the behavioural cases above are what hold
    // the line for the ones that matter.
    const grammar = JSON.parse(await readFile(grammarPath, "utf8"));
    const guarded = beginPatterns(grammar).filter((begin) => begin.includes("(?!\\*)"));

    // Three hanging groups and five bounded ones, across the type-declaration,
    // type-expression, binder-bound, `derives`, and constrained-hole rules — the
    // last being the conjunction `_ : (Eq, Show)`, the binder bound's twin.
    expect(guarded).toHaveLength(8);
    for (const begin of guarded) {
      // The guard sits immediately after the `(` the rule consumes, captured or not.
      expect(begin.includes("\\((?!\\*)") || begin.includes("(\\()(?!\\*)"), begin).toBe(true);
    }
  });

  it("spells the bail-out guard identically wherever it appears", async () => {
    // TextMate cannot share a subpattern, so the guard is written out at every site.
    // A copy that drifts is a rule that silently stops bailing, which is exactly the
    // #162 leak coming back for one shape while the others stay fixed.
    const guards = endPatterns(JSON.parse(await readFile(grammarPath, "utf8")))
      .filter((end) => end.includes("(?=^\\S"))
      .map((end) => end.slice(end.indexOf("(?=^\\S")));

    // Five hanging groups, seven bounded ones, the two contexts that enclose them, and
    // the JavaScript-comment region, which is a half-typed `/*` away from the same leak.
    expect(guards).toHaveLength(15);
    expect(new Set(guards).size).toBe(1);
  });

  /**
   * `union` is in the guard, but **only with a type name after it** (#373).
   *
   * A bare `union` was a safe declaration-start marker while the word was
   * reserved, because no other line could begin with it. It is not safe now: an
   * indented continuation may legitimately start `union(a, b)`, and a guard that
   * bailed there would end the enclosing bracket or comment at a line that never
   * left it. The arm is asserted separately from the alternation above because
   * the word-list test cannot see it — `union` is deliberately *outside* the
   * first alternation, so deleting this arm entirely would leave that test green.
   *
   * The scope assertions cannot stand in for this either: a bail changes region
   * nesting, and the innermost scope of every token in the affected line is the
   * same on both sides of it. Structure is the only observation that moves.
   */
  it("admits `union` to the guard only ahead of a type name", async () => {
    const guards = endPatterns(JSON.parse(await readFile(grammarPath, "utf8")))
      .filter((end) => end.includes("(?=^\\S"));
    expect(guards).toHaveLength(15);
    for (const guard of guards) {
      expect(guard, guard).toContain(
        "|union(?![\\p{ID_Continue}$_\\x{200C}\\x{200D}])[ \\t]+[\\p{Uppercase}\\p{Lt}])",
      );
    }
  });

  /**
   * `widens` joins the guard on `union`'s terms and for `union`'s reason (#546).
   *
   * It is a contextual word too, so a bare one is not a declaration marker: an
   * indented continuation may legitimately read `widens(x)`, and a guard that
   * bailed there would end the enclosing bracket or comment at a line that never
   * left it. The arm is therefore keyed on the follower, exactly as `union`'s is.
   *
   * It sits *before* the `union` arm, and the order carries no meaning — the two
   * words are mutually exclusive, so no input can reach both — but the position
   * is deliberate: the `union` assertion above anchors on that arm being last in
   * its group, and an arm appended after it would move what that test measures
   * without changing what it claims to measure.
   */
  it("admits `widens` to the guard only ahead of a module alias", async () => {
    const guards = endPatterns(JSON.parse(await readFile(grammarPath, "utf8")))
      .filter((end) => end.includes("(?=^\\S"));
    expect(guards).toHaveLength(15);
    for (const guard of guards) {
      expect(guard, guard).toContain(
        "|widens(?![\\p{ID_Continue}$_\\x{200C}\\x{200D}])[ \\t]+[\\p{Uppercase}\\p{Lt}]|union",
      );
    }
  });

  /**
   * `opaque` joins the guard on the same terms, and #590 is what put it there:
   * the word now heads a declaration by itself, so a line beginning `opaque
   * record Point = ...` is a declaration start an unclosed bracket or comment
   * must not swallow. Before #590 the guard's `export` arm covered every one of
   * these lines, because the word could not appear without it.
   *
   * Keyed on the follower like its two neighbours, and for their reason: the
   * word is contextual, so an indented continuation may legitimately read
   * `opaque(x)` or `opaque + 1`, and a bare arm would bail at a line that never
   * left the group. The follower is `record`/`union` rather than a start class —
   * the refused subjects (`opaque type`, `opaque let`, …) are diagnosed lines,
   * and a guard is for structure, not for repair.
   *
   * It sits *first* in the contextual arms, which keeps the `union` assertion
   * above measuring what it says it measures: that arm is still last in the
   * group.
   */
  it("admits `opaque` to the guard only ahead of `record`/`union`", async () => {
    const guards = endPatterns(JSON.parse(await readFile(grammarPath, "utf8")))
      .filter((end) => end.includes("(?=^\\S"));
    expect(guards).toHaveLength(15);
    for (const guard of guards) {
      expect(guard, guard).toContain(
        "|opaque(?![\\p{ID_Continue}$_\\x{200C}\\x{200D}])[ \\t]+(?:record|union)" +
          "(?![\\p{ID_Continue}$_\\x{200C}\\x{200D}])|widens",
      );
    }
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

  /**
   * `module` stays out, and the reason is the guard's own criterion (#565).
   *
   * The two contextual words in the alternation are there because they *open a
   * declaration* — an unclosed bracket or comment must not swallow one. `module`
   * opens nothing: there is no module header (Modules §2), and the declaration it
   * belongs to is headed by `import`, which the hard-keyword alternation already
   * carries. Adding it would cost the two lines it would then bail at — a
   * Playground `module X` header inside an open group, and an indented
   * continuation naming a term called `module` — and buy nothing.
   */
  it("keeps `module` out of the guard, `import` being already in it", async () => {
    const guards = endPatterns(JSON.parse(await readFile(grammarPath, "utf8")))
      .filter((end) => end.includes("(?=^\\S"));
    expect(guards).toHaveLength(15);
    for (const guard of guards) {
      expect(guard, guard).toContain("|import|");
      expect(guard, guard).not.toContain("module");
    }
  });
});

/**
 * The two contextual words #546 added (spec/lexer.md §4.2, Constraints §4.7).
 *
 * Both mean nothing outside their position and lex as ordinary names, so every
 * case here can fail on its own: the declaration rows fail if the lookahead is
 * dropped, and the term rows fail if either word is ever made reserved.
 */
describe("`widens` and `widened` are contextual (#546)", () => {
  it("paints `widens` at a declaration head", async () => {
    expect(await scope("widens Pow.pow(value: Float, exponent: Float): Float = p", "widens"))
      .toBe("storage.type.hexagon");
  });

  it("paints the head's member path as the qualified reference it is", async () => {
    // No head-only spelling: the alias is a namespace and the `.` an accessor,
    // which is what `Float.pow` gets anywhere else in the language.
    const pairs = await scopePairs("widens Pow.pow(value: Float, exponent: Float): Float = p");
    expect(pairs.slice(0, 4)).toEqual([
      ["widens", "storage.type.hexagon"],
      ["Pow", "entity.name.namespace.hexagon"],
      [".", "punctuation.accessor.hexagon"],
      ["pow", "entity.name.function.hexagon"],
    ]);
  });

  it("paints the comma list's head, and reads its earlier members as references", async () => {
    // Recorded rather than admired: only the last listed member has the `(`
    // after it, so the earlier ones take the scope `let f = Float.pow` gives the
    // same spelling. Painting them otherwise would need a head-shaped region.
    const pairs = await scopePairs("widens Pow.pow, Mul.pow(value: Box, exponent: Float): Box = v");
    expect(pairs.slice(0, 8)).toEqual([
      ["widens", "storage.type.hexagon"],
      ["Pow", "entity.name.namespace.hexagon"],
      [".", "punctuation.accessor.hexagon"],
      ["pow", "variable.other.hexagon"],
      [",", "punctuation.separator.comma.hexagon"],
      ["Mul", "entity.name.namespace.hexagon"],
      [".", "punctuation.accessor.hexagon"],
      ["pow", "entity.name.function.hexagon"],
    ]);
  });

  it("leaves `widens` an ordinary name everywhere else", async () => {
    // Contextual status is observable, and this is where it is observed.
    expect(await scope("let widens = 3", "widens"))
      .toBe("variable.other.definition.hexagon");
    expect(await scope("let r = widens(x)", "widens"))
      .toBe("entity.name.function.hexagon");
    expect(await scope("let r = {widens = 1}", "widens"))
      .toBe("variable.other.hexagon");
    // Both occurrences, because a parameter and its use are different slots and
    // neither may be claimed by the head rule.
    expect(
      (await scopePairs("fun f(widens: Int): Int = widens"))
        .filter(([text]) => text === "widens"),
    ).toEqual([
      ["widens", "variable.parameter.hexagon"],
      ["widens", "variable.other.hexagon"],
    ]);
  });

  it("paints `widened` as the whole right-hand side of a member line", async () => {
    expect(await scopePairs("honor Pow<Float> =\n    pow = widened\n")).toEqual([
      ["honor", "storage.type.hexagon"],
      ["Pow", "entity.name.type.constraint.hexagon"],
      ["<", "keyword.operator.comparison.hexagon"],
      ["Float", "entity.name.type.hexagon"],
      [">", "keyword.operator.comparison.hexagon"],
      ["=", "keyword.operator.assignment.hexagon"],
      ["pow", "entity.name.function.hexagon"],
      ["=", "keyword.operator.assignment.hexagon"],
      ["widened", "keyword.other.widened.hexagon"],
    ]);
  });

  it("leaves `widened` an ordinary name everywhere else", async () => {
    expect(await scope("let widened = 5", "widened"))
      .toBe("variable.other.definition.hexagon");
    // Hexagon assigns with `:=`, so an assignment never reaches the rule.
    expect(await scope("fun f() =\n    x := widened\n", "widened"))
      .toBe("variable.other.hexagon");
    // The rule demands the word be the *whole* right-hand side.
    expect(await scope("honor Pow<Box> =\n    pow = widened + 1\n", "widened"))
      .toBe("variable.other.hexagon");
  });
});

/**
 * The namespace-import head #565 respelled (spec/modules.md §3.3, Lexer §4.2):
 * `import module Geo from "./geometry"`, where `module` is contextual and
 * `import * as` is gone from the language.
 *
 * The context is one position wide and total in it — before #565 an `import`
 * admitted only `{`, `*`, or a module string, so no name after `import` was ever
 * a legal program. That is why the rule is anchored on the word before rather
 * than keyed on the alias ahead the way `union` and `widens` are, and the rows
 * below measure the difference rather than assuming it.
 */
describe("`module` is contextual in the import head (#565)", () => {
  it("paints the whole head, `module` among the keywords", async () => {
    expect(await scopePairs('import module Geo from "./geometry"')).toEqual([
      ["import", "keyword.control.import.hexagon"],
      ["module", "keyword.other.module.hexagon"],
      // The alias seat has never had a paint of its own: an uppercase name that
      // is not left of a `.` is a type name to #names, which is what `Geo` got
      // in the `* as Geo` spelling too. Recorded as the status quo the
      // respelling inherits, not as a claim that a module alias is a type.
      ["Geo", "entity.name.type.hexagon"],
      ["from", "keyword.other.from.hexagon"],
      ["\"", "punctuation.definition.string.begin.hexagon"],
      ["./geometry", "string.quoted.double.hexagon"],
      ["\"", "punctuation.definition.string.end.hexagon"],
    ]);
  });

  it("paints the head before the alias is typed, and needs no alias at all", async () => {
    // The difference an anchor makes: a follower-keyed rule would leave this
    // unpainted until the alias arrived, and the word would flicker into place.
    expect(await scope("import module", "module")).toBe("keyword.other.module.hexagon");
    expect(await scope('import module from "./x"', "module"))
      .toBe("keyword.other.module.hexagon");
  });

  it("paints the head word of `import module module` and nothing after it", async () => {
    // The parser reads this as the head and refuses at the *alias* seat, by
    // start class (`module aliases must be uppercase-start names`). The grammar
    // agrees: one head word, then an ordinary name standing where an alias must.
    expect((await scopePairs('import module module from "./x"')).slice(0, 3)).toEqual([
      ["import", "keyword.control.import.hexagon"],
      ["module", "keyword.other.module.hexagon"],
      ["module", "variable.other.hexagon"],
    ]);
  });

  it("leaves `module` an ordinary name everywhere else", async () => {
    expect(await scope("let module = 3", "module")).toBe("variable.other.definition.hexagon");
    expect(await scope("var module = 1", "module")).toBe("variable.other.definition.hexagon");
    expect(await scope("let r = {module = 1}", "module")).toBe("variable.other.hexagon");
    expect(await scope("module(2)", "module")).toBe("entity.name.function.hexagon");
    expect(
      (await scopePairs("fun f(module: Int): Int = module"))
        .filter(([text]) => text === "module"),
    ).toEqual([
      ["module", "variable.parameter.hexagon"],
      ["module", "variable.other.hexagon"],
    ]);
    // Modules §2: there is no module header, and the context reaches no
    // declaration seat. `module Geometry` is the two ordinary items it lexes as.
    expect(await scope("module Geometry", "module")).toBe("variable.other.hexagon");
  });

  it("does not read the word out of the tail of a longer name", async () => {
    // The second lookbehind's whole job. Without it `reimport module` — no
    // program, but a thing a half-typed line can be — would paint a head.
    expect(await scope("let reimport = 1\nreimport module", "module"))
      .toBe("variable.other.hexagon");
  });

  /**
   * Recorded rather than admired. The parser's own pin says the head is tokens
   * and not a line: `import (* why *) module Geo` and an `import` whose head
   * continues on the next line are both accepted, and neither paints here. A
   * lookbehind sees the comment's `*)`, and vscode-textmate hands the grammar
   * one line at a time. The trade is the `widened` rule's — key the position as
   * far as the format reaches and name the edge — and both spellings are rare
   * enough that the alternative, a begin/end region over the whole import, would
   * buy them at the cost of repainting every import form in the language.
   */
  it("does not reach a head interrupted by a comment or a newline", async () => {
    expect(await scope('import (* why *) module Geo from "./g"', "module"))
      .toBe("variable.other.hexagon");
    expect(await scope('import\n    module Geo from "./g"', "module"))
      .toBe("variable.other.hexagon");
  });

  it("gives JavaScript's dead head no paint of its own", async () => {
    // `import * as Geo` is a parse error under the Rewrite Rule (§3.3), and the
    // grammar carries no rule for it — before or after #565. The `*` is the
    // arithmetic operator it always was, and `as` misses its own rule because
    // that rule demands a name, `)`, `]`, or `}` before it. Pinned so a later
    // reader can see the absence was measured rather than overlooked.
    expect(await scope('import * as Geo from "./geometry"', "*"))
      .toBe("keyword.operator.arithmetic.hexagon");
    expect(await scope('import * as Geo from "./geometry"', "as"))
      .toBe("variable.other.hexagon");
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
  it("distinguishes the doc form from the ordinary forms", async () => {
    expect(await scope("// note", " note")).toBe("comment.line.double-slash.hexagon");
    expect(await scope("(** doc *)", " doc ")).toBe("comment.block.documentation.hexagon");
    expect(await scope("(* note *)", " note ")).toBe("comment.block.hexagon");
  });

  it("recognizes a doc comment by spec/doc-comments.md §2.1's predicate", async () => {
    // `(**` followed by a character that is neither `)` nor `*`.
    expect(await scope("(**doc*)", "doc")).toBe("comment.block.documentation.hexagon");
    // The space-first idiom for content that begins with `*` (§2.2).
    expect(await scope("(** *bold* *)", " *bold* ")).toBe("comment.block.documentation.hexagon");

    // The character after `(**` may be the newline — the newline-first body (§3.1) is a
    // doc comment, so the predicate must hold at end of line rather than demand a
    // character on the same one.
    const newlineFirst = await scopePairs("(**\n    A body.\n*)\nlet x = 1");
    expect(newlineFirst).toContainEqual(["    A body.", "comment.block.documentation.hexagon"]);
    expect(newlineFirst).toContainEqual(["let", "storage.type.hexagon"]);
  });

  it("keeps spec/doc-comments.md §2.2's carve-outs ordinary", async () => {
    // `(**)` is the empty block comment, and `(***`, `(****…` are banners and rulers:
    // the predicate excludes `)` and `*` so neither spelling ever becomes documentation.
    for (const opener of ["(**)", "(***)", "(*** x ***)", "(**********)", "(*** doc-like *)"]) {
      const pairs = await scopePairs(`${opener}\nlet x = 1`);
      expect(pairs.some(([, name]) => name.includes(".documentation.")), opener).toBe(false);
      expect(pairs.some(([, name]) => name.startsWith("invalid.")), opener).toBe(false);
      // The comment ends where it should, so the following line is still code.
      expect(pairs, opener).toContainEqual(["let", "storage.type.hexagon"]);
    }

    // No inner-doc spelling exists or is reserved (§9.1), and a doc opener nested inside
    // an ordinary comment is body text — the block rules do not include #comments, and
    // an edit that made them would light up the inside of every commented-out region.
    expect(await scope("(*! not special *)", "! not special ")).toBe("comment.block.hexagon");
    expect(await scope("(* a (** b *) *)", "* b ")).toBe("comment.block.hexagon");
  });

  it("gives `///` no status of its own (spec/doc-comments.md §2.3)", async () => {
    // The line-doc reservation was revoked unspent, so the grammar does not count
    // slashes: `///` is a `//` comment whose text begins with `/`, and so is `////`.
    for (const source of ["/// not documentation", "//// not documentation"]) {
      const pairs = await scopePairs(`${source}\nlet x = 1`);
      expect(pairs.some(([, name]) => name.includes(".documentation.")), source).toBe(false);
      expect(pairs, source).toContainEqual(["//", "punctuation.definition.comment.hexagon"]);
      expect(pairs, source).toContainEqual(["let", "storage.type.hexagon"]);
    }
    expect(await scope("/// not documentation", "/ not documentation")).toBe(
      "comment.line.double-slash.hexagon",
    );
  });

  it("nests block comments and resumes code after the outer close", async () => {
    const pairs = await scopePairs("(* outer (* inner *) still outer *)\nlet x = 1");
    for (const text of [" outer ", "(*", " inner ", "*)", " still outer "]) {
      expect(pairs).toContainEqual([text, "comment.block.hexagon"]);
    }
    expect(pairs).toContainEqual(["let", "storage.type.hexagon"]);
  });

  it("treats `//` inside a block comment and `(*` inside a line comment as text", async () => {
    expect(await scope("(* a // b *)", " a // b ")).toBe("comment.block.hexagon");
    expect(await scope("// a (* b", " a (* b")).toBe("comment.line.double-slash.hexagon");
  });

  it("rejects `*)` at depth zero", async () => {
    expect(await scope("let x = 1\n*)", "*)")).toBe(
      "invalid.illegal.unmatched-comment-close.hexagon",
    );
  });

  it("redirects the JavaScript spellings (§3.1)", async () => {
    // Painted as one region, mirroring the compiler's scan-to-`*/` recovery, so the
    // body of a pasted JS comment does not also light up as code.
    const pasted = await scopePairs("/* JS habit */\nlet x = 1");
    expect(pasted).toContainEqual(["/*", "invalid.illegal.javascript-comment.hexagon"]);
    expect(pasted).toContainEqual([" JS habit ", "invalid.illegal.javascript-comment.hexagon"]);
    expect(pasted).toContainEqual(["let", "storage.type.hexagon"]);

    expect(await scope("let x = 1\n*/", "*/")).toBe("invalid.illegal.javascript-comment.hexagon");
    expect(await scope("/** doc */", "/*")).toBe("invalid.illegal.javascript-comment.hexagon");

    // A pasted JSDoc block is one region, not a line of error followed by `@param`
    // painted as an invalid character — the compiler skips to `*/` and reports once.
    const jsdoc = await scopePairs("/**\n * @param x the thing\n */\nlet x = 1");
    expect(jsdoc).toContainEqual([
      " * @param x the thing",
      "invalid.illegal.javascript-comment.hexagon",
    ]);
    expect(jsdoc).toContainEqual(["let", "storage.type.hexagon"]);

    // A tab inside the body is comment text, which is why the region must not end at
    // `$`: the compiler diagnoses no tab here (spec/comments.md §4), so nor may this.
    const tabbed = await scopePairs("/* one\n\ttwo */\nlet y = 2");
    expect(tabbed).toContainEqual(["\ttwo ", "invalid.illegal.javascript-comment.hexagon"]);
    expect(tabbed.some(([, name]) => name === "invalid.illegal.tab-indentation.hexagon")).toBe(
      false,
    );

    // The bail-out guard still contains a half-typed `/*` rather than repainting the
    // rest of the file while its author is still typing (the #162 failure class).
    const halfTyped = await scopePairs("/* still typing\nlet after = 1");
    expect(halfTyped).toContainEqual(["let", "storage.type.hexagon"]);

    // §3.2 prohibits bidirectional controls in every context, this one included.
    expect(await scope("/* a‮b */", "‮")).toBe(
      "invalid.illegal.bidirectional-control.hexagon",
    );
  });

  it("does not lex comments inside strings", async () => {
    expect(await scope('let s = "// not a comment"', "// not a comment")).toBe(
      "string.quoted.double.hexagon",
    );
    expect(await scope('let s = "(* not a comment *)"', "(* not a comment *)")).toBe(
      "string.quoted.double.hexagon",
    );
  });

  it("keeps a comment opener out of the type-context bracket rules", async () => {
    // Without `(?!\*)` on those `begin`s, #type-declaration-parameters and the
    // `derives` rules claim the `(` of a `(*` opener before #comments is reached.
    for (const source of [
      "record Pair (* note *) = {a: Int}",
      "record Pair(a) derives (* note *) Eq = {a: a}",
      "let x: (* note *) Int = 1",
      "fun f<a: (* note *) Ord>(v: a) = v",
    ]) {
      expect(await scope(source, " note "), source).toBe("comment.block.hexagon");
    }

    // #function-call reads the `(` through a lookahead, so it needs the guard too or
    // a name followed by a comment paints as a call.
    expect(await scope("let y = compute (* note *) (x)", "compute")).toBe(
      "variable.other.hexagon",
    );
    // Its second alternative, the type-argument form, reads a `(` of its own.
    expect(await scope("let y = isEmpty<a> (* note *) (v)", "isEmpty")).toBe(
      "variable.other.hexagon",
    );
  });

  it("keeps a comment inside a bracket group from closing it", async () => {
    // The other half of the guard: a group's own patterns are the only ones tried
    // inside it, so a `(*` that gets past the `begin` still needs #comments in the
    // body — otherwise `*)` ends the group at its `)` and the rest of the list
    // loses the colour the group exists to give.
    const parameters = await scopePairs("record Pair(\n    (* note *)\n    a\n) = {a: a}");
    expect(parameters).toContainEqual([" note ", "comment.block.hexagon"]);
    expect(parameters).toContainEqual(["a", "entity.name.type.parameter.hexagon"]);

    const derived = await scopePairs("record P(a) derives (\n    (* note *)\n    Eq\n) = {a: a}");
    expect(derived).toContainEqual([" note ", "comment.block.hexagon"]);
    expect(derived).toContainEqual(["Eq", "entity.name.type.constraint.hexagon"]);

    const bound = await scopePairs("fun f<a: (Ord, (* note *) Show)>(v: a) = v");
    expect(bound).toContainEqual([" note ", "comment.block.hexagon"]);
    expect(bound).toContainEqual(["Show", "entity.name.type.constraint.hexagon"]);

    // The single-line `derives` clause is the common shape, and it goes through the
    // bounded rule rather than the hanging one.
    const inline = await scopePairs("record P(a) derives (Eq, (* note *) Show) = {a: a}");
    expect(inline).toContainEqual([" note ", "comment.block.hexagon"]);
    expect(inline).toContainEqual(["Show", "entity.name.type.constraint.hexagon"]);

    // A binder list is a context of its own, with no group between it and the comment.
    expect(await scope("fun f<a (* note *)>(v: a) = v", " note ")).toBe(
      "comment.block.hexagon",
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
      // The marked type arrows stand ahead of `->`, which is the munch
      // (spec/effects.md §2.3).
      ["let h: () ->! Int = f", "->!", "keyword.operator.arrow.impure.hexagon"],
      ["let k(s: () ->? Int): Int = s?()", "->?", "keyword.operator.arrow.linked.hexagon"],
      ["let p: Int -> Int = f", "->", "keyword.operator.type.arrow.hexagon"],
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
    // `?` left this list when the call marks landed (spec/effects.md §3.1): it
    // lexes now, and a floating one is a mark in the wrong seat rather than a
    // character with no token — see the mark cases below.
    for (const char of ["%", "^", "&", "@", "#", "`", "\\"]) {
      expect(await scope(`let x = a ${char} b`, char), char).toBe(
        "invalid.illegal.character.hexagon",
      );
    }
  });

  it("keeps a union bar distinct from the forbidden `||`", async () => {
    expect(await scope("union S = A | B", "|")).toBe("keyword.operator.bar.hexagon");
  });

  /**
   * The call marks (spec/effects.md §3.1; Lexer §8.1). The grammar keys on the
   * *left* glue, because that is what distinguishes a mark from the two things
   * the same characters used to be: a `!` standing before an expression is the
   * negation the language spells `not`, and a `?` standing alone had no reading
   * at all. Both stay painted as errors, which is what a reader needs — neither
   * is an operator, and no such operator exists.
   */
  it("paints a mark glued to its callee, in every seat a mark has", async () => {
    for (const [source, text] of [
      ["let x = save!(document)", "!"],
      ["let x = check?(value)", "?"],
      ["let x = stream.next!()", "!"],
      ["let x = (source.next)!()", "!"],
      ["let x = document |> save!", "!"],
    ] as const) {
      expect(await scope(source, text), source).toBe("keyword.operator.mark.hexagon");
    }
  });

  it("leaves a floating mark painted as the error it is", async () => {
    // The `not` redirect survives the token change (§9's own row), and a mark
    // with no argument list to govern is a parse error either way.
    expect(await scope("let x = !a", "!")).toBe("invalid.illegal.operator.hexagon");
    expect(await scope("let x = ?a", "?")).toBe("invalid.illegal.operator.hexagon");
    expect(await scope("let x = readLine !()", "!")).toBe(
      "invalid.illegal.operator.hexagon",
    );
    // `!=` still wins the munch over the mark, which is why the mark rule sits
    // after the comparison row rather than before it.
    expect(await scope("let x = a != b", "!=")).toBe("keyword.operator.comparison.hexagon");
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
    expect(await scope(`(* a${bidi}b *)`, bidi)).toBe(
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
    expect(await scope("let n = Vector.length(v)", "Vector")).toBe(
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

  it("treats `(*** x ***)` and `(**)` as ordinary block comments", async () => {
    // `(*** x ***)` painted as documentation under the reservation-era predicate, which
    // asked only for a non-`)` character; spec/doc-comments.md §2.2 excludes `*` as well
    // (issue #194), so a banner is a comment again. `(**)` was ordinary either way.
    expect(await scope("(*** x ***)", "** x **")).toBe("comment.block.hexagon");
    const pairs = await scopePairs("(**)\nlet x = 1");
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
