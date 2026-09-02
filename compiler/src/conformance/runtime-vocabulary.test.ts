import { beforeAll, describe, expect, test } from "vitest";

import type { CompiledProject } from "../project.js";
import { compileFiles, runProject } from "../support/test-project.js";
import { codeOnly, freeIdentifiers } from "../support/free-identifiers.js";
import { RUNTIME_VOCABULARY, renderEveryHelper } from "../passes/emitter/emitter.js";

/**
 * Conformance for **FFI Part 7 §1.2's runtime vocabulary** — the rule that the
 * emitted JavaScript survives its own module (#666; correction record §14.7).
 *
 * §1.1's disease in the other file, and discovered by §1.1's implementation.
 * JavaScript resolves a name file-locally before the global scope, and the
 * emitted `.js` writes runtime text in the global vocabulary: the exception
 * helper's `new Error(…)` and `Object.assign`, the range and `Seq` machinery's
 * `Symbol.iterator`, the inbound adapter's `Boolean`/`TypeError`/`String`, the
 * memoizer's `WeakMap`, the derived helpers' `Math`/`Number`/`Array`, the match
 * lowering's `RangeError`, and Unit's own spelling `undefined`. A module-scope
 * binding under any of those captured every such reference in its module.
 *
 * The repair is §1.1's move in value space, with the protected spelling
 * manufactured rather than found — JavaScript protects no spelling of the global
 * scope, `globalThis` included — so a contested module imports the globals it
 * contests as `__`-reserved captures from the program's runtime module, `hex.js`
 * (Part 1 §8.3's reserved seat, now taken), Unit takes `void 0` exactly where
 * `undefined` is bound, and the unpublishable seats extend the `__binding`
 * rename. On the spelling alone, per module: a module binding no vocabulary
 * spelling emits the bare text it always did, byte-identically.
 *
 * **The capture classes are executed, never merely emitted.** Three of the four
 * measured severities produce *running* programs — a raise that throws the wrong
 * error, a loop that throws before its first iteration, values that are silently
 * wrong — and two of those emit text a reader would call correct. Each class
 * below therefore runs, and carries its **negative baseline**: the pre-repair
 * text, hand-written and executed, so the failure this repairs is a measurement
 * rather than a claim.
 */

/** Distinguishes otherwise-identical emitted text; see `runProject`'s note. */
let runTag = 0;

/** Executes one hand-written module, for the negative baselines. */
async function runJavaScript(text: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ moduleUrl(text))) as Record<string, unknown>;
}

/**
 * A `data:` URL for one hand-written module, tagged so two baselines whose text
 * happens to coincide are still two module instances.
 *
 * Returned rather than imported for the baselines whose subject is the *import*
 * itself: an aliased import local is the seat rule 4's missing leg was at, so
 * those have to be a real two-module graph.
 */
