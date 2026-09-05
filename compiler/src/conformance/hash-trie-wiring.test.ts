import { describe, expect, test } from "vitest";

import { compileFiles, runMain } from "../support/test-project.js";
import { COMPILER_CLAIMS } from "../passes/checker/variance.js";
import { HASH_TRIE_RUNTIME_OPERATIONS } from "../passes/emitter/emitter.js";
import type * as Typed from "../syntax/typed/index.js";
import trieSource from "../../../stdlib/Runtime/HashTrie.hex?raw";

/**
 * Conformance for the wiring that makes a `Map(k, v)` — and, since #373, a
 * `Set(a)` — the Collections Part 4 §2.1 hash array mapped trie (#370): the
 * two-sided export contract, the import surface the runtime module is reached
 * through, the emitted shapes of the door lowerings, and the `Map(+k, +v)` and
 * `Set(+a)` variance claims the wiring makes checkable.
 *
 * One runtime module now backs two public types, and the fork is a second
 * record: `HashSet(a)` wraps a `HashTrie(a, Unit)` in one field, because one
 * record carries one `[Symbol.iterator]` and the trie's yields `[k, v]` pairs.
 * Both records' claims are read out of the same injected module.
 *
 * This is `vector-trie-wiring.test.ts`'s sibling and is deliberately not a
 * second `map-prelude-companion.test.ts`. That file asserts on the *results* of
 * operations and never on the representation, which is what lets it hold across
 * a change of backing. What is pinned here is precisely what that file must not
 * look at: which JavaScript is emitted, which module it comes from, and what a
 * program that touches no map does *not* carry.
 *
 * ## The two things emission knows
 *
 * A map's whole compiler-side contract is two sentences. **Every map value
 * carries `[Symbol.iterator]`**, which is what `Hex.Map<k, v> extends
 * Iterable<[k, v]>` promises and what `for (k, v) in m`, spread, `show`, `hash`,
 * and the derived `Eq`'s left walk all reach it through. **Every other operation
 * is a call into `Hex.Runtime.HashTrie`**, whose export list
 * (`HASH_TRIE_RUNTIME_OPERATIONS`) is the complete inventory. No emitted
 * JavaScript reads a `HashTrie`'s fields beyond `.size`, and the trie algebra is
 * Hexagon.
 */

/** One project's emitted JavaScript, by source path. */
function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** `/main.hex`'s emitted JavaScript for a one-module program. */
function mainJavaScript(source: string): string {
  return emitted([["/main.hex", "module Main\n\n" + source]], "/main.hex");
}

/** Every source path a project emits, in dependency order. */
function emittedPaths(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).modules.map(({ source }) => source.path);
}

/** A program that reaches a `Map`, minimally. */
const ONE_MAP = "export let n: Int = Map.size(Map.singleton(1, 2))\n";

/** The same for a `Set`, which since #373 is the trie's other public face. */
const ONE_SET = "export let k: Int = Set.size(Set.singleton(1))\n";

