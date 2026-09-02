import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for the prelude occlusion rule (Modules §5.4;
 * `spec/notes/compiler-conformance-defects.md` defect 9).
 *
 * §5.4 grants the shadow at every binder position and reserves what it shadows:
 *
 * - A **module-level** `let`/`fun`/declaration **may occlude a prelude name** —
 *   the local one wins unqualified module-wide, and the prelude's stays reachable
 *   qualified.
 * - A **function-local sequential binder may shadow one too** (#464), for all
 *   four forms alike: `let`, `var`, `fun`, and `let`-destructuring.
 * - At either level the shadowed name is **reserved for the whole enclosing
 *   scope**: every reference in it resolves *as if the prelude did not bind the
 *   name*, so a use above the binder takes Functions §7.2's declared-later error
 *   — or §7.3's legal mutual reference inside a contiguous `fun` group — and
 *   never the prelude's meaning. One identifier, one meaning per scope.
 * - The reverse is not granted: a sequential binder still may not reuse a name
 *   from the module's *own* layers, and the test is the layer of the binding in
 *   scope, not the name's ancestry.
 *
 * The section exists precisely so that adding a name to the prelude cannot break
 * a program already using it: "adding a name to the prelude cannot break a
 * program through a binder collision."
 *
 * Two harnesses. The first substitutes its own prelude member (a project file at
 * `Result.hex` wins over the embedded copy), which is how the module-level rule
 * was pinned before the shipped prelude exported any lowercase name; it is also
 * the only way to compile *prelude source* and so to reach §5.4's prefix
 * reading. The second compiles against the real shipped prelude, where `show`,
 * `nan` and `hash` are ordinary prelude names.
 *
 * Every reservation pin carries a **control**: the same source at a name nothing
 * binds. §5.4's formulation is "resolves as if the prelude did not bind the
 * name", so any divergence from the control is the defect.
 */

/** `Result.hex` supplied by the project — the injected fallback then stands down. */
const RESULT_WITH_VALUE = [
  "/Result.hex",
  "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
  "export let combine(left: Int, right: Int): Int = left + right\n" +
  "export let tally: Int = 0\n",
] as const;

function diagnostics(entry: string, result: string = RESULT_WITH_VALUE[1]): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(1), RESULT_WITH_VALUE[0], result),
    new Source.File(Source.fileId(0), "/main.hex", entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

/**
 * The control comparison: the same program written at a prelude name and at a
 * name nothing binds must produce the same diagnostics, name for name.
 */
function sameAsControl(
  atPrelude: readonly string[],
  atFresh: readonly string[],
  preludeNames: readonly string[],
  freshNames: readonly string[],
): void {
  expect(atPrelude).toEqual(atFresh.map((message) =>
    freshNames.reduce(
      (text, fresh, index) => text.replaceAll(fresh, preludeNames[index]!),
      message,
    )
  ));
}

/**
 * `at` receives the names to use — the prelude's on one call, fresh ones on the
 * other — so the two sources differ in nothing else.
 */
function matchesControl(
  at: (...names: readonly string[]) => string,
  preludeNames: readonly string[],
  freshNames: readonly string[],
): void {
  sameAsControl(
    projectDiagnostics(at(...preludeNames)),
    projectDiagnostics(at(...freshNames)),
    preludeNames,
    freshNames,
  );
}

/** The same, where the shape needs a second module — an import's exporter. */
function matchesProjectControl(
  at: (...names: readonly string[]) => readonly (readonly [string, string])[],
  preludeNames: readonly string[],
  freshNames: readonly string[],
): void {
  const messages = (files: readonly (readonly [string, string])[]): readonly string[] =>
    compileFiles(files).diagnostics.map(({ message }) => message);

  sameAsControl(
    messages(at(...preludeNames)),
    messages(at(...freshNames)),
    preludeNames,
    freshNames,
  );
}

describe("a module-level binder may occlude a prelude value", () => {
  test("`let` occludes, and the local binding is what the module sees", () => {
    // Before the fix this reported "`tally` is already bound", because the
    // module-level `let` path looked the name up through the prelude layer
    // instead of stopping at the module's own.
    expect(diagnostics(
      "export let tally: String = \"mine\"\n" +
      "export let use: String = tally\n",
    )).toEqual([]);
  });

  test("`fun` occludes too (the half that already worked)", () => {
    expect(diagnostics(
      "export fun combine(left: String, right: String): String = left ++ right\n" +
      "export let use: String = combine(\"a\", \"b\")\n",
    )).toEqual([]);
  });

  test("an occluding `let` wins over the prelude at its own type", () => {
    // The discriminator: if the prelude binding were still winning, `use` would
    // be `Int` and this annotation would fail.
    expect(diagnostics(
      "export let combine: String = \"not a function\"\n" +
      "export let use: String = combine\n",
    )).toEqual([]);
  });

  test("a module that does not occlude reaches the prelude value qualified", () => {
    expect(diagnostics("export let three: Int = Result.combine(1, 2)\n")).toEqual([]);
    // The control this pin used to be: bare `combine`. Since #742 nothing is in
    // bare term scope for a non-occluding module to see, and the bare spelling
    // draws §5.5's refusal naming the route above — which is why the occlusion
    // pins around it read the *occluding* binding rather than the prelude's.
    expect(diagnostics("export let three: Int = combine(1, 2)\n"))
      .toEqual(["no bare `combine`; write `Result.combine(1, 2)`"]);
  });
});

describe("a function-local sequential binder may shadow the prelude layer (#464)", () => {
  test("a local `let` over a prelude name compiles", () => {
    // Flipped by #464: this was the hard error "`combine` is already bound".
    // The prelude is the one layer a sequential binder may shadow.
    expect(diagnostics(
      "export fun use(): Int =\n" +
      "    let combine = 1\n" +
      "    combine\n",
    )).toEqual([]);
  });

  test("a block at module init may shadow a prelude value", () => {
    // Flipped by #464 as well. The block body of a module-level `let` is an
    // inner layer (PR #89 finding F1), and an inner layer is exactly where the
    // grant applies.
    expect(diagnostics(
      "export let use: Int =\n" +
      "    let tally = 2\n" +
      "    tally\n",
    )).toEqual([]);
  });

  test("the local `let` is what the block sees, not the prelude's", async () => {
    const exports = await runMain(
      "export fun local(): Float =\n" +
      "    let nan = 2.5\n" +
      "    nan\n" +
      "export let r: Float = local()\n",
    );

    expect(exports.r).toBe(2.5);
  });

  test("`var` shadows too, and assigns", async () => {
    const exports = await runMain(
      "export fun mutated(): Float =\n" +
      "    var nan = 1.0\n" +
      "    nan := 2.0\n" +
      "    nan\n" +
      "export let r: Float = mutated()\n",
    );

    expect(exports.r).toBe(2);
  });

  test("`fun` shadows too, and the call is the local one", async () => {
    // The interpolation inside the body is *not* rerouted: elaboration-internal
    // dispatch keeps the honored `Show` instance (§5.4's first adjacent fact),
    // which is also why this terminates.
    const exports = await runMain(
      "export fun localFun(): String =\n" +
      "    fun show(x: Int): String = \"custom ${x}\"\n" +
      "    show(3)\n" +
      "export let r: String = localFun()\n",
    );

    expect(exports.r).toBe("custom 3");
  });

  test("`let`-destructuring shadows every name its pattern binds", async () => {
    const exports = await runMain(
      "export fun destructured(): String =\n" +
      "    let {show, hash} = {show = \"local\", hash = 3}\n" +
      "    show ++ Int.show(hash)\n" +
      "export let r: String = destructured()\n",
    );

    expect(exports.r).toBe("local3");
  });

  test("the wrapping idiom works one layer in: `let` wraps the prelude's once", async () => {
    // §5.4's second adjacent fact, at function-local scope: the binder's own
    // name is *pending* in its own RHS (Statements §5.1), so the RHS reaches the
    // prelude's `show` — one wrap, not a self-call.
    const exports = await runMain(
      "export fun wrapped(): String =\n" +
      "    let show = (v: Int) => \"«\" ++ show(v) ++ \"»\"\n" +
      "    show(4)\n" +
      "export let r: String = wrapped()\n",
    );

    expect(exports.r).toBe("«4»");
  });
});

describe("the module's own layers stay under the full ban", () => {
  test("a local `let` over a *module* name is still a hard error", () => {
    // The half of the ban #464 does not touch: this never involved the prelude.
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "export fun use(): Int =\n" +
      "    let mine = 2\n" +
      "    mine\n",
    )).not.toEqual([]);
  });

  test("two module-level bindings of the same name are still a hard error", () => {
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "let mine: Int = 2\n" +
      "export let use: Int = mine\n",
    )).not.toEqual([]);
  });

  test("a block at module init may not shadow a module binding", () => {
    // PR #89 finding F1: a block body of a module-level `let` runs at lambda
    // depth 0 and yet is an inner layer. The grant is layer-tested, so it
    // reaches the prelude here and no further.
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "export let use: Int =\n" +
      "    let mine = 2\n" +
      "    mine\n",
    )).not.toEqual([]);
  });

  test("a module that has occluded a prelude name owns it: the local is rule 1's error", () => {
    // The layer test, not a name test (§5.4's third bullet): the module-level
    // `fun` moved `show` into the module layer, so the local below it is the
    // ordinary rebinding error — citing the module's own line, not stdlib's.
    expect(projectDiagnostics(
      "fun show(x: Int): String = \"custom\"\n" +
      "export fun use(): String =\n" +
      "    let show = \"inner\"\n" +
      "    show\n",
    )).toContain(
      "`show` is already bound (line 1); Hexagon does not allow rebinding — " +
        "choose a different name.",
    );
  });

  test("a second local of one prelude name collides with the first local", () => {
    // The first `let` shadows the prelude and *binds*; the second reuses a name
    // this function wrote, which rule 1 refuses at every layer.
    matchesControl(
      (name) =>
        "export fun use(): Float =\n" +
        `    let ${name} = 1.0\n` +
        `    let ${name} = 2.0\n` +
        `    ${name}\n`,
      ["nan"],
      ["zephyr"],
    );
    expect(projectDiagnostics(
      "export fun use(): Float =\n" +
      "    let nan = 1.0\n" +
      "    let nan = 2.0\n" +
      "    nan\n",
    )).toEqual([
      "`nan` is already bound (line 2); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("sibling blocks of one function each get their own shadow", () => {
    // Mirrors the control exactly, which is the whole claim here: whatever rule
    // 1's function-wide phrasing costs two *sibling* blocks, it costs them the
    // same at a prelude name as at one the author wrote.
    matchesControl(
      (name) =>
        "export fun use(): Float =\n" +
        "    let first =\n" +
        `        let ${name} = 1.0\n` +
        `        ${name}\n` +
        "    let second =\n" +
        `        let ${name} = 2.0\n` +
        `        ${name}\n` +
        "    first + second\n",
      ["nan"],
      ["zephyr"],
    );
  });
});