function moduleUrl(text: string): string {
  runTag += 1;
  return `data:text/javascript;charset=utf-8,${
    encodeURIComponent(`${text}\n// baseline ${runTag}\n`)
  }`;
}

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** The `name` and payload of whatever `call` threw, or `undefined` when it returned. */
function thrown(call: () => unknown): Record<string, unknown> | undefined {
  try {
    call();
  } catch (error) {
    const failure = error as { name?: string; message?: string; value?: unknown };
    return {
      name: failure.name,
      message: failure.message,
      value: failure.value,
      isError: error instanceof Error,
    };
  }
  return undefined;
}

describe("class 1 — `record Error` and `record Object` beside a raise", () => {
  const PROGRAM = "export record Error = {code: Int}\n" +
    "export record Object = {tag: Int}\n" +
    "exception Boom(value: Int)\n" +
    "export let raise(): Int = throw(Boom(3))\n";

  test("the raise reaches the real `Error`, and the helper says which spellings moved", () => {
    const text = javascript([["/main.hex", PROGRAM]]);

    // The import line is a manifest: exactly the two spellings this module
    // binds, and nothing else. `Symbol`, `String`, and the rest stay bare here
    // because the decision is per (module, spelling).
    expect(text).toContain('import { __Error, __Object } from "./hex.js";');
    expect(text).toContain(
      "  return __Object.assign(new __Error(__message), " +
        '{ $hex: "main", name: __name }, __fields);',
    );
    // Part 1 §10 stands absolute at both seats: the user's constructors keep
    // their spellings and their export names.
    expect(text).toContain("const Error = __record => __record;");
    expect(text).toContain("const Object = __record => __record;");
    expect(text).toContain("export { Error };");
  });

  test("executed: the raise throws the declared exception", async () => {
    const exports = await runProject([["/main.hex", PROGRAM]]);

    expect(thrown(exports["raise"] as () => number)).toEqual({
      name: "Boom",
      message: "",
      value: 3,
      isError: true,
    });
  });

  test("the negative baseline: unqualified, every raise throws `Error is not a constructor`", async () => {
    // What shipped before this rule, executed. The record's constructor stands
    // where the helper reads `Error`, so the helper's `new` finds an arrow.
    const exports = await runJavaScript(
      "function __exception(__name, __message, __fields) {\n" +
        '  return Object.assign(new Error(__message), { $hex: "main", name: __name }, __fields);\n' +
        "}\n" +
        "const Error = __record => __record;\n" +
        'export const raise = () => { throw __exception("Boom", "", { value: 3 }); };\n',
    );

    expect(thrown(exports["raise"] as () => number)).toMatchObject({
      name: "TypeError",
      message: "Error is not a constructor",
    });
  });
});

describe("class 2 — `record Symbol` beside a `for` loop", () => {
  const PROGRAM = "export record Symbol = {code: Int}\n" +
    "export let total(n: Int): Int =\n" +
    "    var sum = 0\n" +
    "    for i in 1..n\n" +
    "        sum := sum + i\n" +
    "    sum\n";

  test("the range's iterator key qualifies", () => {
    const text = javascript([["/main.hex", PROGRAM]]);

    expect(text).toContain('import { __Symbol } from "./hex.js";');
    expect(text).toContain("    *[__Symbol.iterator]() {");
  });

  test("executed: the loop runs", async () => {
    const exports = await runProject([["/main.hex", PROGRAM]]);

    expect((exports["total"] as (n: number) => number)(4)).toBe(10);
  });

  test("the negative baseline: unqualified, the loop throws before its first iteration", async () => {
    const exports = await runJavaScript(
      "function __range(__start, __end) {\n" +
        "  return { start: __start, end: __end, descending: false,\n" +
        "    *[Symbol.iterator]() {\n" +
        "      for (let __value = __start; __value <= __end; __value += 1) yield __value;\n" +
        "    },\n" +
        "  };\n" +
        "}\n" +
        "const Symbol = __record => __record;\n" +
        "export const total = n => {\n" +
        "  let sum = 0;\n" +
        "  for (const i of __range(1, n)) sum = sum + i;\n" +
        "  return sum;\n" +
        "};\n",
    );

    // The record's constructor has no `.iterator`, so the computed key is
    // `undefined` and the object carries no iteration protocol at all.
    expect(thrown(() => (exports["total"] as (n: number) => number)(4)))
      .toMatchObject({ name: "TypeError" });
  });
});

describe("class 3 — a bound `undefined`, the silent-wrong-value class", () => {
  test("a module-level binding: Unit takes `void 0` throughout", () => {
    const text = javascript([["/main.hex", [
      "export let undefined: Int = 1",
      "export let unit(): Unit = ()",
      "",
    ].join("\n")]]);

    // No import and no capture: `undefined` owes the runtime module nothing.
    // `void 0` is immune at every scope with no per-module machinery, which is
    // exactly why the reserved import — measured to work, §14.7 — is not used.
    expect(text).not.toContain("hex.js");
    expect(text).toBe(
      "const undefined = 1;\n" +
        "const unit = () => void 0;\n" +
        "export { undefined };\n" +
        "export { unit };\n",
    );
  });

  test("a function-scope binding moves the whole module, because `let` admits it", () => {
    // The one vocabulary member a function local can bind: `let` requires a
    // non-uppercase-start name, so every other spelling is a module-level
    // exposure only. The trigger reads the module's own symbols at every scope,
    // and the answer applies throughout — the Unit below is *inside* the
    // shadowing function, which is where the measured failure was.
    expect(javascript([["/main.hex", [
      "export let unit(): Unit =",
      "    let undefined = 1",
      "    ignore(undefined)",
      "    ()",
      "",
    ].join("\n")]])).toBe(
      "const unit = () => {\n" +
        "  const undefined = 1;\n" +
        "  undefined;\n" +
        "  return void 0;\n" +
        "};\n" +
        "export { unit };\n",
    );
  });

  test("executed: the Unit is the real `undefined`, not the shadowing value", async () => {
    // Two programs, because one module cannot hold both bindings — Hexagon
    // refuses the rebinding, which is the shadowing JavaScript would have
    // allowed and is exactly why the module-level and function-level exposures
    // are separate classes.
    const outer = await runProject([["/main.hex", [
      "export let undefined: Int = 1",
      "export let unit(): Unit = ()",
      "",
    ].join("\n")]]);
    const inner = await runProject([["/main.hex", [
      "export let unit(): Unit =",
      "    let undefined = 2",
      "    ignore(undefined)",
      "    ()",
      "",
    ].join("\n")]]);

    expect((outer["unit"] as () => unknown)()).toBeUndefined();
    expect((inner["unit"] as () => unknown)()).toBeUndefined();
  });

  test("the negative baseline: unqualified, every Unit in scope becomes the bound value", async () => {
    const exports = await runJavaScript(
      "const undefined = 1;\n" +
        "export const unit = () => undefined;\n" +
        "export const inner = () => {\n" +
        "  const undefined = 2;\n" +
        "  return undefined;\n" +
        "};\n",
    );

    // No throw, no diagnostic, no type-level symptom: the program runs and
    // answers the wrong value. This is why the trigger reads the *spelling*.
    expect((exports["unit"] as () => unknown)()).toBe(1);
    expect((exports["inner"] as () => unknown)()).toBe(2);
  });
});

describe("class 4 — `exception Boolean` beside a `Seq` boundary", () => {
  const PROGRAM = "export exception Boolean(value: Int)\n" +
    "export let count(): Int = Seq.length(Vector.toSeq([1, 2, 3]))\n";

  test("the inbound adapter's coercion qualifies", () => {
    const text = javascript([["/main.hex", PROGRAM]]);

    expect(text).toContain('import { __Boolean } from "./hex.js";');
    expect(text).toContain("            __step = __Boolean(__next.done)");
    // Per spelling: the same helper's `TypeError`, `String`, `Object`, `Error`,
    // and `Symbol` are untouched, because this module binds none of them.
    expect(text).toContain('              throw new TypeError("Iterator result " + String(__next)');
  });

  test("executed: `Seq.length` of a three-element sequence answers 3", async () => {
    const exports = await runProject([["/main.hex", PROGRAM]]);

    expect((exports["count"] as () => number)()).toBe(3);
  });

  test("the negative baseline: unqualified, the same call answers 0", async () => {
    // The adapter's `Boolean(__next.done)` reads the exception constructor,
    // which answers a branded object — truthy — so the first pull reports the
    // sequence ended. The second measured instance of the silent-wrong-value
    // class, and the reason a `.length` is the observation rather than a throw.
    const exports = await runJavaScript(
      "const Boolean = value => ({ $hex: \"main\", name: \"Boolean\", value });\n" +
        "export const ended = Boolean(1) ? 0 : 3;\n",
    );

    expect(exports["ended"]).toBe(0);
  });
});

describe("the two `SyntaxError` classes — the module never parsed at all", () => {
  test("`export let eval` binds a reserved local and publishes its own name", async () => {
    // Strict mode refuses `eval` and `arguments` as binding names, and an
    // emitted module is always strict, so the pre-repair `const eval = 7;` was
    // a load-time `SyntaxError`: nothing in the module ran. The rename is
    // lawful here on the lowercase gate — every JavaScript reserved word is
    // lowercase and a Hexagon type name is parser-gated uppercase, so a
    // `__binding` alias can carry a value's export seat but never a type's.
    expect(javascript([["/main.hex", "export let eval: Int = 7\n"]])).toBe(
      "const __binding0 = 7;\n" +
        "export { __binding0 as eval };\n",
    );

    const exports = await runProject([["/main.hex", "export let eval: Int = 7\n"]]);
    expect(exports["eval"]).toBe(7);
  });

  test("`arguments` is the same hole and closes with it", async () => {
    expect(javascript([["/main.hex", "export let arguments: Int = 8\n"]])).toBe(
      "const __binding0 = 8;\n" +
        "export { __binding0 as arguments };\n",
    );

    const exports = await runProject([["/main.hex", "export let arguments: Int = 8\n"]]);
    expect(exports["arguments"]).toBe(8);
  });

  // `import { await }` — the rename's former missing leg (§1.2 rule 4) — is
  // retired outright by #762 rather than re-aimable: the sole import form
  // binds a mandatory uppercase-start module alias, which by Lexer §3.2's own
  // case split can never collide with a lowercase JavaScript reserved word,
  // so no import can introduce a hazardous local again. The Modules §3.2
  // respelling that reaches `await` bare — `let await = Lib.await` — is not a
  // new leg either: it is an ordinary declaration binding the name `await`,
  // the same rename path `export let eval` and `export let arguments` already
  // pin below.
});

// Pre-#762 this held two legs — a named import's local (`import { Error }`,
// binding `Error` verbatim) and a namespace alias (`import module Error`,
// lowering to `import * as Error`) — because the two forms landed in
// JavaScript differently and only one of them read as a TypeScript namespace
// import. #762 leaves exactly the second shape: every import is a module
// alias, always `import * as Alias`, so the two legs are one. The alias
// remains a live trigger leg in its own right, because an alias's spelling is
// the module's own uppercase-start choice and can still land on a vocabulary
// word — that is what the surviving test below measures. A named import's
// distinct JavaScript shape has no seat left to re-aim: nothing in the
// grammar emits `import { X }` for a user-chosen local any more.
describe("the trigger's cross-module leg", () => {
  test("an alias contests too — the leg a namespace import sits on", async () => {
    // Named in §1.2's trigger deliberately, against §1.1's grain: `import
    // Error from "./lib"` lowers to `import * as Error`, which occupies
    // JavaScript's value-name space like any binding, where a TypeScript
    // namespace import leaves the plain type-name space alone (§1.1's
    // measured control). The alias keeps its own spelling; what steps aside
    // is the compiler's reference.
    const FILES = [
      ["/lib.hex", "export let zero: Int = 0\n"],
      ["/main.hex", 'import Error from "./lib"\n' +
        "exception Boom(value: Int)\n" +
        "export let raise(): Int = throw(Boom(3))\n" +
        "export let z: Int = Error.zero\n"],
    ] as const;
    const text = javascript(FILES);

    expect(text).toContain('import { __Error } from "./hex.js";');
    expect(text).toContain("new __Error(__message)");
    expect(text).toContain('import * as Error from "./lib.js";');
    expect(text).not.toContain("Error_1");

    const exports = await runProject(FILES);
    expect(thrown(exports["raise"] as () => number)).toMatchObject({ name: "Boom" });
    expect(exports["z"]).toBe(0);
  });

  test("the negative baseline: a namespace alias really does capture in JavaScript", async () => {
    const exports = await runJavaScript(
      "const zero = 0;\n" +
        "export const read = () => {\n" +
        "  const Error = { zero };\n" +
        "  try { return new Error(\"boom\").message; } catch (failure) { return failure.name; }\n" +
        "};\n",
    );

    expect((exports["read"] as () => string)()).toBe("TypeError");
  });
});

