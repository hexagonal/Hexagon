/**
 * The variance analysis of #205 (closure doc
 * `spec/decisions-ml-dialect-generalization-2026-08.md` §5, §6).
 *
 * Two questions, deliberately kept apart because they have different answers:
 *
 * - **`effective`** — what every consumer reads, Step 2's covariance test above
 *   all. Transparent types infer (the definition is public, the computation
 *   leaks nothing); opaque types use their *declared* claim, and a bare
 *   parameter is the empty claim, meaning invariant. Used uniformly, home module
 *   included: a program must not compile in its home module and fail
 *   identically-written elsewhere (§6.4).
 * - **`computed`** — the true variance of the representation. Its only consumer
 *   is §6.3's verification of a written claim, plus the LSP affordance that
 *   offers the claim an author has not made (§8.2).
 *
 * The analysis introduces no subtyping. It answers exactly one question — may
 * this variable be generalized — and unification stays equality-based (§5.4).
 */

import { stronglyConnectedComponents } from "../../support/graph.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import type * as Source from "../../support/source.js";

/** The four-point lattice of §5.1, ordered `unused < co, contra < inv`. */
export type Variance = "unused" | "co" | "contra" | "inv";

/** A parameter position that carries a variable, and where it was seen. */
export interface Occurrence {
  readonly variance: Variance;
  /** The record field or constructor slot the occurrence sits in. */
  readonly field: string;
  readonly span: Source.Span;
}

/**
 * The **compiler-side claim table** (§5.3): parameterized constructors the
 * compiler implements and owns outright, for which no Hexagon declaration of
 * the *name* exists to carry a sigil.
 *
 * Rows come in two grades, and the difference is the warrant.
 *
 * - **Trusted** — no Hexagon-visible representation exists that the emitter yet
 *   targets, and `intrinsics.md` §4.2's parametricity obligation is the row's
 *   entire warrant. *(FFI Part 1 §8.3's edit note to this file calls that
 *   citation a second defect, on the ground that the spec text says §7's. It is
 *   a false alarm and is left unapplied: `intrinsics.md` §4.2 does carry the
 *   obligation — "**Parametricity is part of the contract**", added 2026-08-01
 *   under #205 — and says in the same bullet that the closure doc's §5.3
 *   trusted rows ride it. The closure doc's own §7 is the obligation's other
 *   home; both citations are live, so there is nothing here to correct.)*
 *   - `Node(+a)`: the hidden fixed-32 immutable slot type, read-only from
 *     Hexagon; its disposition is owned by #223, the reopener for this row.
 *   - `Vector(+a)`: `runtime/VectorTrie.hex` writes the representation in
 *     Hexagon, but nothing wires it to the emitter yet, so there is nothing for
 *     §6.3 to check. Collections Part 3 §4 specifies a persistent trie; what
 *     ships is a **copy-on-write native JavaScript array** (`append` is
 *     `[...v, x]`, `set` is `slice()`-then-assign), reaching no persistent
 *     collection runtime at all — which is further from `VectorTrie.hex` than a
 *     JS trie would be, so the conclusion holds a fortiori. *(Corrected
 *     2026-08-02 under #128, per FFI Part 1 §8.3's edit note to this file: this
 *     read "`Vector` ships from `@hexagon/runtime`'s JS trie today", wrong
 *     twice over — no such package exists, and there is no trie.)* The
 *     row upgrades to **verified** at the emitter-wiring milestone, at which
 *     point a future `a`-in-argument-position field in `VectorTrie.hex` breaks
 *     at the row rather than silently.
 * - **Invariant, because a claim may not rest on a contract** — the borrowed
 *   foreign views. `Array` is a view of a genuinely mutable foreign object whose
 *   stability is a boundary contract (FFI Part 1 §3.1, Part 2 §6.2), not a
 *   language guarantee. `JsMap` and `JsSet` are the same case one part further
 *   on: views of native JS `Map`/`Set` whose entries, elements and size are
 *   stable only by the borrow contract (FFI Part 10 §2), so the closure doc
 *   §5.3 table gives them `Array`'s row on `Array`'s grounds. `Nullable` is
 *   representation-direct and holds nothing mutable, but has no declaration site
 *   and no ruling: invariant is the conservative default here, not a mutability
 *   verdict. A claim for any of them needs its own ruling.
 *
 * `Map`'s row is **verified** as of the Map step (#370), and it is `co, co`.
 * §11.4 sequenced the real claim after the milestone, and the milestone has
 * arrived: `runtime/HashTrie.hex` writes the representation and the emitter is
 * wired to it, so there is something for §6.3 to check the claim *against* —
 * `k` and `v` reach `HashTrie` through `root: Root(k, v)`, whose three arms hold
 * them in `Sole(key: k, value: v)` and under `Tree(k, v)`'s `Node` slots, every
 * position covariant. `hash-trie-wiring.test.ts` reads the checker's own
 * computed variance for that record and asserts row equality here, with a
 * sabotage control, which is all "verified" means; §11.1 (ix)'s recomputation
 * clause is what obliges it to run on every edit to that file.
 *
 * `Set`'s row is **verified** as of the Set step (#373), and it is `co`. It
 * upgraded from the explicit invariant row it carried until then — a row written
 * out rather than left absent precisely so that changing it would have to be a
 * deliberate edit — and it reads the same representation `Map`'s does, one
 * composition step further along. A `Set(a)` is not the bare `HashTrie(a, Unit)`
 * the earlier note guessed: it is `HashSet(a)`, the one-field wrapper record the
 * Set step ruled, holding a `HashTrie(a, Unit)`, because one record carries one
 * `[Symbol.iterator]` and a map's yields pairs. The derivation is short given
 * `Map`'s: `a` reaches the trie through its key slot, covariant above; `Unit`
 * fills the value slot, so `a` has no occurrence there at all; and the wrapper's
 * one field puts nothing under an arrow. `hash-trie-wiring.test.ts` reads the
 * checker's own computed variance for `HashSet` and asserts row equality here,
 * with a sabotage control, which is all "verified" means; §11.1 (ix)'s
 * recomputation clause obliges it to run on every edit to that same file.
 *
 * The constructor with no row and no need of one is now `NullableCase` alone. It
 * is not nameable in a type annotation, so no representation can put a parameter
 * under it and `#classify` never reaches it — the default it would fall to is
 * not load-bearing, it is unreachable. `JsMap` and `JsSet` stood in that
 * category only while they had no representation at all (#396); they are
 * annotation syntax now, so they carry their §5.3 rows above.
 *
 * `Seq` is **not** here. It has a declaration site, and the ruling's transitional
 * `Seq(+a)` row was retired by writing the sigil into `stdlib/Seq.hex` — a
 * written sigil supersedes a row, and after the sweep exactly one claim source
 * per constructor is an invariant (§5.3, §11.1 (ix); the "(ix) one claim source
 * per constructor" case in `conformance/relaxed-generalization.test.ts` holds it).
 */
