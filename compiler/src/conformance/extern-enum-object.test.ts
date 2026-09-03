import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for the **object-reading form of `extern enum`** — Foreign Enums
 * §§1–8, and the §9 acceptance tests 1–12 it owns (issue #779).
 *
 * The form is a row of an `extern from` block whose members name **properties of
 * a foreign enum object**: `extern from "keyboard"` + `enum Key as Direction =
 * ARROW_UP as Up | ARROW_DOWN as Down`. The block's specifier says where the
 * object comes from; the row says which of its properties are the alternatives.
 *
 * Four claims are pinned here, and each is a sentence of the spec.
 *
 * - **It is a union** (§1, §4). The local type is nominal and monomorphic, the
 *   constructors are nullary and enter the term namespace, and matching,
 *   exhaustiveness, the constructor door and derivation are the ordinary
 *   union's. What differs is only where the runtime values come from. The
 *   parser therefore hoists the row out of its block into an ordinary
 *   module-level union carrying the specifier.
 * - **Each property is read exactly once** (§3), during ordinary ESM
 *   initialization, into a stable module binding. A getter runs once; a later
 *   mutation of the property does not change the constructor; nothing is
 *   validated, because the declaration is a trusted contract.
 * - **`Object.is` is normative** (§4). Matching, the generated `fromJsT`,
 *   derived `Eq`, and the declaration-index tables `Ord`, `Hash` and `Show` read
 *   all test with it, because the values are the foreign object's — a symbol, a
 *   singleton object, or a `NaN` — and only §2.4's literal form is the
 *   proven-identical case a `switch` needs.
 * - **The face is branded** (§7.2). An exported enum receives a nominal
 *   TypeScript face, because the declaration promises a closed set even where
 *   the dependency's own declarations widen its properties to `string`,
 *   `number`, `symbol` or a common class.
 *
 * The literal form is #773's and is pinned in `extern-enum-literal.test.ts`;
 * the two are exercised side by side here once, because the one thing that can
 * silently go wrong between them is a lowering meant for one reaching the other.
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
    /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const foreign = foreignUrls.get(specifier);
      if (foreign !== undefined) return `${prefix}${JSON.stringify(foreign)};`;
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/**
 * A `data:` URL is a module *identity*, so two runs whose emitted text is
 * byte-identical share one instantiated module — and one copy of the foreign
 * side's values with it. Read-once is exactly what several tests below observe,
 * so the tag is load-bearing here rather than a convenience.
 */
let runTag = 0;

/** Compiles a project with foreign modules and executes it, returning the entry's exports. */
async function run(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
  entry = "/main.hex",
): Promise<Record<string, unknown>> {
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
  for (const module of project.modules) {
    moduleUrls.set(
      module.source.path,
      url(link(module.javascript.text, module.source.path, moduleUrls, foreignUrls)),
    );
  }
  return (await import(/* @vite-ignore */ moduleUrls.get(entry)!)) as Record<string, unknown>;
}

/** The emitted JavaScript of a one-module program that must compile clean. */
function javascript(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/** The emitted `.d.ts` text of a one-module program that must compile clean. */
function declarations(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .declarations.text;
}

/** A TypeScript-style numeric enum object, reverse-map properties and all. */
const NUMERIC = "export const Key = { 0: \"Up\", 1: \"Down\", Up: 0, Down: 1 };\n";

describe("the foreign contract (§3, §9 tests 1–4)", () => {
  /**
   * §9 test 1, and §2.2's reason for it: "The compiler never discovers members
   * with `Object.keys`, `Object.values`, reverse-map inspection…". A TypeScript
   * numeric enum object carries *four* properties for two members; the explicit
   * list is the closed set, and `Up` holds `0` rather than the reverse map's
   * `"Up"`.
   */
  test("a numeric enum object's reverse-map properties are ignored", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "keys"\n' +
          "    export enum Key as Direction = Up | Down\n" +
          "\n" +
          "export let up: JsValue = toJsDirection(Up)\n" +
          "export let down: JsValue = toJsDirection(Down)\n" +
          "export let name(d: Direction): String =\n" +
          "    match d\n" +
          '        Up => "up"\n' +
          '        Down => "down"\n']],
      { keys: NUMERIC },
    );
    expect(exports["up"]).toBe(0);
    expect(exports["down"]).toBe(1);
    const name = exports["name"] as (value: unknown) => string;
    expect(name(0)).toBe("up");
    expect(name(1)).toBe("down");
  });

  /**
   * §9 test 2: "String members whose values differ from local constructor
   * names." No member is ever named by its constructor (§2.4's sentence, which
   * holds in both forms): the property is `UP` and the constructor is `Up`.
   */
  test("string members whose values differ from the local names", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "d"\n' +
          "    export enum Direction = UP as Up | DOWN as Down\n" +
          "\n" +
          "export let describe(d: Direction): String =\n" +
          "    match d\n" +
          '        Up => "going up"\n' +
          '        Down => "going down"\n' +
          "export let value: JsValue = toJsDirection(Up)\n"]],
      { d: 'export const Direction = { UP: "up", DOWN: "down" };\n' },
    );
    expect(exports["value"]).toBe("up");
    const describe = exports["describe"] as (value: unknown) => string;
    expect(describe("up")).toBe("going up");
    expect(describe("down")).toBe("going down");
  });

  /**
   * §9 test 3, and the whole reason §4 makes `Object.is` normative: symbols and
   * singleton objects match by **identity**, and a `NaN`-valued member is the
   * case where `===` and `Object.is` part company. A `switch` or a `===` chain
   * would answer `false` for the `NaN` member against itself, silently.
   */
  test("symbol, singleton and `NaN` members match by identity", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "kinds"\n' +
          "    export enum Kind derives (Eq) = S | O | N\n" +
          "\n" +
          "export let name(k: Kind): String =\n" +
          "    match k\n" +
          '        S => "symbol"\n' +
          '        O => "object"\n' +
          '        N => "nan"\n' +
          "export let same(a: Kind, b: Kind): Bool = a == b\n" +
          "export let nan: JsValue = toJsKind(N)\n" +
          "export let singleton: JsValue = toJsKind(O)\n"]],
      {
        kinds: "const only = { tag: 1 };\n" +
          'export const Kind = { S: Symbol("s"), O: only, N: Number.NaN };\n',
      },
    );
    const name = exports["name"] as (value: unknown) => string;
    const same = exports["same"] as (a: unknown, b: unknown) => boolean;
    expect(name(exports["nan"])).toBe("nan");
    expect(name(exports["singleton"])).toBe("object");
    // The measurement `===` cannot make: the value is not equal to itself under
    // it, so both the match arm above and `Eq` below rest on `Object.is`.
    expect(Number.isNaN(exports["nan"] as number)).toBe(true);
    expect(same(exports["nan"], exports["nan"])).toBe(true);
    expect(same(exports["singleton"], exports["singleton"])).toBe(true);
    expect(same(exports["nan"], exports["singleton"])).toBe(false);
    // A structurally identical object is a different singleton.
    expect(same(exports["singleton"], { tag: 1 })).toBe(false);
  });

  /**
   * §9 test 4: the two aliases are independent. The head aliases the *type* and
   * a member aliases the *property*, and either may be left unaliased in the
   * same declaration.
   */
  test("foreign and local aliases mix freely in one declaration", () => {
    const emitted = javascript(
      'extern from "keyboard"\n' +
        "    export enum Key as Direction = ARROW_UP as Up | Down\n" +
        "\n" +
        "export let up: Direction = Up\n" +
        "export let down: Direction = Down\n",
    );
    expect(emitted).toContain('import { Key as __DirectionForeign } from "keyboard";');
    expect(emitted).toContain("const Up = __DirectionForeign.ARROW_UP;");
    expect(emitted).toContain("const Down = __DirectionForeign.Down;");
  });

  /**
   * §3: "The compiler reads each property exactly once during ordinary ESM
   * initialization and retains the result in a stable module binding… A getter
   * runs once."
   */
  test("a getter runs exactly once", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "counter"\n' +
          "    export enum Counter as Tag = A | B\n" +
          "    fun reads(): Int\n" +
          "\n" +
          "export let isA(t: Tag): Bool =\n" +
          "    match t\n" +
          "        A => True\n" +
          "        B => False\n" +
          "export let count(): Int = reads!()\n" +
          "export let a: Tag = A\n"]],
      {
        counter: "let count = 0;\n" +
          'export const Counter = { get A() { count += 1; return "a"; }, B: "b" };\n' +
          "export function reads() { return count; }\n",
      },
    );
    const isA = exports["isA"] as (value: unknown) => boolean;
    // Every use reads the binding, never the property.
    expect(isA(exports["a"])).toBe(true);
    expect(isA("b")).toBe(false);
    expect(isA(exports["a"])).toBe(true);
    expect((exports["count"] as () => number)()).toBe(1);
  });

  /**
   * §3: "Later mutation of `$Direction.Up` does not change the meaning of the
   * Hexagon constructor."
   */
  test("mutating the property afterwards does not move the constructor", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "mut"\n' +
          "    export enum Mut as M = X | Y\n" +
          "    fun mutate(): Unit\n" +
          "\n" +
          "export let name(v: JsValue): String =\n" +
          "    match fromJsM(v)\n" +
          '        Some(X) => "x"\n' +
          '        Some(Y) => "y"\n' +
          '        None => "none"\n' +
          "export let change(): Unit = mutate!()\n" +
          "export let x: JsValue = toJsM(X)\n"]],
      {
        mut: 'export const Mut = { X: "x", Y: "y" };\n' +
          'export function mutate() { Mut.X = "changed"; }\n',
      },
    );
    (exports["change"] as () => void)();
    const name = exports["name"] as (value: unknown) => string;
    // The binding still holds what was read at initialization…
    expect(exports["x"]).toBe("x");
    expect(name("x")).toBe("x");
    // …and the property's new value is out of set, like any undeclared value.
    expect(name("changed")).toBe("none");
  });

  /**
   * §3: "ordinary typed use performs no defensive validation. A missing…
   * member is a false foreign declaration, not a condition silently converted to
   * `Option`." §8.1's diagnostic for an absent runtime export would require
   * inspecting the foreign package, which the compiler never does (§2.2), so
   * what is pinned is the observable behaviour: the property reads `undefined`
   * and nothing complains.
   */
  test("a declared member the object lacks is captured as `undefined`", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "partial"\n' +
          "    export enum Partial as P = Here | Absent\n" +
          "\n" +
          "export let missing: JsValue = toJsP(Absent)\n" +
          "export let present: JsValue = toJsP(Here)\n"]],
      { partial: 'export const Partial = { Here: "here" };\n' },
    );
    expect(exports["present"]).toBe("here");
    expect(exports["missing"]).toBeUndefined();
  });

  /**
   * `spec/doc-comments.md` §4.2: every form a block admits introduces a name and
   * is documentable, and a union's members claim their own blocks at the leading
   * `|`. The `extern from` header itself is not documentable and stays that way.
   */
  test("doc blocks attach to the head and to each member", () => {
    const face = declarations(
      'extern from "keyboard"\n' +
        "    (** Which way. *)\n" +
        "    export enum Key as Direction =\n" +
        "        (** Upwards. *)\n" +
        "        | ARROW_UP as Up\n" +
        "        (** Downwards. *)\n" +
        "        | ARROW_DOWN as Down\n",
    );
    expect(face).toContain("Which way.");
    expect(face).toContain("Upwards.");
    expect(face).toContain("Downwards.");
  });
});