describe("the minted-local negative — the trigger reads source bindings only", () => {
  test("a companion operation named `undefined` aliases, and Unit stays `undefined`", async () => {
    // §1.2 rule 1: the minted import local is the one compiler-chosen `.js`
    // spelling that can mirror an export's, so the vocabulary and the reserved
    // words join its probe. A companion export named `undefined` is legal
    // Hexagon, and a dot call reaches it with no import of its own to name it.
    //
    // The second half is what makes this the *negative*: rule 1's aliasing runs
    // after rule 2's trigger and puts nothing into it, so this module — which
    // binds no vocabulary spelling of its own — keeps `undefined` for Unit.
    const FILES = [
      ["/lib.hex", "export record Box = {n: Int}\nexport let undefined(b: Box): Int = b.n\n"],
      ["/main.hex", 'import { Box } from "./lib"\n' +
        "export let use(b: Box): Int = b.undefined()\n" +
        "export let unit(): Unit = ()\n"],
    ] as const;

    expect(javascript(FILES)).toBe(
      'import { undefined as __undefined } from "./lib.js";\n' +
        'import { Box } from "./lib.js";\n' +
        "const use = b => __undefined(b);\n" +
        "const unit = () => undefined;\n" +
        "export { use };\n" +
        "export { unit };\n",
    );

    const exports = await runProject(FILES);
    expect((exports["use"] as (b: { n: number }) => number)({ n: 5 })).toBe(5);
    expect((exports["unit"] as () => unknown)()).toBeUndefined();
  });

  /**
   * The second minted channel, and the one that reaches furthest: importing a
   * constraint puts every member in scope (Modules §3.1), so a polymorphic call
   * of a member binds a local under the member's own spelling in a module that
   * named only the constraint. Both hazard classes are live there, and both were
   * measured before the probe: `undefined` gave the importing module a local
   * that every Unit in it then read, and `eval` gave it a binding strict mode
   * refuses — a module that never parsed.
   */
  const CONSTRAINT = (member: string): readonly (readonly [string, string])[] => [
    ["/lib.hex", [
      "export constraint Boxy<a> =",
      `    ${member}(x: a): Int`,
      "",
      "export record Box = {n: Int}",
      "honor Boxy<Box> =",
      `    ${member}(x) = x.n`,
      "",
    ].join("\n")],
    ["/main.hex", [
      'import { Boxy } from "./lib"',
      `export let twice<a: Boxy>(x: a): Int = ${member}(x) + ${member}(x)`,
      "export let unit(): Unit = ()",
      "",
    ].join("\n")],
  ];

  test("a constraint member named `undefined`, called polymorphically", async () => {
    const text = javascript(CONSTRAINT("undefined"));

    expect(text).toContain('import { __undefined as __binding0 } from "./lib.js";');
    // The importer binds no vocabulary spelling of its own, so its Unit is bare.
    expect(text).toContain("const unit = () => undefined;");

    const exports = await runProject(CONSTRAINT("undefined"));
    expect((exports["unit"] as () => unknown)()).toBeUndefined();
  });

  test("the negative baseline: unaliased, every Unit in the importer is the forwarder", async () => {
    // The pre-repair importer, executed: a real two-module graph, because the
    // seat is the import local itself. The module loads clean, nothing throws,
    // and `unit()` answers the forwarder function — the silent-wrong-value class
    // again, one channel over from class 3's.
    const library = moduleUrl(
      "export const __undefined = (x, evidence) => evidence.undefined(x);\n",
    );
    const exports = await runJavaScript(
      `import { __undefined as undefined } from ${JSON.stringify(library)};\n` +
        "export const unit = () => undefined;\n",
    );

    expect(typeof (exports["unit"] as () => unknown)()).toBe("function");
  });

  test("a constraint member named `eval`, on both sides of the import", async () => {
    const text = javascript(CONSTRAINT("eval"));

    expect(text).toContain('import { __eval as __binding0 } from "./lib.js";');
    // The declaring module's own forwarder took the rename at its export seat,
    // which the emitter already did; this is the importer's missing leg.
    expect(javascript(CONSTRAINT("eval"), "/lib.hex")).toContain(
      "export { __binding0 as __eval };",
    );

    // The observation is that the module *loads*: a strict-mode `eval` binding
    // is a load-time `SyntaxError`, so importing it at all is the whole test.
    // `twice` is constrained, so it publishes under its internal name (§6.5).
    const exports = await runProject(CONSTRAINT("eval"));
    expect(Object.keys(exports)).toContain("__twice");
  });

  test("the negative baseline: unaliased, the importer is a `SyntaxError` at load", async () => {
    // Strict mode refuses `eval` as a *binding* name, and an import specifier's
    // local is one, so the importing module never parsed — nothing in it ran and
    // no diagnostic preceded it.
    const library = moduleUrl("export const __eval = (x, evidence) => evidence.eval(x);\n");

    await expect(runJavaScript(
      `import { __eval as eval } from ${JSON.stringify(library)};\n` +
        "export const twice = (x, evidence) => eval(x, evidence) + eval(x, evidence);\n",
    )).rejects.toThrow(SyntaxError);
  });

  test("the declaring module of an `undefined` member contests on its own account", () => {
    // The forwarder is a *source*-derived top-level binding there — Constraints
    // §6.5's `const undefined = (x, evidence) => …` — so that module is
    // contested by rule 2's trigger and spells its own Unit `void 0`.
    expect(javascript([["/main.hex", [
      "export constraint Boxy<a> =",
      "    undefined(x: a): Int",
      "",
      "export let unit(): Unit = ()",
      "",
    ].join("\n")]])).toContain("const unit = () => void 0;");
  });

  test("a minted local is subtracted from the trigger, so the importer stays uncontested", () => {
    // Rule 1 and rule 2 read together. A constraint member named `console` puts
    // the spelling into `moduleLevelBindings` through the import line, but rule 1
    // has already decided that the minted local does not take it — so the
    // *source* quantity rule 2 reads does not contain it either, and the
    // importing module owes the runtime module nothing.
    //
    // Left in, the module emitted `import { __console } from "./hex.js";` and
    // referenced `__console` nowhere: an import line that is not the manifest
    // §1.2 says it is, and an uncontested module that is no longer
    // byte-identical. Measured, and the reach is `console` alone — a member is a
    // term, so non-uppercase-start, and `undefined` is settled by the
    // function-scope symbol check that an imported member never reaches.
    const FILES = [
      ["/lib.hex", [
        "export constraint Boxy<a> =",
        "    console(x: a): Int",
        "",
        "export record Box = {n: Int}",
        "honor Boxy<Box> =",
        "    console(x) = x.n",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import { Boxy, Box } from "./lib"',
        "export let use(b: Box): Int = console(b)",
        "export let unit(): Unit = ()",
        "",
      ].join("\n")],
    ] as const;
    const text = javascript(FILES);

    expect(text).not.toContain("hex.js");
    expect(text).toBe(
      'import { __Boxy_Box_console } from "./lib.js";\n' +
        'import { Box } from "./lib.js";\n' +
        'import { __Boxy_Box } from "./lib.js";\n' +
        "const use = b => __Boxy_Box_console(b);\n" +
        "const unit = () => undefined;\n" +
        "export { __Boxy_Box };\n" +
        "export { use };\n" +
        "export { unit };\n",
    );

    // The *declaring* module still contests, and must: Constraints §6.5's
    // forwarder is a source-derived `const console = …` there, so anything in it
    // writing `console` bare would read the forwarder.
    expect(javascript(FILES, "/lib.hex")).toContain('import { __console } from "./hex.js";');
  });

  test("a routed member seat declines the member's spelling for the same two classes", async () => {
    // Dictionary Sharing §8 hands a routed seat the member's *source* spelling
    // where nothing in the consumer contests it, which makes the seat a minted
    // import local mirroring an export's — rule 1's population, at its third
    // seat. A **namespace** import is what reaches it: the constraint's members
    // then sit in the contest set under their internal locals rather than under
    // their own spellings, so the earlier filters decline and this one decides.
    //
    // Measured reachable, in both classes: with the probe removed the importer
    // emits `import { __Boxy_Box_undefined as undefined }` and every Unit in it
    // reads the seat, and `… as eval` is a module that does not parse.
    const namespaced = (member: string): readonly (readonly [string, string])[] => [
      ["/lib.hex", [
        "export constraint Boxy<a> =",
        `    ${member}(x: a): Int`,
        "",
        "export record Box = {n: Int}",
        "honor Boxy<Box> =",
        `    ${member}(x) = x.n`,
        "",
      ].join("\n")],
      ["/main.hex", [
        'import Lib from "./lib"',
        `export let use(b: Lib.Box): Int = Lib.${member}(b)`,
        "export let unit(): Unit = ()",
        "",
      ].join("\n")],
    ];

    for (const member of ["undefined", "eval"]) {
      const text = javascript(namespaced(member));

      expect(text).toContain(`import { __Boxy_Box_${member} } from "./lib.js";`);
      expect(text).not.toContain(`as ${member} }`);
      expect(text).toContain(`const use = b => __Boxy_Box_${member}(b);`);
      // The importer binds neither spelling, so its own Unit is untouched.
      expect(text).toContain("const unit = () => undefined;");
    }

    // The control that shows the seat really does take the source spelling when
    // the member's name is not a hazard — without it the assertions above would
    // hold in a compiler that never handed out a source spelling at all.
    expect(javascript(namespaced("measure"))).toContain(
      'import { __Boxy_Box_measure as measure } from "./lib.js";',
    );

    const exports = await runProject(namespaced("undefined"));
    expect((exports["use"] as (b: { n: number }) => number)({ n: 5 })).toBe(5);
    expect((exports["unit"] as () => unknown)()).toBeUndefined();
  });
});