export const COMPILER_CLAIMS: ReadonlyMap<string, readonly Variance[]> = new Map([
  ["Vector", ["co"]],
  ["Node", ["co"]],
  ["Array", ["inv"]],
  ["Nullable", ["inv"]],
  ["Map", ["co", "co"]],
  ["Set", ["co"]],
  ["JsMap", ["inv", "inv"]],
  ["JsSet", ["inv"]],
]);

export function flip(variance: Variance): Variance {
  if (variance === "co") return "contra";
  if (variance === "contra") return "co";
  return variance;
}

/** The lattice join: a parameter's variance is the join of its occurrences. */
export function join(left: Variance, right: Variance): Variance {
  if (left === "unused") return right;
  if (right === "unused") return left;
  return left === right ? left : "inv";
}

/**
 * §5.1's sign multiplication: an occurrence at `sign` inside `T`'s slot whose
 * variance is `slot`. `+` preserves, `−` flips, `±` makes every occurrence
 * beneath it invariant, and *unused* erases them.
 */
export function multiply(sign: Variance, slot: Variance): Variance {
  if (sign === "unused" || slot === "unused") return "unused";
  if (slot === "inv" || sign === "inv") return "inv";
  return slot === "co" ? sign : flip(sign);
}

/** A declaration keyed for the graph: `u<id>` for unions, `r<id>` for records. */
type Key = string;

function unionKey(id: Resolved.UnionId): Key {
  return `u${Number(id)}`;
}

function recordKey(id: Resolved.RecordId): Key {
  return `r${Number(id)}`;
}

