import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import * as Src from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";

/**
 * Conformance for type-annotation resolution order
 * (`spec/notes/compiler-conformance-defects.md`, 2026-07-26 defect 6;
 * `spec/notes/seq-deintrinsification-plan.md` Phase 2).
 *
 * Modules §5.5: "The compiler holds no resolution claim that outranks user
 * declarations." The retained boundary intrinsics (`Array`, `Nullable`, and the
 * runtime-private `Node`) are a fallback consulted *after* declarations, never
 * before.
 *
 * The resolver used to test the intrinsic branch *before* the record table but
 * *after* the union table, so a user `union Vector(a)` occluded the intrinsic
 * while a user `record Vector(a)` did not: the record declared successfully, yet
 * every `Vector(a)` annotation still reached the intrinsic and the two never
 * unified. The signature of that defect was a diagnostic that named the same
 * type on both sides — `type mismatch: expected Vector(Int), found Vector(Int)`.
 * The asymmetry between the two tables was the tell that the order was
 * accidental. Declarations are now consulted first, uniformly.
 *
 * `Seq`/`Vector`/`Set`/`Map` remain *members* of the fallback during this phase;
 * `Seq` leaves it in Phase 4. This phase changes order, not membership, so the
 * uncontested-intrinsic tests below must stay green throughout.
 */

/** Compiles entry `/main.hex` plus extras; returns every diagnostic the project reports. */
function diagnostics(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): readonly string[] {
  const files = [
    ...extras.map(([path, text], index) => new Source.File(Source.fileId(index + 1), path, text)),
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source),
  ];
  return compileProject(files).diagnostics.map((diagnostic) => diagnostic.message);
}

/**
 * The same, for a project that supplies a **runtime member's own file** — the
 * only place the hidden `Node` spelling answers, and so the only place its
 * ordering against the companion fallback is observable.
 *
 * A file is that member by sitting at its basename and declaring its name
 * (#829); no host grant privileges a path any more. The body is written out
 * here rather than read from `stdlib/Runtime/VectorTrie.hex` because the
 * specimen aliases something *as* `Node`, and the shipped trie's own text is
 * `Node.empty()`/`Node.get` throughout — the alias would take every one of
 * them. `RUNTIME_OPERATIONS` is the export inventory the emitter reports a
 * member for failing to declare (`VECTOR_RUNTIME_OPERATIONS`), so a member has
 * to carry the names whatever else it says.
 */
const RUNTIME_OPERATIONS = "let empty: Int = 0\n" +
  "fun size(x: Int): Int = 0\n" +
  "fun get(x: Int): Int = 0\n" +
  "fun set(x: Int): Int = 0\n" +
  "fun append(x: Int): Int = 0\n" +
  "fun prepend(x: Int): Int = 0\n" +
  "fun slice(x: Int): Int = 0\n" +
  "fun window(x: Int): Int = 0\n" +
  "fun concat(x: Int): Int = 0\n" +
  "fun nodeRun(x: Int): Int = 0\n";

function memberDiagnostics(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): readonly string[] {
  const files = [
    ["/VectorTrie.hex", `module Runtime.VectorTrie\n${source}`] as const,
    ...extras,
  ];
  return compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  ).diagnostics.map((diagnostic) => diagnostic.message);
}

/** Resolver/checker diagnostics for a single module, with the privileged-runtime gate available. */
function runtimeDiagnostics(
  source: string,
  options: { readonly runtime?: boolean } = {},
): readonly string[] {
  const file = new Src.File(Src.fileId(0), "/runtime.hex", "module Runtime\n\n" + source);
  // The checker carries resolver diagnostics forward, so this is the union of both.
  return check(resolve(parse(applyLayout(lex(file))), options)).diagnostics.map((d) => d.message);
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

/** Compiles a program and executes it, returning `/main.hex`'s exports. */
async function run(source: string): Promise<Record<string, unknown>> {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source)]);
  // The project-wide bag, not just the entry's: a broken prelude module must fail here.
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls);
    moduleUrls.set(
      module.source.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  // By path, never `modules[0]`: the prelude modules share the project.
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<string, unknown>;
}