/**
 * A corpus that binds no runtime-vocabulary spelling anywhere, exercising every
 * family of reference seat the emitter has: helper bodies, the inline `Unit` and
 * empty-tuple spellings, interpolation and derived `show`/`hash`, the match
 * lowering's unreachable arm, the range and `Seq` machinery, and the collection
 * brackets.
 *
 * It serves twice: as the byte-identity negative below, and as the tripwire's
 * inline-seat input — the seats no rendered helper covers.
 */
const UNCONTESTED_CORPUS: readonly string[] = [
  "exception Boom(line: Int, message: String)\n" +
    "export let raise(n: Int): Int =\n" +
    "    if n > 0 then throw(Boom(3, \"bad\")) else n\n" +
    "export let caught(n: Int): Int =\n" +
    "    try\n" +
    "        raise(n)\n" +
    "    catch\n" +
    "        Boom(line, _) => line\n",
  "export let loop(n: Int): Int =\n" +
    "    var total = 0\n" +
    "    for i in 1..n\n" +
    "        total := total + i\n" +
    "    total\n" +
    "export let text(x: Int): String = \"value ${x} here\"\n" +
    "export let empty: Unit = ()\n",
  "export let v: Vector(Int) = [1, 2, 3]\n" +
    "export let first: Int = v[1]\n" +
    "export let sliced: Vector(Int) = v[1..2]\n" +
    "export let m: Map(String, Int) = Map.fromVector([(\"a\", 1)])\n" +
    "export let looked: Int = m[\"a\"]\n" +
    "export let st: Set(Int) = Set.fromVector([1, 2, 3])\n" +
    "export let ch: String = \"hello\"[1]\n" +
    "export let sub: String = \"hello\"[1..3]\n" +
    "export let ms: String = Show.show(m)\n" +
    "export let mh: Int = Hash.hash(m)\n" +
    "export let ss: String = Show.show(st)\n" +
    "export let sh: Int = Hash.hash(st)\n" +
    "export let vs: String = Show.show(v)\n" +
    "export let vh: Int = Hash.hash(v)\n" +
    "export let me: Bool = Eq.equals(m, m)\n" +
    "export let se: Bool = Eq.equals(st, st)\n",
  "export let n(): Int = Seq.length(Vector.toSeq([1, 2, 3]))\n" +
    "export let memo(): Seq(Int) = Seq.memoize(Vector.toSeq([1, 2]))\n" +
    "export let counted(): Seq(Int) = Seq.take(Seq.iterate(0, (x) => x + 1), 3)\n",
  "export let probe(): Unit = Debug.log(\"hi\")\n",
  "export let d(a: Int, b: Int): Int = Int.div(a, b)\n" +
    "export let fl(a: Float, b: Float): Bool = a == b\n" +
    "export let cmp(a: String, b: String): Ordering = Ord.compare(a, b)\n" +
    "export let bi: BigInt = 12n\n" +
    "export let widened(x: Int): BigInt = x\n" +
    "export let narrowed(x: BigInt): Option(Int) = BigInt.toInt(x)\n" +
    "export let bs: String = Show.show(12n)\n" +
    "export let fx: Float = Float.pow(2.0, 3.0)\n" +
    "export let sx: String = Show.show(1.5)\n",
  "export union Shape = Circle(Int) | Rect(Int, Int)\n" +
    "export let area(s: Shape): Int =\n" +
    "    match s\n" +
    "        Circle(0) => 1\n" +
    "        Circle(_) => 2\n" +
    "        Rect(0, 0) => 3\n" +
    "        Rect(_, _) => 4\n",
  "export record Point derives (Eq, Ord, Show, Hash) = {x: Int, y: Float}\n" +
    "export let p: Point = Point({x = 1, y = 2.0})\n" +
    "export let s: String = Show.show(p)\n" +
    "export let h: Int = Hash.hash(p)\n" +
    "export let e: Bool = Eq.equals(p, p)\n" +
    "export let o: Ordering = Ord.compare(p, p)\n" +
    "export let t: String = Show.show((1, \"a\"))\n" +
    "export let th: Int = Hash.hash((1, \"a\"))\n" +
    "export let te: Bool = Eq.equals((1, \"a\"), (1, \"a\"))\n",
];

