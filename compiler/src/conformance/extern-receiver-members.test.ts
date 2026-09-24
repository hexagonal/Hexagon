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
    expect(javascript).not.toMatch(/import \{[^}]*\b(push|bump|value|setValue)\b/u);
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