describe("the runtime module's two-sided contract", () => {
  /**
   * `Hex.Runtime.HashTrie` exports nothing at the Hexagon level — every
   * operation's type names the private `HashTrie` — so the emitter writes the
   * JavaScript export list from a fixed inventory. A name in the inventory that
   * the module does not declare would be a `SyntaxError` in generated code
   * rather than a diagnostic, so the two sides are checked against each other.
   */
  test("every inventory operation is declared by the trie module", () => {
    for (const operation of HASH_TRIE_RUNTIME_OPERATIONS) {
      expect(trieSource).toMatch(new RegExp(`^(fun|let) ${operation}\\b`, "mu"));
    }
  });

  /**
   * The other half of the export list's contract, and the reason it is a fixed
   * list rather than "everything the module declares": `containsKey`, `isEmpty`
   * and `representative` *are* declared in the trie and are deliberately absent
   * from the inventory. `stdlib/Map.hex` writes the first two in ordinary
   * Hexagon over `get` and `size`, and `Set.hex` writes its `isEmpty` the same
   * way; `containsKey` and `representative` are reached only from *inside* the
   * module, by the wrapper's `containsMember` and `memberIn` (#373). An export
   * list naming operations no consumer imports is a claim the wiring has no
   * reason to make.
   *
   * The list is also the whole inventory rather than one companion's half: the
   * export renderer keys off `"self"`, so the module publishes in one list
   * everything either companion could reach.
   */
  test("the module declares more than the inventory, and only the inventory is exported", () => {
    expect(trieSource).toMatch(/^let containsKey\b/mu);
    expect(trieSource).toMatch(/^let isEmpty\b/mu);
    expect(trieSource).toMatch(/^let representative<k: Hash>/mu);
    const javascript = emitted([["/main.hex", "module Main\n\n" + `${ONE_MAP}${ONE_SET}`]], "/Hex/Runtime/HashTrie.hex");
    expect(javascript).toContain(
      `export { ${HASH_TRIE_RUNTIME_OPERATIONS.join(", ")} };`,
    );
    expect(javascript).not.toContain("containsKey,");
    expect(javascript).not.toContain(", isEmpty");
    expect(javascript).not.toContain("representative,");
  });

  /**
   * The discipline `stdlib/Runtime/HashTrie.hex`'s header states, made checkable. The
   * module sees the prelude before its seat, and a vector literal, bracket,
   * pattern or `Vector.` call written in it would make the emitted
   * `HashTrie.js` import `Vector.js`, which already imports `VectorTrie.js` —
   * coupling this trie to a runtime nothing here wants, through an edge created
   * at emission that no `Import` item records and no acyclicity check can see.
   *
   * The seat (`RUNTIME_MODULES`' `precedes`) is what keeps the rule enforceable,
   * and it is why the seat stayed at `Vector` when `Map` took the last
   * prelude place: a later seat would let this module name `Vector`.
   */
  test("the emitted runtime module never imports Vector or the vector trie", () => {
    const javascript = emitted([["/main.hex", "module Main\n\n" + ONE_MAP]], "/Hex/Runtime/HashTrie.hex");
    const specifiers = [...javascript.matchAll(/^\s*import\b[^;\n]*?from\s+"([^"]+)";/gmu)]
      .map((match) => match[1]!);
    expect(specifiers).not.toContain("../Vector.js");
    expect(specifiers).not.toContain("./VectorTrie.js");
    expect(specifiers).not.toContain("../Map.js");
    // And it really does import — an empty list would pass the checks above
    // vacuously. `Seq` is `entries`' answer.
    expect(specifiers).toContain("../Seq.js");
  });

  /**
   * The iteration face, spliced at construction inside the runtime module and
   * nowhere else — the whole of what makes `Hex.Map<k, v> extends
   * Iterable<[k, v]>` true. It delegates to the module's own lazy `entries`
   * walk through the `Seq` driver rather than re-deriving the traversal, which
   * would be a second implementation of the same suspension problem.
   */
  test("every constructed trie carries the pair iterator", () => {
    const javascript = emitted([["/main.hex", "module Main\n\n" + ONE_MAP]], "/Hex/Runtime/HashTrie.hex");
    expect(javascript).toContain("[Symbol.iterator]: __hashTrieIterate");
    expect(javascript).toContain("function* __hashTrieIterate()");
    expect(javascript).toContain("yield* __seqToIterable(entries(this));");
    // The face is the runtime module's alone: a consumer never splices one.
    expect(mainJavaScript(ONE_MAP)).not.toContain("__hashTrieIterate");
  });
});