/**
 * The corpus compiled once, as **one program**: its members are independent
 * modules that import nothing from each other, and compiling them together
 * pays for the prelude's injection once instead of eight times.
 */
let compiledCorpus: CompiledProject | undefined;

function corpus(): CompiledProject {
  return compiledCorpus ??= compileFiles(
    UNCONTESTED_CORPUS.map((source, index) => [`/corpus${index}.hex`, source] as const),
  );
}

// Compiled in a hook rather than inside whichever test asks first, so the one
// slow thing in this file is not charged to a per-test timeout under a parallel
// run — the failure that would report as a timeout in an unrelated assertion.
beforeAll(() => {
  corpus();
});

/**
 * One module binding **every** capturable spelling at once, and reaching every
 * family of seat that writes one: the exception helper, the range, the `Seq`
 * spine and its memoizer, the map bracket, the derived `show`/`hash`/`compare`
 * walks, string interpolation, the vector and string brackets, the `BigInt`
 * widening, the match lowering's unreachable arm, and Unit.
 *
 * The uppercase members arrive as union constructors rather than as records:
 * a constructor binds at module level in the emitted JavaScript exactly as a
 * record's does, and `String`, `Number`, and `Array` are already spoken for as
 * type names.
 */
const ALL_CONTESTED = [
  "export union Contested =",
  "    Error(Int)",
  "    | Object(Int)",
  "    | Symbol(Int)",
  "    | Boolean(Int)",
  "    | TypeError(Int)",
  "    | RangeError(Int)",
  "    | String(Int)",
  "    | WeakMap(Int)",
  "    | Math(Int)",
  "    | Number(Int)",
  "    | Array(Int)",
  "    | BigInt(Int)",
  "",
  "export let console: Int = 1",
  "export let undefined: Int = 2",
  "",
  "exception Boom(value: Int)",
  "export let raise(): Int = throw(Boom(3))",
  "export let loop(n: Int): Int =",
  "    var sum = 0",
  "    for i in 1..n",
  "        sum := sum + i",
  "    sum",
  "export let counted(): Int = Seq.length(Vector.toSeq([1, 2, 3]))",
  "export let memo(): Seq(Int) = Seq.memoize(Vector.toSeq([1, 2]))",
  "export let unit(): Unit = ()",
  "export let shown(x: Int): String = \"value ${x}\"",
  "export let vs: String = Show.show([1, 2, 3])",
  "export let vh: Int = Hash.hash([1, 2, 3])",
  "export let cs: Ordering = Ord.compare(\"a\", \"b\")",
  "export let big(x: Int): BigInt = x",
  "export let sliced: Vector(Int) = [1, 2, 3][1..2]",
  "export let ch: String = \"hello\"[1]",
  "export let m: Map(String, Int) = Map.fromVector([(\"a\", 1)])",
  "export let looked: Int = m[\"a\"]",
  "export union Flag = On | Off",
  "export let flag(f: Flag): Int =",
  "    match f",
  "        On => 1",
  "        Off => 0",
  "",
].join("\n");

