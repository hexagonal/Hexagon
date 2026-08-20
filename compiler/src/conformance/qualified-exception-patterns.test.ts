import { describe, expect, test } from "vitest";

import {
  compileFiles,
  compileMain,
  projectDiagnostics,
  runMain,
  runProject,
} from "../support/test-project.js";

/**
 * Conformance for **exception patterns in catch position**, bare and qualified
 * — `qualified-constructor-patterns.test.ts` in the other position the flat
 * constructor patterns of Unions §4.2 appear in.
 *
 * Exceptions §1 delegates a catch arm to those patterns, and §5.2 repeats the
 * delegation, so Modules §3.3's qualified spelling is part of the grammar an
 * arm is written in. One pattern resolver answers both positions, and it always
 * did — what refused a `Map.KeyError` arm was the **checker**, whose exception
 * table was built from the module's own `exception` items alone. Bare or
 * qualified, an exception the module had not written was not an exception
 * constructor as far as a catch arm was concerned (#469).
 *
 * #466 is what made the gap cost something. Once a module's own declaration may
 * occlude a prelude exception's name (Modules §5.4), an occluding module had no
 * spelling at all for the prelude's: bare meant its own, qualified was refused,
 * and only a catch-all arm and a rethrow were left. §5.4's "reachable qualified
 * in **both** positions" was, for exceptions, not kept.
 *
 * The table is now every exception constructor in scope — the prelude layer's
 * (§5.5) and the imports' — carried to the checker and to emission as
 * `Module.visibleExceptions`. Two invariants run through the pins below:
 *
 * - **The two spellings are one constructor.** Resolution answers with the same
 *   symbol, so §5.3's reachability check cannot tell them apart, and emission
 *   tests the same `name`.
 * - **Nothing about the arm changes with the spelling.** Arity, payload
 *   binding, and every refusal read exactly as the bare form's do.
 */

describe("a prelude module's own name qualifies its exceptions in catch arms", () => {
  test("`Vector.IndexError(i, s)` catches and binds both payload slots", async () => {
    const exports = await runMain(
      "export fun guarded(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        Vector.IndexError(index, size) => index + size\n" +
      "export let r: Int = guarded([1, 2, 3])\n",
    );

    // 9 out of bounds for size 3: the declared slots, in declaration order.
    expect(exports.r).toBe(12);
  });

  test("`Map.KeyError` catches the bracket's throw, nullary", async () => {
    // The one nullary prelude exception a program can provoke without help:
    // §4.1's bracket asserts presence and raises `KeyError` on absence.
    const exports = await runMain(
      "let m: Map(Int, String) = Map.fromVector([(1, \"one\")])\n" +
      "export fun lookup(key: Int): String =\n" +
      "    try\n" +
      "        m[key]\n" +
      "    catch\n" +
      "        Map.KeyError => \"absent\"\n" +
      "export let found: String = lookup(1)\n" +
      "export let missing: String = lookup(9)\n",
    );

    expect([exports.found, exports.missing]).toEqual(["one", "absent"]);
  });

  test("the bare spelling reaches the same prelude declaration", async () => {
    // §5.5 puts a prelude module's exports in bare scope, so this is the same
    // constructor by the other name — the half that has to keep working, and
    // the reason the widened table is not a qualified-only door.
    const exports = await runMain(
      "export fun guarded(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        IndexError(index, size) => index + size\n" +
      "export let r: Int = guarded([1, 2, 3])\n",
    );

    expect(exports.r).toBe(12);
  });

  test("every prelude exception is nameable in a catch arm, by both spellings", () => {
    // The seven the prelude exports — `Seq.hex`'s `ReentrancyError` among them,
    // which has been in the prelude and uncatchable since it was declared (FFI
    // Part 3 §7.4), and `Float.hex`'s `FloatRangeError`, which nothing in its
    // own home module throws either (#526: it is the range the doors *into*
    // `Float` from the exact world fail, `Rat.toFloat` first). Compilation is
    // the claim; the arms are unreachable at run time because nothing here
    // throws.
    const arms: readonly (readonly [string, string])[] = [
      ["Map", "KeyError"],
      ["Vector", "IndexError(index, size)"],
      ["Vector", "SliceError(start, end)"],
      ["Seq", "ReentrancyError"],
      ["Integral", "DivideByZeroError(message)"],
      ["Pow", "NegativeExponentError(message)"],
      ["Float", "FloatRangeError(message)"],
    ];
    for (const [home, arm] of arms) {
      for (const spelling of [arm, `${home}.${arm}`]) {
        expect(projectDiagnostics(
          "export fun f(n: Int): Int =\n" +
          "    try\n" +
          "        n\n" +
          "    catch\n" +
          `        ${spelling} => 0\n` +
          "        _ => 1\n",
        )).toEqual([]);
      }
    }
  });
});