describe("a user record occludes a same-named intrinsic, coherently", () => {
  test("annotation and constructor meet", () => {
    expect(diagnostics(
      "export record Vector(a) = { item: a }\n" +
      "export fun wrap(item: Int): Vector(Int) = Vector({ item = item })\n",
    )).toEqual([]);
  });

  test("a field read goes through the record", () => {
    expect(diagnostics(
      "export record Vector(a) = { item: a }\n" +
      "export fun unwrap(box: Vector(Int)): Int = box.item\n",
    )).toEqual([]);
  });

  test("companion dispatch reaches the record's own module", () => {
    expect(diagnostics(
      "export record Vector(a) = { item: a }\n" +
      "export fun doubled(box: Vector(Int)): Int = box.item * 2\n" +
      // A `let` header, so the caller sits outside `doubled`'s group: a dot call
      // may not reach into the group that contains it (Method Syntax §4.4).
      "export let use(box: Vector(Int)): Int = box.doubled()\n",
    )).toEqual([]);
  });

  test("companion dispatch reaches an imported home module", () => {
    expect(diagnostics(
      "import Boxes\n" +
      "export fun use(box: Boxes.Vector(Int)): Int = box.doubled()\n",
      [["/boxes.hex",
        "module Boxes\n\n" + "export record Vector(a) = { item: a }\n" +
        "export fun doubled(box: Vector(Int)): Int = box.item * 2\n"]],
    )).toEqual([]);
  });

  test("the occluded record round-trips at runtime", async () => {
    const module = await run(
      "export record Vector(a) = { item: a }\n" +
      "export fun wrap(item: Int): Vector(Int) = Vector({ item = item })\n" +
      "export fun unwrap(box: Vector(Int)): Int = box.item\n" +
      "export let answer: Int = unwrap(wrap(42))\n",
    );
    expect(module["answer"]).toBe(42);
  });

  test("the arity diagnostic comes from the declaration, not the intrinsic", () => {
    // The intrinsic `Vector` is unary; this record is binary. Before the reorder
    // the annotation reached the intrinsic and the arity went unremarked, showing
    // up later as an unintelligible `Vector(Int)` / `Vector(?, ?)` mismatch.
    expect(diagnostics(
      "export record Vector(a, b) = { one: a, two: b }\n" +
      "export fun make(): Vector(Int) = Vector({ one = 1, two = 2 })\n",
    )).toEqual(["type `Vector` expects 2 arguments, but 1 were provided"]);
  });

  test("a multi-parameter intrinsic name is occluded too", () => {
    expect(diagnostics(
      "export record Map(k, v) = { key: k, value: v }\n" +
      "export fun make(): Map(String, Int) = Map({ key = \"a\", value = 1 })\n",
    )).toEqual([]);
  });

  test("`Seq` in particular — the name Phase 4 needs", () => {
    expect(diagnostics(
      "export record Seq(a) = { item: a }\n" +
      "export fun wrap(item: Int): Seq(Int) = Seq({ item = item })\n",
    )).toEqual([]);
  });

  test("a user union still occludes (the half that always worked)", () => {
    expect(diagnostics(
      "export union Vector(a) = Item(a)\n" +
      "export fun wrap(item: Int): Vector(Int) = Item(item)\n",
    )).toEqual([]);
  });
});

