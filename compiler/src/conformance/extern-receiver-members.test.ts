import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 5's **instance receiver members** — `method`, `get`,
 * and `set` standalone in an `extern from` block (#982, the first of its two
 * implementation PRs; `extern class`, `new as` and `static` are the second).
 *
 * Four claims, each a sentence of the spec:
 *
 * - **A member is an ordinary subject-first binding** (§1, §2.1). It types,
 *   checks, exports, and dot-calls like any companion operation of its receiver
 *   type (§9; Method Syntax §4.1's extern row); only its linkage differs.
 * - **A direct call emits the receiver call inline, in every module** (§2.2):
 *   `params.get(key)`, `response.status`, `request.timeout = value`. The first
 *   argument is the JavaScript receiver, and an importer emits the same text as
 *   the binding module, because the linkage rides the member's symbol.
 * - **A first-class reference is the stable convention-preserving wrapper**
 *   (§2.3): one module-level arrow per member, the ESM export, and the same
 *   object from every reference in every module — never the raw detachable
 *   property function.
 * - **Every slot is a capture position** (Part 1 §5.4): a captured argument is
 *   copied on the way to the receiver and a captured result on the way back,
 *   inline and in the wrapper alike.
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
  foreignUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*(?:import|export)(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const foreign = foreignUrls.get(specifier);
      if (foreign !== undefined) return `${prefix}${JSON.stringify(foreign)};`;
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/** A fresh module identity per run, so no two runs share foreign state. */
let runTag = 0;

/** Compiles a project with foreign modules and executes it, returning each module's exports. */
async function run(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
): Promise<Record<string, Record<string, unknown>>> {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#run${runTag}`;
  const foreignUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) {
    foreignUrls.set(specifier, url(text));
  }
  const moduleUrls = new Map<string, string>();
  const runtimeGlobals = project.runtimeGlobals;
  if (runtimeGlobals !== undefined) {
    moduleUrls.set(runtimeGlobals.path.replace(/\.js$/u, ".hex"), url(runtimeGlobals.text));
  }
  for (const data of project.dataUnits) {
    moduleUrls.set(data.path, url(link(data.javascript.text, data.path, moduleUrls, foreignUrls)));
  }
  for (const module of project.modules) {
    moduleUrls.set(
      module.path,
      url(link(module.javascript.text, module.path, moduleUrls, foreignUrls)),
    );
  }
  const loaded: Record<string, Record<string, unknown>> = {};
  for (const module of project.modules) {
    if (!files.some(([path]) => path === module.source.path)) continue;
    loaded[module.name] = (await import(/* @vite-ignore */ moduleUrls.get(module.path)!)) as Record<
      string,
      unknown
    >;
  }
  return loaded;
}

/** A project's emitted text for one of its own modules, which must compile clean. */
function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
  artifact: "javascript" | "declarations" = "javascript",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)![artifact].text;
}

/** Diagnostic messages for a one-module program over an empty foreign module. */
function diagnostics(rows: string, prelude = "    type T\n"): readonly string[] {
  return compileFiles([[
    "/main.hex",
    `module Main\n\nextern from "world"\n${prelude}${rows}`,
  ]]).diagnostics.map(({ message }) => message);
}

/** The foreign class every execution test binds, reached through a factory `fun`. */
const BOXES_JS = `
export class Box {
  constructor(v) { this.v = v; this.reads = 0; this.items = [1, 2, 3]; }
  get value() { this.reads += 1; return this.v; }
  set value(x) { this.v = x; }
  bump(n) { this.v += n; return this.v; }
  then(k) { return this.v * k; }
  push(x) { this.items.push(x); return this.items.length; }
  snapshot() { return this.items; }
  load(xs) { this.loaded = xs; xs.push(99); }
}
export const make = (v) => new Box(v);
export const rawBump = Box.prototype.bump;
`;

const BOXES = `module Boxes

extern from "boxes"
    export type Box
    export fun make(v: Int) ->! Box
    export get value(box: Box) ->! Int
    export set value as setValue(box: Box, v: Int) ->! Unit
    export method bump(box: Box, n: Int) ->! Int
    export method then as times(box: Box, k: Int) ->! Int
    export method push(box: Box, x: Int) ->! Unit
    export method snapshot(box: Box) ->! Array(Int)
    export method load(box: Box, xs: Array(Int)) ->! Unit
    export get reads(box: Box) ->! Int
`;

async function runMain(main: string): Promise<Record<string, unknown>> {
  const loaded = await run(
    [["/boxes.hex", BOXES], ["/main.hex", `module Main\n\nimport Boxes\n\n${main}`]],
    { boxes: BOXES_JS },
  );
  return loaded["Main"]!;
}