describe("a module alias qualifies an imported exception", () => {
  const project = (arm: string): readonly (readonly [string, string])[] => [
    ["/lib.hex", "export exception Boom(code: Int)\n"],
    ["/main.hex",
      "import * as Lib from \"./lib\"\n" +
      "import { Boom } from \"./lib\"\n" +
      "export fun f(): Int =\n" +
      "    try\n" +
      "        throw(Boom(3))\n" +
      "    catch\n" +
      `        ${arm} => c\n` +
      "export let r: Int = f()\n"],
  ];

  test("`Lib.Boom(c)` catches what `Boom(c)` catches", async () => {
    for (const arm of ["Lib.Boom(c)", "Boom(c)"]) {
      expect(compileFiles(project(arm)).diagnostics).toEqual([]);
      expect((await runProject(project(arm)))["r"]).toBe(3);
    }
  });

  test("the alias alone is enough — no term import of the constructor", async () => {
    // `import * as Lib` binds no bare `Boom`, so this is the qualified form
    // carrying the whole reference, throw side and catch side both.
    const files = [
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import * as Lib from \"./lib\"\n" +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        throw(Lib.Boom(5))\n" +
        "    catch\n" +
        "        Lib.Boom(c) => c\n" +
        "export let r: Int = f()\n"],
    ] as const;

    expect(compileFiles(files).diagnostics).toEqual([]);
    expect((await runProject(files))["r"]).toBe(5);
  });

  test("the emitted arm tests the declaring module and name, not the spelling", () => {
    // Exceptions §7.1's representation, which is what the bare form emits too.
    // A qualified arm that tested a union tag — the shape a constructor whose
    // declaration never crossed compiles to — would match nothing thrown.
    //
    // The brand is the *declaring* module's identity (§7.1, #488), so an arm in
    // `/main.hex` naming `/lib.hex`'s exception tests `"lib"`: the alias the
    // importer chose is nowhere in the emitted text, and neither is the
    // importer's own identity.
    const javascript = compileFiles([
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import * as Lib from \"./lib\"\n" +
        "export fun f(g: (() ->? Int)): Int =\n" +
        "    try\n" +
        "        g?()\n" +
        "    catch\n" +
        "        Lib.Boom(c) => c\n"],
    ]).modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(javascript).toContain('.name === "Boom"');
    expect(javascript).toContain('$hex === "lib"');
    expect(javascript).not.toContain("Lib.Boom");
  });
});

