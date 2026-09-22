import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for FFI Part 10 §4, the read-only bracket on a captured `JsMap`
 * (#793).
 *
 * The bracket is the last read surface of Part 10's map. `JsMap.size`,
 * `containsKey`, `get`, `entries` and `fromSeq` landed with #792 as ordinary
 * Hexagon over the intrinsic door; `jsMap[k]` cannot, for the reason every
 * bracket in the corpus is the emitter's own lowering — it is an *expression
 * form*, and a check followed by a return is statements. So it is
 * `mapIndex`'s shape without `mapIndex`'s evidence parameter, and the absence
 * of that parameter is a design statement rather than an economy (§4.3): a
 * captured `JsMap` looks its key up by the native collection's SameValueZero,
 * so no `Hash` obligation exists anywhere on this part's surfaces.
 *
 * **Almost everything here executes**, against genuine native `Map`s that
 * crossed a genuine foreign boundary. That is not ceremony. The three claims
 * §4 actually makes — that a present `undefined` is distinguishable from
 * absence, that `has` runs before `get`, and that the throw is *the* prelude
 * `KeyError` a consumer module can catch — are claims about what a running
 * program observes, and a reading of emitted text is evidence about none of
 * them. The two text pins at the end exist for the converse reason: no
 * execution can distinguish the required two-step lowering from a fused
 * `get`-plus-`undefined`-test on a map whose values happen never to be
 * `undefined`, and §4.2 item 4 forbids the fused shape *unconditionally*.
 *
 * **What is deliberately not pinned.** The issue asked for a `Proxy` whose
 * `has`/`get` throw, observed on the `JsError` path. That pin is void since the
 * capture arc (#961): under #875 a `JsMap` is captured at the crossing, so by
 * the time the bracket runs the receiver is a genuine native `Map` whose
 * `has`/`get` are the platform's own and cannot throw at all (§2, §4.4). The
 * hostile source's throw is real, but it happens during the capture, one frame
 * earlier, and `capture-walk.test.ts` owns it.
 */

/** Minimal ESM linker: rewrite compiler-owned relative imports to data-URL modules. */
function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

function link(
  javascript: string,
  importerPath: string,
  moduleUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*(?:import|export)(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/**
 * A `data:` URL is a module *identity*, so two runs whose emitted text is
 * byte-identical share one instantiated module — and one copy of the foreign
 * side's values with it. The order pins below record into a foreign module's
 * own array, so sharing an instance across two runs would let one test read the
 * other's events; the tag makes every fixture textually distinct.
 */
let runTag = 0;

interface Run {
  /** `Main`'s exports. */
  readonly main: Record<string, unknown>;
  /**
   * One foreign module's own exports, by the specifier the program named it by
   * — the same instance the Hexagon program is linked against, so a fixture
   * that records what it was asked can be interrogated directly.
   */
  readonly foreign: (specifier: string) => Promise<Record<string, unknown>>;
}

/**
 * Compiles a whole project — several Hexagon modules, prelude included — with
 * foreign `data:` modules beside it, and executes it.
 *
 * Several modules rather than one because the `KeyError` pin needs two: the
 * throw has to happen in a module that is not the one catching it, or the pin
 * would be about a single module's private agreement with itself rather than
 * about the `(owner, name)` pair §4.1 says makes one arm cover both brackets.
 */
async function run(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
  entry = "Main",
): Promise<Run> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#bracket${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) {
    moduleUrls.set(specifier, url(text));
  }
  const runtimeGlobals = project.runtimeGlobals;
  if (runtimeGlobals !== undefined) {
    moduleUrls.set(runtimeGlobals.path.replace(/\.js$/u, ".hex"), url(runtimeGlobals.text));
  }
  for (const data of project.dataUnits) {
    moduleUrls.set(data.path, url(link(data.javascript.text, data.path, moduleUrls)));
  }
  for (const module of project.modules) {
    // Keyed and linked by the module's **address** (Packages §6), which is what
    // the emitted specifiers name since #829, then a second pass for the bare
    // foreign specifiers the first leaves alone.
    const linked = link(module.javascript.text, module.path, moduleUrls).replace(
      /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
      (statement, prefix: string, _quote: string, specifier: string) => {
        const target = moduleUrls.get(specifier);
        return target === undefined ? statement : `${prefix}${JSON.stringify(target)};`;
      },
    );
    moduleUrls.set(module.path, url(linked));
  }
  const root = project.modules.find(({ name }) => name === entry);
  if (root === undefined) throw new Error(`no module \`${entry}\` in the compiled project`);
  return {
    main: (await import(/* @vite-ignore */ moduleUrls.get(root.path)!)) as Record<
      string,
      unknown
    >,
    foreign: async (specifier) =>
      (await import(/* @vite-ignore */ moduleUrls.get(specifier)!)) as Record<string, unknown>,
  };
}

/** The emitted JavaScript of a one-module program that must compile clean. */
function javascript(source: string): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

describe("the bracket reads a captured map (§4.1)", () => {
  /**
   * The whole surface in one observation: the bracket is legal on a `JsMap`, it
   * yields the value type rather than an `Option`, and the value it yields is
   * the one the foreign map bound — read out of the *capture*, which is what the
   * program actually holds (§2).
   */
  test("a present key yields the value, unwrapped", async () => {
    const { main } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Int)\n" +
          "\n" +
          'export fun probe(): Int = table!()["b"]\n']],
      { stock: 'export function table() { return new Map([["a", 1], ["b", 2]]); }\n' },
    );
    expect((main["probe"] as () => number)()).toBe(2);
  });

  /**
   * §4.3's equality regime, which the bracket inherits by doing nothing: no
   * `Hash` is required at the seat and none is threaded, so the lookup is the
   * native map's SameValueZero. Two equal-looking `String`s are one key — every
   * primitive behaves identically on both sides — and that is what makes the
   * pin above a lookup rather than a coincidence of construction.
   *
   * The absence of the constraint is also directly observable: a `Range` key
   * type is satisfiable here (below), and `Map(Range, v)` is not.
   */
  test("the key type carries no `Hash` obligation", () => {
    // `JsMap(Range, Int)` is the strongest form of the claim: `Range` has no
    // `Hash` instance at all (Collections Part 4 §4.4), so a bracket that
    // required one could not be written.
    expect(
      projectDiagnostics(
        "module Main\n\n" +
          "let span: Range = 1..3\n" +
          "let m: JsMap(Range, Int) = JsMap.fromSeq(Vector.toSeq([(span, 7)]))\n" +
          "export let read: Int = m[span]\n",
      ),
    ).toEqual([]);
  });
});