describe("the receiver call (§2.2, §3.1, §4.1)", () => {
  test("a `method` call makes its first argument the JavaScript receiver", async () => {
    const main = await runMain(
      "export fun qualified(): Int = Boxes.bump!(Boxes.make!(1), 4)\n" +
        "export fun dotted(): Int = Boxes.make!(10).bump!(5)\n" +
        "export fun piped(): Int = Boxes.make!(2) |> Boxes.bump!(3)\n",
    );
    expect((main.qualified as () => number)()).toBe(5);
    expect((main.dotted as () => number)()).toBe(15);
    expect((main.piped as () => number)()).toBe(5);
  });

  test("a `get` performs a fresh property read on every call under `->!`", async () => {
    // §3.1: "The compiler must not cache, hoist, or common-subexpression-
    // eliminate a `->!` `get` merely because Hexagon bindings are immutable." The
    // foreign accessor counts its own reads.
    const main = await runMain(
      "export fun twice(): Int =\n" +
        "    let box = Boxes.make!(7)\n" +
        "    let a = box.value!()\n" +
        "    let b = box.value!()\n" +
        "    box.reads!() * 100 + a + b\n",
    );
    expect((main.twice as () => number)()).toBe(2 * 100 + 14);
  });

  test("a `set` writes the property, and its value is `Unit`, not the assignment's", async () => {
    // §4.1's honest `Unit`: a JavaScript assignment expression yields the
    // assigned value, and a `set` row's value is `Unit` regardless — in the
    // statement position and in the value position alike.
    const main = await runMain(
      "export fun written(): Int =\n" +
        "    let box = Boxes.make!(1)\n" +
        "    box.setValue!(42)\n" +
        "    box.value!()\n" +
        "export fun result(): Unit = Boxes.setValue!(Boxes.make!(1), 7)\n",
    );
    expect((main.written as () => number)()).toBe(42);
    expect((main.result as () => unknown)()).toBeUndefined();
  });

  test("a `Unit` method's JavaScript result is discarded in the value position", async () => {
    // Part 6 §3.2's discard: `push` answers the new length in JavaScript.
    const main = await runMain("export fun pushed(): Unit = Boxes.push!(Boxes.make!(1), 4)\n");
    expect((main.pushed as () => unknown)()).toBeUndefined();
  });

  test("a keyword-named member is reached under its alias (§2.4)", async () => {
    const main = await runMain("export fun tripled(): Int = Boxes.make!(4).times!(3)\n");
    expect((main.tripled as () => number)()).toBe(12);
  });

  test("an importer emits the receiver call as the binding module does, and imports no wrapper", () => {
    const files = [
      ["/boxes.hex", BOXES],
      ["/main.hex",
        "module Main\n\nimport Boxes\n\n" +
          "export fun go(box: Boxes.Box): Int =\n" +
          "    box.setValue!(4)\n" +
          "    Boxes.push!(box, 1)\n" +
          "    let u = Boxes.push!(box, 2)\n" +
          "    let n = box.bump!(1)\n" +
          "    box.value!()\n"],
    ] as const;
    const javascript = emitted(files, "/main.hex");
    expect(javascript).toContain("  box.value = 4;\n");
    expect(javascript).toContain("  box.push(1);\n");
    expect(javascript).toContain("  const u = void box.push(2);\n");
    expect(javascript).toContain("  const n = box.bump(1);\n");
    expect(javascript).toContain("  return box.value;\n");
    // The namespace import the source wrote, and nothing bound for the member.
    expect(javascript).not.toMatch(
      /import \{[^}]*\b(push|bump|value|setValue|snapshot|load)\b/u,
    );
  });

  test("a captured member reached from an importer binds no internal edition", () => {
    // A receiver member has no unwalked edition: every call crosses into
    // JavaScript, so the importer inlines the copies and imports nothing.
    const javascript = emitted([
      ["/boxes.hex", BOXES],
      ["/main.hex",
        "module Main\n\nimport Boxes\n\n" +
          "export fun go(box: Boxes.Box): Int =\n" +
          "    let xs = box.snapshot!()\n" +
          "    box.load!(xs)\n" +
          "    xs.length()\n"],
    ], "/main.hex");
    expect(javascript).not.toContain("__snapshot");
    expect(javascript).not.toContain("__load");
    expect(javascript).toMatch(/const xs = __capture\(__capturePlans, \d+, box\.snapshot\(\)\);/u);
  });

  test("a dot call in the binding module itself dispatches to the member", () => {
    const javascript = emitted([["/boxes.hex", BOXES + `
export fun bumpTwice(box: Box): Int =
    let n = box.bump!(1)
    box.bump!(n)
`]], "/boxes.hex");
    expect(javascript).toContain("const n = box.bump(1);\n");
    expect(javascript).toContain("return box.bump(n);\n");
  });

  test("a dot call reached through a module that was never imported still emits inline", () => {
    // Method Syntax §4.2's import-insensitivity: `Main` imports only `Mid`, and
    // the receiver's type arrives through `Mid`'s result. The member owes no
    // import (§8.2) — its linkage rides its symbol.
    const files = [
      ["/boxes.hex", BOXES],
      ["/mid.hex", "module Mid\n\nimport Boxes\n\nexport fun fresh(): Boxes.Box = Boxes.make!(1)\n"],
      ["/main.hex", "module Main\n\nimport Mid\n\nexport fun go(): Int = Mid.fresh!().bump!(2)\n"],
    ] as const;
    const javascript = emitted(files, "/main.hex");
    expect(javascript).toContain("Mid.fresh().bump(2)");
    expect(javascript).not.toContain("Boxes.js");
  });

  test("an integer-literal receiver is parenthesized, a string receiver needs nothing", () => {
    // `5.toString()` does not parse; `(5).toString()` does. A standalone member's
    // foreign module supplies no binding, so the block emits no import at all.
    const files = [["/main.hex", `module Main

extern from "text-tools"
    method trim(text: String) -> String
    method toString as show(n: Int) -> String

export fun go(): String = show(5) ++ trim("  a  ")
`]] as const;
    const javascript = emitted(files, "/main.hex");
    expect(javascript).toContain("(5).toString()");
    expect(javascript).toContain('"  a  ".trim()');
    expect(javascript).not.toContain("text-tools");
  });
});

