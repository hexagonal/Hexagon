import { describe, expect, test } from "vitest";
import { AnalysisSession, type CodeAction } from "./session.js";

/** Offset of the `nth` occurrence of `needle`, counting from one. */
function at(text: string, needle: string, nth = 1): number {
  let offset = -1;
  for (let found = 0; found < nth; found += 1) {
    offset = text.indexOf(needle, offset + 1);
    if (offset < 0) throw new Error(`no occurrence ${nth} of ${JSON.stringify(needle)}`);
  }
  return offset;
}

function sessionOf(files: Record<string, string>): {
  readonly session: AnalysisSession;
  readonly texts: ReadonlyMap<string, string>;
} {
  const session = new AnalysisSession();
  const texts = new Map(Object.entries(files));
  for (const [path, text] of texts) session.setFile(path, text);
  return { session, texts };
}

/** Every action offered where `needle` is written, as a caret would ask. */
function actionsOn(
  session: AnalysisSession,
  path: string,
  text: string,
  needle: string,
  nth = 1,
): readonly CodeAction[] {
  const offset = at(text, needle, nth);
  return session.codeActions(path, { start: offset, end: offset });
}

/** The file as it would read once an action's edits were applied. */
function applied(text: string, action: CodeAction): string {
  const ordered = [...action.edits].sort((left, right) =>
    left.span.start.offset - right.span.start.offset
  );
  let result = text;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const { span, replacement } = ordered[index]!;
    result = result.slice(0, span.start.offset) + replacement + result.slice(span.end.offset);
  }
  return result;
}

/** The single action offered, failing loudly when the count is not one. */
function sole(actions: readonly CodeAction[]): CodeAction {
  expect(actions.map(({ title, disabled }) => `${title}${disabled === undefined ? "" : " (off)"}`))
    .toHaveLength(1);
  return actions[0]!;
}

describe("code actions: the diagnostic's own fixes", () => {
  test("a compiler-authored fix is offered where the diagnostic is", () => {
    // The lexer redirects JavaScript's comment spelling to Hexagon's (#171) and
    // carries the repair on the diagnostic. Nothing but this could reach it.
    const source = ["/* a note */", "let value: Int = 1", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "/*"));
    expect(action.title).toBe("use the Hexagon block comment spelling");
    expect(applied(source, action)).toBe(
      ["(* a note *)", "let value: Int = 1", ""].join("\n"),
    );
    expect(action.disabled).toBeUndefined();
  });

  test("nothing is offered away from the diagnostic", () => {
    const source = ["/* a note */", "let value: Int = 1", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(actionsOn(session, "/main.hex", source, "value")).toEqual([]);
  });

  test("a selection covering the diagnostic is enough, not only a caret on it", () => {
    const source = ["/* a note */", "let value: Int = 1", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.codeActions("/main.hex", { start: 0, end: source.length })).toHaveLength(1);
  });

  test("a caret immediately after the name is still on it", () => {
    // Where an editor leaves the cursor after typing a name, and where the
    // other position queries all answer. The region is closed at both ends.
    const source = "export fun zero() = 0\n";
    const { session } = sessionOf({ "/main.hex": source });
    const past = at(source, "zero") + "zero".length;
    expect(session.codeActions("/main.hex", { start: past, end: past })
      .map(({ title }) => title)).toEqual(["Infer return type"]);
  });
});