describe("completeness — the worst-contested module writes no bare global", () => {
  test("every seat steps around every spelling, in one module", () => {
    const text = javascript([["/main.hex", ALL_CONTESTED]]);

    // The manifest names the whole capturable vocabulary, because this module
    // binds the whole of it.
    expect(text).toContain(
      "import { __Array, __BigInt, __Boolean, __console, __Error, __Math, __Number, " +
        '__Object, __RangeError, __String, __Symbol, __TypeError, __WeakMap } from "./hex.js";',
    );
    // And the claim that matters, swept rather than spot-checked: **no
    // compiler-written line of this module spells any vocabulary member bare.**
    // The user's own declaration and export lines are the sole legitimate
    // occurrences — Part 1 §10, at both seats — so they are the only lines
    // excluded, by their declared name rather than by their shape. Everything
    // that remains was written by the emitter, and a seat the qualification
    // missed is the one bare word left in it.
    //
    // Deliberately not `freeIdentifiers`: a *free* identifier is the wrong
    // question here, because the user's `const Error = …` binds the spelling, so
    // an unqualified `new Error(…)` in a helper would read as bound and the
    // assertion would pass vacuously. The lookarounds are what make this a
    // reference check rather than a substring one — `__Error`, `IndexError`, and
    // `"SliceError"` all leave the word alone.
    const own = new Set<string>(RUNTIME_VOCABULARY);
    const emitterWritten = codeOnly(text).split("\n").filter((line) => {
      const declared = /^const ([A-Za-z_$][\w$]*) = /u.exec(line)?.[1] ??
        /^export \{ ([A-Za-z_$][\w$]*) \};$/u.exec(line)?.[1];
      return declared === undefined || !own.has(declared);
    }).join("\n");
    for (const member of RUNTIME_VOCABULARY) {
      expect(emitterWritten).not.toMatch(new RegExp(`(?<![\\w$.])${member}(?![\\w$])`, "u"));
    }
    expect(text).toContain("const unit = () => void 0;");
    // The seats the sweep above is silent about because they are *inside*
    // qualified references, spot-checked so the families are on the record.
    expect(text).toContain("new __Error(__message)");
    expect(text).toContain("*[__Symbol.iterator]()");
    expect(text).toContain("__Boolean(__next.done)");
    expect(text).toContain("new __WeakMap()");
    expect(text).toContain('throw new __RangeError("Unexpected pattern.");');
    expect(text).toContain("__BigInt(x)");
    expect(text).toContain("__Array.from(__text)");
    expect(text).toContain("__Number.isNaN(__value)");
    expect(text).toContain("__Math.imul(");
    expect(text).toContain("new __TypeError(");
  });

  test("executed: the whole of it runs", async () => {
    const exports = await runProject([["/main.hex", ALL_CONTESTED]]);

    expect(thrown(exports["raise"] as () => number)).toMatchObject({ name: "Boom" });
    expect((exports["loop"] as (n: number) => number)(4)).toBe(10);
    expect((exports["counted"] as () => number)()).toBe(3);
    expect((exports["unit"] as () => unknown)()).toBeUndefined();
    expect((exports["shown"] as (x: number) => string)(7)).toBe("value 7");
    expect(exports["vs"]).toBe("[1, 2, 3]");
    expect(exports["looked"]).toBe(1);
    expect((exports["big"] as (x: number) => bigint)(3)).toBe(3n);
    expect((exports["ch"] as string)).toBe("h");
    expect([...(exports["sliced"] as Iterable<number>)]).toEqual([1, 2]);
  });
});