describe("the stable convention-preserving wrapper (§2.3)", () => {
  test("every first-class reference, in every module, is one wrapper that keeps its receiver", async () => {
    const loaded = await run(
      [["/boxes.hex", BOXES], ["/main.hex", "module Main\n\nimport Boxes\n\n" +
        "export let first: (Boxes.Box, Int) ->! Int = Boxes.bump\n" +
        "export let second: (Boxes.Box, Int) ->! Int = Boxes.bump\n" +
        "export let box: Int ->! Boxes.Box = Boxes.make\n"]],
      { boxes: BOXES_JS },
    );
    const main = loaded["Main"]!;
    const boxes = loaded["Boxes"]!;
    expect(main.first).toBe(main.second);
    expect(main.first).toBe(boxes.bump);
    // Detached, the raw prototype function would read `this.v` off `undefined`.
    const box = (main.box as (v: number) => unknown)(1);
    expect((main.first as (b: unknown, n: number) => number)(box, 2)).toBe(3);
  });

  test("the binding module's wrappers are module-level arrows, and the raw property is never a value", () => {
    const javascript = emitted([["/boxes.hex", BOXES]], "/boxes.hex");
    expect(javascript).toContain("const value = box => box.value;\n");
    expect(javascript).toContain("const setValue = (box, v) => { box.value = v; };\n");
    expect(javascript).toContain("const bump = (box, n) => box.bump(n);\n");
    expect(javascript).toContain("const times = (box, k) => box.then(k);\n");
    expect(javascript).toContain("const push = (box, x) => { box.push(x); };\n");
    expect(javascript).toContain("export { bump };\n");
    // Only the factory `fun` imports anything from the foreign module.
    expect(javascript).toContain('import { make } from "boxes";');
    expect(javascript).not.toMatch(/import \{[^}]*\b(bump|then|push|value)\b/u);
  });
});

describe("extern rows as companion operations (Method Syntax §4.1, §4.2)", () => {
  test("a plain extern `fun` over its home module's types dot-calls like any export", async () => {
    // §4.2's rule is the home module's exported subject-first functions, whatever
    // supplies the body: an extern `fun` over an extern type, or over a record
    // declared beside the block.
    const loaded = await run(
      [["/geometry.hex", `module Geometry

export record Point = {x: Int, y: Int}

extern from "geometry"
    export type Shape
    export fun norm(p: Point) ->! Int
    export fun unit() ->! Shape
    export fun sides(s: Shape) ->! Int
`], ["/main.hex", `module Main

import Geometry

export fun go(): Int = Geometry.Point({x = 3, y = 4}).norm!() * 10 + Geometry.unit!().sides!()
`]],
      {
        geometry: "export const norm = (p) => p.x + p.y;\n" +
          "export const unit = () => ({ n: 4 });\n" +
          "export const sides = (s) => s.n;\n",
      },
    );
    expect((loaded["Main"]!.go as () => number)()).toBe(74);
  });
});

describe("capture positions (Part 1 §5.4)", () => {
  test("a captured result is Hexagon's copy, and a captured argument crosses as a copy", async () => {
    // `snapshot` hands out the foreign array itself and `push` then grows it;
    // `load` pushes onto whatever it was handed. Neither reaches Hexagon's value.
    const main = await runMain(
      "export fun held(): Int =\n" +
        "    let box = Boxes.make!(1)\n" +
        "    let xs = box.snapshot!()\n" +
        "    box.push!(4)\n" +
        "    box.load!(xs)\n" +
        "    xs.length()\n",
    );
    expect((main.held as () => number)()).toBe(3);
  });

  test("the wrapper copies exactly as the inline call does", async () => {
    const loaded = await run(
      [["/boxes.hex", BOXES], ["/main.hex", "module Main\n\nimport Boxes\n\n" +
        "export let snap: Boxes.Box ->! Array(Int) = Boxes.snapshot\n" +
        "export let box: Int ->! Boxes.Box = Boxes.make\n"]],
      { boxes: BOXES_JS },
    );
    const main = loaded["Main"]!;
    const box = (main.box as (v: number) => { items: number[] })(1);
    const copy = (main.snap as (b: unknown) => number[])(box);
    expect(copy).toEqual([1, 2, 3]);
    expect(copy).not.toBe(box.items);
  });
});

