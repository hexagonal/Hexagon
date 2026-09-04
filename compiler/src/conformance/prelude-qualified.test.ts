import { describe, expect, test } from "vitest";

import { compileProject, type Resolved, Source } from "../index";

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
    /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/** Compiles a project and executes it, returning `/main.hex`'s exports. */
async function run(files: readonly (readonly [string, string])[]): Promise<Record<string, unknown>> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  // Keyed and linked by the module's **address** — its full name laid out as a
  // path (Packages §6) — since that, not the source file's own path, is what
  // every emitted specifier is computed from (Modules §11.2, #829).
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.path, moduleUrls);
    moduleUrls.set(
      module.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  // By path, never `modules[0]`: the prelude members share the project.
  const main = project.modules.find((module) => module.source.path === "/main.hex")!;
  return (await import(/* @vite-ignore */ moduleUrls.get(main.path)!)) as Record<string, unknown>;
}

/**
 * Conformance for the qualified reachability of prelude names (Modules §6.4;
 * `spec/notes/compiler-conformance-defects.md` defect 10).
 *
 * §6.4 exists to underwrite §5.4: "The occlusion rule's *prelude version stays
 * reachable qualified* only works if every prelude name has a qualified home — a
 * companion module it also lives in." §5.4 leans on exactly that, promising that
 * after a module occludes `show`, "the prelude's version remains reachable
 * qualified."
 *
 * The prelude was seeded as *bare* names only. Terms went into a fallback scope
 * and type identities were registered, but the member module itself could not be
 * named, so no qualified path to it existed at all — `Option.Some` reported
 * `unknown name \`Option\``.
 *
 * Nothing depended on it while a module-level binder could not occlude a prelude
 * value (defect 9): no program could shadow `Some`, so the escape hatch had
 * nothing to protect. Fixing defect 9 made occlusion real, which makes this the
 * half that has to work.
 *
 * A prelude member is addressable as a **fallback** layer: an explicit
 * `import` of the same name is a module-level binding and wins (§5.4).
 */

function diagnostics(source: string): readonly string[] {
  return compileProject([new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source)])
    .diagnostics.map((diagnostic) => diagnostic.message);
}

/**
 * Compiles the entry beside a second module at `path`, whose header is derived
 * from its basename the way the headerless-file fixit derives one (Modules
 * §2.1): `mine.hex` declares `module Mine`.
 */