interface Entry {
  readonly key: Key;
  readonly name: string;
  readonly opaque: boolean;
  readonly parameters: readonly string[];
  readonly declaredParameters: readonly Resolved.DeclaredTypeParameter[];
  /** The representation: one entry per field or constructor slot. */
  readonly slots: readonly { readonly field: string; readonly annotation: Resolved.TypeAnnotation }[];
  /** Computed variance per parameter; filled by the fixpoint. */
  computed: Variance[];
  /** Where each parameter was seen, at what sign; filled on the last pass. */
  occurrences: Occurrence[][];
}

/**
 * The declarations a table is built over.
 *
 * §6.4's uniformity is a property of *which declarations are in here*, and it is
 * the reason the checker feeds this the whole program's nominals rather than the
 * ones its own module happens to name. A declaration can be reached without being
 * imported — through a re-exported alias, or through the type of an imported
 * function — and an absent declaration reads as invariant (`#effective`). Sourcing
 * the table per module would therefore make the same text compile in one module
 * and fail one import away, which is precisely what §6.4 forbids. The direction of
 * the error is safe either way, but "safe" is not the claim §6.4 makes.
 *
 * Earlier declarations win on a duplicate id. The checker passes its own module's
 * view first, so where a declaration appears in both, the copy the *checking*
 * module holds is the one used — which for an imported nominal is the copy the
 * resolver stamped `representationVisible: false`, not the home module's own. It
 * makes no difference: the two copies differ in that field alone, and this
 * analysis never reads it. Stated because the precedence is easy to assume the
 * other way round.
 */
export interface Declarations {
  readonly unions: Iterable<Resolved.Union>;
  readonly records: Iterable<Resolved.RecordDeclaration>;
}

export class VarianceTable {
  readonly #entries = new Map<Key, Entry>();
  /** The component currently being solved; see `#slotVariance`. */
  #solving = new Set<Key>();