describe("the boundary intrinsics are a fallback in both directions", () => {
  // Modules §5.5 names `Array`, `Nullable`, and the runtime-private `Node`
  // explicitly: deliberately *not* prelude-declared, and resolved after
  // declarations, never before. Both halves of that need pinning — that they
  // still resolve when nothing competes, and that they yield when something does.
  test("`Array` at an extern boundary", () => {
    expect(diagnostics(
      "extern from \"host\"\n    fun sink(values: Array(Int)): Unit\n",
    )).toEqual([]);
  });

  test("`Nullable` at an extern boundary", () => {
    expect(diagnostics(
      "extern from \"host\"\n    fun sink(value: Nullable(Int)): Unit\n",
    )).toEqual([]);
  });

  test("`Node` inside a privileged runtime module", () => {
    // Private: the intrinsic has no public form, so exporting it is a separate
    // (correct) error, and using it here would mask what this test is about.
    expect(runtimeDiagnostics(
      "fun make(): Node(Int) = Node.empty()\n", { runtime: true },
    )).toEqual([]);
  });

  test("`Node` stays hidden outside one", () => {
    expect(runtimeDiagnostics("fun make(): Node(Int) = Node.empty()\n")).toEqual([
      "unknown generic type `Node`",
      // Rule 1's plain report: `Node.` is read in the module-alias namespace,
      // and nothing there answers outside a runtime module. No repair clause —
      // the trie node is unimportable, so no module of the spelling is visible
      // (#829's Ruling A).
      "no module alias `Node`",
    ]);
  });

  test("a runtime `record Node(a)` outranks even the hidden intrinsic", () => {
    // And having outranked it, the name denotes an ordinary public record — the
    // export that the intrinsic forbids just above is unremarkable here.
    expect(runtimeDiagnostics(
      "export record Node(a) = { item: a }\n" +
      "export fun make(item: Int): Node(Int) = Node({ item = item })\n", { runtime: true },
    )).toEqual([]);
  });

  test("a user `record Array(a)` outranks the boundary intrinsic", () => {
    expect(diagnostics(
      "export record Array(a) = { item: a }\n" +
      "export fun wrap(item: Int): Array(Int) = Array({ item = item })\n",
    )).toEqual([]);
  });

  test("a user `record Nullable(a)` outranks the boundary intrinsic", () => {
    expect(diagnostics(
      "export record Nullable(a) = { item: a }\n" +
      "export fun wrap(item: Int): Nullable(Int) = Nullable({ item = item })\n",
    )).toEqual([]);
  });

  test("the occlusion reaches into extern signatures too", () => {
    // §5.5 grants no carve-out for extern positions, so an occluding declaration
    // wins there as well: `sink` takes the *record*. The call is the discriminator
    // — `Array({ item: ... })` can only be the record's constructor, so if the
    // extern's parameter had stayed the intrinsic this would not typecheck.
    // Recorded because it is the consequence a later reader of FFI Part 3 is most
    // likely to be surprised by, and it is a consequence of the spec as written.
    expect(diagnostics(
      "export record Array(a) = { item: a }\n" +
      "extern from \"host\"\n    fun sink(values: Array(Int)): Unit\n" +
      "export fun use(item: Int): Unit = sink!(Array({ item = item }))\n",
    )).toEqual([]);
  });
});

/**
 * Modules §5.1 rule 2's ordering, at the three spellings where it is visible
 * (#531). The boundary intrinsics were already behind declarations; they are now
 * behind **the companion fallback** as well — §5.5's own sentence applied, since
 * what the fallback resolves to is a user's declaration reached through the
 * user's own import.
 *
 * This is the one place the fallback re-means a program that already compiled,
 * and rule 2 says so in as many words. The tell of the old reading was the
 * same-name-both-sides mismatch — `expected Array(Int), found Array(Int)` —
 * defect 6's own signature, one namespace over.
 */