describe("faces (Part 7 §7 occasion 2)", () => {
  test("an exported member faces as an ordinary function declaration", async () => {
    const face = emitted([["/boxes.hex", BOXES]], "/boxes.hex", "declarations");
    expect(face).toContain("export declare function value(box: Box): number;");
    expect(face).toContain("export declare function setValue(box: Box, v: number): void;");
    expect(face).toContain("export declare function times(box: Box, k: number): number;");
    expect(face).toContain("export declare function snapshot(box: Box): ReadonlyArray<number>;");
    expect(
      await typeScriptErrors({
        "boxes.d.ts": face,
        "consumer.ts": 'import { make, bump, setValue } from "./boxes.js";\n' +
          "const box = make(1);\n" +
          "export const n: number = bump(box, 2);\n" +
          "setValue(box, 3);\n",
      }),
    ).toEqual([]);
  });

  test("a documented member carries its documentation to both artifacts", () => {
    const files = [["/boxes.hex", `module Boxes

extern from "boxes"
    export type Box
    (** Adds \`n\` to the box. *)
    export method bump(box: Box, n: Int) ->! Int
`]] as const;
    expect(emitted(files, "/boxes.hex", "declarations")).toContain("Adds `n` to the box.");
    expect(emitted(files, "/boxes.hex")).toContain("Adds `n` to the box.");
  });
});

describe("declaration diagnostics (§11)", () => {
  test("the subject is explicit and first (§5)", () => {
    expect(diagnostics("    method m() ->! Int\n")).toEqual([
      "an extern `method` takes its receiver as an explicit first parameter; " +
      "write `method m(subject: Subject) ->! Int`",
    ]);
    expect(diagnostics("    get g() ->! Int\n")).toEqual([
      "an extern `get` takes its receiver as an explicit first parameter; " +
      "write `get g(subject: Subject) ->! Int`",
    ]);
  });

  test("a property read takes nothing beyond its subject (§3.1)", () => {
    expect(diagnostics("    get g(t: T, i: Int) ->! Int\n")).toEqual([
      "a property read takes no arguments beyond its subject; for a receiver call, use `method`",
    ]);
  });

  test("a `set` takes the subject and the value, returns `Unit`, and writes `->!` (§4.1)", () => {
    expect(diagnostics("    set s(t: T) ->! Unit\n")).toEqual([
      "an extern `set` takes the subject and the assigned value: " +
      "`set s(t: T, value: Value) ->! Unit`",
    ]);
    expect(diagnostics("    set s(t: T, v: Int) ->! Int\n")).toEqual([
      "an extern `set` returns `Unit`",
    ]);
    // Compared as a type: a transparent alias of `Unit` is `Unit`.
    expect(
      compileFiles([["/main.hex", `module Main

type Nothing = Unit

extern from "world"
    type T
    set s(t: T, v: Int) ->! Nothing
`]]).diagnostics.map(({ message }) => message),
    ).toEqual([]);
    const [report] = compileFiles([["/main.hex", `module Main

extern from "world"
    type T
    set s(t: T, v: Int) -> Unit
`]]).diagnostics;
    expect(report?.message).toBe(
      "an extern `set` grants write capability, and a write to foreign state is an effect — " +
        "its arrow is `->!`; write `set s(…) ->! Unit`",
    );
    expect(report?.fixes?.[0]?.edits?.map(({ replacement }) => replacement)).toEqual(["->!"]);
  });

  test("a member row writes its arrow; `:` takes Part 4 §13's colon row", () => {
    const [report] = compileFiles([["/main.hex", `module Main

extern from "world"
    type T
    method m(t: T): Int
`]]).diagnostics;
    expect(report?.message).toMatch(/^an extern callable declares its effect/u);
    expect(report?.fixes?.[0]?.edits?.map(({ replacement }) => replacement)).toEqual(["->!"]);
  });

  test("a Hexagon hard keyword needs the author's alias, and gets no applied fixit (§2.4)", () => {
    const [report] = compileFiles([["/main.hex", `module Main

extern from "world"
    type T
    get then(t: T) ->! Int
`]]).diagnostics;
    expect(report?.message).toBe(
      "`then` is a Hexagon hard keyword and cannot name a binding; " +
        "bind the member under an alias: `get then as …`",
    );
    expect(report?.fixes ?? []).toEqual([]);
    expect(diagnostics("    method catch as recover(t: T) ->! Int\n")).toEqual([]);
    expect(diagnostics("    method match as matches(t: T, s: String) ->! Bool\n")).toEqual([]);
  });

  test("a foreign name illegal as a Hexagon term takes the alias rewrite (Part 4 §3.2)", () => {
    expect(diagnostics("    method URL(t: T) ->! Int\n")).toEqual([
      "foreign member `URL` is not a legal Hexagon term name; bind it with an alias: " +
      "`method URL as uRL`",
    ]);
    expect(diagnostics("    method __proto(t: T) ->! Int\n")).toEqual([
      "foreign member `__proto` uses the reserved `__` prefix; bind it with an alias: " +
      "`method __proto as proto`",
    ]);
    expect(diagnostics("    method __proto as proto(t: T) ->! Int\n")).toEqual([]);
  });

  test("a getter and a setter of one name collide, and the rewrite aliases the setter (§4.2)", () => {
    expect(diagnostics("    get timeout(t: T) ->! Int\n    set timeout(t: T, v: Int) ->! Unit\n"))
      .toEqual([
        "`timeout` is already bound (line 5); a getter and a setter are two bindings — " +
        "alias the setter: `set timeout as setTimeout(...)`",
      ]);
    // The rewrite names the setter's own property, whichever row came first.
    expect(diagnostics("    get tm as timeout(t: T) ->! Int\n    set timeout(t: T, v: Int) ->! Unit\n"))
      .toEqual([
        "`timeout` is already bound (line 5); a getter and a setter are two bindings — " +
        "alias the setter: `set timeout as setTimeout(...)`",
      ]);
    expect(diagnostics("    set timeout(t: T, v: Int) ->! Unit\n    get tm as timeout(t: T) ->! Int\n"))
      .toEqual([
        "`timeout` is already bound (line 5); a getter and a setter are two bindings — " +
        "alias the setter: `set timeout as setTimeout(...)`",
      ]);
  });

  test("`default`, `static`, and `new` have no member seat outside a class (§6.2–§6.4)", () => {
    expect(diagnostics("    default method m(t: T) ->! Int\n")).toEqual([
      "`default` selects a foreign module's default export, and a member is not an export; " +
      "drop `default`",
    ]);
    expect(diagnostics("    static method m(x: Int) ->! Int\n")).toEqual([
      "a `static` member targets the foreign class's constructor object; " +
      "declare it inside the `extern class` it belongs to",
    ]);
    expect(diagnostics("    new as create(x: Int) ->! T\n")).toEqual([
      "`new` constructs a foreign class; declare it inside that class's `extern class` block",
    ]);
  });

  test("a member row is monomorphic and its records closed (Part 4 §12.4, Part 1 §5.4 item 7)", () => {
    expect(diagnostics("    method m<a>(t: T, x: a) ->! Int\n")).toContain(
      "generic extern declarations are not part of Hexagon v1",
    );
    expect(diagnostics("    method m(t: T, r: {n: Int, ...}) ->! Unit\n").length).toBe(1);
  });

  test("a private member is not a companion operation abroad or at home (Method Syntax §4.2)", () => {
    expect(
      compileFiles([["/main.hex", `module Main

extern from "world"
    export type T
    method hidden(t: T) ->! Int

export fun f(t: T): Int = t.hidden!()
`]]).diagnostics.map(({ message }) => message),
    ).toEqual([
      "`T` has no field `hidden`, its companion exports no operation `hidden`, and no " +
      "constraint honored at `T` has a subject-first member `hidden`; call an available " +
      "subject-first function explicitly",
    ]);
  });
});