describe("crossing and matching (§4, §5.1, §9 tests 5–6)", () => {
  /**
   * §5.1: "An enum value crosses unchanged in both directions… It does not
   * trigger the nested-adapter restrictions that apply to `Seq(a)`." Read off
   * the emitted text, because the claim is the *absence* of code: no encoder,
   * decoder, wrapper, copy or traversal at a parameter, a result, a callback or
   * an `Array(Direction)`.
   */
  test("parameters, results, callbacks and arrays cross with no wrapper", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Direction = Up | Down\n" +
        "    fun current(): Direction\n" +
        "    fun move(direction: Direction): Unit\n" +
        "    fun all(): Array(Direction)\n" +
        "    fun onChange(handler: (Direction) ->? Unit): Unit\n" +
        "\n" +
        "export let go(): Unit = move!(Up)\n" +
        "export let now(): Direction = current!()\n",
    );
    // A result and an `Array(Direction)` result are imported bare: nothing is
    // interposed on the way in.
    expect(emitted).toContain('import { current } from "d";');
    expect(emitted).toContain('import { all } from "d";');
    // `move` and `onChange` take the ordinary `Unit`-result wrapper every extern
    // returning `Unit` takes — a statement body, not a conversion.
    expect(emitted).toContain("const move = direction => { __moveForeign(direction); };");
    expect(emitted).toContain("const onChange = handler => { __onChangeForeign(handler); };");
    // The call passes the captured binding itself, and the result comes home as
    // itself.
    expect(emitted).toContain("const go = () => move(Up);");
    expect(emitted).toContain("const now = () => current();");
    // Nothing between the two sides: the conversions exist as bindings but no
    // signature reaches for them.
    expect(emitted).not.toContain("fromJsDirection(__");
    expect(emitted).not.toContain("toJsDirection(__");
  });

  /**
   * §4: "Matching evaluates the scrutinee once and compares it with the member
   * bindings… using `Object.is`", and the `switch` §4 licenses is the literal
   * form's alone. Both forms stand in one module here, because a lowering meant
   * for one reaching the other is the failure this pins against.
   */
  test("the object form lowers to an `Object.is` chain and the literal form to a `switch`", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Direction = Up | Down\n" +
        "\n" +
        'export extern enum Order = "asc" as Ascending | "desc" as Descending\n' +
        "\n" +
        "export let way(d: Direction): String =\n" +
        "    match d\n" +
        '        Up => "up"\n' +
        '        Down => "down"\n' +
        "export let order(o: Order): String =\n" +
        "    match o\n" +
        '        Ascending => "ascending"\n' +
        '        Descending => "descending"\n',
    );
    expect(emitted).toContain("const __match = d;");
    expect(emitted).toContain("if (Object.is(__match, Up)) {");
    expect(emitted).toContain("if (Object.is(__match, Down)) {");
    expect(emitted).toContain("switch (o) {");
    expect(emitted).toContain('case "asc":');
    // The object form never switches on the scrutinee, and never reads a tag.
    expect(emitted).not.toContain("switch (__match)");
    expect(emitted).not.toContain(".tag");
  });

  /**
   * §4: "Exhaustiveness and reachability use the declared local constructor
   * set" — the explicit list, never the object's properties, which the compiler
   * never inspects (§2.2).
   */
  test("exhaustiveness and reachability read the declared set", () => {
    const missing = 'extern from "d"\n' +
      "    enum Direction = Up | Down | Left\n" +
      "\n" +
      "let f(d: Direction): Int =\n" +
      "    match d\n" +
      "        Up => 1\n" +
      "        Down => 2\n";
    expect(projectDiagnostics(missing)).toEqual([
      "match is missing cases: `Left`",
    ]);
    const repeated = 'extern from "d"\n' +
      "    enum Direction = Up | Down\n" +
      "\n" +
      "let f(d: Direction): Int =\n" +
      "    match d\n" +
      "        Up => 1\n" +
      "        Down => 2\n" +
      "        Up => 3\n";
    expect(projectDiagnostics(repeated)).toEqual([
      "this case is unreachable; `Up` is already handled above",
    ]);
  });

  /**
   * §4: "a foreign function falsely declared as returning `Direction` may return
   * an out-of-set value. Hexagon need not add a hidden default arm to every
   * match." The chain's own unreachable-pattern backstop is what an out-of-set
   * value meets, exactly as the literal form's `switch` default does.
   */
  test("an out-of-set value reaching an exhaustive match throws", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "d"\n' +
          "    export enum Direction = Up | Down\n" +
          "\n" +
          "export let way(d: Direction): String =\n" +
          "    match d\n" +
          '        Up => "up"\n' +
          '        Down => "down"\n']],
      { d: 'export const Direction = { Up: "up", Down: "down" };\n' },
    );
    const way = exports["way"] as (value: unknown) => string;
    expect(way("up")).toBe("up");
    expect(() => way("sideways")).toThrow("Unexpected pattern.");
  });

  /**
   * §2.3's export reaches "the local nominal type, every local constructor and
   * the generated conversion bindings", and Pattern Matching §2.2's constructor
   * door then answers a bare head abroad from the expected type. The member is a
   * *binding*, not a tag, so the emitted match abroad has to name it — which is
   * the one import channel this form adds.
   */
  test("the constructor door works abroad, over an imported member binding", async () => {
    const exports = await run(
      [
        ["/bindings.hex",
          'extern from "d"\n' +
            "    export enum Direction = Up | Down\n"],
        ["/main.hex",
          'import Bindings from "./bindings"\n' +
            "\n" +
            "export let way(d: Bindings.Direction): String =\n" +
            "    match d\n" +
            '        Up => "up"\n' +
            '        Down => "down"\n'],
      ],
      { d: 'export const Direction = { Up: "u", Down: "d" };\n' },
    );
    const way = exports["way"] as (value: unknown) => string;
    expect(way("u")).toBe("up");
    expect(way("d")).toBe("down");
  });

  /** The import that door owes, and the module edge it reports. */
  test("a match abroad imports the member bindings it names", () => {
    const project = compileFiles([
      ["/bindings.hex", 'extern from "d"\n    export enum Direction = Up | Down\n'],
      ["/main.hex",
        'import Bindings from "./bindings"\n' +
          "\n" +
          "export let way(d: Bindings.Direction): String =\n" +
          "    match d\n" +
          '        Up => "up"\n' +
          '        Down => "down"\n'],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain(
      'import { Down as __Down, Up as __Up } from "./bindings.js";',
    );
    expect(main.javascript.enumMemberImports).toEqual(["./bindings"]);
    // A module that only *names* the type owes nothing.
    const bindings = project.modules.find(({ source }) => source.path === "/bindings.hex")!;
    expect(bindings.javascript.enumMemberImports).toEqual([]);
  });

  /**
   * §4: "Two extern enums listing identically named or identical-looking foreign
   * values remain distinct nominal types." Two blocks, one module.
   */
  test("two enums over the same foreign names stay distinct", () => {
    expect(projectDiagnostics(
      'extern from "a"\n' +
        "    enum Direction as Left = Up | Down\n" +
        'extern from "b"\n' +
        "    enum Direction as Right = Up as RUp | Down as RDown\n" +
        "\n" +
        "let f(x: Left): Right = x\n",
    )).toEqual(["type mismatch: expected Right, found Left"]);
  });

  /** Several enums in one block, each with its own capture. */
  test("one block may read several enum objects", () => {
    const emitted = javascript(
      'extern from "many"\n' +
        "    export enum Direction = Up | Down\n" +
        "    export enum Level = Low | High\n" +
        "\n" +
        "export let a: Direction = Up\n" +
        "export let b: Level = Low\n",
    );
    expect(emitted).toContain('import { Direction as __DirectionForeign } from "many";');
    expect(emitted).toContain('import { Level as __LevelForeign } from "many";');
    expect(emitted).toContain("const Up = __DirectionForeign.Up;");
    expect(emitted).toContain("const Low = __LevelForeign.Low;");
  });
});