describe("the import surface", () => {
  /**
   * The guarantee in both directions. A program with no map must not carry the
   * hash trie at all, and one that touches a map must carry both the trie and
   * the `Map.hex` companion the operations are named through.
   */
  test("no map, no hash trie", () => {
    const files = [["/main.hex", "module Main\n\n" + "export let n: Int = 1 + 2\n"]] as const;
    expect(emittedPaths(files)).toEqual(["/main.hex"]);
    expect(mainJavaScript("export let n: Int = 1 + 2\n")).not.toContain("HashTrie");
  });

  /** A vector program stays a vector program: the two runtimes are independent. */
  test("a vector alone carries no hash trie", () => {
    const files = [["/main.hex", "module Main\n\n" + "export let v: Vector(Int) = [1, 2, 3]\n"]] as const;
    expect(emittedPaths(files)).not.toContain("/Hex/Runtime/HashTrie.hex");
    expect(emittedPaths(files)).not.toContain("/Hex/Map.hex");
    expect(emitted(files, "/main.hex")).not.toContain("HashTrie");
  });

  test("a map carries the trie and the companion", () => {
    const files = [["/main.hex", "module Main\n\n" + ONE_MAP]] as const;
    const paths = emittedPaths(files);
    expect(paths).toContain("/Hex/Runtime/HashTrie.hex");
    expect(paths).toContain("/Hex/Map.hex");
    // The companion is what `/main.hex` names; the trie is reached only from it.
    expect(emitted(files, "/main.hex")).toContain('from "./Hex/Map.js"');
    expect(emitted(files, "/main.hex")).not.toContain("HashTrie");
  });

  /**
   * The import names only what the module reached, in inventory order — the
   * same discipline the vector runtime's import line follows, and the reason it
   * is a function of what the module uses rather than of where it uses it.
   *
   * Since #373 the inventory has two halves and each companion takes its own:
   * `Map.hex` declares the map-facing seven and imports exactly those, and
   * `Set.hex` declares the set-facing eight and imports exactly those. Neither
   * reaches the other's, which is what "a function of what the module uses"
   * means when one runtime module backs two public types. Both lists are read
   * out of `HASH_TRIE_RUNTIME_OPERATIONS` by position rather than transcribed,
   * so a reordering there moves both assertions with it.
   */
  test("each companion imports its own half of the inventory, in inventory order", () => {
    const importLine = (operations: readonly string[]): string =>
      `import { ${
        operations
          .map((operation) =>
            `${operation} as __hashTrie${operation[0]!.toUpperCase()}${operation.slice(1)}`
          )
          .join(", ")
      } } from "./Runtime/HashTrie.js";`;

    const mapOperations = HASH_TRIE_RUNTIME_OPERATIONS.slice(0, 7);
    const setOperations = HASH_TRIE_RUNTIME_OPERATIONS.slice(7);
    expect(mapOperations).toEqual(["empty", "singleton", "size", "get", "set", "remove", "entries"]);
    expect(setOperations).toEqual([
      "emptySet",
      "soleMember",
      "memberCount",
      "containsMember",
      "memberIn",
      "addMember",
      "removeMember",
      "members",
    ]);

    expect(emitted([["/main.hex", "module Main\n\n" + ONE_MAP]], "/Hex/Map.hex"))
      .toContain(importLine(mapOperations));
    expect(emitted([["/main.hex", "module Main\n\n" + ONE_SET]], "/Hex/Set.hex"))
      .toContain(importLine(setOperations));
  });

  /**
   * A consumer that only reads a bracket reaches `get` and nothing else — the
   * bracket is the emitter's own lowering (Part 4 §4.1/§11), so it names the
   * runtime directly rather than going through the companion.
   */
  test("a bracket read imports the one operation it needs", () => {
    const javascript = mainJavaScript(
      "let m: Map(Int, String) = Map.singleton(1, \"one\")\n" +
        "export let head: String = m[1]\n",
    );
    expect(javascript).toContain(
      'import { get as __hashTrieGet } from "./Hex/Runtime/HashTrie.js";',
    );
  });

  /**
   * The specifier is path-adjusted from the importer's own emitted location,
   * exactly as the vector runtime's is: only `compileProject` knows where the
   * module was injected, and a guess would emit an import of a path that is not
   * there — a clean compile that fails at load.
   */
  test("a nested module reaches the runtime by a relative specifier", () => {
    const files = [
      ["/src/deep/inner.hex", "module Inner\n\n" + "export let n: Int = Map.size(Map.singleton(1, 2))\n"],
      ["/src/main.hex", "module Main\n\n" + "import Inner\nexport let m: Int = Inner.n\n"],
    ] as const;
    const javascript = emitted(files, "/src/deep/inner.hex");
    // Emission is laid out by declared name (Modules §11, Packages §6), not by
    // source path: `Inner` emits at the output root regardless of its file's
    // nesting, and the prelude sits under `Hex/` there too — one directory down.
    expect(javascript).toContain('from "./Hex/Map.js"');
    expect(emitted(files, "/Hex/Map.hex")).toContain('from "./Runtime/HashTrie.js"');
  });
});