/**
 * FFI Part 5 §6–§8: `extern class` — an opaque foreign type plus companion
 * functions, `new as` constructors, `static` members over the constructor
 * object, `default class`, all-or-nothing visibility, and the binding module's
 * `__class_<Type>` re-export every other module reaches the class through.
 */
const COUNTERS_JS = `
export class Counter {
  static created = 0;
  static get total() { return Counter.created; }
  static set total(v) { Counter.created = v; }
  static of(n) { return new this(n); }
  constructor(n, step = 1) { this.n = n; this.step = step; Counter.created += 1; }
  next() { this.n += this.step; return this.n; }
  get value() { return this.n; }
}
`;
const CLIENTS_JS = `
export default class Client { constructor(name) { this.name = name; } get who() { return this.name; } }
`;
const MAPS_JS = `
export class Map { constructor(zoom) { this.kind = "mapbox"; this.zoom = zoom; } }
export const table = () => new globalThis.Map([["a", 1], ["b", 2]]);
`;

const COUNTERS = `module Counters

extern from "counters"
    export class Counter
        new as create(n: Int) ->! Counter
        new as createWithStep(n: Int, step: Int) ->! Counter
        static method of(n: Int) ->! Counter
        static get total() ->! Int
        static set total as setTotal(v: Int) ->! Unit
        method next(c: Counter) ->! Int
        get value(c: Counter) ->! Int

extern from "clients"
    export default class Client
        new as connect(name: String) ->! Client
        get who(c: Client) ->! String
`;

async function runCounters(main: string): Promise<Record<string, Record<string, unknown>>> {
  return await run(
    [["/counters.hex", COUNTERS], ["/main.hex", `module Main\n\nimport Counters\n\n${main}`]],
    { counters: COUNTERS_JS, clients: CLIENTS_JS },
  );
}

