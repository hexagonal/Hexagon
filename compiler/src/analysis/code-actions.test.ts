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

  test("the retired console form offers its rewrite for one argument only", () => {
    const single = 'console.log("hello")\n';
    const { session } = sessionOf({ "/main.hex": single });
    const action = sole(actionsOn(session, "/main.hex", single, "console"));
    expect(action.title).toBe("write `log`");
    expect(applied(single, action)).toBe('log("hello")\n');

    // Two arguments have no mechanical rewrite — `log` takes one rendered
    // `String`, and the interpolation is the writer's — so the report stands
    // alone.
    const several = 'console.log("hello", 42)\n';
    session.setFile("/main.hex", several);
    expect(actionsOn(session, "/main.hex", several, "console")).toEqual([]);
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
    //
    // This closes `touches` and nothing further: `codeActions` hands the
    // *diagnostic's* start offset to `functionAt`, never the caret, so the
    // inclusive end of the binding span in `functionAt` is not what this test
    // exercises and moving it will not fail here.
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
    expect(action.diagnostic?.message).toContain("requires a complete signature");
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
    // `first` is written, so the empty vector's element cannot be `a` — writing
    // it would say the two are the same type, which they are not.
    const source = "export fun pair(first: a) = (first, [])\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "pair"));
    expect(applied(source, action)).toBe(
      "export fun pair(first: a): (a, Vector(b)) = (first, [])\n",
    );
  });

  test("parenthesizes a lambda that wrote no parameter list", () => {
    const source = "export let twice = x => (1, 2)\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "twice"));
    expect(applied(source, action)).toBe("export let twice = (x): (Int, Int) => (1, 2)\n");
  });

  test("parenthesizes a destructured parameter around all of it", () => {
    // A record pattern carries an `=` of its own, and the parameter list starts
    // where the lambda does — not at the last `=` before the arrow, which is
    // inside the pattern and would put the open parenthesis in the middle of it.
    const source = "export let get = {a = p} => 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "get"));
    expect(applied(source, action)).toBe("export let get = ({a = p}): Int => 1\n");
  });

  test("parenthesizes a constructor pattern, which ends in a parenthesis of its own", () => {
    // A parameter is a pattern, and this one closes with `)` without there
    // being a parameter list at all. Reading that `)` as the list's produced
    // `Box(v): Int => 1`, which is not a program.
    const source = [
      "export union Box(a) =",
      "    | Box(value: a)",
      "",
      "export let ff = Box(v) => 1",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "ff ="));
    expect(applied(source, action)).toContain("export let ff = (Box(v)): Int => 1");
  });

  test("adds no parentheses to a parameter that already has them", () => {
    // `((x, y))` is one tuple-destructured parameter (Functions §3.1): the outer
    // parentheses are the parameter list and are already there.
    const source = "export let fst = ((x, y)) => 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "fst"));
    expect(applied(source, action)).toBe("export let fst = ((x, y)): Int => 1\n");
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
    // `<a>` is declared and written in no parameter, so nothing pairs it with a
    // variable — it is reserved by the declaration alone. Reusing it for the
    // empty vector's element would say that element is the type the caller
    // chooses, which it is not.
    const source = "export fun hold<a>(value: Int) = []\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "hold"));
    expect(applied(source, action)).toBe("export fun hold<a>(value: Int): Vector(b) = []\n");
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

  test("waits when the result stands on a parameter that has no type yet", () => {
    // One diagnostic asks for the parameter type and the return type together,
    // and it carries `incompleteSignature` either way — so the mark that lets
    // the return half through would let this through too. Asked of the tree
    // instead: `value` has no annotation, so its type is a fresh variable, and
    // the result *is* that variable.
    const source = "export fun identity(value) = value\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "identity"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "`value` has no type yet, so the result type of `identity` is not settled",
    );

    // What refusing buys. `: a` reads as right until the parameter is written,
    // and then it is the annotation that gets blamed.
    const written = "export fun identity(value: Int): a = value\n";
    const { session: after } = sessionOf({ "/main.hex": written });
    expect(after.diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; " +
        "change the annotation to `Int`, or remove it to let the type be inferred",
    ]);
  });

  test("a bare parameter the result does not stand on is no reason to wait", () => {
    // The borrowing is what decides, not the missing annotation. `1` is `Int`
    // however `x` is eventually typed, so the repair is right under every
    // completion and refusing would give it up for nothing.
    const source = "export fun m(x) = 1\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "m("));
    expect(applied(source, action)).toBe("export fun m(x): Int = 1\n");
  });

  test("the result borrows through whatever wraps it", () => {
    // A test on the result type alone — is it a variable? — would let every one
    // of these through, and each is a different arm of the walk that finds the
    // variables a result mentions. One wrong annotation per arm otherwise.
    const wrappings: readonly [string, string][] = [
      ["export fun m(x) = [x]\n", "Vector"],
      ["export fun m(x) = (x, 1)\n", "tuple"],
      ["export fun m(x) = {a = x}\n", "record field"],
      ["export fun m(x) = Some(x)\n", "union argument"],
      ["export fun m(x) = () => x\n", "function result"],
      ["export fun m(x) = {...x}\n", "record row"],
      ["export fun m(x) = Map.set(Map.empty, x, 1)\n", "map key"],
      ["export fun m(x) = Map.set(Map.empty, 1, x)\n", "map value"],
      // The variable is in the returned function's *parameter*, and nowhere in
      // its result: walking only what a function returns would miss it.
      ["export fun m(x) = (y) => x == y\n", "function parameter"],
    ];
    for (const [source, wrapping] of wrappings) {
      const { session } = sessionOf({ "/main.hex": source });
      expect(sole(actionsOn(session, "/main.hex", source, "m(")).disabled, wrapping)
        .toBe("`x` has no type yet, so the result type of `m` is not settled");
    }
  });

  test("the refusal names the parameter that would settle it", () => {
    // `x` is bare too, and is not why. Sending the user to the wrong word is
    // worse than saying nothing, because they annotate it and nothing changes.
    const source = "export fun m(x, y) = [y]\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(sole(actionsOn(session, "/main.hex", source, "m(")).disabled)
      .toBe("`y` has no type yet, so the result type of `m` is not settled");
  });

  test("a nullable result is walked like any other wrapper", () => {
    // `Nullable(a)` is ordinary source syntax — the `?` spelling is what does
    // not lex in this slice, which is a different claim — so a result can be
    // one, and the arm that walks it is as load-bearing as the rest.
    const source = ["export fun m(x, y: Int) =", "    let z: Nullable(a) = x", "    z", ""]
      .join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    expect(sole(actionsOn(session, "/main.hex", source, "m(")).disabled)
      .toBe("`x` has no type yet, so the result type of `m` is not settled");

    // Written on the parameter, it is the user's own and is offered.
    const annotated = "export fun m(x: Nullable(a), y) = x\n";
    const { session: paired } = sessionOf({ "/main.hex": annotated });
    expect(applied(annotated, sole(actionsOn(paired, "/main.hex", annotated, "m("))))
      .toBe("export fun m(x: Nullable(a), y): Nullable(a) = x\n");
  });

  test("a variable the user already wrote is not one to wait for", () => {
    // `y` is bare, so something is unwritten — but `Vector(a)` is spelled out of
    // the `a` the user put on `x`, and is the answer under every completion of
    // `y`. Waiting here would give up a repair for nothing: the mismatch a bad
    // completion produces is reported identically with the annotation and
    // without it, so writing it moves no blame.
    const source = "export fun m(x: a, y) = [x, y]\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "m("));
    expect(applied(source, action)).toBe("export fun m(x: a, y): Vector(a) = [x, y]\n");

    // Same signature, and the result is the *bare* parameter's variable instead.
    const other = "export fun m(x: a, y) = [y]\n";
    const { session: waits } = sessionOf({ "/main.hex": other });
    expect(sole(actionsOn(waits, "/main.hex", other, "m(")).disabled)
      .toBe("`y` has no type yet, so the result type of `m` is not settled");
  });

  test("borrowing is not always containment: a constraint's implied type", () => {
    // The reading that first suggests itself — does the result contain the
    // parameter's own variable? — is too narrow to be safe. An implied type
    // member (Collections Part 2 §5) makes the result a projection variable
    // that appears in no parameter's type at all, while being wholly determined
    // by one: `x` is one fresh variable and the result is another, unified only
    // once the subject reaches a concrete instance.
    const source = [
      "constraint Source<a> =",
      "    type Item",
      "    get(value: a): Item",
      "",
      "export record Box = {value: Int}",
      "",
      "honor Source<Box> =",
      "    type Item = Int",
      "    get(box: Box) = box.value",
      "",
      "export fun peek(x) = get(x)",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    // No parameter's type mentions the projection, so there is no parameter to
    // send the user to and the sentence stays general. Annotating `x` does not
    // settle it either — see #190, which is why this reaches only the bare
    // case and the all-annotated one is still open.
    expect(sole(actionsOn(session, "/main.hex", source, "peek")).disabled)
      .toBe("the signature of `peek` is not complete yet, so its result type is not settled");

    // And what it averts: the projection is `Int`, so `: a` is blamed as soon
    // as the parameter is written — and the user has no generic completion to
    // reach for, because a binder may not carry a projection in this slice.
    const written = source.replace("export fun peek(x) = get(x)", "export fun peek(x: Box): a = get(x)");
    const { session: after } = sessionOf({ "/main.hex": written });
    expect(after.diagnostics("/main.hex").map(({ message }) => message))
      .toContain(
        "`a` is a declared type variable, but the body requires `Int`; " +
          "change the annotation to `Int`, or remove it to let the type be inferred",
      );
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

  test("waits while the signature has an error, because a half-typed type is a variable", () => {
    // The trap this exists for. `I` is a user two keystrokes into `Int`, and the
    // checker does not stop there: it gives `x` a fresh variable, so the result
    // generalizes and the repair on offer is `: Vector(a)`. That is not wrong
    // about the text on screen and is wrong about the text being typed towards.
    const source = "export fun m(x: I) = [x]\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "m("));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "the signature of `m` has an error to fix first: " +
        "unknown type `I`; this slice supports primitive, tuple, and declared union types",
    );

    // What refusing buys, stated as the thing that would otherwise happen: had
    // the annotation been written, finishing the word would blame the signature.
    const written = "export fun m(x: Int): Vector(a) = [x]\n";
    const { session: after } = sessionOf({ "/main.hex": written });
    expect(after.diagnostics("/main.hex").map(({ message }) => message)).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; " +
        "change the annotation to `Int`, or remove it to let the type be inferred",
    ]);
  });

  test("a later parameter's type is as much the signature as the first one's", () => {
    const source = "export fun m(x: Int, y: Bogus) = x\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(sole(actionsOn(session, "/main.hex", source, "m(")).disabled)
      .toMatch(/^the signature of `m` has an error to fix first: unknown type `Bogus`/);
  });

  test("an error caret-ing the name is not thereby about the missing signature", () => {
    // The trap in the *other* direction. Plenty of errors report at a
    // declaration's name, and only the ones marked `incompleteSignature` are
    // answered by writing one. A rebinding conflict leaves the body's type
    // unresolved — `m(y)` cannot be settled while `m` means two things — so the
    // repair would be `: a`, rigid and wrong the moment the conflict is.
    const source = "export fun m(x: Int) = [x]\nexport fun m(y) = [m(y)]\n";
    const { session } = sessionOf({ "/main.hex": source });
    const second = source.indexOf("m(y)");
    const conflict = session.diagnostics("/main.hex")
      .find(({ message }) => message.includes("already bound"));
    expect(conflict?.primary.start.offset).toBe(second);
    const action = sole(session.codeActions("/main.hex", { start: second, end: second }));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toMatch(/^the signature of `m` has an error to fix first: /);
  });

  test("the two errors that caret the name are not reasons to refuse", () => {
    // Both are the absence of the very thing being written — the missing
    // signature this answers, and the undeclared constraint that comes with it —
    // so a check on the whole declaration has to step over exactly them.
    //
    // This pins that they are stepped over, not where the step ends: widening
    // the skip past the name changes no answer, because reaching that character
    // means the parser failed on the header and then there is no function here
    // to ask about. `export fun m) = 0` reports at exactly that offset and
    // offers nothing at all.
    const source = "export fun double(value: a) = value + value\n";
    const { session } = sessionOf({ "/main.hex": source });
    const messages = session.diagnostics("/main.hex").map(({ message }) => message);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatch(/must declare every constraint/);
    const action = sole(actionsOn(session, "/main.hex", source, "double"));
    expect(action.disabled).toBeUndefined();
    expect(applied(source, action)).toBe("export fun double(value: a): a = value + value\n");
  });

  test("an error in another declaration is not this declaration's to wait on", () => {
    // The region is one declaration's. A file with a mistake elsewhere is the
    // ordinary state of a file being worked on, and refusing everywhere while
    // anything anywhere is broken would make the repair unreachable in practice.
    const source = "export fun m(x: Int) = [x]\nlet helper(y: Bogus) = y\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "m("));
    expect(action.disabled).toBeUndefined();
    expect(applied(source, action)).toBe(
      "export fun m(x: Int): Vector(Int) = [x]\nlet helper(y: Bogus) = y\n",
    );
  });

  test("a type the checker gave up on is refused rather than spelled", () => {
    // `helper` has an error, so its result is the checker's `Error` type, and
    // `size` inherits it through the call. There is no source text for that —
    // rendering it as `?` would put a character in the file that does not lex —
    // and it is reachable only from *another* declaration, since an error in
    // this one is refused before the type is ever spelled.
    const source = "let helper(x: Int) = missingName\nexport fun size(v: Int) = helper(v)\n";
    const { session } = sessionOf({ "/main.hex": source });
    expect(sole(actionsOn(session, "/main.hex", source, "size")).disabled).toBe(
      "the return type of `size` cannot be written here: " +
        "part of the inferred type is unknown, because the definition has an error",
    );
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

  // Fourteen sessions, each a full project compile. Given an explicit budget with
  // #344's last landing: `Float.hex` and `String.hex` joined the prelude, so
  // every one of those compiles carries two more modules, and at ~3s alone the
  // test had no room left in the default 5s under the full suite's parallel
  // load. Explicit per test rather than a global testTimeout, so the rest of the
  // file keeps the tight default.
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
  }, 30_000);

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

  test("a body-declared variable reaches the result through the parameter", () => {
    // This was the case that showed compiling the edit to be load-bearing: `z`
    // is declared in the body and is the result, nothing paired the two, so the
    // annotation minted `a` and the checker then had two distinct declared
    // variables where the body needed one.
    //
    // It is now refused a step earlier, because the rigid `z` reaches the
    // result by way of `value`. Verification still has its own reaching inputs
    // — see the open-record test below — so this moved rather than removed the
    // cover.
    const source = ["export fun keep(value) =", "    let held: z = value", "    held", ""]
      .join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "keep"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "`value` has no type yet, so the result type of `keep` is not settled",
    );

    // Written, it pairs, and the repair is the user's own spelling.
    const annotated = ["export fun keep(value: z) =", "    let held: z = value", "    held", ""]
      .join("\n");
    const { session: paired } = sessionOf({ "/main.hex": annotated });
    expect(applied(annotated, sole(actionsOn(paired, "/main.hex", annotated, "keep"))))
      .toContain("export fun keep(value: z): z =");
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

  test("an open record's row is a borrowing like any other", () => {
    // `{...a}` is an *open* record inferred, and closed the moment it is
    // written: the function goes from taking any record to taking only the
    // empty one, with no diagnostic anywhere saying so. Directly, the row comes
    // from `r` and the bare-parameter check gets there first — which is why the
    // walk has to count a record's tail and not only its fields.
    const source = "export fun copy(r) = {...r}\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "copy"));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "`r` has no type yet, so the result type of `copy` is not settled",
    );

    // Annotated, the row is the user's own and writing it closes nothing.
    const annotated = "export fun copy(r: {...a}) = {...r}\n";
    const { session: paired } = sessionOf({ "/main.hex": annotated });
    expect(applied(annotated, sole(actionsOn(paired, "/main.hex", annotated, "copy"))))
      .toBe("export fun copy(r: {...a}): {...a} = {...r}\n");
  });

  test("refuses an annotation that would silently change the type", () => {
    // The one that justifies compiling before offering, and it is *not* reached
    // through a bare parameter: the open row lives under an arrow rather than
    // being the result, so this declaration has no parameters at all and
    // nothing earlier has anything to say about it. Only writing the annotation
    // and compiling it shows the row closing.
    const source = "export fun m() = (r) => {...r}\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "m("));
    expect(action.edits).toEqual([]);
    expect(action.disabled).toBe(
      "writing `: {...a} -> {...a}` would change the type of `m` " +
        "from `() -> {...a} -> {...a}` to `() -> {} -> {}`",
    );
  });
});

describe("code actions: the variance an opaque type could declare (#205)", () => {
  test("offers the claim the representation supports", () => {
    const source = [
      "export opaque record Box(a) = { get: () -> a }",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "a) = {"));
    // Phrased in consequences, not lattice vocabulary (closure doc §8.2).
    expect(action.title).toContain("Declare `Box(+a)`");
    expect(action.title).toContain("stay polymorphic");
    // The one action that answers no diagnostic: an under-claim is not wrong,
    // Hexagon has no warning tier, and nothing reports it.
    expect(action.diagnostic).toBeUndefined();
    expect(action.kind).toBe("refactor");
    expect(applied(source, action)).toContain("export opaque record Box(+a) =");
  });

  test("applying it leaves the file clean, and the claim verified", () => {
    const source = "export opaque record Box(a) = { get: () -> a }\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "a) = {"));
    session.setFile("/main.hex", applied(source, action));
    expect(session.diagnostics("/main.hex")).toEqual([]);
    // And the offer is gone: the claim has been made.
    expect(actionsOn(session, "/main.hex", applied(source, action), "+a")).toEqual([]);
  });

  test("a contravariant representation offers the contravariant claim", () => {
    const source = "export opaque record Sink(a) = { accept: a -> Unit }\n";
    const { session } = sessionOf({ "/main.hex": source });
    const action = sole(actionsOn(session, "/main.hex", source, "a) = {"));
    expect(action.title).toContain("Declare `Sink(-a)`");
    expect(applied(source, action)).toContain("record Sink(-a)");
  });

  test("nothing is offered where there is nothing to claim", () => {
    // Invariant: the representation supports no claim. Transparent: the sigil
    // is a parse error there, so offering it would be offering an error.
    for (
      const source of [
        "export opaque record Cell(a) = { get: () -> a, put: a -> Unit }\n",
        "record Box(a) = { get: () -> a }\n",
        "export record Box(a) = { get: () -> a }\n",
        "export opaque record Tag(a) = { name: String }\n",
      ]
    ) {
      const { session } = sessionOf({ "/main.hex": source });
      expect(actionsOn(session, "/main.hex", source, "a) = {")).toEqual([]);
    }
  });

  test("the offer is scoped to the requested range", () => {
    // `underClaims` takes a span filter and the session passes `touches(span,
    // range)`. Dropping the filter left every test above green — they all ask
    // at the declaration — while a request anywhere in the file answered with
    // every under-claim in it. A client asks about the line under the cursor.
    const source = [
      "export opaque record Box(a) = { get: () -> a }",
      "",
      "export fun size(): Int = 0",
      "",
    ].join("\n");
    const { session } = sessionOf({ "/main.hex": source });
    // At the declaration: offered.
    expect(actionsOn(session, "/main.hex", source, "a) = {")).toHaveLength(1);
    // Two lines away, on an unrelated declaration: not offered.
    expect(actionsOn(session, "/main.hex", source, "Int = 0")).toEqual([]);
  });

  test("a claim already made is not offered again, right or wrong", () => {
    for (
      const source of [
        "export opaque record Box(+a) = { get: () -> a }\n",
        // Over-claimed: an error, and §6.3's report is the answer to it — not a
        // refactor offering the same claim a second time.
        "export opaque record Sink(+a) = { accept: a -> Unit }\n",
      ]
    ) {
      const { session } = sessionOf({ "/main.hex": source });
      const titles = actionsOn(session, "/main.hex", source, "a) = {")
        .map(({ title }) => title);
      expect(titles.filter((title) => title.startsWith("Declare"))).toEqual([]);
    }
  });

  test("an imported declaration's head is not this file's to edit", () => {
    const box = "export opaque record Box(a) = { get: () -> a }\n";
    const main = 'import * as B from "./box.hex"\nexport let n: Int = 1\n';
    const { session } = sessionOf({ "/box.hex": box, "/main.hex": main });
    expect(session.codeActions("/main.hex", { start: 0, end: main.length })).toEqual([]);
  });
});