describe("the seven door lowerings", () => {
  /**
   * Each declaration binds its lowering, read off the module that declares them
   * (`spec/intrinsics.md` §3.2's worked example). Six of the seven are the trie
   * operation itself under its imported name — an alias is the whole lowering,
   * and a wrapper would only add an arity to get wrong. `mapEmpty` is the one
   * that is not, because the trie's `empty` is a *value* and the door admits
   * `fun` only; the thunk is what bridges the two, and `export let empty =
   * emptyMap()` calls it exactly once per program.
   */
  test("each declaration binds its lowering", () => {
    const javascript = emitted([["/main.hex", "module Main\n\n" + ONE_MAP]], "/Hex/Map.hex");
    expect(javascript).toContain("const emptyMap = () => __hashTrieEmpty;");
    expect(javascript).toContain("const singleton = __hashTrieSingleton;");
    expect(javascript).toContain("const size = __hashTrieSize;");
    expect(javascript).toContain("const get = __hashTrieGet;");
    expect(javascript).toContain("const set = __hashTrieSet;");
    expect(javascript).toContain("const remove = __hashTrieRemove;");
    expect(javascript).toContain("const entries = __hashTrieEntries;");
    expect(javascript).toContain("const empty = emptyMap();");
  });

  /**
   * The constrained trio's ABI, which is what §3.4's grant is *for*: the
   * declaration carries `<k: Hash>`, so the call site appends the evidence
   * suffix the compiled `<k: Hash>` trie operation already takes. The two faces
   * agree by construction, because the same compiler emitted both — which is
   * exactly the argument the grant rests on.
   */
  test("a call to the keyed trio appends evidence", () => {
    const javascript = mainJavaScript(
      "export let n: Int = Map.size(Map.set(Map.empty, 1, 2))\n",
    );
    expect(javascript).toMatch(/set\(empty, 1, 2, \w*__Hash_Int\)/u);
  });

  /**
   * And the unconstrained rows do not. `singleton` is Part 4 §12.4's permanent
   * signature: an emitted call with a trailing dictionary here would be the
   * signature quietly acquiring the constraint the ruling says it never gets.
   */
  test("a call to singleton appends nothing", () => {
    const javascript = mainJavaScript(
      "export let n: Int = Map.size(Map.singleton(1, 2))\n",
    );
    expect(javascript).toContain("singleton(1, 2)");
    expect(javascript).not.toContain("__Hash_Int");
  });

  /**
   * The bracket's payload (Part 4 §4.3): nullary, branded, with a best-effort
   * key rendering in the message that §4.3 licenses as non-normative. The
   * `$hex` brand is what makes the thrown value the same *kind* of thing as
   * `Vector.hex`'s `IndexError` — today's inline read threw a bare `Error`
   * without it, which is the defect this lowering fixes on the way past.
   */
  test("the bracket throws the KeyError shape", async () => {
    const main = await runMain("module Main\n\n" + "let m: Map(Int, String) = Map.singleton(1, \"one\")\n" +
        "export fun boom(ignored: Int): String = m[9]\n",
    );
    let thrown: unknown;
    try {
      (main["boom"] as (ignored: number) => unknown)(0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "KeyError", $hex: "Hex.Map" });
    // Nullary: §4.3 rules out a key payload (a polymorphic key cannot be an
    // exception slot) and rules out every lying substitute for it.
    expect(Object.keys(thrown as object)).not.toContain("key");
    expect(Object.keys(thrown as object)).not.toContain("size");
  });
});