describe("the generated conversions (§5.2, §9 tests 7–8)", () => {
  /**
   * §5.2: `fromJsT` "evaluates its input once, compares it with the declared
   * members… in declaration order using `Object.is`, and returns the
   * corresponding constructor in `Some`; otherwise it returns `None`."
   */
  test("`fromJsT` answers `Some` for every member and `None` otherwise", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "d"\n' +
          "    export enum Direction = Up | Down\n" +
          "\n" +
          "export let read(v: JsValue): String =\n" +
          "    match fromJsDirection(v)\n" +
          '        Some(Up) => "up"\n' +
          '        Some(Down) => "down"\n' +
          '        None => "none"\n']],
      { d: 'export const Direction = { Up: "u", Down: Number.NaN };\n' },
    );
    const read = exports["read"] as (value: unknown) => string;
    expect(read("u")).toBe("up");
    // The `NaN` member again, this time through the projection.
    expect(read(Number.NaN)).toBe("down");
    expect(read("elsewhere")).toBe("none");
    expect(read(undefined)).toBe("none");
  });

  /**
   * §8.3: "Distinct declared properties with the same `Object.is` value violate
   * §3. A compiler is not required to check the violation at module
   * initialization, but `fromJs` must not pretend aliases are
   * distinguishable." Declaration order decides, and the compiler does not
   * refuse the declaration — it cannot see the values.
   */
  test("aliased foreign values are not refused, and `fromJsT` answers the first", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "aliased"\n' +
          "    export enum Aliased as A = FIRST as One | SECOND as Two\n" +
          "\n" +
          "export let read(v: JsValue): String =\n" +
          "    match fromJsA(v)\n" +
          '        Some(One) => "one"\n' +
          '        Some(Two) => "two"\n' +
          '        None => "none"\n']],
      { aliased: 'export const Aliased = { FIRST: "same", SECOND: "same" };\n' },
    );
    expect((exports["read"] as (value: unknown) => string)("same")).toBe("one");
  });

  /**
   * §5.2: "`toJsDirection` is an identity widening to opaque `JsValue`; it does
   * not allocate or encode." Object identity is the observation that shows it.
   */
  test("`toJsT` preserves primitive value and object identity", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "kinds"\n' +
          "    export enum Kind = Text | Only\n" +
          "    let raw: JsValue\n" +
          "\n" +
          "export let text: JsValue = toJsKind(Text)\n" +
          "export let only: JsValue = toJsKind(Only)\n" +
          "export let original: JsValue = raw\n"]],
      {
        kinds: "const singleton = { id: 1 };\n" +
          'export const Kind = { Text: "t", Only: singleton };\n' +
          "export const raw = singleton;\n",
      },
    );
    expect(exports["text"]).toBe("t");
    expect(exports["only"]).toBe(exports["original"]);
  });

  /** The emitted shape: a chain, not a `switch`, and identity throughout. */
  test("the conversions are an identity chain and an identity function", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Direction = Up | Down\n" +
        "\n" +
        "export let f(v: JsValue): Option(Direction) = fromJsDirection(v)\n",
    );
    expect(emitted).toContain(
      'if (Object.is(__value, Up)) return { tag: "Some", value: Up };',
    );
    expect(emitted).toContain(
      'if (Object.is(__value, Down)) return { tag: "Some", value: Down };',
    );
    expect(emitted).toContain('return { tag: "None" };');
    expect(emitted).toContain("const toJsDirection = __value => __value;");
  });
});