  constructor(
    unions: Iterable<Resolved.Union>,
    records: Iterable<Resolved.RecordDeclaration>,
    ...rest: readonly Declarations[]
  ) {
    for (const union of [unions, ...rest.map((it) => it.unions)].flatMap((it) => [...it])) {
      if (this.#entries.has(unionKey(union.id))) continue;
      this.#entries.set(unionKey(union.id), {
        key: unionKey(union.id),
        name: union.name,
        opaque: union.opaque,
        parameters: union.parameters,
        declaredParameters: union.declaredParameters ?? [],
        slots: union.constructors.flatMap((constructor) =>
          constructor.slots.map((slot) => ({
            field: `${constructor.binding.name}.${slot.field}`,
            annotation: slot.annotation,
          }))
        ),
        computed: union.parameters.map(() => "unused" as Variance),
        occurrences: union.parameters.map(() => []),
      });
    }
    for (const record of [records, ...rest.map((it) => it.records)].flatMap((it) => [...it])) {
      if (this.#entries.has(recordKey(record.id))) continue;
      this.#entries.set(recordKey(record.id), {
        key: recordKey(record.id),
        name: record.name,
        opaque: record.opaque,
        parameters: record.parameters,
        declaredParameters: record.declaredParameters ?? [],
        slots: record.fields.map((field) => ({
          field: field.name,
          annotation: field.annotation,
        })),
        computed: record.parameters.map(() => "unused" as Variance),
        occurrences: record.parameters.map(() => []),
      });
    }
    this.#solve();
  }

  /**
   * The claim every consumer reads (§6.4). Out of range — an arity the caller
   * got wrong, or a declaration this module cannot see — reads as invariant,
   * which declines generalization rather than granting it.
   */
  effectiveUnion(id: Resolved.UnionId, index: number): Variance {
    return this.#effective(unionKey(id), index);
  }

  effectiveRecord(id: Resolved.RecordId, index: number): Variance {
    return this.#effective(recordKey(id), index);
  }

  /** The representation's true variance; §6.3's verification and §8.2's affordance only. */
  computedUnion(id: Resolved.UnionId, index: number): Variance {
    return this.#entries.get(unionKey(id))?.computed[index] ?? "inv";
  }

  computedRecord(id: Resolved.RecordId, index: number): Variance {
    return this.#entries.get(recordKey(id))?.computed[index] ?? "inv";
  }

  /**
   * Every occurrence of a declaration's parameter in its representation, in
   * source order — the material §6.3's report needs to name a witness.
   */
  occurrencesUnion(id: Resolved.UnionId, index: number): readonly Occurrence[] {
    return this.#entries.get(unionKey(id))?.occurrences[index] ?? [];
  }

  occurrencesRecord(id: Resolved.RecordId, index: number): readonly Occurrence[] {
    return this.#entries.get(recordKey(id))?.occurrences[index] ?? [];
  }

  #effective(key: Key, index: number): Variance {
    const entry = this.#entries.get(key);
    if (entry === undefined) return "inv";
    const parameter = entry.parameters[index];
    if (parameter === undefined) return "inv";
    if (!entry.opaque) return entry.computed[index] ?? "inv";
    // Bare is the empty claim, and the empty claim is invariant (§6.2).
    const declared = entry.declaredParameters.find(
      (candidate) => candidate.name === parameter,
    );
    return declared?.claim ?? "inv";
  }

  /**
   * §5.1's least fixpoint, run per strongly-connected component of the
   * type-declaration dependency graph, dependencies first.
   *
   * The order is what makes §6.3's rule real rather than incidental: while a
   * component is being solved its own members contribute their **computed**
   * estimate (`#solving` holds them), and every constructor outside it
   * contributes its **declared claim** — which for an under-claiming opaque type
   * is deliberately weaker than its representation supports. Solving one global
   * system instead would let a transparent type read an opaque neighbour's
   * representation through the back door.
   *
   * This is not what §6.4's uniformity rests on — that rests on the table being
   * sourced from the whole program, which is `Declarations`' business, not this
   * method's. Per-SCC order would hold §6.3 just as well over a per-module table,
   * and §6.4 would still be broken.
   *
   * Termination is immediate from the four-point lattice's finite height.
   */
  #solve(): void {
    const keys = [...this.#entries.keys()];
    const components = stronglyConnectedComponents(
      keys,
      (key) => this.#dependencies(key),
    );
    for (const component of components) {
      this.#solving = new Set(component);
      for (let changed = true; changed;) {
        changed = false;
        for (const key of component) {
          const entry = this.#entries.get(key)!;
          const next = entry.parameters.map(() => "unused" as Variance);
          for (const slot of entry.slots) {
            this.#classify(entry, slot.annotation, "co", next, undefined);
          }
          for (const [index, variance] of next.entries()) {
            if (entry.computed[index] !== variance) {
              entry.computed[index] = variance;
              changed = true;
            }
          }
        }
      }
      // A second pass over the settled component records where each parameter
      // occurs and at what sign, so a witness is never taken from a half-solved
      // iteration.
      for (const key of component) {
        const entry = this.#entries.get(key)!;
        const discard = entry.parameters.map(() => "unused" as Variance);
        for (const slot of entry.slots) {
          this.#classify(entry, slot.annotation, "co", discard, slot.field);
        }
      }
    }
    this.#solving = new Set();
  }

  /** Every declaration named anywhere in `key`'s representation. */
  #dependencies(key: Key): readonly Key[] {
    const entry = this.#entries.get(key);
    if (entry === undefined) return [];
    const found: Key[] = [];
    const walk = (annotation: Resolved.TypeAnnotation): void => {
      switch (annotation.kind) {
        case "Union":
          found.push(unionKey(annotation.union));
          annotation.arguments.forEach(walk);
          return;
        case "RecordDeclaration":
          found.push(recordKey(annotation.record));
          annotation.arguments.forEach(walk);
          return;
        case "Function":
          annotation.parameters.forEach(walk);
          walk(annotation.result);
          return;
        case "Tuple":
          annotation.elements.forEach(walk);
          return;
        case "Record":
          for (const field of annotation.fields) walk(field.annotation);
          return;
        case "Vector":
        case "Set":
        case "Node":
        case "Array":
        case "JsSet":
          walk(annotation.element);
          return;
        case "Nullable":
          walk(annotation.value);
          return;
        case "Map":
        case "JsMap":
          walk(annotation.key);
          walk(annotation.value);
          return;
        default:
          return;
      }
    };
    for (const slot of entry.slots) walk(slot.annotation);
    return found;
  }

  /**
   * Classifies every variable occurrence in `annotation` at the current `sign`,
   * joining into `into`. When `field` is given, each occurrence is also recorded
   * against the declaration for witness reporting.
   */
  #classify(
    entry: Entry,
    annotation: Resolved.TypeAnnotation,
    sign: Variance,
    into: Variance[],
    field: string | undefined,
  ): void {
    switch (annotation.kind) {
      case "TypeVariable": {
        const index = entry.parameters.indexOf(annotation.name);
        if (index < 0) return;
        into[index] = join(into[index] ?? "unused", sign);
        if (field !== undefined) {
          entry.occurrences[index]!.push({ variance: sign, field, span: annotation.span });
        }
        return;
      }
      case "Function":
        // `t` keeps the current sign; each parameter type in `s` flips it. The
        // only source of `−` among Hexagon-owned constructors (§5.2).
        for (const parameter of annotation.parameters) {
          this.#classify(entry, parameter, flip(sign), into, field);
        }
        this.#classify(entry, annotation.result, sign, into, field);
        return;
      case "Tuple":
        for (const element of annotation.elements) {
          this.#classify(entry, element, sign, into, field);
        }
        return;
      case "Record":
        // All Hexagon data is immutable: there is no field position that reads
        // *and* writes, so a field keeps the current sign (§5.1).
        for (const recordField of annotation.fields) {
          this.#classify(entry, recordField.annotation, sign, into, field);
        }
        if (annotation.tail !== undefined) {
          // The variance is joined but no `Occurrence` is recorded, so a claim
          // blocked here would report without a witness to point at. Unreachable
          // rather than handled: a row tail cannot be written in a declaration's
          // field annotation, which is the only annotation this walk ever sees.
          // If tails ever become writable there, this needs a span.
          const index = entry.parameters.indexOf(annotation.tail);
          if (index >= 0) into[index] = join(into[index] ?? "unused", sign);
        }
        return;
      case "Union":
        this.#classifyArguments(
          entry,
          annotation.arguments,
          sign,
          into,
          field,
          (index) => this.#slotVariance(unionKey(annotation.union), index),
        );
        return;
      case "RecordDeclaration":
        this.#classifyArguments(
          entry,
          annotation.arguments,
          sign,
          into,
          field,
          (index) => this.#slotVariance(recordKey(annotation.record), index),
        );
        return;
      case "Vector":
      case "Set":
      case "Node":
        this.#classify(
          entry,
          annotation.element,
          multiply(sign, COMPILER_CLAIMS.get(annotation.kind)?.[0] ?? "inv"),
          into,
          field,
        );
        return;
      case "Array":
      case "JsSet":
        this.#classify(
          entry,
          annotation.element,
          multiply(sign, COMPILER_CLAIMS.get(annotation.kind)?.[0] ?? "inv"),
          into,
          field,
        );
        return;
      case "Nullable":
        this.#classify(
          entry,
          annotation.value,
          multiply(sign, COMPILER_CLAIMS.get("Nullable")?.[0] ?? "inv"),
          into,
          field,
        );
        return;
      case "Map":
      case "JsMap":
        this.#classify(
          entry,
          annotation.key,
          multiply(sign, COMPILER_CLAIMS.get(annotation.kind)?.[0] ?? "inv"),
          into,
          field,
        );
        this.#classify(
          entry,
          annotation.value,
          multiply(sign, COMPILER_CLAIMS.get(annotation.kind)?.[1] ?? "inv"),
          into,
          field,
        );
        return;
      default:
        // Primitives, ranges, extern types (monomorphic in v1 — FFI Part 4
        // §12.4), implied types (unreferenceable in v1), and error nodes carry
        // no parameter occurrence.
        return;
    }
  }

  #classifyArguments(
    entry: Entry,
    arguments_: readonly Resolved.TypeAnnotation[],
    sign: Variance,
    into: Variance[],
    field: string | undefined,
    slotVariance: (index: number) => Variance,
  ): void {
    arguments_.forEach((argument, index) => {
      this.#classify(entry, argument, multiply(sign, slotVariance(index)), into, field);
    });
  }

  /**
   * The variance of another declaration's slot, as seen from inside the
   * fixpoint. §6.3, exactly: a constructor in the component being solved
   * contributes its computed estimate; one outside contributes its declared
   * claim — which for a transparent type *is* its computed variance, and for an
   * opaque one is whatever its author wrote. A declaration this module cannot
   * see reads as invariant, the answer that declines rather than grants.
   */
  #slotVariance(key: Key, index: number): Variance {
    const entry = this.#entries.get(key);
    if (entry === undefined) return "inv";
    if (this.#solving.has(key)) return entry.computed[index] ?? "inv";
    return this.#effective(key, index);
  }
}