describe("`extern class` (§6)", () => {
  test("constructors, static members, and instance members run from an importer", async () => {
    const { Main: main } = await runCounters(
      "export fun stepped(): Int = Counters.createWithStep!(1, 5).next!()\n" +
        "export fun ofThis(): Int = Counters.of!(4).value!()\n" +
        "export fun totals(): Int =\n" +
        "    Counters.setTotal!(10)\n" +
        "    let c = Counters.create!(1)\n" +
        "    Counters.total!()\n" +
        "export fun who(): String = Counters.connect!(\"ada\").who!()\n",
    );
    expect((main!.stepped as () => number)()).toBe(6);
    // §6.3: a static method keeps receiver-call emission, so `this` is the class.
    expect((main!.ofThis as () => number)()).toBe(4);
    // §6.3: `static set` writes the constructor object's property; `static get`
    // reads it fresh after the constructor incremented it.
    expect((main!.totals as () => number)()).toBe(11);
    expect((main!.who as () => string)()).toBe("ada");
  });

  test("the binding module imports the class once, and re-exports it for importers (§7)", () => {
    const javascript = emitted([["/counters.hex", COUNTERS]], "/counters.hex");
    expect(javascript).toContain('import { Counter } from "counters";');
    expect(javascript).toContain('import Client from "clients";');
    expect(javascript).toContain("const create = n => new Counter(n);\n");
    expect(javascript).toContain("const of = n => Counter.of(n);\n");
    expect(javascript).toContain("const total = () => Counter.total;\n");
    expect(javascript).toContain("const setTotal = v => { Counter.total = v; };\n");
    expect(javascript).toContain("export { Counter as __class_Counter };");
    expect(javascript).toContain("export { Client as __class_Client };");
  });

  test("an importer reaches the class through `__class_<Type>`, never the foreign module", () => {
    const javascript = emitted([
      ["/counters.hex", COUNTERS],
      ["/main.hex", "module Main\n\nimport Counters\n\n" +
        "export fun go(): Int =\n" +
        "    Counters.setTotal!(Counters.total!() + 1)\n" +
        "    Counters.create!(1).next!()\n"],
    ], "/main.hex");
    expect(javascript).toContain(
      'import { __class_Counter as Counter } from "./Counters.js";',
    );
    expect(javascript).toContain("  Counter.total = Counter.total + 1;\n");
    expect(javascript).toContain("  return new Counter(1).next();\n");
    expect(javascript).not.toContain('"counters"');
  });

  test("a first-class constructor or static member is the one stable wrapper (§6.2, §6.3)", async () => {
    const loaded = await runCounters(
      "export let make: Int ->! Counters.Counter = Counters.create\n" +
        "export let again: Int ->! Counters.Counter = Counters.create\n" +
        "export let read: () ->! Int = Counters.total\n",
    );
    expect(loaded["Main"]!.make).toBe(loaded["Main"]!.again);
    expect(loaded["Main"]!.make).toBe(loaded["Counters"]!.create);
    const counter = (loaded["Main"]!.make as (n: number) => { n: number })(3);
    expect(counter.n).toBe(3);
    expect(typeof (loaded["Main"]!.read as () => number)()).toBe("number");
  });

  test("a class spelled like a runtime global never captures the compiler's own text", async () => {
    // Part 7 §1.2 rule 1: the minted import local steps aside, so the capture
    // copy's `new Map()` still builds a JavaScript `Map`, in the binding module
    // and in an importer alike.
    const maps = `module Maps

extern from "maps"
    export class Map as MapboxMap
        new as open(zoom: Int) ->! MapboxMap
    export fun table() ->! JsMap(String, Int)

export fun both(): Int =
    let m = open!(3)
    table!().size()
`;
    const main = "module Main\n\nimport Maps\n\n" +
      "export fun again(): Int =\n" +
      "    let m = Maps.open!(4)\n" +
      "    Maps.table!().size()\n";
    const files = [["/maps.hex", maps], ["/main.hex", main]] as const;
    const binding = emitted(files, "/maps.hex");
    // §7: an unusable foreign spelling falls back to the class's own fixed
    // `__class_<Type>`, never a numeric probe — in both modules alike.
    expect(binding).toContain('import { Map as __class_MapboxMap } from "maps";');
    expect(binding).toContain("new __class_MapboxMap(3)");
    expect(binding).toContain("export { __class_MapboxMap };");
    const importer = emitted(files, "/main.hex");
    expect(importer).toContain('import { __class_MapboxMap } from "./Maps.js";');
    expect(importer).toContain("new __class_MapboxMap(4)");
    const loaded = await run(files, { maps: MAPS_JS });
    expect((loaded["Maps"]!.both as () => number)()).toBe(2);
    expect((loaded["Main"]!.again as () => number)()).toBe(2);
  });

  test("two binding modules' classes of one type name take the family's probe in the importer only", async () => {
    const module = (name: string, specifier: string) => `module ${name}

extern from "${specifier}"
    export class Map as MapboxMap
        new as open(zoom: Int) ->! MapboxMap
        get zoom(m: MapboxMap) ->! Int
`;
    const files = [
      ["/east.hex", module("East", "maps")],
      ["/west.hex", module("West", "maps-west")],
      ["/main.hex", "module Main\n\nimport East\nimport West\n\n" +
        "export fun go(): Int = East.open!(1).zoom!() * 10 + West.open!(2).zoom!()\n"],
    ] as const;
    const importer = emitted(files, "/main.hex");
    expect(importer).toContain('import { __class_MapboxMap } from "./East.js";');
    expect(importer).toContain('import { __class_MapboxMap as __class_MapboxMap_1 } from "./West.js";');
    const west = "export class Map { constructor(zoom) { this.zoom = zoom + 100; } }\n";
    const loaded = await run(files, { maps: MAPS_JS, "maps-west": west });
    expect((loaded["Main"]!.go as () => number)()).toBe(10 + 102);
  });

  test("a reserved-word or `__` foreign class name falls back to `__class_<Type>`", () => {
    const javascript = emitted([["/main.hex", `module Main

extern from "w"
    class delete as Del
        new as make() ->! Del
    class __capture as Cap
        new as cap() ->! Cap

export fun go(): Int =
    let d = make!()
    let c = cap!()
    0
`]], "/main.hex");
    expect(javascript).toContain('import { delete as __class_Del } from "w";');
    expect(javascript).toContain("new __class_Del()");
    expect(javascript).toContain('import { __capture as __class_Cap } from "w";');
  });

  test("a private class re-exports nothing, and a class of instance members imports nothing", () => {
    const javascript = emitted([["/main.hex", `module Main

extern from "counters"
    class Counter
        new as create(n: Int) ->! Counter
    export class Handle
        method close(h: Handle) ->! Unit
    class Empty

export fun make(): Int =
    let c = create!(1)
    0
`]], "/main.hex");
    expect(javascript).toContain('import { Counter } from "counters";');
    expect(javascript).not.toContain("__class_");
    expect(javascript).not.toMatch(/import \{ Handle \}/u);
    expect(javascript).not.toContain("Empty");
  });

  test("the `.d.ts` faces the class as a brand and its members as functions, and no `__class_`", async () => {
    const face = emitted([["/counters.hex", COUNTERS]], "/counters.hex", "declarations");
    expect(face).toContain("export type Counter = { readonly [CounterBrand]: never };");
    expect(face).toContain("export declare function create(n: number): Counter;");
    expect(face).toContain("export declare function total(): number;");
    expect(face).toContain("export declare function setTotal(v: number): void;");
    expect(face).not.toContain("__class_");
    expect(
      await typeScriptErrors({
        "counters.d.ts": face,
        "consumer.ts": 'import { create, next, total } from "./counters.js";\n' +
          "export const n: number = next(create(1)) + total();\n",
      }),
    ).toEqual([]);
  });

  test("§8's idiom — the binding module imported under the class's own name — still parses", async () => {
    // §6.4's `default class Client` in module `Client`, imported as `Client`:
    // the namespace import and the class's minted local would otherwise bind one
    // identifier twice, and the importer would not load.
    const files = [
      ["/client.hex", `module Client

extern from "clients"
    export default class Client
        new as connect(name: String) ->! Client
        get who(c: Client) ->! String
`],
      ["/main.hex", "module Main\n\nimport Client\n\n" +
        "export fun go(): String = Client.connect!(\"ada\").who!()\n"],
    ] as const;
    const javascript = emitted(files, "/main.hex");
    expect(javascript).toContain('import * as Client from "./Client.js";');
    expect(javascript).toContain('import { __class_Client } from "./Client.js";');
    expect(javascript).toContain('new __class_Client("ada")');
    const loaded = await run(files, { clients: CLIENTS_JS });
    expect((loaded["Main"]!.go as () => string)()).toBe("ada");
  });

  test("dot calls reach a class's instance members (§9)", () => {
    const javascript = emitted([
      ["/counters.hex", COUNTERS],
      ["/main.hex", "module Main\n\nimport Counters\n\n" +
        "export fun go(c: Counters.Counter): Int = c.next!() + c.value!()\n"],
    ], "/main.hex");
    expect(javascript).toContain("return c.next() + c.value;");
  });
});