describe("derivation (§6, §9 test 9)", () => {
  /**
   * §6: "`Ord` follows declaration order, never numeric/string/object
   * ordering." The object below is written so the two disagree: `Big` holds the
   * larger number and is declared first, so it is `Less`.
   */
  test("`Ord` follows declaration order, not value order", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "sizes"\n' +
          "    export enum Size derives (Eq, Ord, Show, Hash) = Big | Small\n" +
          "\n" +
          "export let order(): String = show(Ord.compare(Big, Small))\n" +
          "export let reverse(): String = show(Ord.compare(Small, Big))\n" +
          "export let same(): String = show(Ord.compare(Big, Big))\n"]],
      { sizes: "export const Size = { Big: 2, Small: 1 };\n" },
    );
    expect((exports["order"] as () => string)()).toBe("Less");
    expect((exports["reverse"] as () => string)()).toBe("Greater");
    expect((exports["same"] as () => string)()).toBe("Equal");
  });

  /**
   * §6: "`Show` uses the local constructor name (`Up`), not a foreign string
   * value or symbol description."
   */
  test("`Show` gives the local constructor name", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "d"\n' +
          "    export enum Direction derives (Eq, Show) = UP as Up | SIDEWAYS as Side\n" +
          "\n" +
          "export let names(): String = show(Up) ++ show(Side)\n"]],
      {
        d: 'export const Direction = { UP: "up", SIDEWAYS: Symbol("sideways") };\n',
      },
    );
    expect((exports["names"] as () => string)()).toBe("UpSide");
  });

  /**
   * §6: "`Hash` hashes the declaration index, not mutable object structure or
   * foreign numeric magnitude." Both halves: agreement with `Eq`, and
   * independence from the values — two enums whose members hold different
   * values but occupy the same positions hash alike.
   */
  test("`Hash` hashes the declaration index and agrees with `Eq`", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "two"\n' +
          "    export enum Size derives (Eq, Hash) = Big | Small\n" +
          "    export enum Mood derives (Eq, Hash) = Glad | Sad\n" +
          "\n" +
          "export let a(): Int = Hash.hash(Big)\n" +
          "export let b(): Int = Hash.hash(Big)\n" +
          "export let c(): Int = Hash.hash(Small)\n" +
          "export let d(): Int = Hash.hash(Glad)\n"]],
      {
        two: "export const Size = { Big: 2, Small: 1 };\n" +
          'export const Mood = { Glad: {}, Sad: Symbol("sad") };\n',
      },
    );
    const hash = (name: string) => (exports[name] as () => number)();
    expect(hash("a")).toBe(hash("b"));
    expect(hash("a")).not.toBe(hash("c"));
    // Position, not payload: `Big` holds `2` and `Glad` holds an object, and
    // both are the first member of their declaration.
    expect(hash("a")).toBe(hash("d"));
  });

  /**
   * §6: "`Eq` compares constructors; emission may use `Object.is` on the member
   * values." It must here, and the emitted text says which one it took: a
   * `NaN`-valued member under `===` would not be equal to itself.
   */
  test("derived `Eq` is `Object.is`, and the index tables are too", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Direction derives (Eq, Ord, Show, Hash) = Up | Down\n" +
        "\n" +
        "export let same(a: Direction, b: Direction): Bool = a == b\n",
    );
    expect(emitted).toContain(
      "const __Eq_Direction_equals = (__left, __right) => Object.is(__left, __right);",
    );
    expect(emitted).toContain("Object.is(__left, Up) ? 0 : Object.is(__left, Down) ? 1 : -1");
    expect(emitted).toContain('Object.is(__value, Up) ? "Up"');
  });

  /** A derived instance travels as any union's does. */
  test("a derived instance is usable abroad", async () => {
    const exports = await run(
      [
        ["/bindings.hex",
          'extern from "d"\n    export enum Direction derives (Eq, Show) = Up | Down\n'],
        ["/main.hex",
          'import Bindings from "./bindings"\n' +
            "export let shown(): String = show(Bindings.Down)\n" +
            "export let equal(): Bool = Bindings.Up == Bindings.Up\n"],
      ],
      { d: 'export const Direction = { Up: "u", Down: "d" };\n' },
    );
    expect((exports["shown"] as () => string)()).toBe("Down");
    expect((exports["equal"] as () => boolean)()).toBe(true);
  });
});

