import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * A crossed `Vector(a)` as a plain array.
 *
 * Readouts that land in a `Vector` go through this since the trie wiring: a
 * `Vector(a)` is a `TrieVector` record, not a JavaScript array. The subject of
 * these tests is unchanged; spreading is what the `Hex.Vector<a> extends
 * Iterable<a>` face promises a consumer can do, so the readout is now also a
 * live check of that contract.
 */
function elements(value: unknown): unknown[] {
  return [...(value as Iterable<unknown>)];
}

/**
 * Conformance for type-directed companion dispatch (Method Syntax §4.1/§4.2).
 *
 * `e.name(args…)` on a nominal receiver means `CompanionOf(T).name(e, args…)`,
 * and §1 states what decides `CompanionOf`: "Resolution is type-directed, never
 * lexical. `v.at(3)` consults `v`'s inferred type, not the names in scope."
 * §4.2 gives the candidate set exactly — the functions **exported by `T`'s home
 * module** whose **first parameter is `T`-headed** — and calls the `T`-headed
 * test syntactic, "a declaration-indexing operation", with "no speculative
 * unification anywhere".
 *
 * The checker did none of that (#267). It kept one flat map from operation name
 * to symbol, populated from every `fun`/`let` symbol in scope, last-wins, and
 * consulted it with the field text alone. Dispatch was therefore lexical, and
 * every binder kind produced a different wrong answer:
 *
 * - a *compatible* module-level `map` silently won `s.map(f)`, so the program
 *   called the local and the prelude combinator never ran — a clean compile and
 *   wrong runtime behaviour, the worst shape in the defect log;
 * - an *incompatible* one produced a bare arity error naming nothing;
 * - a non-function `let take` knocked the operation out entirely, and the
 *   compiler said the companion had no `take` — a false statement about the
 *   companion;
 * - a `Vector` receiver reached prelude `Seq.length`/`Seq.prepend` and failed
 *   with a `Seq`/`Vector` type mismatch where the companion diagnostic and its
 *   subject-first rewrite belonged (#217).
 *
 * Behaviour, not diagnostics, is what the headline case can be pinned by: before
 * the fix it compiled with zero diagnostics. Those tests execute.
 *
 * Two neighbouring rules are deliberately **not** exercised here, because the
 * fix does not touch them. §6's field/companion collision is still not a hard
 * error — a visible field wins and dispatch is never attempted — and dot call
 * still does not reach the compiler-**core** `Vector`/`Map`/`Set` inventories,
 * which arrives when `stdlib/Vector.hex` joins the prelude. What a built-in
 * receiver *does* reach is a companion module addressable under its own name
 * (§4.1, Collections Part 3 §7), pinned below because the Playground already
 * depends on it.
 */

/** One project's emitted JavaScript, by source path. */
function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const compiled = compileFiles(files);
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("a module-level binding never wins a dot call (#267)", () => {
  /**
   * The filed reproduction, and the only one whose failure was silent. The local
   * `map` returns its receiver unchanged, so if it wins the sequence comes back
   * unmapped — with no diagnostic anywhere to say so.
   */
  test("a compatible local does not steal the call", async () => {
    const source =
      "export fun map(s: Seq(Int), f: Int -> Int): Seq(Int) = s\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([1, 2]).map(x => x + 1))\n";

    expect(projectDiagnostics(source)).toEqual([]);
    const main = await runProject([["/main.hex", source]]);
    expect(elements(main["out"])).toEqual([2, 3]);
    // The local kept its name, so the companion is reached under the
    // collision-cleared spelling (Modules §6.4) — the machinery #266 pinned,
    // now exercised by dispatch rather than by a qualified call.
    expect(emitted([["/main.hex", source]], "/main.hex")).toContain("__prelude_map(");
  });

  /**
   * The same defect wearing a diagnostic. `map(f: Int -> Int)` cannot take a
   * receiver, so the stolen call used to report `function arity mismatch` about
   * a function the user never meant to call.
   */
  test("an incompatible local is not a candidate", async () => {
    const source =
      "export fun map(f: Int -> Int): Int = f(1)\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([1, 2]).map(x => x + 1))\n";

    expect(projectDiagnostics(source)).toEqual([]);
    const main = await runProject([["/main.hex", source]]);
    expect(elements(main["out"])).toEqual([2, 3]);
  });

  /**
   * The non-function binder. `take` is a real `Seq` operation; a module-level
   * `let take: Int` used to displace it and the compiler then reported that the
   * companion had no `take` at all.
   */
  test("a non-function `let` of the same name is not a candidate", async () => {
    const source =
      "export let take: Int = 5\n" +
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([1, 2, 3]).take(2))\n";

    expect(projectDiagnostics(source)).toEqual([]);
    const main = await runProject([["/main.hex", source]]);
    expect(elements(main["out"])).toEqual([1, 2]);
  });
});