describe("absence throws the prelude `KeyError` (§4.1, §11)", () => {
  /**
   * The identity claim, and the only arrangement that can test it: the bracket
   * runs in `Reader`, the arm is written in `Main`, and the arm names `KeyError`
   * *bare* — the prelude declaration Collections Part 4 §4.3 owns, which §4.1
   * reuses rather than redeclaring.
   *
   * What makes this cross-module form the pin rather than a flourish: the
   * emitted throw is not a Hexagon constructor call but a payload the helper
   * builds itself, so the catch matches on the `(owner, name)` pair alone. A
   * helper that branded the *emitting* module would still be caught by an arm in
   * `Reader` and would sail past this one.
   */
  test("an absent key is caught by a `catch KeyError` arm in another module", async () => {
    const { main } = await run(
      [
        ["/reader.hex",
          "module Reader\n\n" +
            "export let lookup(m: JsMap(String, Int), key: String): Int = m[key]\n"],
        ["/main.hex",
          "module Main\n\n" +
            "import Reader\n" +
            'extern from "stock"\n' +
            "    fun table() ->! JsMap(String, Int)\n" +
            "\n" +
            "export fun probe(key: String): Int =\n" +
            "    try\n" +
            "        Reader.lookup(table!(), key)\n" +
            "    catch\n" +
            "        KeyError => -1\n"],
      ],
      { stock: 'export function table() { return new Map([["a", 1]]); }\n' },
    );
    const probe = main["probe"] as (key: string) => number;
    expect([probe("a"), probe("z")]).toEqual([1, -1]);
  });

  /**
   * The same payload from the other side: `Map.KeyError`, the qualified
   * spelling, catches a `JsMap` bracket's throw. One arm, both brackets — which
   * is the sentence §4.1 writes, and which is true only because the two helpers
   * build the payload from one piece of code.
   */
  test("the qualified `Map.KeyError` catches it too, and so does the persistent bracket's", async () => {
    const { main } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Int)\n" +
          "\n" +
          "let persistent: Map(String, Int) = Map.fromVector([(\"a\", 1)])\n" +
          "export fun both(): (Int, Int) =\n" +
          "    let foreign = try\n" +
          '        table!()["z"]\n' +
          "    catch\n" +
          "        Map.KeyError => 7\n" +
          "    let native = try\n" +
          '        persistent["z"]\n' +
          "    catch\n" +
          "        Map.KeyError => 8\n" +
          "    (foreign, native)\n"]],
      { stock: 'export function table() { return new Map([["a", 1]]); }\n' },
    );
    expect((main["both"] as () => [number, number])()).toEqual([7, 8]);
  });

  /**
   * The payload's own shape, read off the thrown JavaScript value: nullary
   * (nothing beyond the two fields every Hexagon exception carries), branded to
   * the *declaring* module, and named `KeyError`. The two brackets' throws are
   * compared field by field, because "the same `(owner, name)` pair" is the
   * literal contract and the arms above would also pass on two payloads that
   * merely agreed about `name`.
   */
  test("the two brackets throw the same shape", async () => {
    const { main } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Int)\n" +
          "\n" +
          "let persistent: Map(String, Int) = Map.fromVector([(\"a\", 1)])\n" +
          'export fun viaJsMap(): Int = table!()["z"]\n' +
          'export fun viaMap(): Int = persistent["z"]\n']],
      { stock: 'export function table() { return new Map([["a", 1]]); }\n' },
    );
    const thrown = (name: string): Record<string, unknown> => {
      try {
        (main[name] as () => number)();
      } catch (error) {
        return error as Record<string, unknown>;
      }
      throw new Error(`${name} did not throw`);
    };
    const foreign = thrown("viaJsMap");
    const native = thrown("viaMap");
    expect(foreign["name"]).toBe("KeyError");
    expect(foreign["$hex"]).toBe("Hex.Map");
    expect([foreign["name"], foreign["$hex"]]).toEqual([native["name"], native["$hex"]]);
    // Nullary: no payload slot, because a polymorphic key cannot be one
    // (Exceptions §2). `message` and `stack` are `Error`'s own.
    expect(Object.keys(foreign).filter((key) => key !== "stack")).toEqual(["name", "$hex"]);
  });
});