describe("the surfaces (§7, §9 test 10)", () => {
  /**
   * §7.2's branded face. The brand is TypeScript-only; the runtime values stay
   * the dependency's, which is what the exported member constants carry.
   */
  test("an exported enum faces as a brand, with its members and conversions", () => {
    const face = declarations(
      'extern from "keyboard"\n' +
        "    export enum Key as Direction = ARROW_UP as Up | ARROW_DOWN as Down\n",
    );
    expect(face).toContain("declare const DirectionBrand: unique symbol;");
    expect(face).toContain("export type Direction = { readonly [DirectionBrand]: never };");
    expect(face).toContain("export declare const Up: Direction;");
    expect(face).toContain("export declare const Down: Direction;");
    expect(face).toContain(
      "export declare function fromJsDirection(value: unknown): Option<Direction>;",
    );
    expect(face).toContain(
      "export declare function toJsDirection(value: Direction): unknown;",
    );
    // Not the literal form's face: the values are the dependency's, and the
    // brand is what carries §4's nominal distinctness into TypeScript.
    expect(face).not.toContain('"ARROW_UP"');
  });

  /**
   * The spelling is the cheap half; what the brand is *for* is what `tsc` does
   * with it. §4's nominal distinctness — "two extern enums listing identically
   * named or identical-looking foreign values remain distinct nominal types" —
   * is a fact the literal form's face gives up on purpose and this one keeps,
   * and a brand is the only way TypeScript can carry it.
   */
  test("the branded face compiles, and keeps two enums apart, under `tsc`", async () => {
    const face = declarations(
      'extern from "keyboard"\n' +
        "    export enum Key as Direction = ARROW_UP as Up | ARROW_DOWN as Down\n" +
        'extern from "sizes"\n' +
        "    export enum Size = Big | Small\n",
    );
    const option = "export type Option<a> = { tag: \"Some\"; value: a } | { tag: \"None\" };\n";
    expect(await typeScriptErrors({ "main.d.ts": face, "Option.d.ts": option })).toEqual([]);
    expect(
      await typeScriptErrors({
        "main.d.ts": face,
        "Option.d.ts": option,
        "consumer.ts": 'import { Up, toJsDirection, fromJsDirection } from "./main.js";\n' +
          "export const raw: unknown = toJsDirection(Up);\n" +
          "export const back = fromJsDirection(raw);\n",
      }),
    ).toEqual([]);
    const errors = await typeScriptErrors({
      "main.d.ts": face,
      "Option.d.ts": option,
      "consumer.ts": 'import { Big, toJsDirection } from "./main.js";\n' +
        "toJsDirection(Big);\n" +
        'toJsDirection("ARROW_UP");\n',
    });
    expect(errors).toHaveLength(2);
    // A `Size` lacks `Direction`'s brand, and a bare string lacks it too — which
    // is the literal form's trade taken the other way.
    expect(errors[0]).toContain("Property '[DirectionBrand]' is missing in type 'Size'");
    expect(errors[1]).toContain("error TS2345");
  });

  /** §2.3: an unprefixed declaration is private, and a private type faces nothing. */
  test("a private enum publishes nothing", () => {
    const source = 'extern from "d"\n' +
      "    enum Direction = Up | Down\n" +
      "\n" +
      "export let f(): Int = 1\n";
    expect(declarations(source)).not.toContain("Direction");
    const emitted = javascript(source);
    expect(emitted).toContain("const Up = __DirectionForeign.Up;");
    expect(emitted).not.toContain("export { Up };");
    expect(emitted).not.toContain("export { fromJsDirection };");
  });

  /**
   * §2.3: "`export enum` inside a block… exports the local nominal type, every
   * local constructor, and the generated conversion bindings."
   */
  test("`export enum` publishes the constructors and the conversions", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Direction = Up | Down\n",
    );
    expect(emitted).toContain("export { Up };");
    expect(emitted).toContain("export { Down };");
    expect(emitted).toContain("export { fromJsDirection };");
    expect(emitted).toContain("export { toJsDirection };");
  });

  /**
   * §7.1: "No enum reverse object, numeric table, string remapping, wrapper
   * class, or brand is created at runtime." §9 test 12's other half is
   * byte-identity over `stdlib/` and `runtime/`; this is the local reading of
   * it — an ordinary all-nullary union beside an enum keeps Unions §6.1's
   * tagged objects and its tag `switch`.
   */
  test("an ordinary all-nullary union beside an enum is unchanged", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Direction = Up | Down\n" +
        "\n" +
        "export union Colour = Red | Green\n" +
        "\n" +
        "export let name(c: Colour): String =\n" +
        "    match c\n" +
        '        Red => "red"\n' +
        '        Green => "green"\n',
    );
    expect(emitted).toContain('const Red = { tag: "Red" };');
    expect(emitted).toContain("switch (__match.tag) {");
    expect(emitted).toContain('case "Red":');
  });
});