/**
 * The `Map(k, v)` claim, verified against the representation — the generalization
 * closure doc's §5.3 row, upgraded from written-invariant to **verified** at this
 * milestone and recomputed here on every edit to `stdlib/Runtime/HashTrie.hex` (its
 * §11.1 item (ix)).
 *
 * This mirrors `vector-trie-wiring.test.ts`'s §5.3 block, and for its reasons.
 * The variance is **read, never re-derived**: a test that walked the file's
 * field annotations itself would prove only that this file and the spec agree,
 * and would keep agreeing after an edit that broke the module. The answer comes
 * out of the checker's own `VarianceTable` fixpoint, published per parameter on
 * `Typed.RecordDeclaration.variance` — the single channel the §8.2 code action
 * and hover read, with nothing downstream recomputing it.
 */
describe("§5.3 the `Map(k, v)` claim, verified against the representation", () => {
  /**
   * The probe route: the project's **own** `HashTrie.hex` declaring
   * `module Runtime.HashTrie`, which is adopted as the member and compiled in
   * its real role (#829). There is no other route — the host grant that used to
   * privilege a path went with the ruling — so the probe reads the file's own
   * text at the member's own basename, beside a `/main.hex` whose map is what
   * reaches it.
   */
  const PROBE_PATH = "/HashTrie.hex";
  const TOUCH: readonly [string, string] = ["/main.hex", "module Main\n\n" + ONE_MAP];

  interface TrieVariance {
    readonly diagnostics: readonly string[];
    readonly hashTrie: readonly Typed.ParameterVariance[];
    readonly root: readonly Typed.ParameterVariance[];
  }

  /** `HashTrie`'s and `Root`'s parameter variance in the module at `path`. */
  function varianceIn(
    files: readonly (readonly [string, string])[],
    path: string,
  ): TrieVariance {
    const project = compileFiles(files);
    const module = project.modules.find(({ source }) => source.path === path);
    if (module === undefined) throw new Error(`${path} was not compiled`);
    const record = module.typed.records.find(({ name }) => name === "HashTrie");
    const union = module.typed.unions.find(({ name }) => name === "Root");
    if (record === undefined || union === undefined) {
      throw new Error(`${path} declares no HashTrie/Root`);
    }
    return {
      diagnostics: project.diagnostics.map(({ message }) => message),
      hashTrie: record.variance,
      root: union.variance,
    };
  }

  const positions = (variance: readonly Typed.ParameterVariance[]) =>
    variance.map(({ name, computed }) => [name, computed]);

  /**
   * The shipping route: the injected `/HashTrie.hex` a real map program is built
   * on — the embedded copy from `stdlib-sources.ts`, which
   * `vector-trie-wiring.test.ts`'s drift guard holds equal to
   * `stdlib/Runtime/HashTrie.hex`.
   */
  test("the trie every map is built on is covariant in both parameters", () => {
    const shipped = varianceIn([["/main.hex", "module Main\n\n" + ONE_MAP]], "/Hex/Runtime/HashTrie.hex");
    expect(shipped.diagnostics).toEqual([]);
    // §6.3's derivation, as the checker computes it: `k` and `v` reach
    // `HashTrie` through `root: Root(k, v)`, whose arms hold them in
    // `Sole(key: k, value: v)` and under `Tree(k, v)` — `Node` slots and
    // constructor fields all the way down, every one of them covariant.
    expect(positions(shipped.root)).toEqual([["k", "co"], ["v", "co"]]);
    expect(positions(shipped.hashTrie)).toEqual([["k", "co"], ["v", "co"]]);
    // Transparent and unsigilled, so this *is* what every consumer reads.
    expect(shipped.hashTrie[0]?.declared).toBeUndefined();
    expect(shipped.hashTrie[1]?.declared).toBeUndefined();
  });

  /** The row and the representation, side by side — which is all "verified" means. */
  test("the claim table's `Map` row is what the representation computes", () => {
    const shipped = varianceIn([["/main.hex", "module Main\n\n" + ONE_MAP]], "/Hex/Runtime/HashTrie.hex");
    expect(COMPILER_CLAIMS.get("Map")).toEqual(["co", "co"]);
    expect(shipped.hashTrie.map(({ computed }) => computed))
      .toEqual(COMPILER_CLAIMS.get("Map"));
  });

  /**
   * The control, and the whole reason the two tests above are not decoration: an
   * edit to `HashTrie.hex` that puts a parameter in argument position must turn
   * them red. Both halves go through the same probe route — the file's own text
   * adopted as the runtime member — so the only difference between the readings
   * is the one field.
   *
   * The sabotage also breaks the module outright, which is the machinery biting
   * rather than merely reporting — but reaching that here takes one line the
   * vector's version did not need, and the difference is worth recording.
   * `TrieVector`'s `empty` is built with `Node.empty()`, a *call*, so it is
   * expansive and §5's Step 2 runs on it; `HashTrie`'s is a bare record literal,
   * a syntactic value, which generalizes under the classic restriction with no
   * variance test at all. So the probe adds an expansive binding of its own —
   * identically in both halves, so the only difference between the readings is
   * still the one field — and *that* is where Step 2 declines to generalize a
   * variable occurring invariantly. The binding is annotated on purpose: a
   * declined variable is declined silently unless the binding *wrote* the
   * variable down, which is §4.1's report and the only shape that says why.
   */
  const EXPANSIVE = "\nfun makeEmpty<k, v>(): HashTrie(k, v) = empty\n" +
    "let widened: HashTrie(k, v) = makeEmpty()\n";

  test("a `v` in argument position turns the row red", () => {
    const baseline = varianceIn([[PROBE_PATH, `${trieSource}${EXPANSIVE}`], TOUCH], PROBE_PATH);
    expect(baseline.diagnostics).toEqual([]);
    expect(positions(baseline.hashTrie)).toEqual([["k", "co"], ["v", "co"]]);

    // One added field, `v` under a function arrow, plus the value every
    // construction site now has to supply.
    const sabotaged = "fun sink<a>(value: a): Int = 0\n\n" +
      trieSource
        .replace("    root: Root(k, v),\n}", "    root: Root(k, v),\n    consume: v -> Int,\n}")
        .replaceAll("HashTrie({", "HashTrie({\n        consume = sink,") +
      EXPANSIVE;
    expect(sabotaged).not.toBe(trieSource);

    const broken = varianceIn([[PROBE_PATH, sabotaged], TOUCH], PROBE_PATH);
    expect(positions(broken.hashTrie)).toEqual([["k", "co"], ["v", "inv"]]);
    expect(broken.hashTrie.map(({ computed }) => computed))
      .not.toEqual(COMPILER_CLAIMS.get("Map"));
    expect(broken.diagnostics.join("\n")).toContain("occurs in an invariant position");
  });
});