describe("the hatch #466 needed: an occluding module reaches both", () => {
  test("its own exception bare, the prelude's qualified", async () => {
    // The shape the issue names. `IndexError` here is the module's own
    // declaration, occluding `Vector`'s (Modules §5.4); before #469 the
    // prelude's had no spelling left in a catch arm at all, and the only way
    // out was a catch-all arm and a rethrow.
    const exports = await runMain(
      "export exception IndexError(code: Int)\n" +
      "export fun theirs(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        Vector.IndexError(index, size) => index + size\n" +
      "export fun mine(): Int =\n" +
      "    try\n" +
      "        throw(IndexError(7))\n" +
      "    catch\n" +
      "        IndexError(code) => code\n" +
      "export let a: Int = theirs([1, 2, 3])\n" +
      "export let b: Int = mine()\n",
    );

    expect([exports.a, exports.b]).toEqual([12, 7]);
  });

  test("an occluded nullary prelude exception is catchable qualified", async () => {
    const exports = await runMain(
      "export exception KeyError(reason: String)\n" +
      "let m: Map(Int, String) = Map.fromVector([(1, \"one\")])\n" +
      "export fun lookup(key: Int): String =\n" +
      "    try\n" +
      "        m[key]\n" +
      "    catch\n" +
      "        Map.KeyError => \"absent\"\n" +
      "export let found: String = lookup(1)\n" +
      "export let missing: String = lookup(9)\n",
    );

    expect([exports.found, exports.missing]).toEqual(["one", "absent"]);
  });

  /**
   * **The #488 flip, and the residue it discharges.** Exceptions §7.1 used to
   * represent a raised exception as an `Error` carrying `$hex: true` and the
   * declared `name`, so *identity was the name string* at run time: two
   * exceptions declared in two modules under one name had one representation,
   * and an arm naming either caught both — `B.Boom(tag)` swallowed `A`'s throw
   * and bound `tag` to `undefined`, an accident needing no adversary.
   *
   * The brand now carries the **declaring module** (§7.1), so identity is the
   * (module, name) pair and the arms below are two arms again. Nothing here is
   * about occlusion, the prelude, or the qualified spelling: two ordinary
   * imports are all it ever took. It was simply unwritable while a catch arm
   * could name no exception the module had not written, which is why #469 made
   * it reachable and #488 closed it.
   */
  test("two exceptions of one declared name are two representations", async () => {
    const files = [
      ["/a.hex", "export exception Boom(code: Int)\nexport fun raise(): Int = throw(Boom(1))\n"],
      ["/b.hex", "export exception Boom(tag: String)\n"],
      ["/main.hex",
        "import * as A from \"./a\"\n" +
        "import * as B from \"./b\"\n" +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        A.raise()\n" +
        "    catch\n" +
        "        B.Boom(tag) => 2\n" +
        "        A.Boom(code) => 1\n" +
        "export let r: Int = f()\n"],
    ] as const;

    // Both arms compile — they are two distinct constructors, so §5.3 has no
    // objection — and `A`'s throw passes the `B.Boom` arm to reach `A.Boom`.
    expect(compileFiles(files).diagnostics).toEqual([]);
    expect((await runProject(files))["r"]).toBe(1);
  });

  test("with only the foreign arm, the domestic exception is rethrown", async () => {
    // The other half of the pair: an arm that no longer captures does not
    // silently swallow either. `B.Boom` matches nothing `A` raises, so §7.4's
    // implicit rethrow carries the exception out of the `try` intact — payload
    // and all, which is what a `tag` bound `undefined` used to destroy.
    const files = [
      ["/a.hex", "export exception Boom(code: Int)\nexport fun raise(): Int = throw(Boom(7))\n"],
      ["/b.hex", "export exception Boom(tag: String)\n"],
      ["/main.hex",
        "import * as A from \"./a\"\n" +
        "import * as B from \"./b\"\n" +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        A.raise()\n" +
        "    catch\n" +
        "        B.Boom(tag) => 2\n"],
    ] as const;

    expect(compileFiles(files).diagnostics).toEqual([]);
    const f = (await runProject(files))["f"] as () => number;
    expect(f).toThrowError(
      expect.objectContaining({ name: "Boom", $hex: "a", code: 7 }),
    );
  });
});