describe("`Nullable` over an object-reading enum", () => {
  /**
   * §2.4's designation is the *literal* form's, and it rests on the enum naming
   * both nullish values — which the object-reading contract refuses outright
   * (§3 rule 4). So `Nullable(T)` here is an ordinary wrapper: accepted, and
   * distinct from `T`.
   */
  test("`Nullable` is an ordinary wrapper, and does not collapse", async () => {
    expect(projectDiagnostics(
      'extern from "d"\n' +
        "    enum Direction = Up | Down\n" +
        "\n" +
        "let f(x: Nullable(Direction)): Direction = x\n",
    )).toEqual(["type mismatch: expected Direction, found Nullable(Direction)"]);
    const exports = await run(
      [["/main.hex",
        'extern from "d"\n' +
          "    export enum Direction = Up | Down\n" +
          "    fun echo(v: Nullable(Direction)): Nullable(Direction)\n" +
          "\n" +
          "export let roundTrip(v: Nullable(Direction)): Nullable(Direction) = echo!(v)\n"]],
      {
        d: 'export const Direction = { Up: "u", Down: "d" };\n' +
          "export function echo(v) { return v; }\n",
      },
    );
    const roundTrip = exports["roundTrip"] as (value: unknown) => unknown;
    expect(roundTrip(null)).toBeNull();
    expect(roundTrip("u")).toBe("u");
  });
});