describe("the companion fallback outranks the boundary intrinsics", () => {
  const ARR = ["/arr.hex", "module Arr\n\n" + "export record Array(a) = { item: a }\n"] as const;
  const NUL = ["/nul.hex", "module Nul\n\n" + "export record Nullable(a) = { item: a }\n"] as const;

  test("`Array` — a same-spelled export through a same-spelled alias wins", () => {
    // The discriminator is the field: only the record has one. Under the old
    // order the annotation was the intrinsic and this read was a mismatch.
    expect(diagnostics(
      'import Arr as Array\n' +
      "export fun item(a: Array(Int)): Int = a.item\n",
      [ARR],
    )).toEqual([]);
  });

  test("`Array` — a constructed value meets the annotation, no same-name mismatch", () => {
    expect(diagnostics(
      'import Arr as Array\n' +
      "export fun wrap(item: Int): Array(Int) = Array.Array({ item = item })\n",
      [ARR],
    )).toEqual([]);
  });

  test("`Array` — an alias with no matching export leaves the intrinsic in place", () => {
    // The alias is visible and answers nothing, so resolution proceeds to what
    // answered before the fallback existed. If it had not, the extern row would
    // draw `unknown generic type \`Array\``.
    expect(diagnostics(
      'import Arr as Array\n' +
      'extern from "host"\n    fun rows(): Array(Int)\n' +
      "export let first: Array(Int) = rows!()\n" +
      "export let n: Int = Array.count()\n",
      [["/arr.hex", "module Arr\n\n" + "export fun count(): Int = 1\n"]],
    )).toEqual([]);
  });

  test("`Nullable` — the same pair", () => {
    expect(diagnostics(
      'import Nul as Nullable\n' +
      "export fun item(a: Nullable(Int)): Int = a.item\n",
      [NUL],
    )).toEqual([]);
    expect(diagnostics(
      'import Nul as Nullable\n' +
      'extern from "host"\n    fun maybe(): Nullable(Int)\n' +
      "export let first: Nullable(Int) = maybe!()\n" +
      "export let n: Int = Nullable.count()\n",
      [["/nul.hex", "module Nul\n\n" + "export fun count(): Int = 1\n"]],
    )).toEqual([]);
  });

  test("`Node` — the same pair, inside the one module where the spelling answers", () => {
    // Rule 2 carves the exception at `Node` only for a runtime-privileged
    // module, and shipped runtime source holds no import lines: a project
    // supplying the member's own file may, which is exactly this shape.
    // `Option` is a prelude member seated before this one, so it is in reach.
    const alias = "import Option as Node\n\n" + RUNTIME_OPERATIONS +
      // The annotation is the whole assertion: with no `Node` type behind the
      // alias the hidden intrinsic answers it, and without the intrinsic there
      // would be no type at all ("unknown generic type `Node`"). The *term*
      // spelling `Node.` is rule 1's, not rule 2's — an explicit alias takes it,
      // which it always did.
      "fun sized(n: Node(Int)): Int = 1\n";
    expect(memberDiagnostics(alias + "export let answer: Option(Int) = Node.Some(1)\n"))
      .toEqual([]);
    // And the type really is the intrinsic rather than the aliased module's own:
    // the alias's value handed to that annotation is a mismatch naming both.
    expect(memberDiagnostics(alias + "export let bad: Int = sized(Node.Some(1))\n").join("\n"))
      .toContain("expected Node(Int)");
  });

  /**
   * The other half of the pair the retired host grant used to reach, and the
   * reason it is gone rather than moved.
   *
   * That specimen put a **project** module's exported `Node` type behind the
   * alias, and it needed an ordinary project module to hold the runtime
   * privilege — which is what `runtimePaths` handed out and what #829 retired.
   * Privilege is membership now, and a member sees the injected modules before
   * it and nothing else (Modules §5.5), so a project module is not there to be
   * aliased. The refusal is the seat rule's, not the door's.
   */
  test("a runtime member cannot reach a project module, so it cannot alias one", () => {
    expect(memberDiagnostics(
      "import Mynode as Node\n\n" + RUNTIME_OPERATIONS + "fun item(n: Node(Int)): Int = 1\n",
      [["/mynode.hex", "module Mynode\n\n" + "export record Node(a) = { item: a }\n"]],
    )).toContain("no module `Mynode`");
  });

  test("the intrinsics that are not boundary types keep answering first", () => {
    // Rule 2's carve names three spellings. `Vector`, `Set`, `Map`, and the two
    // JS views are not among them, so conservativity there is exact: a
    // same-spelled alias over a same-spelled export changes nothing.
    expect(diagnostics(
      'import Myvec as Vector\n' +
      "export fun first(values: Vector(Int)): Int = values[0]\n",
      [["/myvec.hex", "module Myvec\n\n" + "export record Vector(a) = { item: a }\n"]],
    )).toEqual([]);
  });
});

