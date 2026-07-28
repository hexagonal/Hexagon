/**
 * Scope assertions for syntaxes/hexagon.tmLanguage.json.
 *
 * The cases are drawn from the specs the grammar claims to follow — chiefly
 * spec/lexer.md §§3-8 and its §11 acceptance/rejection inventory — so a rule that
 * drifts from the token language fails here rather than in someone's editor.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRoot, scopeOf, scopePairs, tokenize } from "./tokenize.js";

/** Innermost scope of the first token spelled exactly `text`. */
const scope = (source: string, text: string) => scopeOf(source, text);

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

  it("scopes literal words", async () => {
    expect(await scope("let x = true", "true")).toBe("constant.language.boolean.hexagon");
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
    expect(await scope("let when = true", "when")).toBe("variable.other.definition.hexagon");
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
    expect(await scope("constraint Ord<a: Eq> =\n    compare(l: a): a", "Ord")).toBe(
      "entity.name.type.hexagon",
    );
    expect(await scope("honor Show<Rat> =\n    show(r: Rat): String = \"\"", "Show")).toBe(
      "entity.name.type.hexagon",
    );
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
    expect(await scope("searching := false", "searching")).toBe("variable.other.hexagon");
    expect(await scope("searching := false", ":=")).toBe("keyword.operator.assignment.hexagon");
  });

  it("scopes an uppercase qualifier before `.` as a namespace", async () => {
    const source = "let n = Vector.size(values)";
    expect(await scope(source, "Vector")).toBe("entity.name.namespace.hexagon");
    expect(await scope(source, "size")).toBe("entity.name.function.hexagon");
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
    expect(await scope("fun isEmpty<a>(v: Vector(a)): Bool = true", "isEmpty")).toBe(
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
  const sources = [
    "stdlib/Prelude.hex",
    "stdlib/Option.hex",
    "stdlib/Result.hex",
    "stdlib/Seq.hex",
    "stdlib/Vector.hex",
    "stdlib/Rat.hex",
    "stdlib/Integral.hex",
    "runtime/VectorTrie.hex",
  ];

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