describe("the negatives — an uncontested module emits the text it always did", () => {
  test("nothing in the corpus imports a capture, takes `void 0`, or owes a runtime module", () => {
    // The byte-identity claim in the form a single run can check: the two
    // spellings this rule can introduce appear nowhere, and no program of the
    // corpus asks for `hex.js`. The whole-file pins the rest of this suite
    // carries — and every `toBe` in the sibling conformance files, which this
    // change left untouched — are the byte-for-byte half.
    const project = corpus();
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(project.runtimeGlobals).toBeUndefined();
    for (const module of project.modules) {
      expect(module.javascript.text).not.toContain("hex.js");
      expect(module.javascript.text).not.toContain("void 0");
      expect(module.javascript.importsRuntimeGlobals).toBe(false);
      for (const member of RUNTIME_VOCABULARY) {
        expect(module.javascript.text).not.toContain(`__${member}`);
      }
    }
  });

  test("a representative uncontested module, pinned whole", () => {
    expect(javascript([["/main.hex", "exception Boom(value: Int)\n" +
      "export let raise(): Int = throw(Boom(3))\n"]])).toBe(
      "function __exception(__name, __message, __fields) {\n" +
        '  return Object.assign(new Error(__message), { $hex: "main", name: __name }, __fields);\n' +
        "}\n" +
        "\n" +
        'const Boom = value => __exception("Boom", "", { value });\n' +
        "const raise = () => (() => { throw Boom(3); })();\n" +
        "export { raise };\n",
    );
  });
});

describe("the runtime module takes Part 1 §8.3's reserved seat", () => {
  test("its bytes depend on the vocabulary alone, not on the program that asked", () => {
    const first = compileFiles([["/main.hex", "export record Error = {code: Int}\n" +
      "exception Boom(value: Int)\n" +
      "export let raise(): Int = throw(Boom(3))\n"]]).runtimeGlobals;
    const second = compileFiles([["/main.hex", "export record Symbol = {code: Int}\n" +
      "export let total(n: Int): Int =\n" +
      "    var sum = 0\n" +
      "    for i in 1..n\n" +
      "        sum := sum + i\n" +
      "    sum\n"]]).runtimeGlobals;

    // Two programs contesting *different* spellings, one text: the full
    // vocabulary always, so nothing about the file is a function of the caller.
    expect(second?.text).toBe(first?.text);
    expect(first?.text).toBe(
      "const __Array = globalThis.Array,\n" +
        "  __BigInt = globalThis.BigInt,\n" +
        "  __Boolean = globalThis.Boolean,\n" +
        "  __console = globalThis.console,\n" +
        "  __Error = globalThis.Error,\n" +
        "  __Math = globalThis.Math,\n" +
        "  __Number = globalThis.Number,\n" +
        "  __Object = globalThis.Object,\n" +
        "  __RangeError = globalThis.RangeError,\n" +
        "  __String = globalThis.String,\n" +
        "  __Symbol = globalThis.Symbol,\n" +
        "  __TypeError = globalThis.TypeError,\n" +
        "  __WeakMap = globalThis.WeakMap;\n" +
        "export { __Array, __BigInt, __Boolean, __console, __Error, __Math, __Number, " +
        "__Object, __RangeError, __String, __Symbol, __TypeError, __WeakMap };\n",
    );
  });

  test("it follows §8.3's probed stem and its placement, and `hex.d.ts` does not grow", () => {
    // One stem, one module identity: the code home follows whatever filename
    // the type home's probe settled, and the probe's input is the source
    // basenames, so the stem is defined for a program owing `hex.js` alone.
    const collided = compileFiles([
      ["/src/hex.hex", "export let z: Int = 0\n"],
      ["/src/main.hex", "export record Error = {code: Int}\n" +
        "exception Boom(value: Int)\n" +
        "export let raise(): Int = throw(Boom(3))\n"],
    ]);
    expect(collided.runtimeGlobals?.path).toBe("/src/hex1.js");
    expect(javascript(
      [["/src/hex.hex", "export let z: Int = 0\n"], ["/src/main.hex",
        "export record Error = {code: Int}\n" +
        "exception Boom(value: Int)\n" +
        "export let raise(): Int = throw(Boom(3))\n"]],
      "/src/main.hex",
    )).toContain('import { __Error } from "./hex1.js";');

    // The declaration module is untouched: no generated `.d.ts` imports the
    // runtime module's exports, and declaring them would surface reserved names
    // in every consumer's `Hex` namespace. The two artefacts are emitted
    // independently, each exactly when owed — here, only the executable one.
    expect(collided.runtimeDeclarations).toBeUndefined();
  });

  test("a module below the root spells the specifier relative to itself", () => {
    expect(javascript([
      ["/src/a/main.hex", "export record Error = {code: Int}\n" +
        "exception Boom(value: Int)\n" +
        "export let raise(): Int = throw(Boom(3))\n"],
      ["/src/b/other.hex", "export let z: Int = 0\n"],
    ], "/src/a/main.hex")).toContain('import { __Error } from "../hex.js";');
  });

  test("executed: a contested program loads through it", async () => {
    // The obligation §8.3's type-only artefact never carried. A host that
    // materializes only source-derived modules loses every contested program at
    // its first import, so the execution set carries this one like a prelude
    // module — `runProject` is this repo's instance of that.
    const exports = await runProject([["/main.hex", "export record Error = {code: Int}\n" +
      "export record Object = {tag: Int}\n" +
      "exception Late(message: String)\n" +
      "export let boom(): Int = throw(Late(\"gone\"))\n"]]);

    expect(thrown(exports["boom"] as () => number)).toMatchObject({
      name: "Late",
      message: "gone",
    });
  });
});