describe("still-intrinsic names keep working — this phase changes order, not membership", () => {
  test("`Vector`", () => {
    expect(diagnostics("export fun first(values: Vector(Int)): Int = values[0]\n")).toEqual([]);
  });

  test("`Set`", () => {
    expect(diagnostics(
      "export fun has(values: Set(Int)): Bool = Set.contains(values, 1)\n",
    )).toEqual([]);
  });

  // Qualified, like the `Set` row above it. This used to be spelled `m.size()`,
  // which proved nothing about `Map` staying intrinsic: dot call resolved through
  // a flat by-name table, so `size` found this module's own `size` and the test
  // passed on a self-recursive call (#267). A `Map` receiver now names no
  // companion at all — `stdlib/Vector.hex` and its siblings are not in the
  // prelude yet — so the dot spelling reports, and only the core inventory
  // answers for `Map`.
  test("`Map`", () => {
    expect(diagnostics("export fun size(m: Map(String, Int)): Int = Map.size(m)\n")).toEqual([]);
  });

  test("`Seq`, through the compiler-known operation family", () => {
    expect(diagnostics(
      "export fun firstFew(): Vector(Int) = Vector.fromSeq(Seq.iterate(1, x => x + 1).take(3))\n",
    )).toEqual([]);
  });

  test("the `for ... in` desugaring is untouched by an occluding `record Seq`", () => {
    // The desugaring reaches the intrinsic type directly, not through the name,
    // so occluding `Seq` in a module that loops must not disturb it.
    expect(diagnostics(
      "export record Seq(a) = { item: a }\n" +
      "export fun visit(values: Vector(Int)): Unit =\n" +
      "    for value in values\n" +
      "        Debug.log(\"${value}\")\n",
    )).toEqual([]);
  });
});

describe("the term-level yield stays pinned", () => {
  // The term namespace already yielded to user bindings before this change
  // (resolver.ts's `SeqOperation`/`CollectionOperation` special cases each test
  // `scope.lookup` and the module aliases first). That is the behaviour the type
  // namespace has now been brought into line with; pin it against drift.
  test("a module alias named `Seq` takes `Seq.iterate`", () => {
    expect(diagnostics(
      "import Myseq as Seq\n" +
      "export fun use(): Int = Seq.iterate(1, x => x + 1)\n",
      [["/myseq.hex", "module Myseq\n\n" + "export fun iterate(seed: Int, step: (Int) -> Int): Int = step(seed)\n"]],
    )).toEqual([]);
  });

  test("a module alias named `Vector` takes `Vector.length`", () => {
    expect(diagnostics(
      "import Myvec as Vector\n" +
      "export fun use(): Int = Vector.length(7)\n",
      [["/myvec.hex", "module Myvec\n\n" + "export fun length(n: Int): Int = n\n"]],
    )).toEqual([]);
  });
});

describe("known residue, pinned deliberately", () => {
  test("a vector literal still means the intrinsic under an occluding `record Vector`", () => {
    // `[...]` is dedicated syntax wired to the intrinsic, so occluding the *name*
    // cannot redirect it. The result is the same same-name mismatch that defect 6
    // was about, now confined to the literal. This is `Vector`'s own arc to
    // resolve (plan Phase 5, item 11: "Vector's extra weight is its syntax
    // surface"); `Seq` has no literal form, so Phase 4 is unaffected. Pinned so
    // that arc has a starting assertion rather than a surprise.
    const reported = diagnostics(
      "export record Vector(a) = { item: a }\n" +
      "export fun lit(): Vector(Int) = [1, 2, 3]\n",
    );
    expect(reported).toHaveLength(1);
    // Not the exact text: the element is an un-unified inference variable whose
    // number is incidental. What is pinned is that the literal is rejected, and
    // that the rejection still names `Vector` on both sides.
    expect(reported[0]).toMatch(/^type mismatch: expected Vector\(Int\), found Vector\(/u);
  });
});