describe("code actions: infer return type", () => {
  test("writes the inferred type after the parameter list", () => {
    const source = [
      "export union Colour =",
      "    | Red",
      "    | Green",
      "",
      "export fun brighten(colour: Colour) = colour",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "brighten"));
    expect(action.title).toBe("Infer return type");
    expect(action.diagnostic.message).toContain("requires a complete signature");
    expect(applied(source, action)).toContain(
      "export fun brighten(colour: Colour): Colour = colour",
    );
    // The repair is gone from the diagnostics of the file it edits.
    session.setFile("/main.hex", applied(source, action));
    expect(session.diagnostics("/main.hex")).toEqual([]);
  });

  test("keeps the spelling of a type variable the signature already wrote", () => {
    const source = "export fun listOf(value: a) = [value]\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "listOf"));
    expect(applied(source, action)).toBe("export fun listOf(value: a): Vector(a) = [value]\n");
  });

  test("mints a name for a variable no annotation spells, avoiding the ones taken", () => {
    // `first` is written, so the result's own variable cannot be `a` — writing
    // it would say the two are the same type, which they are not.
    const source = "export fun pair(first: a, second) = (second, first)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "pair"));
    expect(applied(source, action)).toBe(
      "export fun pair(first: a, second): (b, a) = (second, first)\n",
    );
  });

  test("parenthesizes a lambda that wrote no parameter list", () => {
    const source = "export let twice = x => (x, x)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "twice"));
    expect(applied(source, action)).toBe("export let twice = (x): (a, a) => (x, x)\n");
  });

  test("parenthesizes a destructured parameter around all of it", () => {
    // A record pattern carries an `=` of its own, and the parameter list starts
    // where the lambda does — not at the last `=` before the arrow, which is
    // inside the pattern and would put the open parenthesis in the middle of it.
    const source = "export let get = {a = p} => p\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "get"));
    expect(applied(source, action)).toBe("export let get = ({a = p}): a => p\n");
  });

  test("parenthesizes a constructor pattern, which ends in a parenthesis of its own", () => {
    // A parameter is a pattern, and this one closes with `)` without there
    // being a parameter list at all. Reading that `)` as the list's produced
    // `Box(v): a => v`, which is not a program.
    const source = [
      "export union Box(a) =",
      "    | Box(value: a)",
      "",
      "export let ff = Box(v) => v",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "ff ="));
    expect(applied(source, action)).toContain("export let ff = (Box(v)): a => v");
  });

  test("adds no parentheses to a parameter that already has them", () => {
    // `((x, y))` is one tuple-destructured parameter (Functions §3.1): the outer
    // parentheses are the parameter list and are already there.
    const source = "export let fst = ((x, y)) => x\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "fst"));
    expect(applied(source, action)).toBe("export let fst = ((x, y)): a => x\n");
  });

  test("writes a zero-parameter signature after its empty parentheses", () => {
    const source = "export fun zero() = 0\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "zero"));
    expect(applied(source, action)).toBe("export fun zero(): Int = 0\n");
  });

  test("leaves a comment between the parameters and the body where it was", () => {
    const source = "export fun zero() (* why *) = 0\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "zero"));
    expect(applied(source, action)).toBe("export fun zero(): Int (* why *) = 0\n");
  });

  test("writes a function type with the parentheses that keep its arity", () => {
    // `((Int, Int) -> Int, …)` is a two-element tuple of two-parameter
    // functions. Dropping either pair of parentheses says something else.
    const source = "export fun both(f: (Int, Int) -> Int) = (f, f)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "both"));
    expect(applied(source, action)).toBe(
      "export fun both(f: (Int, Int) -> Int): ((Int, Int) -> Int, (Int, Int) -> Int) = (f, f)\n",
    );
  });

  test("writes the empty tuple by its name", () => {
    // Products §2.7 (#159): the type is `Unit`, and `()` in type notation is a
    // zero-parameter domain rather than a type.
    const source = "export fun nothing() = ()\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "nothing"));
    expect(applied(source, action)).toBe("export fun nothing(): Unit = ()\n");
  });

  test("spells an aliased import by the name this module bound", () => {
    const helper = ["export union Colour =", "    | Red", "    | Green", ""].join("\n");
    const source = [
      'import {Colour as Shade, Red} from "./helper"',
      "",
      "export fun pick() = Red",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/helper.hex": helper, "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "pick"));
    expect(applied(source, action)).toContain("export fun pick(): Shade = Red");
  });

  test("spells an imported record, whose name is a type and a constructor", () => {
    // `import {Point}` binds both namespaces at once (Modules §3.1), so the
    // clause carries a value symbol *and* names a type. Reading the symbol as
    // "this is not a type import" made every imported record unspellable.
    const helper = "export record Point = {x: Int, y: Int}\n";
    const source = ['import {Point} from "./helper"', "", "export fun same(p: Point) = p", ""]
      .join("\n");
    const { session } = sessionOf({ "/helper.hex": helper, "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "same"));
    expect(applied(source, action)).toContain("export fun same(p: Point): Point = p");
  });

  test("qualifies a type reached only through a namespace import", () => {
    const helper = ["export union Colour =", "    | Red", "    | Green", ""].join("\n");
    const source = [
      'import * as Palette from "./helper"',
      "",
      "export fun pick() = Palette.Red",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/helper.hex": helper, "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "pick"));
    expect(applied(source, action)).toContain("export fun pick(): Palette.Colour = Palette.Red");
  });

  test("picks one spelling when a type is reachable under two aliases", () => {
    // Two namespace imports of one module make one identity reachable twice.
    // Either name would compile; answering the same request differently on two
    // runs would not, so the first is kept.
    const helper = ["export union Colour =", "    | Red", "    | Green", ""].join("\n");
    const source = [
      'import * as Palette from "./helper"',
      'import * as Shades from "./helper"',
      "",
      "export fun pick() = Palette.Red",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/helper.hex": helper, "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "pick"));
    expect(applied(source, action)).toContain("export fun pick(): Palette.Colour = Palette.Red");
  });

  test("refuses a built-in spelling the module has declared over", () => {
    // `Unit` is supplied by the language rather than by a module, so there is no
    // identity to look up and nothing but this stops `: Unit` naming the union
    // declared above — which typechecks against nothing and reports the
    // memorable `expected Unit, found Unit`.
    const source = ["union Unit =", "    | U", "", "export fun v() = ()", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "v"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toContain("this module declares its own `Unit`");
  });

  test("a type alias takes the name too, though nothing can be spelled as one", () => {
    // `type Unit = Int` is accepted and silently makes `Unit` mean `Int` here.
    const source = ["type Unit = Int", "", "export fun v() = ()", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(sole(actionsOn(session, "/main.hex", source, "v")).disabled)
      .toContain("this module declares its own `Unit`");
  });

  test("and takes it from a prelude type as surely as a union would", () => {
    // The same occlusion, on the other kind of spelling: an alias named
    // `Option` is what `Option` means here, so the prelude's has no name.
    const source = ["type Option = Int", "", "export fun some(value: Int) = Some(value)", ""]
      .join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(sole(actionsOn(session, "/main.hex", source, "some")).disabled)
      .toContain("`Option` is declared in another module and this one has no name for it");
  });

  test("prefers the prelude's bare spelling", () => {
    const source = "export fun some(value: a) = Some(value)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "some"));
    expect(applied(source, action)).toBe("export fun some(value: a): Option(a) = Some(value)\n");
  });

  test("refuses a type this module has no name for, and says which", () => {
    // The constructor is imported and the type is not, so the value is writable
    // here and its type is not: exactly the case a silent insertion would break.
    const helper = ["export union Colour =", "    | Red", "    | Green", ""].join("\n");
    const source = ['import {Red} from "./helper"', "", "export fun pick() = Red", ""].join("\n");
    const { session } = sessionOf({ "/helper.hex": helper, "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "pick"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toContain("`Colour` is declared in another module");
  });

  test("will not spell a prelude type under a name the module has taken", () => {
    // Modules §5.4: a module may declare its own `Option`, which occludes the
    // prelude's. `Some` still builds the prelude's, and writing `Option(Int)`
    // here would name the union declared two lines up — a different type, and
    // no diagnostic would say the annotation had moved.
    const source = [
      "union Option =",
      "    | Nothing",
      "",
      "export fun some(value: Int) = Some(value)",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "some"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toContain("`Option` is declared in another module");
  });

  test("offers nothing for a function that already writes its return type", () => {
    const source = "export fun zero(): Int = 0\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(actionsOn(session, "/main.hex", source, "zero")).toEqual([]);
  });

  test("a declared type parameter is a name minting must not take", () => {
    // `<a>` is declared and never written in a parameter, so nothing pairs it
    // with a variable — but it is bound, and reusing it would say the result is
    // the type the caller chooses.
    const source = "export fun hold<a>(value) = (value, value)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "hold"));
    expect(applied(source, action)).toBe("export fun hold<a>(value): (b, b) = (value, value)\n");
  });

  test("offers nothing on a private function's own error", () => {
    // A private declaration can carry a diagnostic on its name — this one is
    // rebound — and that is not an invitation to write a signature nothing
    // asked for.
    const source = ["let same(x: Int) = x", "let same(y: Int) = y", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toHaveLength(1);
    expect(actionsOn(session, "/main.hex", source, "same", 2)).toEqual([]);
  });

  test("offers nothing for a private function, which needs no signature", () => {
    // Modules §4.1.1 asks for a complete signature at the module boundary only,
    // so there is no error here and nothing to repair.
    const source = ["let helper(x: Int) = x + 1", "export fun use(x: Int): Int = helper(x)", ""]
      .join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toEqual([]);
    expect(actionsOn(session, "/main.hex", source, "helper")).toEqual([]);
  });

  test("still offers the return type when parameter types are missing too", () => {
    // One diagnostic asks for both; this answers half of it, and the half it
    // answers must be right. The message that remains no longer says "return".
    const source = "export fun identity(value) = value\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "identity"));
    const repaired = applied(source, action);
    expect(repaired).toBe("export fun identity(value): a = value\n");
    session.setFile("/main.hex", repaired);
    expect(session.diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "exported function `identity` requires a complete signature; add type for parameter `value`",
    ]);
  });

  test("is offered once when two diagnostics caret the same declaration", () => {
    // A missing signature and an undeclared constraint both point at the name.
    const source = "export fun double(value) = value + value\n";
    const { session } = sessionOf({ "/main.hex": source });
    const messages = session.diagnostics("/main.hex").map(({ message }) => message);
    expect(messages.length).toBeGreaterThan(1);
    expect(sole(actionsOn(session, "/main.hex", source, "double")).title)
      .toBe("Infer return type");
  });

  test("leaves the session's own analysis untouched", () => {
    const source = "export fun zero() = 0\n";
    const { session } = sessionOf({ "/main.hex": source });
    const settled = session.version;
    actionsOn(session, "/main.hex", source, "zero");
    // Verification compiles an edited copy. Doing that on the real file set
    // would leave the user's session holding text they never typed.
    expect(session.version).toBe(settled);
    expect(session.diagnostics("/main.hex")).toHaveLength(1);
  });

  test("waits while the body has an error, rather than writing what it inferred", () => {
    // Inference does not stop at an unknown name: it produces a variable, so the
    // repair on offer would be `: a` — true of the broken text and wrong the
    // moment the name is fixed, at which point the rigid annotation is what gets
    // blamed.
    const source = "export fun bad() = missingName(1)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "bad"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "the body of `bad` has an error to fix first: unknown name `missingName`",
    );

    // The same error at the body's last character, where it ends exactly where
    // the declaration does. Both edges of the region are edges something lands
    // on: an error at the body's first character is the ordinary case above.
    const ending = "export fun bad(x: Int) = missingName\n";
    const { session: other } = sessionOf({ "/main.hex": ending });
    expect(sole(actionsOn(other, "/main.hex", ending, "bad")).disabled)
      .toBe("the body of `bad` has an error to fix first: unknown name `missingName`");
  });

  test("does not claim an error is about the type when it is about the text", () => {
    // A JavaScript-spelled comment is an error inside the body whose own repair
    // is offered right beside this one, and the body's type — `Int` — is not in
    // question. Saying "its type is not settled" would be a causal claim the
    // compiler contradicts; what is true is only that there is something to fix.
    const source = "export fun m(x: Int) = 1 /* c */ + 2\n";
    const { session } = sessionOf({ "/main.hex": source });
    const actions = actionsOn(session, "/main.hex", source, "m(");
    expect(actions.map(({ title }) => title)).toEqual(["Infer return type"]);
    expect(actions[0]!.disabled).toMatch(/^the body of `m` has an error to fix first: /);
  });

  test("waits for a declaration the parser could not carry on past", () => {
    // The other way a declaration stops: nothing is left *open*, the parser
    // simply could not take what came next and abandoned it. `#parseItems`
    // accepts `VSep`, `Semicolon`, `VClose` or the end after an item, and this
    // asks layout the same question — so the first of these, which types as
    // `Int`, is seen for what it is: a `(Int, Int)` missing its open paren.
    //
    // Each is here with a newline in it as well, because that is where the
    // rules that guessed at this went wrong: a comma or a closer at the start
    // of a line is an `expressionContinuations` token, so layout emits no
    // separator before it and the two spellings are one event.
    for (const source of [
      "export fun m(x: Int, y: Int) = x, y)\n",
      "export fun m(x: Int, y: Int) = x\n, y)\n",
      'export fun m(x: Int) = x) ++ "a"\n',
      'export fun m(x: Int) = x\n  ) ++ "a"\n',
      "export fun m(x: Int) = 1 else 2\n",
      "export fun m(x: Int) =\n    let y: Int = x\n    y, 2\n",
      "export fun m(x: Int) =\n    let y: Int = x\n    y\n    , 2\n",
      // The same event under an *indented* body, which is the shape most
      // functions have. A declaration's span ends at its body's last item, not
      // at the closer layout puts after it, so asking about the token straight
      // after the span asked at the wrong depth and answered "settled" for
      // every one of these.
      'export fun m(x: Int) =\n    x\n) ++ "a"\n',
      "export fun m(x: Int, y: Int) =\n    x\n, y)\n",
      "export fun m(x: Int) =\n    match x\n        _ => 1\n) ++ 2\n",
      "export fun m(x: Int) =\n    let y: Int = x + 1\n    y\n)\nexport fun g(): Int = 2\n",
      // The same event with nothing after it to make it look worse. Refusing
      // here is a decision, not an accident: no test on token positions can
      // tell this from the line above, since they differ only in what follows
      // the token the parser stopped at.
      "export fun m(x: Int) = 1\n}\n",
      "export fun m(x: Int) = 1\n\n\n(* note *)\n)\n",
      "export fun m(x: Int) =\n    1\n}\n",
    ]) {
      const { session } = sessionOf({ "/main.hex": source });
      const action = sole(actionsOn(session, "/main.hex", source, "m("));
      expect(action.edits, source).toEqual([]);
      expect(action.disabled, source).toBe(
        "the parser could not carry on past `m`, so its type is not settled yet",
      );
    }
  });

  test("but a declaration that ended where one may end still gets its repair", () => {
    // A `;` is a separator, so the item ended; `@@@` does not lex, so nothing
    // was abandoned; a new declaration at the block's own column gets its `VSep`
    // and a deeper-indented line is a continuation of this one; and the last
    // declaration in a file ends at layout's `VClose`.
    for (const source of [
      "export fun m(x: Int) = 1;\n",
      "export fun m(x: Int) = 1; export fun g(): Int = 2\n",
      "export fun m(x: Int) = 1 @@@\n",
      "export fun m(x: Int) = 1\n@@@\nexport fun g(): Int = 2\n",
      "export fun m(x: Int) = 1\nexport fun g(): Int = 2\n",
      "export fun m(x: Int) = 1\n    + 2\n",
      "export fun m(x: Int) = {\n    a = 1,\n    b = 1,\n}.a\n",
      "export fun m(x: Int) = 1",
      // Indented bodies of every shape, where the closers layout emits for the
      // blocks the declaration opened sit between it and the parser's decision.
      "export fun m(x: Int) =\n    let y: Int = x\n    y\n",
      "export fun m(x: Int) =\n    let y: Int = x\n    y\nexport fun g(): Int = 2\n",
      "export fun m(x: Int) =\n    let y: Int =\n        let z: Int = x\n        z\n    y\n",
      "export fun m(x: Int) =\n    if x > 0 then\n        1\n    else\n        2\n",
      "export fun m(x: Int) = match x\n    _ => 1\nexport fun g(): Int = 2\n",
      "export fun m(x: Int) =\n    let y: Int = x\n    y",
    ]) {
      const { session } = sessionOf({ "/main.hex": source });
      const action = sole(actionsOn(session, "/main.hex", source, "m("));
      expect(action.disabled, source).toBeUndefined();
      expect(applied(source, action), source).toContain("export fun m(x: Int): Int =");
    }
  });

  test("waits for a body that never closed, wherever the parser reported it", () => {
    // The one the diagnostics cannot answer. A body that stops parsing takes
    // the report with it: `#parseItems` carets whatever token it stopped on and
    // then synchronizes *forward*, so the complaint lands on the next
    // declaration's first keyword — or at the end of the file when there is no
    // next declaration. Both are outside this declaration, and neither is
    // distinguishable by position from a complaint about the file. The unclosed
    // bracket is, and it is in this declaration's own text.
    for (const [source, named] of [
      // Last in the file, and followed by another — the two the report lands in
      // completely different places for.
      ["export fun m(x: Int) = {a = x\n", "{"],
      ["export fun m(x: Int) = {a = x\nexport fun n(): Int = 1\n", "{"],
      ["export fun m(x: Int) = [x\nexport fun n(): Int = 1\n", "["],
      // The innermost is the one named: `[` is context, `{` is where the
      // cursor is.
      ["export fun m(x: Int) = [{a = x\n", "{"],
    ] as const) {
      const { session } = sessionOf({ "/main.hex": source });
      const action = sole(actionsOn(session, "/main.hex", source, "m("));
      expect(action.edits, source).toEqual([]);
      expect(action.disabled, source).toBe(
        `the body of \`m\` has an unclosed \`${named}\`, so its type is not settled yet`,
      );
    }
  });

  test("waits for a parameter list that never closed, and says which it is", () => {
    // Not a broken type — a missing place to put one. The body here is settled;
    // `x` is an ordinary expression. What is missing is the `)` the return
    // annotation has to follow (Functions §4.1), and writing the colon anyway
    // produced `f(x: Int: Int = x`.
    const source = "export fun f(x: Int = x\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "f("));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "`f` has no closed parameter list to write a return type after",
    );
  });

  test("text between two declarations belongs to neither of their bodies", () => {
    // A lexer error produces no declaration, so it falls in the gap after this
    // one — but `mm`'s body is `1`, its brackets balance, and its type is
    // settled. Reported *after* the declaration, exactly like the recovery
    // report above, and it is not this declaration's problem.
    const source = ["export fun mm(x: Int) = 1", "@@@", "export fun nn(y: Int): Int = y", ""]
      .join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "mm"));
    expect(action.disabled).toBeUndefined();
    expect(applied(source, action)).toContain("export fun mm(x: Int): Int = 1");
  });

  test("the next declaration's own half-typed body is not this one's problem", () => {
    // Typing a new function under a finished one. The unclosed brace is in
    // `nn`'s text, not `mm`'s, and `mm` still has a repair to offer.
    const source = ["export fun mm(x: Int) = 1", "export fun nn(y: Int) = {a = y", ""].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "mm"));
    expect(action.disabled).toBeUndefined();
    expect(applied(source, action)).toContain("export fun mm(x: Int): Int = 1");
    expect(sole(actionsOn(session, "/main.hex", source, "nn")).disabled)
      .toContain("has an unclosed `{`");
  });

  test("a brace inside a string is not an unclosed brace", () => {
    // A string is one token however much punctuation it holds, and an
    // interpolation's tokens are nested inside it.
    const source = 'export fun f(x: Int) = "a{b${x}"\n';
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "f("));
    expect(applied(source, action)).toBe('export fun f(x: Int): String = "a{b${x}"\n');
  });

  test("an error on either side of the declaration is not the body's", () => {
    // The region has two edges and both are wrong if either is: an error before
    // this body, and one in the declaration after it, are neither of them this
    // one's.
    const source = [
      "let before: Int = missingOne",
      "export fun zero() = 0",
      "let after: Int = missingTwo",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex")).toHaveLength(3);
    const action = sole(actionsOn(session, "/main.hex", source, "zero"));
    expect(action.disabled).toBeUndefined();
    expect(applied(source, action)).toContain("export fun zero(): Int = 0");
  });

  test("refuses when the written type would collide with one the body declares", () => {
    // `z` is a declared type variable inside the body, and the result is that
    // same variable — but nothing pairs the two, so the annotation would be
    // minted as `a` and the checker would then have two distinct declared
    // variables where the body needs one. Caught by compiling the edit.
    const source = ["export fun keep(value) =", "    let held: z = value", "    held", ""]
      .join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "keep"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toContain("writing `: a` would break `/main.hex`");
    expect(action.disabled).toContain("distinct declared type variables");
  });

  test("a diagnostic that quotes a column is not read as new when the edit moves it", () => {
    // The unterminated comment belongs to the declaration *after* this one, so
    // it does not hold the repair up — but it names the column it opened at, and
    // inserting five characters earlier on the line moves that column. Compared
    // by message, the same pre-existing error would look like one the edit
    // caused, and the repair would be refused for breaking nothing.
    const source = "export fun m(x: Int) = 1; export let y: Int = 2 (* oops\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(session.diagnostics("/main.hex").map(({ message }) => message))
      .toContain("unterminated block comment; opened at line 1, column 49");
    const action = sole(actionsOn(session, "/main.hex", source, "m"));
    expect(action.disabled).toBeUndefined();
    expect(applied(source, action)).toContain("export fun m(x: Int): Int = 1;");
  });

  test("refuses an annotation that would silently change the type", () => {
    // The one that justifies compiling before offering. `{...a}` is an *open*
    // record inferred, and closed the moment it is written: the function goes
    // from taking any record to taking only the empty one, and not one
    // diagnostic anywhere says so.
    const source = "export fun copy(r) = {...r}\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "copy"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "writing `: {...a}` would change the type of `copy` from `{...a} -> {...a}` to `{} -> {}`",
    );
  });
});