describe("a built-in receiver reaches the module addressable under its name", () => {
  /**
   * #217's reproduction, now the other way up. `Vector` is a compiler built-in
   * declared by no `.hex` file, so §4.1 gives it "the fixed prelude companion
   * module of the same name" — and `stdlib/Vector.hex` became exactly that at
   * the intrinsic-door milestone (`spec/intrinsics.md` §9.2). The three calls
   * below are the issue's own: `length` and `prepend` are `stdlib/Seq.hex`
   * exports too, so a lexical table handed a `Vector` receiver the `Seq`
   * function and the user got a unification failure; `isEmpty` was the control,
   * a `Vector`-only name that reported "no operation" instead.
   *
   * Run, not merely compiled: dispatch resolving to the right symbol and the
   * emitted module *calling* it are separate claims, and the prelude import that
   * joins them is synthesized (#266).
   */
  test("`length` on a vector literal means `Vector.length`", async () => {
    const source = "export let n: Int = [1, 2, 3].length()\n";

    expect(projectDiagnostics(source)).toEqual([]);
    expect((await runProject([["/main.hex", source]]))["n"]).toBe(3);
  });

  test("`prepend` on a vector literal answers with a `Vector`", async () => {
    const source = "export let v: Vector(Int) = [1, 2].prepend(0)\n";

    expect(projectDiagnostics(source)).toEqual([]);
    expect(elements((await runProject([["/main.hex", source]]))["v"])).toEqual([0, 1, 2]);
  });

  test("`isEmpty`, the control that reported before, dispatches", async () => {
    const source = "export let blank: Bool = [1, 2].isEmpty()\n";

    expect(projectDiagnostics(source)).toEqual([]);
    expect((await runProject([["/main.hex", source]]))["blank"]).toBe(false);
  });

  /**
   * The other half of the same rule: the prelude member is not privileged here,
   * *addressability under the name* is. A project's own `import * as Vector`
   * makes that module addressable too, and its exported subject-first operations
   * become `Vector`'s alongside the prelude's — which is what keeps the
   * Playground's `import * as Vector from "/stdlib/Vector.hex"` working, and
   * what a project replacing the companion depends on.
   */
  test("a module addressable as `Vector` supplies the built-in's operations", async () => {
    const files = [
      ["/vec.hex", "export fun doubled(values: Vector(Int)): Vector(Int) = values\n"],
      [
        "/main.hex",
        'import * as Vector from "./vec"\n' +
        "export let out: Vector(Int) = [1, 2].doubled()\n",
      ],
    ] as const;

    expect(diagnostics(files)).toEqual([]);
    const main = await runProject(files);
    expect(elements(main["out"])).toEqual([1, 2]);
  });

  /**
   * The name is what makes the module the companion, so the same file under any
   * other alias supplies nothing. A dot call never consults the names in scope
   * (§1); it consults the one companion its receiver's head names.
   */
  test("the same module under another alias is not `Vector`'s companion", () => {
    const messages = diagnostics([
      ["/vec.hex", "export fun doubled(values: Vector(Int)): Vector(Int) = values\n"],
      [
        "/main.hex",
        'import * as Bag from "./vec"\n' +
        "export let out: Vector(Int) = [1, 2].doubled()\n",
      ],
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(
      /^`Vector\(\?\d+\)` has no field `doubled`, its companion exports no operation `doubled`, and no constraint honored at `Vector\(\?\d+\)` has a subject-first member `doubled`; call an available subject-first function explicitly$/u,
    );
  });

  /**
   * The union flavour of the same leak. `Option` is a prelude union declared in
   * `stdlib/Option.hex`, which exports no operations at all, so `map` is not its
   * — and the identity keying is what keeps `Seq.map` from answering for it.
   */
  test("a prelude union receiver does not reach the `Seq` companion", () => {
    expect(
      projectDiagnostics(
        "export fun probe(o: Option(Int)): Option(Int) = o.map(x => x + 1)\n",
      ),
    ).toEqual([
      "`Option(Int)` has no field `map`, its companion exports no operation `map`, and no constraint honored at `Option(Int)` has a subject-first member `map`; call an available subject-first function explicitly",
    ]);
  });
});

describe("the companion is the home module, and only the home module", () => {
  /**
   * Dispatch inside the declaring file reads top-down like every other reference
   * (Method Syntax §4.4, Functions §7.2): the operation is in §4.2's candidate
   * set whichever side of the call it sits on — the set is indexed from
   * declarations — but only a declaration above the call may be reached.
   */
  test("an operation declared above its call site dispatches", async () => {
    const main = await runProject([[
      "/main.hex",
      "export record Box = {value: Int}\n" +
      "export fun twice(b: Box): Int = b.value * 2\n" +
      "export let doubled: Int = Box({value = 21}).twice()\n",
    ]]);

    expect(main["doubled"]).toBe(42);
  });

  /** §9 row 12: the candidate exists, so "has no operation" would be a lie. */
  test("an operation declared below its call site is refused as such", () => {
    expect(projectDiagnostics(
      "export record Box = {value: Int}\n" +
      "export let doubled: Int = Box({value = 21}).twice()\n" +
      "export fun twice(b: Box): Int = b.value * 2\n",
    )).toEqual([
      "`Box`'s companion declares `twice` below this call; declarations are " +
      "read top-down — move the declaration above this call",
    ]);
  });

  /**
   * A local of the same name loses to the home module's operation even though it
   * is the name in scope — §1's "not UFCS" clause, cross-module. The home
   * operation is imported under an alias, so the emitted call also proves the
   * winner is spelled by its local binding rather than by its declared name.
   */
  test("a same-named local loses to the type's home module", async () => {
    const files = [
      [
        "/box.hex",
        "export record Box = {value: Int}\n" +
        "export fun twice(b: Box): Int = b.value * 2\n",
      ],
      [
        "/main.hex",
        'import { Box, twice as scaleBy } from "./box"\n' +
        "export fun twice(b: Box): Int = 0\n" +
        "export let out: Int = Box({value = 21}).twice()\n",
      ],
    ] as const;

    expect(diagnostics(files)).toEqual([]);
    const main = await runProject(files);
    expect(main["out"]).toBe(42);
    expect(emitted(files, "/main.hex")).toContain("scaleBy(");
  });

  /**
   * §4.2's "exported only, uniformly — including inside the home module itself".
   * A private helper is callable bare there, so making it dot-callable would give
   * the type a visibility-dependent method set for no gain. The old flat table
   * admitted it.
   */
  test("a private subject-first function in the home module is not dot-callable", () => {
    expect(
      projectDiagnostics(
        "export record Box = {value: Int}\n" +
        "fun secret(b: Box): Int = 7\n" +
        "export let n: Int = Box({value = 1}).secret() + secret(Box({value = 0}))\n",
      ),
    ).toEqual([
      "`Box` has no field `secret`, its companion exports no operation `secret`, and no constraint honored at `Box` has a subject-first member `secret`; call an available subject-first function explicitly",
    ]);
  });

  /**
   * The subject-first filter. `make(n: Int): Box` is exported by `Box`'s home
   * module and returns a `Box`, but its first parameter is not `Box`-headed, so
   * it is not one of `Box`'s operations — §4.2's third worked example.
   */
  test("an exported function whose first parameter is not `T`-headed is not dot-callable", () => {
    expect(
      projectDiagnostics(
        "export record Box = {value: Int}\n" +
        "export fun make(n: Int): Box = Box({value = n})\n" +
        "export let n: Int = make(1).make()\n",
      ),
    ).toEqual([
      "`Box` has no field `make`, its companion exports no operation `make`, and no constraint honored at `Box` has a subject-first member `make`; call an available subject-first function explicitly",
    ]);
  });

  /** A union receiver dispatches to its home module exactly as a record does. */
  test("a union receiver dispatches to its own declaring module", async () => {
    const main = await runProject([[
      "/main.hex",
      "export union Shade =\n" +
      "    | Pale\n" +
      "    | Dark\n" +
      "export fun rank(s: Shade): Int =\n" +
      "    match s\n" +
      "        Pale => 1\n" +
      "        Dark => 2\n" +
      "export let n: Int = Pale.rank()\n",
    ]]);

    expect(main["n"]).toBe(1);
  });
});

describe("what the fix leaves exactly as it was", () => {
  /**
   * The intrinsic door's dispatch (#134, `spec/intrinsics.md` §8.1). `memoize` is
   * an `extern fun` behind `extern from "hex:intrinsic"`, and the resolver binds
   * it as symbol kind `fun` — not `extern` — precisely so that §4.2's set
   * contains it. An index that admitted declarations by shape rather than by
   * symbol kind would drop it silently.
   */
  test("`memoize` still dispatches on a `Seq` receiver", async () => {
    const main = await runProject([[
      "/main.hex",
      "export let out: Vector(Int) =\n" +
      "    Vector.fromSeq(Vector.toSeq([1, 2, 3]).memoize())\n",
    ]]);

    expect(elements(main["out"])).toEqual([1, 2, 3]);
  });

  /**
   * A visible record field still wins the call form outright and companion
   * dispatch is never attempted — today's behaviour, byte for byte. §6 makes this
   * shape a hard error at the use site; enforcing it is a separate issue, and
   * nothing here should be read as pinning the collision *rule*.
   */
  test("a visible field still wins over a companion operation of the same name", async () => {
    const main = await runProject([[
      "/main.hex",
      "export record Ruler = {size: (Int) -> Int}\n" +
      "export fun size(r: Ruler): Int = 99\n" +
      "export fun run(r: Ruler): Int = r.size(4)\n",
    ]]);

    const run = main["run"] as (r: { size: (n: number) => number }) => number;
    expect(run({ size: (n) => n + 1 })).toBe(5);
  });

  /**
   * A structural receiver still takes the row fallback (§3.5) — it has no home
   * module, so companion dispatch is never attempted for it and the index is
   * never consulted. `bump` is unannotated on purpose: its receiver is an
   * unsolved variable at the dot, which is the case §3.5 defines the fallback
   * for.
   */
  test("a structural receiver is untouched by companion resolution", async () => {
    const main = await runProject([[
      "/main.hex",
      "fun bump(r): Int = r.callback(3)\n" +
      "export fun run(r: {callback: (Int) -> Int}): Int = bump(r)\n",
    ]]);

    const run = main["run"] as (r: { callback: (n: number) => number }) => number;
    expect(run({ callback: (n) => n * 2 })).toBe(6);
  });
});