describe("shadowing reserves the name for the whole block (§5.4's reservation)", () => {
  test("a use above the binder is the declared-later error, never the prelude's meaning", () => {
    // The discriminator: were the prelude's `show` still visible above the
    // binder, this would compile clean and `early` would be "1".
    matchesControl(
      (name) =>
        "export fun use(): String =\n" +
        `    let early = ${name}(1)\n` +
        `    let ${name} = (v: Int) => "custom"\n` +
        "    early\n",
      ["show"],
      ["zephyr"],
    );
    expect(projectDiagnostics(
      "export fun use(): String =\n" +
      "    let early = show(1)\n" +
      "    let show = (v: Int) => \"custom\"\n" +
      "    early\n",
    )).toContain(
      "`show` is declared later in this block; declarations are read top-down — " +
        "move its declaration above this use",
    );
  });

  test("a lambda above the binder is reserved too, at whatever the control does", () => {
    matchesControl(
      (name) =>
        "export fun use(): Float =\n" +
        `    let g = () => ${name}\n` +
        `    let ${name} = 2.5\n` +
        "    g()\n",
      ["nan"],
      ["zephyr"],
    );
  });

  test("`var` reserves what it shadows", () => {
    matchesControl(
      (name) =>
        "export fun use(): Float =\n" +
        `    let early = ${name}\n` +
        `    var ${name} = 2.5\n` +
        "    early\n",
      ["nan"],
      ["zephyr"],
    );
  });

  test("a destructuring pattern reserves every name it binds", () => {
    // `hash` is bound by the pattern's second field, and the reservation covers
    // it exactly as it covers `show`.
    matchesControl(
      (first, second) =>
        "export fun use(): String =\n" +
        `    let early = Int.show(${second})\n` +
        `    let {${first}, ${second}} = {${first} = "local", ${second} = 3}\n` +
        `    early ++ ${first}\n`,
      ["show", "hash"],
      ["alpha", "zephyr"],
    );
  });
});