/**
 * **The tripwire** (§1.2, §14.7's conformance bullet).
 *
 * The vocabulary is defined by the emitter's own references, so the one thing
 * that can silently falsify it is the emitter growing a reference the list does
 * not hold — a helper moved into module scope, an inline seat reaching for a new
 * global. This renders every helper and scans every module of the corpus above,
 * and asserts the globals they name are a subset of the single-sourced list, so
 * the capturable set moves only by conscious edit.
 *
 * The program's runtime module is deliberately not scanned: it is the capture
 * rather than a reference seat, its `globalThis` is safe by construction (the
 * module binds only reserved names, so nothing there can be shadowed), and
 * scanning it would put the qualifier itself into the vocabulary it guards.
 */
describe("the tripwire — the capturable set moves only by conscious edit", () => {
  /**
   * Every global the emitter's own text can name, from both seat families.
   *
   * A helper is rendered on its own, so the names it reaches for in the module
   * around it — a sibling helper, a runtime operation's local — read as free
   * here. They are dropped on Lexer §3.2's prefix, which is the same ground
   * every other probe in the corpus rests on and is sound in this direction
   * too: a name the emitter generated is a name the emitter bound, and no
   * global spelling starts with the reservation.
   */
  let scanned: ReadonlySet<string> | undefined;

  /** The scan, run once: compiling the corpus twice is the file's slowest thing. */
  function referencedGlobals(): ReadonlySet<string> {
    return scanned ??= scanReferencedGlobals();
  }

  function scanReferencedGlobals(): ReadonlySet<string> {
    const globals = new Set<string>();
    const collect = (text: string): void => {
      for (const name of freeIdentifiers(text)) {
        if (!name.startsWith("__")) globals.add(name);
      }
    };
    for (const helper of renderEveryHelper()) collect(helper);
    for (const module of corpus().modules) collect(module.javascript.text);
    return globals;
  }

  test("every global the emitted text names is in the vocabulary", () => {
    const vocabulary = new Set<string>(RUNTIME_VOCABULARY);
    expect([...referencedGlobals()].filter((name) => !vocabulary.has(name)).sort()).toEqual([]);
  });

  test("and every vocabulary member is genuinely referenced", () => {
    // The other direction, which is what keeps the assertion above from passing
    // vacuously: a corpus that exercised nothing would satisfy any subset claim,
    // and a member no seat writes would be dead weight in a list whose whole
    // authority is that it is the feeder's.
    const referenced = referencedGlobals();
    expect(RUNTIME_VOCABULARY.filter((name) => !referenced.has(name))).toEqual([]);
  });

  test("the scanner can fail: a body naming an unlisted global is reported", () => {
    // A tripwire that cannot fire asserts nothing. This is the shape of the
    // edit it exists to catch — a helper reaching for a global the list does not
    // hold — fed through the same scanner, with the three things a substring
    // probe would get wrong sitting beside it: a global's name inside a string,
    // a property access, and an object key.
    const hypothetical = 'function __probe(__value) {\n' +
      '  const __keys = Reflect.ownKeys(__value);\n' +
      '  return { Reflect: __value.Reflect, name: "Reflect", keys: __keys };\n' +
      "}\n";
    const vocabulary = new Set<string>(RUNTIME_VOCABULARY);

    expect([...freeIdentifiers(hypothetical)].sort()).toEqual(["Reflect"]);
    expect([...freeIdentifiers(hypothetical)].filter((name) => !vocabulary.has(name)))
      .toEqual(["Reflect"]);
  });

  test("the scanner reads code, not text: strings, keys, and members are not globals", () => {
    // The three false positives the emitted corpus actually contains — a
    // `"Map.empty"` constant inside a derived `show`, `{ start: __start }` in
    // the range helper, `__error.name` in the exception path — with a template
    // substitution beside them, which *is* code and must be scanned.
    const sample = "function __probe(__range, __error) {\n" +
      '  const __shown = "Map.empty" + `index ${String(__error.index)}`;\n' +
      "  return { start: __range.start, name: __error.name, __shown };\n" +
      "}\n";

    expect([...freeIdentifiers(sample)].sort()).toEqual(["String"]);
  });
});