/**
 * The `Set(a)` claim, verified against the representation — the generalization
 * closure doc's §5.3 row, upgraded from **written-invariant** to verified at
 * this milestone (#373) and recomputed here on every edit to
 * `stdlib/Runtime/HashTrie.hex`, which is the same file `Map`'s row reads (its §11.1
 * item (ix), as extended by the Set step).
 *
 * The block above this one is the template and its reasoning carries over
 * whole; only the record read differs. `HashSet(a)` is the one-field wrapper the
 * Set step ruled, so the derivation is one composition step past `Map`'s: `a`
 * reaches the trie through the key slot, verified covariant above; `Unit` fills
 * the value slot, so `a` has no occurrence there at all; and the wrapper adds no
 * field that puts `a` under an arrow.
 */
describe("§5.3 the `Set(a)` claim, verified against the representation", () => {
  /** The probe route, as the `Map` block above; `/main.hex`'s set is the reach. */
  const PROBE_PATH = "/HashTrie.hex";
  const TOUCH: readonly [string, string] = ["/main.hex", "module Main\n\n" + ONE_SET];

  /** `HashSet`'s parameter variance in the module at `path`. */
  function wrapperVarianceIn(
    files: readonly (readonly [string, string])[],
    path: string,
  ): { readonly diagnostics: readonly string[]; readonly hashSet: readonly Typed.ParameterVariance[] } {
    const project = compileFiles(files);
    const module = project.modules.find(({ source }) => source.path === path);
    if (module === undefined) throw new Error(`${path} was not compiled`);
    const record = module.typed.records.find(({ name }) => name === "HashSet");
    if (record === undefined) throw new Error(`${path} declares no HashSet`);
    return {
      diagnostics: project.diagnostics.map(({ message }) => message),
      hashSet: record.variance,
    };
  }

  const positions = (variance: readonly Typed.ParameterVariance[]) =>
    variance.map(({ name, computed }) => [name, computed]);

  test("the wrapper every set is built on is covariant in its one parameter", () => {
    const shipped = wrapperVarianceIn([["/main.hex", "module Main\n\n" + ONE_SET]], "/Hex/Runtime/HashTrie.hex");
    expect(shipped.diagnostics).toEqual([]);
    expect(positions(shipped.hashSet)).toEqual([["a", "co"]]);
    // Transparent and unsigilled, so this *is* what every consumer reads.
    expect(shipped.hashSet[0]?.declared).toBeUndefined();
  });

  /** The row and the representation, side by side — all "verified" means. */
  test("the claim table's `Set` row is what the representation computes", () => {
    const shipped = wrapperVarianceIn([["/main.hex", "module Main\n\n" + ONE_SET]], "/Hex/Runtime/HashTrie.hex");
    expect(COMPILER_CLAIMS.get("Set")).toEqual(["co"]);
    expect(shipped.hashSet.map(({ computed }) => computed))
      .toEqual(COMPILER_CLAIMS.get("Set"));
  });

  /**
   * The control. An edit to the *wrapper* that puts `a` in argument position
   * must turn the two tests above red, and it must do so through the wrapper
   * alone: the trie beneath is untouched here, so this is the second record's
   * own reading being checked rather than the first's leaking into it.
   *
   * The expansive binding is here for the reason the `Map` block records —
   * `emptySet` is a bare record literal, a syntactic value, so it generalizes
   * under the classic restriction with no variance test at all, and Step 2 needs
   * something expansive to run on. The annotation is what makes a declined
   * variable say so (§4.1's report).
   */
  const EXPANSIVE_SET = "\nfun makeEmptySet<a>(): HashSet(a) = emptySet\n" +
    "let widenedSet: HashSet(a) = makeEmptySet()\n";

  test("an `a` in argument position on the wrapper turns the row red", () => {
    const baseline = wrapperVarianceIn(
      [[PROBE_PATH, `${trieSource}${EXPANSIVE_SET}`], TOUCH],
      PROBE_PATH,
    );
    expect(baseline.diagnostics).toEqual([]);
    expect(positions(baseline.hashSet)).toEqual([["a", "co"]]);

    // One added field on the wrapper, `a` under a function arrow, plus the value
    // every construction site now has to supply.
    const sabotaged = "fun drain<a>(value: a): Int = 0\n\n" +
      trieSource
        .replace(
          "record HashSet(a) = { trie: HashTrie(a, Unit) }",
          "record HashSet(a) = { trie: HashTrie(a, Unit), consume: a -> Int }",
        )
        .replaceAll("HashSet({", "HashSet({ consume = drain,") +
      EXPANSIVE_SET;
    expect(sabotaged).not.toBe(trieSource);

    const broken = wrapperVarianceIn([[PROBE_PATH, sabotaged], TOUCH], PROBE_PATH);
    expect(positions(broken.hashSet)).toEqual([["a", "inv"]]);
    expect(broken.hashSet.map(({ computed }) => computed))
      .not.toEqual(COMPILER_CLAIMS.get("Set"));
    expect(broken.diagnostics.join("\n")).toContain("occurs in an invariant position");
  });
});