describe("module-wide is enforced the same way (§5.4's reservation, defect 2)", () => {
  test("a `fun` occluder: the use above it is declared-later, not the prelude's", () => {
    // Before #464 this compiled with *zero* diagnostics and two meanings for one
    // identifier: `early` was the prelude's "1", `late` the local "custom".
    matchesControl(
      (name) =>
        `export let early: String = ${name}(1)\n` +
        `fun ${name}(x: Int): String = "custom"\n` +
        `export let late: String = ${name}(2)\n`,
      ["show"],
      ["zephyr"],
    );
    expect(projectDiagnostics(
      "export let early: String = show(1)\n" +
      "fun show(x: Int): String = \"custom\"\n" +
      "export let late: String = show(2)\n",
    )).toEqual([
      "`show` is declared later in this block; declarations are read top-down — " +
        "move its declaration above this use",
    ]);
  });

  test("a `let` occluder reserves identically", () => {
    matchesControl(
      (name) =>
        `export let early: String = ${name}(1)\n` +
        `let ${name} = (x: Int) => "custom"\n` +
        `export let late: String = ${name}(2)\n`,
      ["show"],
      ["zephyr"],
    );
  });

  test("a `fun` block still recurses together, and calls the local one", async () => {
    // §7.3's mutual visibility is what the reservation leaves standing: the block
    // binds every member before the first body is walked, so `early` resolves
    // `show` to the block's own — never to the prelude's, which would have made
    // this "1".
    expect(projectDiagnostics(
      "fun\n" +
      "    early(x: Int): String = show(x)\n" +
      "    show(x: Int): String = \"custom ${x}\"\n" +
      "export let r: String = early(7)\n",
    )).toEqual([]);

    const exports = await runMain(
      "fun\n" +
      "    early(x: Int): String = show(x)\n" +
      "    show(x: Int): String = \"custom ${x}\"\n" +
      "export let grouped: String = early(7)\n",
    );

    expect(exports.grouped).toBe("custom 7");
  });

  test("a group split by another item reads §7.3's repair, control and all", () => {
    matchesControl(
      (name) =>
        `fun early(x: Int): String = ${name}(x)\n` +
        "let gap: Int = 1\n" +
        `fun ${name}(x: Int): String = "custom"\n` +
        "export let r: String = early(7)\n",
      ["show"],
      ["zephyr"],
    );
  });
});