describe("a present `undefined` is not absence (§4.2 steps 2–4)", () => {
  /**
   * The pin the two-step lowering exists for, and the one a fused
   * `get`-plus-`undefined`-test fails. `Unit`'s representation *is* `undefined`
   * (Products §2.6), so the foreign map below binds `"here"` to exactly the
   * value a fused lowering would read as absence.
   *
   * Both halves are measured in one run, because the claim is a *distinction*:
   * the present entry answers, and the genuinely absent key throws.
   */
  test("a `JsMap(String, Unit)` entry bound to `undefined` is present", async () => {
    const { main } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Unit)\n" +
          "\n" +
          "export fun probe(key: String): Bool =\n" +
          "    try\n" +
          "        let _ = table!()[key]\n" +
          "        True\n" +
          "    catch\n" +
          "        KeyError => False\n"]],
      { stock: 'export function table() { return new Map([["here", undefined]]); }\n' },
    );
    const probe = main["probe"] as (key: string) => boolean;
    expect([probe("here"), probe("gone")]).toEqual([true, false]);
  });

  /**
   * The same distinction at a `Nullable(Int)` value, where the `undefined` is
   * not a representation accident but a value the type *names* — and where the
   * answer is observable rather than trivially `()`. `Nullable.undefined` and a
   * missing key are two different things, and the program can tell them apart:
   * the present one comes back and answers `isUndefined`, the absent one throws.
   */
  test("a present `Nullable.undefined` comes back as itself", async () => {
    const { main } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Nullable(Int))\n" +
          "\n" +
          "export fun probe(key: String): String =\n" +
          "    try\n" +
          "        let found = table!()[key]\n" +
          "        if Nullable.isUndefined(found) then \"present-undefined\"\n" +
          "        else if Nullable.isNull(found) then \"present-null\"\n" +
          "        else \"present-value\"\n" +
          "    catch\n" +
          "        KeyError => \"absent\"\n"]],
      {
        stock: "export function table() {\n" +
          '  return new Map([["u", undefined], ["n", null], ["v", 5]]);\n' +
          "}\n",
      },
    );
    const probe = main["probe"] as (key: string) => string;
    expect([probe("u"), probe("n"), probe("v"), probe("x")]).toEqual([
      "present-undefined",
      "present-null",
      "present-value",
      "absent",
    ]);
  });
});