function withModule(path: string, text: string, entry: string): readonly string[] {
  const basename = path.slice(path.lastIndexOf("/") + 1).replace(/\.hex$/u, "");
  const name = basename
    .split(/[-_.]/u)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
  return compileProject([
    new Source.File(Source.fileId(1), path, `module ${name}\n\n${text}`),
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

describe("a prelude member is reachable by name", () => {
  test("its terms are, with no import line", () => {
    expect(diagnostics(
      "export let a: Option(Int) = Option.Some(1)\n" +
      "export let b: Option(Int) = Option.None\n" +
      "export let c: Result(Int, String) = Result.Ok(1)\n" +
      "export let d: Ordering = Ordering.Less\n",
    )).toEqual([]);
  });

  test("its types are", () => {
    expect(diagnostics(
      "export let a: Option.Option(Int) = Some(1)\n" +
      "export let b: Result.Result(Int, String) = Ok(1)\n",
    )).toEqual([]);
  });

  test("the open unions' bare spellings are untouched", () => {
    expect(diagnostics(
      "export let a: Option(Int) = Some(1)\n" +
      "export let b: Result(Int, String) = Ok(1)\n",
    )).toEqual([]);
    // `Ordering` is not an open union (#742, ruling 2), so its constructors have
    // only the qualified spelling — and the bare one draws §5.5's refusal
    // naming it, never an unknown name.
    expect(diagnostics("export let c: Ordering = Less\n"))
      .toEqual(["no bare `Less`; write `Ordering.Less`"]);
  });

  test("a member that does not export the name still says so", () => {
    // The qualifier resolves; the *member* is what rejects the field. Before the
    // fix this reported `unknown name \`Option\`` — a different, misleading error.
    expect(diagnostics("export let a: Int = Option.notThere(1)\n")).toEqual([
      "module `Option` does not export `notThere`",
    ]);
  });
});

describe("qualified access is what makes occlusion survivable (§5.4 + §6.4)", () => {
  test("an occluding module still reaches the prelude version qualified", () => {
    // The whole point of §6.4. `Some` is occluded module-wide by a local
    // binding; `Option.Some` must still be the prelude's constructor.
    expect(withModule(
      "/Result.hex",
      "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
      "export let tally: Int = 7\n",
      "export let tally: String = \"mine\"\n" +
      "export let local: String = tally\n" +
      "export let prelude: Int = Result.tally\n",
    )).toEqual([]);
  });
});

describe("an explicit alias is a module-level binding and wins", () => {
  test("`import Option` of a different module shadows the prelude member", () => {
    // §5.4: explicit imports enter the same layer as local bindings. The prelude
    // member is only a fallback, so this must resolve to the imported module —
    // and must not collide, which is what a same-layer registration would cause.
    expect(withModule(
      "/mine.hex",
      "export let greet(name: String): String = name\n",
      "import Mine as Option\n" +
      "export let a: String = Option.greet(\"x\")\n",
    )).toEqual([]);
  });

  test("the shadowed prelude type is still nameable unqualified", () => {
    expect(withModule(
      "/mine.hex",
      "export let greet(name: String): String = name\n",
      "import Mine as Option\n" +
      "export let a: Option(Int) = Some(1)\n" +
      "export let b: String = Option.greet(\"x\")\n",
    )).toEqual([]);
  });
});

describe("the qualified spelling runs (PR #90 finding F1)", () => {
  // Resolving the name is half the job. A prelude member has no namespace object
  // to dot into — unlike an explicit `import`, nothing declares one — so the
  // first fix emitted a bare `Option.Some(1)` with no import at all: a clean
  // compile and a `ReferenceError` on load. These assertions are on *values*
  // produced by executing the emitted module, which is the only level at which
  // that failure is visible.

  test("a qualified constructor produces the value", async () => {
    const module = await run([[
      "/main.hex",
      "module Main\n\n" + "export let wrapped: Option(Int) = Option.Some(41)\n" +
      "export let unwrapped: Int = match wrapped\n" +
      "    None => 0\n" +
      "    Some(value) => value + 1\n",
    ]]);
    expect(module["unwrapped"]).toBe(42);
  });

  test("a qualified nullary constructor produces the value", async () => {
    const module = await run([[
      "/main.hex",
      "module Main\n\n" + "export let nothing: Option(Int) = Option.None\n" +
      "export let isNothing: Bool = nothing == None\n",
    ]]);
    expect(module["isNothing"]).toBe(true);
  });

  test("a qualified value from a second member produces the value", async () => {
    const module = await run([[
      "/main.hex",
      "module Main\n\n" + "export let ordered: Ordering = Ordering.Less\n" +
      "export let isLess: Bool = ordered == Ordering.Less\n",
    ]]);
    expect(module["isLess"]).toBe(true);
  });

  test("the occluding module gets BOTH values, distinct", async () => {
    // The case that forbids the lazy fix. Importing the prelude's `tally` under
    // its own name would collide with the module-level binding that occludes it —
    // the very binding the qualified spelling exists to see past. Both values
    // have to survive to runtime, and be different.
    const module = await run([
      ["/Result.hex",
        "module Result\n\n" + "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
        "export let tally: Int = 7\n"],
      ["/main.hex",
        "module Main\n\n" + "export let tally: Int = 1\n" +
        "export let mine: Int = tally\n" +
        "export let theirs: Int = Result.tally\n"],
    ]);
    expect(module["mine"]).toBe(1);
    expect(module["theirs"]).toBe(7);
  });

  test("a qualified reference and a bare one share one import", async () => {
    // No occlusion here, so both spellings denote the same symbol and must not
    // produce two conflicting local bindings.
    const module = await run([[
      "/main.hex",
      "module Main\n\n" + "export let viaBare: Option(Int) = Some(1)\n" +
      "export let viaQualified: Option(Int) = Option.Some(2)\n" +
      "export let same: Bool = viaBare != viaQualified\n",
    ]]);
    expect(module["same"]).toBe(true);
  });
});

describe("the synthesized import dodges every module-level binding (PR #91 finding F1)", () => {
  /**
   * The dodge is what makes §6.4 usable, and it was written against a *list* of
   * binder forms — `let`, `fun`, `var` — rather than against the module. Every
   * other way to bind a module-level name collided, and the collision is the
   * silent kind: a clean compile whose emitted JavaScript redeclares an
   * identifier and dies with a `SyntaxError` on load.
   *
   * Unreachable before `Seq.hex` joined the prelude, because no prelude module
   * exported a single lowercase term for a local name to collide with. It became
   * reachable on some twenty-five common identifiers at once.
   *
   * The rule these pin is "dodge everything the emitted module already binds",
   * so they are deliberately *not* about `Seq` — the mechanism is general and the
   * next prelude member inherits it.
   */

  test("an explicit local binding does not collide with a qualified prelude term", async () => {
    // #762 left no named import to bind `take` bare; Modules §3.2's ordinary
    // route for a value bare under another module's name — an explicit `let`
    // — is the modern shape of the same collision risk.
    const module = await run([
      ["/lib.hex", "module Lib\n\n" + "export let take(value: Int): Int = value + 1\n"],
      ["/main.hex",
        "module Main\n\n" + "import Lib\n" +
        "let take = Lib.take\n" +
        "let source: Seq(Int) = Seq.iterate(1, x => x + 1)\n" +
        "export let mine: Int = take(1)\n" +
        "export let theirs: Vector(Int) = Vector.fromSeq(Seq.take(source, 2))\n"],
    ]);
    expect(module["mine"]).toBe(2);
    expect(elements(module["theirs"])).toEqual([1, 2]);
  });

  test("a constraint member does not collide with a companion candidate", async () => {
    // Reaches the collision with no prelude spelling anywhere in the source: the
    // *field call* alone registers the candidate, because resolution cannot yet
    // tell a companion dispatch from a call of a function-valued field.
    const module = await run([
      ["/main.hex",
        "module Main\n\n" + "constraint Mappable<c> =\n" +
        "    map(value: c, transform: Int -> Int): c\n" +
        "record Holder = { map: Int -> Int }\n" +
        "let holder = Holder({ map = value => value * 2 })\n" +
        "export let out: Int = holder.map(3)\n"],
    ]);
    expect(module["out"]).toBe(6);
  });

  test("a module-level let-pattern occludes, and does not collide", async () => {
    // Two halves at once. The pattern binder is a module-level `let` (§5.4), so
    // it may occlude the prelude's `take` — the fourth binder form of defect
    // 11's family — and the qualified spelling must still reach past it.
    const module = await run([
      ["/main.hex",
        "module Main\n\n" + "let (take, keep) = (10, 2)\n" +
        "let source: Seq(Int) = Seq.iterate(1, x => x + 1)\n" +
        "export let mine: Int = take + keep\n" +
        "export let theirs: Vector(Int) = Vector.fromSeq(Seq.take(source, 2))\n"],
    ]);
    expect(module["mine"]).toBe(12);
    expect(elements(module["theirs"])).toEqual([1, 2]);
  });

  test("an extern binding does not collide with a qualified prelude term", async () => {
    // Compiled, not run: the foreign module is not linkable here. The assertion
    // is that the emitted top level declares each name once.
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex",
        "module Main\n\n" + "extern from \"lib\"\n" +
        "    fun fold(value: Int): Int\n" +
        "export let mine: Int = fold!(1)\n" +
        "export let theirs: Int = Seq.length(Vector.toSeq([1, 2]))\n"),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!.javascript.text;
    expect(topLevelBindings(javascript).filter((name) => name === "fold")).toHaveLength(1);
  });

  test("the collection-core guard has no user-reachable receiver left, and the machinery still fires", async () => {
    // **This test used to assert the opposite, and the change is the
    // milestone.** `Set.empty`/`Set.isEmpty` were compiler core operations that
    // shared their spelling with real `Seq.hex`, `Vector.hex` and `Map.hex`
    // exports, and registering a companion candidate for them would have put
    // prelude terms the module never named into the used-prelude set. #370
    // retired `Map`'s entry from the guard and #373 retired `Set`'s: both are
    // prelude members now, so both spellings are ordinary qualified calls that
    // synthesize real imports, which is exactly what a companion module arriving
    // means.
    //
    // What is left of `#routesToCollectionCore` is `Node`, and it is
    // `#runtime`-gated — no user program can reach it, so no user program can
    // exercise the suppression at all. Its terminal disposition is #223.
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex",
        "module Main\n\n" + "let s: Set(Int) = Set.empty\n" +
        "export let blank: Bool = Set.isEmpty(s)\n"),
    ]);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find((module) => module.source.path === "/main.hex")!;
    expect(main.javascript.text).not.toContain("Vector.js");
    expect(synthesizedImportNames(main)).toEqual(["./Hex/Set:empty", "./Hex/Set:isEmpty"]);
    // The machinery the guard used to hold back is unchanged, and this is where
    // it is read. This is a function-valued *field* call, not companion dispatch —
    // it is the shape that cannot be decided without the checker, which is
    // exactly what `#noteCompanionCandidate` stays conservative for. Read off
    // the *resolved* tree, because that is where the candidate lives: since #263
    // emission filters the synthesized import to what Core references, so the
    // emitted text of this module says nothing about what was registered.
    const fieldCall = compileProject([
      new Source.File(Source.fileId(0), "/main.hex",
        "module Main\n\n" + "record Holder = { length: Int -> Int }\n" +
        "let holder = Holder({ length = value => value })\n" +
        "export let n: Int = holder.length(3)\n"),
    ]);
    expect(fieldCall.diagnostics).toEqual([]);
    const fieldMain = fieldCall.modules
      .find((module) => module.source.path === "/main.hex")!;
    // *Every* prelude member exporting the name, not the one the bare spelling
    // resolves to. Dispatch is type-directed, so `Vector.hex`'s `length`
    // occluding `Seq.hex`'s in the prelude scope says nothing about which one a
    // receiver can reach; registering only the winner made the
    // over-approximation an under-approximation and emitted a bare name the
    // other member's import had bound. `Array.hex` joined the exporters at #511
    // and rides the same rule, which is the point of asserting the whole list.
    expect(synthesizedImportNames(fieldMain))
      .toEqual(["./Hex/Seq:length", "./Hex/Vector:length", "./Hex/Array:length"]);
    expect(fieldMain.javascript.text).not.toContain("Seq.js");
    expect(fieldMain.javascript.text).not.toContain("Vector.js");
  });

  test("suppressing the core call still imports a genuinely dispatched `length`", async () => {
    // The failure the guard could cause if it were ever widened: emitted code
    // that calls a prelude name it never imported (defect log 8/10). One module,
    // both shapes — a `Map` core call that must NOT register a candidate, and a
    // real `Seq` dispatch of a colliding name that must. Run, not just compiled:
    // a missing import is a load-time `ReferenceError`, which only linking finds.
    const module = await run([
      ["/main.hex",
        "module Main\n\n" + "let source: Seq(Int) = Vector.toSeq([1, 2, 3])\n" +
        "let s: Set(Int) = Set.empty\n" +
        "export let measured: Bool = Set.isEmpty(s)\n" +
        "export let dispatched: Int = source.length()\n"],
    ]);
    expect(module["measured"]).toBe(true);
    expect(module["dispatched"]).toBe(3);
  });
});