describe("an import occludes and reserves too (§5.4's \"or import\")", () => {
  // An explicit import enters the *same* layer as a local binding, so it takes a
  // prelude name over module-wide and reserves it exactly as a `let` would. The
  // control here is the shape at a name the prelude does not bind, and this pin
  // follows it wherever it goes — which #465 moved: a term reference above the
  // import that binds it is the declared-later error now (Modules §3), not an
  // unknown name, so that is what the prelude name draws too. The invariant is
  // untouched, being stated over the control rather than over any one message.

  test("a use above an occluding import reads as the control does", () => {
    // Before this, the shape compiled with zero diagnostics and two meanings:
    // `early` was the prelude's "1", `late` the import's "custom".
    matchesProjectControl(
      (name) => [
        ["/lib.hex", `export fun ${name}(x: Int): String = "custom"\n`],
        ["/main.hex",
          `export let early: String = ${name}(1)\n` +
          `import { ${name} } from "./lib"\n` +
          `export let late: String = ${name}(2)\n`],
      ],
      ["show"],
      ["zork"],
    );
    expect(compileFiles([
      ["/lib.hex", "export fun show(x: Int): String = \"custom\"\n"],
      ["/main.hex",
        "export let early: String = show(1)\n" +
        "import { show } from \"./lib\"\n" +
        "export let late: String = show(2)\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "`show` is declared later in this block; declarations are read top-down — " +
        "move the import above this use",
    ]);
  });

  test("below the import the local meaning stands, and it is the import's", async () => {
    const exports = await runProject([
      ["/lib.hex", "export fun show(x: Int): String = \"imported ${x}\"\n"],
      ["/main.hex",
        "import { show } from \"./lib\"\n" +
        "export let late: String = show(2)\n"],
    ]);

    expect(exports.late).toBe("imported 2");
  });

  test("a constraint's members arrive with it and reserve the same way", () => {
    // Modules §3.1: members are not importable severally, so the constraint's
    // name is the only spelling at the import line — and every member it brings
    // occludes, the pattern's author never having written those names either.
    matchesProjectControl(
      (name) => [
        ["/lib.hex",
          "export constraint Labelled<a> =\n" +
          `    ${name}(subject: a): String\n`],
        ["/main.hex",
          `export let early: String = ${name}(1)\n` +
          "import { Labelled } from \"./lib\"\n"],
      ],
      ["show"],
      ["zork"],
    );
  });
});

describe("a declaration's constructor names occlude too (#466)", () => {
  /**
   * §5.4's grant reaches "a declaration's **constructor names** — a union's, a
   * record's, or an exception's". Before #466 all three *refused* a prelude
   * collision instead, which was the third channel through which adding a name
   * to the prelude could still break a program; the guarantee is stated over
   * binder collisions with no exception now.
   *
   * The prelude constructors these pins take over are real: `Less`/`Greater`
   * from `Ordering` (`stdlib/Ordering.hex`), `Some` from `Option.hex`,
   * `IndexError` from `Vector.hex`, `True` from `Bool.hex` (#147).
   */

  test("a union may take a prelude constructor over, and the module's is what it means", async () => {
    expect(projectDiagnostics(
      "export union Direction = Less | Greater\n" +
      "export let d: Direction = Less\n",
    )).toEqual([]);

    // The discriminator is the annotation: the prelude's `Less` is an
    // `Ordering`, so if the occlusion had not happened this would not type.
    const exports = await runMain(
      "export union Direction = Less | Greater\n" +
      "export let d: Direction = Less\n" +
      "export let g: Direction = Greater\n",
    );

    expect(exports.d).toBe("Less");
    expect(exports.g).toBe("Greater");
  });

  test("a bare constructor *pattern* below the declaration is the module's", async () => {
    // §5.4 reads pattern position and value position as one scope, so the
    // pattern means what the reference means: the module's own constructor.
    // Were it still the prelude's, the scrutinee would not type as `Direction`.
    const exports = await runMain(
      "export union Direction = Less | Greater\n" +
      "export fun name(d: Direction): String =\n" +
      "    match d\n" +
      "        Less => \"the module's Less\"\n" +
      "        Greater => \"the module's Greater\"\n" +
      "export let low: String = name(Less)\n" +
      "export let high: String = name(Greater)\n",
    );

    expect(exports.low).toBe("the module's Less");
    expect(exports.high).toBe("the module's Greater");
  });

  test("a bare constructor pattern *above* the declaration reads as the control does", () => {
    // The reservation in pattern position, which is the machinery #466 had to
    // add: without it `Less` above the union silently kept the prelude's
    // meaning and the arm drew a type mismatch against `Direction` instead.
    matchesControl(
      (name, other) =>
        "export fun f(d: Direction): Int =\n" +
        "    match d\n" +
        `        ${name} => 1\n` +
        "        _ => 2\n" +
        `union Direction = ${name} | ${other}\n`,
      ["Less", "Greater"],
      ["Zork", "Zap"],
    );
    expect(projectDiagnostics(
      "export fun f(d: Direction): Int =\n" +
      "    match d\n" +
      "        Less => 1\n" +
      "        _ => 2\n" +
      "union Direction = Less | Greater\n",
    )).toContain(
      "`Less` is declared later in this block; declarations are read top-down — " +
        "move the union's declaration above this use",
    );
  });

  test("a value reference above the declaration reads as the control does", () => {
    matchesControl(
      (name, other) =>
        `export let early: Direction = ${name}\n` +
        `union Direction = ${name} | ${other}\n`,
      ["Less", "Greater"],
      ["Zork", "Zap"],
    );
  });

  test("an exception may take a prelude exception's name over", async () => {
    expect(projectDiagnostics("export exception IndexError(code: Int)\n")).toEqual([]);

    // Thrown and caught below the declaration through the bare spelling: the
    // catch arm is a constructor pattern like any other (exceptions.md §5.2).
    const exports = await runMain(
      "export exception IndexError(code: Int)\n" +
      "export fun caught(): Int =\n" +
      "    try\n" +
      "        throw(IndexError(7))\n" +
      "    catch\n" +
      "        IndexError(c) => c\n" +
      "export let r: Int = caught()\n",
    );

    expect(exports.r).toBe(7);
  });

  test("a record may take a prelude constructor's name over", async () => {
    expect(projectDiagnostics(
      "export record Some(a) = { value: a }\n" +
      "export let s: Some(Int) = Some({value = 1})\n",
    )).toEqual([]);

    const exports = await runMain(
      "export record Some(a) = { value: a }\n" +
      "export let boxed: Some(Int) = Some({value = 9})\n" +
      "export let unboxed: Int = boxed.value\n",
    );

    expect(exports.unboxed).toBe(9);
  });

  test("`union Flag = True | Maybe` is legal, and `Bool` still demands `Bool`", () => {
    // §5.4's own example. Occluding `True` costs the module the bare spelling
    // of the boolean and nothing else: every context demanding `Bool` still
    // demands it, so a strayed `Flag` constructor is a loud type error.
    expect(projectDiagnostics("export union Flag = True | Maybe\n")).toEqual([]);
    expect(projectDiagnostics(
      "export union Flag = True | Maybe\n" +
      "export let stray: Bool = Maybe\n",
    )).toEqual(["type mismatch: expected Bool, found Flag"]);
  });

  test("and `Bool.True` stays spellable in both positions", async () => {
    const exports = await runMain(
      "export union Flag = True | Maybe\n" +
      "export let flag: Flag = True\n" +
      "export let yes: Bool = Bool.True\n" +
      "export fun describe(b: Bool): String =\n" +
      "    match b\n" +
      "        Bool.True => \"yes\"\n" +
      "        Bool.False => \"no\"\n" +
      "export let said: String = describe(Bool.True)\n",
    );

    expect(exports.flag).toBe("True");
    expect(exports.yes).toBe(true);
    expect(exports.said).toBe("yes");
  });

  test("user-versus-user collisions are untouched: two unions in one module", () => {
    // Unions §2's declaration-site hard error. The exemption is the prelude
    // layer only, so a name the module's own layers bind still fights.
    expect(projectDiagnostics(
      "union A = Dup | X\n" +
      "union B = Dup | Y\n",
    )).toEqual([
      "`Dup` is already bound (line 1); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("and a declared constructor still fights an imported one", () => {
    expect(compileFiles([
      ["/lib.hex", "export union A = Dup | X\n"],
      ["/main.hex",
        "import { A, Dup, X } from \"./lib\"\n" +
        "union B = Dup | Y\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "`Dup` is already bound (line 1); Hexagon does not allow rebinding — " +
        "choose a different name.",
    ]);
  });

  test("an imported constructor occludes and reserves like any other import", () => {
    // The import arm §5.4 already covered, now reachable at a constructor: the
    // exporting module could not even declare `Less` before #466.
    matchesProjectControl(
      (name, other) => [
        ["/lib.hex", `export union Direction = ${name} | ${other}\n`],
        ["/main.hex",
          `import { Direction, ${name}, ${other} } from "./lib"\n` +
          `export let d: Direction = ${name}\n`],
      ],
      ["Less", "Greater"],
      ["Zork", "Zap"],
    );
    matchesProjectControl(
      (name, other) => [
        ["/lib.hex", `export union Direction = ${name} | ${other}\n`],
        ["/main.hex",
          `export let early: Direction = ${name}\n` +
          `import { Direction, ${name}, ${other} } from "./lib"\n`],
      ],
      ["Less", "Greater"],
      ["Zork", "Zap"],
    );
    expect(compileFiles([
      ["/lib.hex", "export union Direction = Less | Greater\n"],
      ["/main.hex",
        "export let early: Direction = Less\n" +
        "import { Direction, Less, Greater } from \"./lib\"\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      // One diagnostic, and it is about the term. The *type* `Direction` above
      // the import is legal since #465 — an import's type-namespace half is
      // order-insensitive like the declaration it imports — so the annotation
      // types, and what is left is the constructor, which was the prelude's
      // `Less` silently before #466 and is now the import's, read top-down.
      "`Less` is declared later in this block; declarations are read top-down — " +
        "move the import above this use",
    ]);
  });
});

describe("in prelude source, the prelude layer is the §5.5 visible prefix", () => {
  // `Result.hex` sees the members before it and only those, so `show` —
  // `Show.hex` is first in the set — is an ordinary prelude name there. The rule
  // reads identically: stdlib source pasted into a user module keeps its meaning.

  test("a prelude module's function-local binder shadows an earlier member's export", () => {
    expect(diagnostics(
      "export let use: Int = 1\n",
      "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
      "export let labelled(n: Int): String =\n" +
      "    let show = \"prefix shadow\"\n" +
      "    show\n",
    )).toEqual([]);
  });

  test("and reserves it there for the whole block, exactly as in user code", () => {
    expect(diagnostics(
      "export let use: Int = 1\n",
      "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
      "export let labelled(n: Int): String =\n" +
      "    let early = show(n)\n" +
      "    let show = \"prefix shadow\"\n" +
      "    early ++ show\n",
    )).toEqual([
      "`show` is declared later in this block; declarations are read top-down — " +
        "move its declaration above this use",
    ]);
  });
});

describe("every module-level binder form may occlude, not just `let`/`fun`", () => {
  /**
   * Defect 9 was fixed for `let`. A **constraint member** binds at module level
   * too and kept the unconditional `scope.lookup`, so declaring
   * `constraint Walkable<c> = ... iterate(...)` reported `\`iterate\` is already
   * bound` against the prelude's — §5.4's guarantee failing at a binder form the
   * first fix did not reach.
   *
   * Reachable only once a prelude module exports lowercase operation names,
   * which `Seq.hex` is the first to do: `iterate`, `map`, `filter`, `fold`.
   */
  test("a constraint member may occlude a prelude value", () => {
    expect(diagnostics(
      "constraint Walkable<c> =\n" +
      "    combine(value: c, other: c): c\n",
    )).toEqual([]);
  });

  test("it still rejects two constraint members of one name", () => {
    expect(diagnostics(
      "constraint Walkable<c> =\n" +
      "    combine(value: c, other: c): c\n" +
      "    combine(value: c): c\n",
    )).not.toEqual([]);
  });

  test("it still rejects a constraint member colliding with a module binding", () => {
    expect(diagnostics(
      "let mine: Int = 1\n" +
      "constraint Walkable<c> =\n" +
      "    mine(value: c): c\n",
    )).not.toEqual([]);
  });
});