describe("evaluation order and arity (§4.2 step 1)", () => {
  /**
   * "The map and key expressions are evaluated exactly once each, map first."
   * Both halves in one log: two effectful calls, one entry each, map before key.
   *
   * A lowering written inline rather than as a helper is what this guards
   * against — `m.has(k) ? m.get(k) : throw` mentions both twice, and a map
   * expression with an effect would run it twice. The argument positions of an
   * ordinary call are what buy the guarantee, which is why the helper takes two
   * parameters and does its work on those.
   */
  test("map first, key second, one evaluation each", async () => {
    const { main, foreign } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Int)\n" +
          "    fun key() ->! String\n" +
          "\n" +
          "export fun probe(): Int = table!()[key!()]\n"]],
      {
        stock: "export const events = [];\n" +
          "export function table() {\n" +
          '  events.push("map");\n' +
          '  return new Map([["a", 1]]);\n' +
          "}\n" +
          'export function key() { events.push("key"); return "a"; }\n',
      },
    );
    expect((main["probe"] as () => number)()).toBe(1);
    const { events } = (await foreign("stock")) as { events: readonly string[] };
    expect(events).toEqual(["map", "key"]);
  });

  /**
   * The same, on the throwing path. An absence must not re-evaluate anything
   * either: the `has` that answered `false` and the throw that follows both read
   * the locals the call already bound.
   */
  test("an absent key evaluates each side once as well", async () => {
    const { main, foreign } = await run(
      [["/main.hex",
        "module Main\n\n" +
          'extern from "stock"\n' +
          "    fun table() ->! JsMap(String, Int)\n" +
          "    fun key() ->! String\n" +
          "\n" +
          "export fun probe(): Int =\n" +
          "    try\n" +
          "        table!()[key!()]\n" +
          "    catch\n" +
          "        KeyError => -1\n"]],
      {
        stock: "export const events = [];\n" +
          "export function table() {\n" +
          '  events.push("map");\n' +
          '  return new Map([["a", 1]]);\n' +
          "}\n" +
          'export function key() { events.push("key"); return "z"; }\n',
      },
    );
    expect((main["probe"] as () => number)()).toBe(-1);
    const { events } = (await foreign("stock")) as { events: readonly string[] };
    expect(events).toEqual(["map", "key"]);
  });
});

describe("what the bracket is not (§4.3, §4.5, §11)", () => {
  /**
   * §4.3's last bullet, executed: `JsMap(Range, v)` is satisfiable, and a
   * `Range`-typed element on it is an **ordinary key lookup**. There is no
   * slicing meaning here to compete with it, so nothing needed deciding — the
   * checker has one unification and no `Range` arm, and this is what that
   * produces.
   *
   * The key is one `Range` *value*, bound once. Under SameValueZero a second
   * `1..3` is a different object and finds nothing, which is §4.3's structural-
   * keys paragraph rather than a defect — and the second half of the assertion
   * pins exactly that, so nobody later "fixes" the lookup into a structural one.
   */
  test("a `Range` key on a `JsMap(Range, v)` looks up, and does not slice", async () => {
    const { main } = await run(
      [["/main.hex",
        "module Main\n\n" +
          "let span: Range = 1..3\n" +
          "let m: JsMap(Range, Int) = JsMap.fromSeq(Vector.toSeq([(span, 7)]))\n" +
          "export let sameValue: Int = m[span]\n" +
          "export let equalLooking: Int =\n" +
          "    try\n" +
          "        m[1..3]\n" +
          "    catch\n" +
          "        KeyError => -1\n"]],
    );
    expect([main["sameValue"], main["equalLooking"]]).toEqual([7, -1]);
  });

  /**
   * And the refusal on the other side of §4.5: a `Range` element on a map whose
   * key type is not `Range` is the **ordinary element-type mismatch**, not a
   * slicing diagnostic and not a bespoke one. The message is the unifier's own,
   * which is the evidence that no slicing arm was written.
   */
  test("a `Range` element on a `JsMap(String, v)` is an ordinary type mismatch", () => {
    expect(
      projectDiagnostics(
        "module Main\n\n" + "export let read(m: JsMap(String, Int)): Int = m[1..3]\n",
      ),
    ).toEqual(["type mismatch: expected Range, found String"]);
    // Nothing offers a slice, an `at`, or a window.
    expect(
      projectDiagnostics(
        "module Main\n\n" + "export let read(m: JsMap(String, Int)): Int = m[1..3]\n",
      ).join(" "),
    ).not.toMatch(/slic|window/iu);
  });

  /**
   * §4.5's first bullet and §11's write-position row. The refusal is the
   * **existing corpus-wide** one — `[]` never appears in write position anywhere
   * in the language (Collections Part 1 §3.3) — and it is a resolver refusal, so
   * it lands before the receiver's type is even consulted. Pinned rather than
   * added to: a `JsMap`-specific message here would be a second sentence saying
   * what one already says.
   */
  test("the bracket in write position is the existing refusal", () => {
    expect(
      projectDiagnostics(
        "module Main\n\n" +
          "export let store(m: JsMap(String, Int), k: String, v: Int): Unit =\n" +
          "    m[k] := v\n",
      )[0],
    ).toBe("assignment targets a bare name; records and tuples are immutable");
  });

  /**
   * The enumeration §11 says gains `JsMap`. The receiver is a `Bool`, which is
   * the probe that stays honest: this test used a `JsSet` until #794 gave that
   * receiver a rewrite-naming refusal of its own (§5), which took this
   * sentence's place *at that receiver* without changing the sentence. A
   * persistent `Set` would only move the problem — #794 flagged a sibling
   * message naming `Set.contains` as a rider for James to rule on — whereas a
   * `Bool` has no bracket meaning anyone has ever proposed. The `JsSet`/`Set`
   * contrast is `js-set-bracket.test.ts`'s to own.
   */
  test("the generic refusal's enumeration names `JsMap`", () => {
    expect(
      projectDiagnostics(
        "module Main\n\n" + "export let read(b: Bool, x: Int): Int = b[x]\n",
      ),
    ).toEqual(["indexing requires a Vector, String, Map, JsMap, or Array value"]);
  });
});