describe("`extern class` layout (Lexer Layout §2.1)", () => {
  test("a memberless class is complete, and a `class` term never opens a block", () => {
    expect(diagnostics("    class Empty\n    method m(t: T) ->! Int\n")).toEqual([]);
    // `class` stays an ordinary name wherever no name follows it at an item's
    // head, a function's name and a call inside a delimiter included.
    expect(compileFiles([["/main.hex", `module Main

let class(x: Int): Int =
    x + 1

export let y: Int =
    class(
        2)
`]]).diagnostics.map(({ message }) => message)).toEqual([]);
  });
});

describe("`extern class` diagnostics (§11)", () => {
  const classDiagnostics = (rows: string, header = "    class URL as Url\n"): readonly string[] =>
    diagnostics(header + rows, "    type T\n");

  test("an instance member's subject is the class's own type (§5)", () => {
    expect(classDiagnostics("        method m(t: T) ->! Int\n")).toEqual([
      "instance members of `class URL as Url` take `Url` as their first parameter; " +
      "declare this member at block level if it targets another type",
    ]);
  });

  test("`new` names its constructor, writes its arrow, and builds the class (§6.2)", () => {
    expect(classDiagnostics("        new(text: String) ->! Url\n")).toEqual([
      "name the companion constructor: `new as create(...) -> Url`",
    ]);
    expect(classDiagnostics("        new as create(text: String) ->! T\n")).toEqual([
      "`new` constructs `Url`; write `new as create(…) ->! Url` (`->` only where construction touches nothing)",
    ]);
    expect(classDiagnostics("        new as create(text: String)\n")).toEqual([
      "`new` constructs `Url`; write `new as create(…) ->! Url` (`->` only where construction touches nothing)",
    ]);
    expect(classDiagnostics("        static new as create(text: String) ->! Url\n")).toEqual([
      "a constructor is already the class's own operation; drop `static`: `new as create(...) -> Url`",
    ]);
  });

  test("`new` and `static` rows write their parameter list (Part 4 §4.1)", () => {
    expect(classDiagnostics("        new as mk ->! Url\n")).toEqual([
      "`new` takes a parameter list, even an empty one; write `new as mk() ->! Url`",
    ]);
    expect(classDiagnostics("        static get port ->! Int\n")).toEqual([
      "a static member takes a parameter list, even an empty one; write `static get port() ->! Int`",
    ]);
    expect(classDiagnostics("        static method now ->! Int\n")).toEqual([
      "a static member takes a parameter list, even an empty one; write `static method now() ->! Int`",
    ]);
  });

  test("every class member slot refuses an open record (Part 1 §5.4 item 7, #962)", () => {
    const refusal = /^this record may have more fields \(`\{n: Int, \.\.\.\}`\)/u;
    for (
      const row of [
        "        new as create(r: {n: Int, ...}) ->! Url\n",
        "        static method s() ->! {n: Int, ...}\n",
        "        static set s(v: {n: Int, ...}) ->! Unit\n",
        "        method m(u: Url, r: {n: Int, ...}) ->! Unit\n",
      ]
    ) {
      const reports = classDiagnostics(row);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatch(refusal);
    }
  });

  test("static property forms fix their arity (§6.3)", () => {
    expect(classDiagnostics("        static get port(u: Url) ->! Int\n")).toEqual([
      "a static property read takes no parameters; write `static get port() ->! Int`",
    ]);
    expect(classDiagnostics("        static set port(u: Url, v: Int) ->! Unit\n")).toEqual([
      "a static property write takes exactly the assigned value; write `static set port(v: Int) ->! Unit`",
    ]);
    expect(classDiagnostics("        static set port(v: Int) -> Unit\n")).toEqual([
      "an extern `set` grants write capability, and a write to foreign state is an effect — " +
      "its arrow is `->!`; write `static set port(…) ->! Unit`",
    ]);
  });

  test("a class block holds members only, exported with the class (§6.1, §7)", () => {
    expect(classDiagnostics("        fun f(x: Int) ->! Int\n")).toEqual([
      "extern class members are `new`, `method`, `get`, `set`, and their `static` forms; declare this at block level",
    ]);
    expect(classDiagnostics("        export method m(u: Url) ->! Int\n")).toEqual([
      "`export class` exports every declared member; export the class, or declare the member at block level",
    ]);
    expect(classDiagnostics("        default method m(u: Url) ->! Int\n")).toEqual([
      "`default` selects a foreign module's default export, and a member is not an export; drop `default`; " +
      "to make the class the default export, write `default class`",
    ]);
  });

  test("the header: no inheritance, no alias on a default class, an uppercase local type", () => {
    expect(classDiagnostics("", "    class Dog extends Animal\n")).toEqual([
      "Hexagon does not model foreign inheritance; declare the subclass as its own `extern class`",
    ]);
    expect(classDiagnostics("", "    default class Client as Local\n")).toEqual([
      "`as` aliases a foreign export name; a `default class` has none — name the class directly: " +
      "`default class Local`",
    ]);
    expect(classDiagnostics("", "    class url\n")).toEqual([
      "foreign class `url` needs an uppercase-start local alias; write `class url as Url`",
    ]);
    // §6.4: a default class has no alias to add; its rewrite names the type.
    expect(classDiagnostics("", "    default class client\n")).toEqual([
      "a class's local type name is uppercase-start; write `default class Client`",
    ]);
    expect(classDiagnostics("", "    class Box<a>\n")).toEqual([
      "generic extern declarations are not part of Hexagon v1",
    ]);
  });

  test("two classes of one module sharing a member name collide, with both rewrites (§8)", () => {
    expect(diagnostics(
      "    class URL as Url\n        method toString(u: Url) ->! String\n" +
        "    class Path\n        method toString(p: Path) ->! String\n",
      "",
    )).toEqual([
      "`toString` is already bound (line 5); members of the classes in one module are one module's " +
      "bindings — alias one of them (`method toString as pathToString(...)`), or declare each class " +
      "in its own binding module",
    ]);
  });
});