describe("diagnostics (§2.1, §2.2, §9 test 11)", () => {
  /** §2.1: "The body permits nullary members only." */
  test("a payload member is refused", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction = Up(Int) | Down\n',
    )).toEqual([
      "foreign enums contain stable values only; use `extern type` plus " +
      "explicit operations for structured foreign values",
    ]);
  });

  /** §2.1: "Foreign enum declarations are monomorphic." */
  test("a type-parameter list is refused", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction(a) = Up | Down\n',
    )).toEqual([
      "a foreign enum is monomorphic; `extern enum` takes no type parameters",
    ]);
  });

  /**
   * §2.2: "A repeated foreign member… is a compile error", naming both — the
   * message names the property and the label names the member that read it
   * first, which is the reading that stays sensible when neither member is
   * aliased and the two names coincide.
   */
  test("a repeated foreign member is refused", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction = UP as Up | UP as Also\n',
    )).toEqual(["`UP` is read twice; a foreign enum reads each member once"]);
    const source = 'extern from "d"\n    enum Direction = Up | Up as Second\n';
    expect(projectDiagnostics(source))
      .toEqual(["`Up` is read twice; a foreign enum reads each member once"]);
    // The label is what names the first origin once the message has stopped
    // naming it, so it is pinned rather than left to the message's shape: it
    // points at the first member, inside the block, and gives its constructor.
    const [diagnostic] = compileFiles([["/main.hex", source]]).diagnostics;
    expect(diagnostic?.labels?.map(({ message }) => message))
      .toEqual(["first read here, as `Up`"]);
    const label = diagnostic!.labels![0]!.span;
    expect(source.slice(label.start.offset, label.end.offset)).toBe("Up");
    expect(label.start.offset).toBeLessThan(diagnostic!.primary.start.offset);
  });

  /** §2.2: "…or local constructor is a compile error" — the union's own rule. */
  test("a repeated local constructor is refused", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction = UP as Up | DOWN as Up\n',
    )).toEqual(["duplicate constructor `Up`"]);
  });

  /** §2.2: "Local constructor names must be uppercase-start." */
  test("a lowercase foreign member with no alias is refused", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction = up | down\n',
    )).toEqual([
      "`up` names a foreign property; give it a constructor name: `up as Up`",
    ]);
  });

  /** The head's own half of the same rule. */
  test("a lowercase foreign type name with no alias is refused", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum key = Up | Down\n',
    )).toEqual([
      "foreign type `key` needs an uppercase-start local alias; write `enum key as Key`",
    ]);
  });

  /**
   * §2.4, §9 test 17: the block reads members, and never writes them.
   *
   * **Every one of the six kinds §2.4 admits**, and the float it refuses. Two of
   * them — `null` and `undefined` — are ordinary `NonUpperName`s everywhere else
   * in the grammar, so a refusal keyed on token kind alone would read them as
   * foreign property names: `enum Slot = null as Missing` would emit
   * `Slot.null`, bind JavaScript `undefined`, and reach §3 rule 4's forbidden
   * state with no diagnostic at all. Each spelling is listed here because each
   * is a separate way for that to happen.
   */
  test("a literal in member position is refused with the module-scope head", () => {
    const refusal = "an `extern from` block reads members, never writes them — a literal " +
      'enum is the module-scope form `extern enum T = "up" as Up`';
    for (const member of ['"up"', "0", "-1", "1.5", "true", "false", "null", "undefined"]) {
      expect(projectDiagnostics(
        `extern from "d"\n    enum Direction = ${member} as Up | DOWN as Down\n`,
      )).toEqual([refusal]);
    }
    // And in a later member position as well as the first, since the loop that
    // reads members asks the question once per member.
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction = UP as Up | null as Missing\n',
    )).toEqual([refusal]);
  });

  /**
   * §3: the property is spelled the way JavaScript spells one. Part 4 §3.2
   * admits any ECMAScript identifier as a foreign name, and that set is wider in
   * one direction than the set a *binding* may take: a reserved word is an
   * ordinary property name, and reaches it by the dot.
   */
  test("a member is read by the dot where JavaScript spells one, and the bracket otherwise", () => {
    const emitted = javascript(
      'extern from "d"\n' +
        "    export enum Reserved = default as Fallback | café as Cafe\n",
    );
    expect(emitted).toContain("const Fallback = __ReservedForeign.default;");
    expect(emitted).toContain('const Cafe = __ReservedForeign["café"];');
  });

  /** A head with no members at all. */
  test("a declaration with no members is refused", () => {
    expect(projectDiagnostics('extern from "d"\n    enum Direction =\n'))
      .toEqual(["a foreign enum needs at least one member"]);
  });

  /**
   * FFI Part 5's `extern class` is not this issue's, and its refusal stands
   * unchanged: `enum` is the only word the gate learned.
   */
  test("`class` keeps its refusal", () => {
    expect(projectDiagnostics('extern from "d"\n    class Widget\n'))
      .toEqual(["extern `class` declarations belong to a later FFI slice"]);
  });

  /**
   * §5.2: "Either generated name colliding with an explicit or generated term
   * binding is a hard compile error naming both origins."
   */
  test("a conversion-name collision is a hard error", () => {
    expect(projectDiagnostics(
      'extern from "d"\n' +
        "    enum Direction = Up | Down\n" +
        "\n" +
        "let fromJsDirection(v: Int): Int = v\n",
    )).toEqual([
      "`fromJsDirection` is already bound (line 2); `extern enum Direction` generates " +
      "it (Foreign Enums §5.2) — rename the enum type, or the other declaration.",
    ]);
  });

  /**
   * `enum` is a type-introducing row, so the modifiers that belong to a
   * callable or an imported value have no seat on it — the same sentences the
   * `type` row draws.
   */
  test("`default` and the purity claims are refused on an enum row", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    default enum Direction = Up | Down\n',
    )).toEqual(["`default` applies to foreign functions and values, not types"]);
    expect(projectDiagnostics(
      'extern from "d"\n    pure enum Direction = Up | Down\n',
    )).toEqual([
      "`pure` claims a function's face, and a type has none — the claim belongs " +
      "on an extern `fun`",
    ]);
  });

  /**
   * Part 4 §3.2's reservation half. The foreign side of an `as` is outside
   * Hexagon's name seats and is exempt; an unaliased seat is both sides at once
   * and takes the alias rewrite rather than a rename, which would read a
   * different property.
   */
  test("a reserved `__` foreign name is exempt when aliased and refused when not", () => {
    expect(projectDiagnostics(
      'extern from "d"\n    enum __Key as Direction = __UP as Up\n',
    )).toEqual([]);
    expect(projectDiagnostics(
      'extern from "d"\n    enum Direction = __UP\n',
    )).toEqual([
      "foreign member `__UP` uses the reserved `__` prefix; bind it with an alias: " +
      "`__UP as UP`",
    ]);
  });

  /** The block's own sentence names its four rows. */
  test("an unknown row still names what a block contains", () => {
    expect(projectDiagnostics('extern from "d"\n    42\n'))
      .toEqual(["extern blocks contain `fun`, `let`, `type`, or `enum` declarations"]);
  });
});