describe("the emitted lowering (§4.2, normative)", () => {
  /**
   * The text §4.2 fixes, in the order it fixes it. Three lines and nothing
   * between them: the membership question, the read on its `true` branch, and
   * the throw beneath.
   *
   * This is the pin no execution can supply. A fused `if (v === undefined)`
   * shape passes every behavioural test in this file except the present-
   * `undefined` ones, and §4.2 item 4 forbids it *even where `v` cannot contain
   * `undefined`* — one lowering, no type-directed variants. So the shape is
   * asserted directly, and the `undefined` sweep below is what says the
   * forbidden variant is not there.
   */
  test("`has` before `get`, and no `undefined` test anywhere in the helper", () => {
    const text = javascript(
      "export let read(m: JsMap(String, Int), k: String): Int = m[k]\n",
    );
    const body = /^function __jsMapIndex\([\s\S]*?^\}$/mu.exec(text)?.[0];
    expect(body).toBeDefined();
    expect(body).toContain("function __jsMapIndex(__map, __key) {");
    expect(body).toContain("if (__map.has(__key)) return __map.get(__key);");
    expect(body).toContain('__error.name = "KeyError";');
    expect(body).toContain('__error.$hex = "Hex.Map";');
    // §4.2 item 4, as text: the word does not occur, so there is no test against
    // it and no branch that could confuse a stored `undefined` with absence.
    expect(body).not.toContain("undefined");
    // And no `Hash` dictionary reaches the call (§4.3) — two arguments, both of
    // them the program's own expressions.
    expect(text).toContain("__jsMapIndex(m, k)");
  });

  /**
   * The same emission on a map whose value type manifestly cannot hold
   * `undefined`, beside one whose value type is `Unit` — *one* helper, emitted
   * once, shared by both. §4.2 item 4's "no type-directed variants" is the claim,
   * and a type-directed emitter would be caught here and nowhere else.
   */
  test("one helper serves every value type", () => {
    const text = javascript(
      "export let a(m: JsMap(String, Int), k: String): Int = m[k]\n" +
        "export let b(m: JsMap(String, Unit), k: String): Unit = m[k]\n" +
        "export let c(m: JsMap(String, Nullable(Int)), k: String): Nullable(Int) = m[k]\n",
    );
    expect(text.match(/function __jsMapIndex\(/gu)).toHaveLength(1);
    expect(text).toContain("__jsMapIndex(m, k)");
  });
});