/**
 * The prelude terms the *resolver* reached, as `specifier:name` — the
 * synthesized import items' names, before emission filters them (#263). The one
 * place a companion candidate is observable, since a registered candidate no
 * dispatch needed is now dropped before it reaches the emitted text.
 */
function synthesizedImportNames(
  module: { readonly resolved: { readonly items: readonly Resolved.Item[] } },
): readonly string[] {
  return module.resolved.items.flatMap((item) =>
    item.kind === "Import" && item.synthesized && item.form.kind === "Named"
      ? item.form.names.map(({ imported }) => `${item.specifier}:${imported}`)
      : []
  );
}

/** Every identifier the emitted module binds at top level, imports included. */
function topLevelBindings(javascript: string): readonly string[] {
  const bound: string[] = [];
  for (const line of javascript.split("\n")) {
    for (const match of line.matchAll(/^import \{([^}]*)\} from/gu)) {
      for (const piece of match[1]!.split(",")) {
        const parts = piece.trim().split(/\s+as\s+/u);
        const local = parts[parts.length - 1]!.trim();
        if (local !== "") bound.push(local);
      }
    }
    const declared = line.match(/^(?:const|let|var|function\*?) (\w+)/u);
    if (declared !== null) bound.push(declared[1]!);
  }
  return bound;
}