describe("reachability reads the constructor, not the spelling (§5.3)", () => {
  test("a qualified arm after the bare one for the same declaration is refused", () => {
    expect(projectDiagnostics(
      "export fun f(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        IndexError(index, size) => 0\n" +
      "        Vector.IndexError(index, size) => 1\n",
    )).toEqual(["exception `IndexError` is already caught above"]);
  });

  test("and so is the bare arm after the qualified one", () => {
    expect(projectDiagnostics(
      "export fun f(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        Vector.IndexError(index, size) => 0\n" +
      "        IndexError(index, size) => 1\n",
    )).toEqual(["exception `IndexError` is already caught above"]);
  });

  test("two different constructors sharing a bare name are two arms", () => {
    // The other side of the same rule, and the reason it cannot be spelling
    // arithmetic: `IndexError` and `Vector.IndexError` are one constructor in
    // the test above and two here, purely by what each name resolves to.
    expect(projectDiagnostics(
      "export exception IndexError(code: Int)\n" +
      "export fun f(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        IndexError(code) => 0\n" +
      "        Vector.IndexError(index, size) => 1\n",
    )).toEqual([]);
  });

  test("an imported exception is caught once, by whichever spelling came first", () => {
    expect(compileFiles([
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import * as Lib from \"./lib\"\n" +
        "import { Boom } from \"./lib\"\n" +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        throw(Boom(3))\n" +
        "    catch\n" +
        "        Lib.Boom(c) => c\n" +
        "        Boom(c) => c\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "exception `Boom` is already caught above",
    ]);
  });
});

describe("what a qualified exception pattern refuses", () => {
  test("arity is reported as it is for the bare form, naming the constructor", () => {
    const message = "exception pattern `IndexError` expects 2 arguments, got 1";
    expect(projectDiagnostics(
      "export fun f(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        Vector.IndexError(index) => 0\n",
    )).toEqual([message]);
    expect(projectDiagnostics(
      "export fun f(v: Vector(Int)): Int =\n" +
      "    try\n" +
      "        v.at(9)\n" +
      "    catch\n" +
      "        IndexError(index) => 0\n",
    )).toEqual([message]);
  });

  test("a constructor that is not an exception's is still refused, either spelling", () => {
    // The table grew to every exception in scope, not to every constructor:
    // `Ordering`'s are union constructors and a catch arm has never taken one.
    for (const arm of ["Prelude.Less", "Less"]) {
      expect(projectDiagnostics(
        "export fun f(n: Int): Int =\n" +
        "    try\n" +
        "        n\n" +
        "    catch\n" +
        `        ${arm} => 0\n`,
      )).toEqual(["`Less` is not an exception constructor"]);
    }
  });

  test("an unknown qualifier and an unexported name read as they do in a match", () => {
    expect(compileFiles([
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import * as Lib from \"./lib\"\n" +
        "export fun f(n: Int): Int =\n" +
        "    try\n" +
        "        n\n" +
        "    catch\n" +
        "        Nope.Boom(c) => 0\n" +
        "        _ => 1\n"],
    ]).diagnostics.map(({ message }) => message)).toContain("unknown module alias `Nope`");

    expect(compileFiles([
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import * as Lib from \"./lib\"\n" +
        "export fun f(n: Int): Int =\n" +
        "    try\n" +
        "        n\n" +
        "    catch\n" +
        "        Lib.Blast(c) => 0\n" +
        "        _ => 1\n"],
    ]).diagnostics.map(({ message }) => message)).toContain(
      "module `Lib` does not export `Blast`",
    );
  });

  test("an exception a private declaration hides is not in scope to be caught", () => {
    // The table is metadata; what a catch arm may *name* is still settled by
    // resolution. An unexported `exception` crosses no module boundary, so
    // neither spelling finds it.
    const messages = compileFiles([
      ["/lib.hex", "exception Hidden(code: Int)\nexport let seed: Int = 1\n"],
      ["/main.hex",
        "import * as Lib from \"./lib\"\n" +
        "export fun f(n: Int): Int =\n" +
        "    try\n" +
        "        n\n" +
        "    catch\n" +
        "        Lib.Hidden(c) => 0\n" +
        "        _ => 1\n"],
    ]).diagnostics.map(({ message }) => message);

    expect(messages).toContain("module `Lib` does not export `Hidden`");
  });
});

describe("the widened table costs the rest of the module nothing", () => {
  test("a match on a union still refuses an exception constructor", () => {
    // Exceptions §1's one door: `match` is not it, and the sentence that says
    // so is untouched by the table's width.
    expect(compileFiles([
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import { Boom } from \"./lib\"\n" +
        "export fun f(e: Exn): Int =\n" +
        "    match e\n" +
        "        Boom(c) => c\n"],
    ]).diagnostics.map(({ message }) => message)).toContain(
      "match requires a closed type; exceptions are inspected with `try`/`catch`",
    );
  });

  test("a program that never catches emits nothing for the visible declarations", () => {
    // `visibleExceptions` is a candidate set the checker and emission read, and
    // never an obligation: no import line, no declaration, no runtime value.
    const javascript = compileMain(
      "export let doubled: Int = 21 * 2\n",
    ).modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(javascript).not.toContain("IndexError");
    expect(javascript).not.toContain("KeyError");
    expect(javascript.match(/^import /gmu)).toBeNull();
  });
});
