/**
 * FFI Part 1 §5.4's **capture walk**, compiled: the type-directed copy a value
 * takes as it crosses a foreign boundary, rendered as a plan the `capture`
 * runtime helper interprets.
 *
 * §5.4 fixes the walk at a declared type τ and says nothing about its spelling
 * — "the emitter's spelling of the copy is its own … the access pattern above
 * is the contract" (Part 2 §6.2). What is compiled here is a **plan**: a flat
 * table of nodes, each naming the shape to rebuild and the plan its components
 * take, with a node's children addressed by index. Two properties come out of
 * that shape and neither is incidental:
 *
 * - **A recursive type is a finite plan.** `record R = { next: Option(R), xs:
 *   Array(Int) }` is three nodes whose edges form a cycle, because an index
 *   back-reference is all a recursive occurrence needs. A generator that
 *   composed one closure per type layer would not terminate on it.
 * - **A deep value is an iterative walk.** The helper drives one explicit
 *   worklist and never recurses, so §5.4's "the walk over a long acyclic
 *   structure is an **iterative** traversal that does not depend on recursion
 *   depth" is a property of the one interpreter rather than a property each
 *   generated copier would have to be audited for. A hundred-thousand-node
 *   chain costs a hundred thousand worklist entries and one stack frame.
 *
 * **Why this is a second walk over the type graph.** The checker owns §5.4's
 * membership function (`#findCapturedCollection`), and it is the one that
 * decides what a *position* may be — the refusals. It runs over `Mono`, the
 * checker's private representation: inference variables carrying resolution
 * state, records whose rows are still being solved, nominals whose components
 * are read through the checker's schemes and its lazy union materialisation.
 * None of that survives the pass boundary, and none of it exists here. So this
 * pass asks the same question over `Typed.Type`, the representation it is
 * handed, and the question it asks is narrower by exactly the refusals: *does
 * the copier do anything at this type* — which is `planFor(τ) !== undefined`,
 * and is therefore one function here rather than a predicate beside a
 * generator that could disagree with it.
 *
 * The two agree at every position this pass emits at **but one**, named below.
 * Where they differ harmlessly they differ because the checker followed a path
 * in order to refuse it — a captured collection under one of item 1's five
 * containers, inside an opaque representation — and this walk answers
 * "identity" for a position the program never reaches, because the program
 * does not compile.
 *
 * **Where a record's row is concerned, the two are held together at three
 * named places rather than by one construction.** A row is the only node at
 * which they can disagree about what a type *contains*, because it is the only
 * one whose contents unification can change after the declaration is written.
 *
 * 1. *The fields.* A structural record's fields are normalized before they
 *    cross the pass boundary (`#publicType`), so a tail unification solved
 *    contributes the fields it carries, exactly as `#findCapturedCollection`
 *    sees them. That is the repair for #961 review 1's finding 2: read raw,
 *    one record was "closed and walkable" to the checker and "open and names
 *    nothing" here, and the position that compiled crossed uncopied.
 * 2. *The published tail.* Read one link, never chased: a published tail is a
 *    row a **consumer** could instantiate, and §5.4 item 7 leaves a foreign
 *    seat's row open precisely because Hexagon cannot name what it did not
 *    declare (#961 review 2). The cost is that at a non-extern position a
 *    chain ending in a live variable publishes closed, which PR 3's export
 *    wrapper will have to look at again.
 * 3. *The extern's own row.* It is judged as **written**
 *    (`#externDeclaredSignatures`), which is also what this walk is handed, so
 *    a call site that solved the shared tail can redirect neither the refusal
 *    nor the copy (#961 reviews 2 and 3).
 * 4. *A nominal's field row.* There is nothing left to hold together: #962
 *    refuses `...` anywhere in a nominal `record`'s field types, a union
 *    payload or an `exception` payload, at the declaration
 *    (`#rejectOpenRowsInDeclarations`, Products §4). A declaration's row is
 *    one row for every value of the type, so the row a construction could
 *    once widen — and with it the two readings the checker used to need, and
 *    the disagreement this header recorded as its one live difference — no
 *    longer exists to be read two ways.
 *
 * **Two differences remain, and neither reaches a seat.** `Node`, the hidden
 * trie node, is identity here and followed there; it has no annotation syntax,
 * so no declaration can put it at a position. And the budget is asymmetric —
 * the checker's walk passes `#walkBudget` into `#normalizeRecord` and the pass
 * boundary passes none — which runs in the safe direction, because a chain the
 * checker abandons is a position it refuses.
 *
 * The third difference this header carried until #962 was a nominal's field
 * row at a seat that kept its open rows: the checker's live walk saw what a
 * construction had put in the field and the published row did not, so an
 * extern result of that nominal compiled with no plan and Hexagon held the
 * foreign array (#961 review 4's residue). It is gone because the declaration
 * that produced it is gone, which is where it had to be killed — the
 * disagreement was one record declaration's row being two rows, and no reading
 * here could have made it one.
 *
 * `capture-walk.test.ts` pins each of the four places above. The header claims
 * nothing the file does not pin, and denies nothing the file cannot prevent.
 */

import type * as Typed from "../../syntax/typed/index.js";

/** One component of a rebuilt aggregate: its property name and its plan. */
export type CaptureSlot = readonly [name: string, plan: number | null];

/**
 * One node of a capture plan. `null` in a component position means **identity**
 * — §5.4's "a component whose type names no captured collection is carried by
 * identity" — and is what keeps the walk from entering what it must not.
 */
export type CapturePlan =
  | { readonly k: "array"; readonly e: number | null }
  | { readonly k: "map"; readonly key: number | null; readonly value: number | null }
  | { readonly k: "set"; readonly e: number | null }
  | { readonly k: "tuple"; readonly e: readonly (number | null)[] }
  | {
    readonly k: "record";
    readonly fields: readonly CaptureSlot[];
    /**
     * Whether the declared row is **open** (Products §4's `...`). An open row
     * is legal at the positions where the *foreign* side instantiates the tail
     * (§5.4 item 7 — an extern result, an `extern let`), and the fields it did
     * not declare are held exactly as a value at a type variable is: by
     * identity. The copy therefore starts from a spread of the source, which
     * carries them, and overwrites only the fields the declaration named.
     */
    readonly open: boolean;
  }
  | {
    readonly k: "union";
    readonly arms: readonly (readonly [tag: string, slots: readonly CaptureSlot[]])[];
  }
  | { readonly k: "nullable"; readonly e: number };

/** One declared field or constructor slot, under the occurrence's arguments. */
export interface CaptureComponent {
  readonly name: string;
  readonly type: Typed.Type;
}

/** One constructor of a union occurrence, under that occurrence's arguments. */
export interface CaptureArm {
  readonly name: string;
  readonly slots: readonly CaptureComponent[];
}

/**
 * How this walk reaches a nominal declaration's components. Supplied by the
 * emitter, which holds the module's record and union tables; the walk itself
 * knows nothing about where a declaration lives.
 *
 * Both answer `undefined` for a declaration the module cannot reach and for one
 * the walk must **not** enter — an `opaque record` or `opaque union`, whose
 * erased runtime value crosses by identity (Part 7 §5) and whose representation
 * §5.4 item 2 therefore refuses to copy rather than rebuild, and the prelude
 * `Seq`/`Stream`, which are two of item 1's five containers.
 */
export interface CaptureNominals {
  readonly recordFields: (
    type: Typed.NominalRecordType,
  ) => readonly CaptureComponent[] | undefined;
  readonly unionArms: (type: Typed.UnionType) => readonly CaptureArm[] | undefined;
}

/**
 * How much of a type graph one module's plans may read before the walk gives
 * up and answers identity.
 *
 * The checker's bound is the load-bearing one: a position whose type outruns it
 * is **refused** (`#captureBoundRefusal`), so a program that reaches emission
 * has already been decided. This bound exists so that a best-effort emission of
 * an errored module cannot hang, and it is deliberately the same order of
 * magnitude — three orders above any declaration graph a program writes.
 */
const WALK_BUDGET = 50_000;

/**
 * The capture plans one emitted module needs, built on demand and rendered once.
 *
 * Plans are **deduplicated by a structural key over the declared type**, so a
 * type that crosses at four positions compiles to one node, and a recursive
 * occurrence finds the node already allocated and takes its index.
 */
export class CapturePlans {
  readonly #nominals: CaptureNominals;
  readonly #plans: (CapturePlan | undefined)[] = [];
  readonly #byKey = new Map<string, number>();
  /** Memoized answers to "does the copier do anything here", by type key. */
  readonly #named = new Map<string, boolean>();
  #steps = 0;

  constructor(nominals: CaptureNominals) {
    this.#nominals = nominals;
  }

  /**
   * The plan index the walk at `type` takes, or `undefined` where the walk
   * copies nothing and the value crosses **by identity, with no emitted
   * change** — §5.4's "an aggregate whose declared type names no captured
   * collection is not walked at all".
   */
  planFor(type: Typed.Type): number | undefined {
    if (!this.copies(type)) return undefined;
    return this.#allocate(type);
  }

  /**
   * Whether the walk at `type` copies anything — `planFor`'s own gate, asked
   * **without allocating a row**.
   *
   * `planFor(τ) !== undefined` answers the same question, and at a seat that
   * goes on to emit the copy it is the one to ask. This exists for the seats
   * that decide a *shape* and may emit nothing at all: an importer choosing
   * which edition of another module's export to bind (FFI Part 7 §7 occasion 4)
   * asks about types this module copies at no position of its own, and a row
   * allocated for such a question would render a plan table no emitted line
   * reads.
   *
   * One membership function either way — this is the predicate `planFor` gates
   * on, not a second reading of §5.4 standing beside it.
   *
   * **It spends no budget.** The counter below bounds the *plan table*, so that
   * an errored module's best-effort emission cannot hang; a question that
   * allocates no row has no business drawing it down, and the linkage question
   * is asked once per imported name, at every import, in every module. Were it
   * to accumulate, a module with enough imports would exhaust the bound before
   * emitting anything, `#key` would start truncating, and two unrelated types
   * would silently share one plan — a wrong copy from an exhausted counter
   * rather than from anything either type says. The walk itself stays bounded,
   * because the counter still rises inside the call and only the total is put
   * back.
   */
  copies(type: Typed.Type): boolean {
    const spent = this.#steps;
    try {
      return this.#namesCaptured(type);
    } finally {
      this.#steps = spent;
    }
  }

  /**
   * The module-level table, under the name the emitter minted for it.
   *
   * It is a `const` in the hoisted section, ahead of every body and ahead of
   * the `extern let` initializers that run at module evaluation (§4.4's
   * once-at-initialization capture is a module-level call).
   */
  lines(name: string): readonly string[] {
    if (this.#plans.length === 0) return [];
    return [
      `const ${name} = [`,
      ...this.#plans.map((plan) => `  ${renderPlan(plan)},`),
      "];",
    ];
  }

  #allocate(type: Typed.Type): number | undefined {
    const key = this.#key(type);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return existing;
    // The index is claimed **before** the components are read, which is the
    // whole of how a recursive type terminates: the occurrence the walk meets
    // again finds this index and takes it, and the node is filled in when the
    // components come back.
    const index = this.#plans.length;
    this.#plans.push(undefined);
    this.#byKey.set(key, index);
    const plan = this.#build(type);
    if (plan === undefined) {
      // Only a budget exhaustion reaches here, and only in a module that is
      // already errored; the slot keeps a shape the interpreter can read.
      this.#plans[index] = { k: "tuple", e: [] };
      return index;
    }
    this.#plans[index] = plan;
    return index;
  }

  #build(type: Typed.Type): CapturePlan | undefined {
    const inner = (component: Typed.Type): number | null => this.planFor(component) ?? null;
    switch (type.kind) {
      case "Array":
        return { k: "array", e: inner(type.element) };
      case "JsMap":
        return { k: "map", key: inner(type.key), value: inner(type.value) };
      case "JsSet":
        return { k: "set", e: inner(type.element) };
      case "Tuple":
        return { k: "tuple", e: type.elements.map(inner) };
      case "Nullable": {
        const value = this.planFor(type.value);
        // `Nullable(a)` names one only through `a`, so this is never identity.
        return value === undefined ? undefined : { k: "nullable", e: value };
      }
      case "Record": {
        const open = type.tail !== undefined;
        const fields = type.fields.flatMap((field): CaptureSlot[] => {
          const plan = this.planFor(field.type);
          // An open row starts from a spread, which already carries the fields
          // that cross by identity — declared or not — so only the walked ones
          // are listed. A closed row is rebuilt from its fields alone, which
          // reads each of them exactly once.
          if (open && plan === undefined) return [];
          return [[field.name, plan ?? null]];
        });
        return { k: "record", fields, open };
      }
      case "NominalRecord": {
        const components = this.#nominals.recordFields(type);
        if (components === undefined) return undefined;
        return {
          k: "record",
          fields: components.map((field): CaptureSlot => [field.name, inner(field.type)]),
          open: false,
        };
      }
      case "Union": {
        const arms = this.#nominals.unionArms(type);
        if (arms === undefined) return undefined;
        // **Every payload constructor is rebuilt**, not only the ones carrying
        // the collection: §5.4's clause is "a fresh aggregate of the same
        // representation … with each component the walk at its declared type",
        // and a value's constructor is not a static property of the position.
        // Nullary constructors are left out, so the interpreter finds no arm
        // for one and answers with the value — "Nullary constructors and `None`
        // are the shared constants they always were".
        return {
          k: "union",
          arms: arms.flatMap((arm) =>
            arm.slots.length === 0
              ? []
              : [[
                arm.name,
                arm.slots.map((slot): CaptureSlot => [slot.name, inner(slot.type)]),
              ] as const]
          ),
        };
      }
      default:
        return undefined;
    }
  }

  /**
   * §5.4's trigger, asked as the emitter has to ask it: **does the copier do
   * anything at this type**. Plain reachability, so it is computed as
   * reachability — a queue over the constructors the copier enters, with a
   * `seen` set of occurrence keys that is never unwound.
   *
   * The constructors it enters are exactly the ones `#build` rebuilds. A
   * runtime container (`Vector`, `Map`, `Set`, and the `Seq`/`Stream` records
   * `#nominals` withholds), an opaque representation, a function type and a
   * type variable all end a path here, where the checker's walk follows them
   * and reports a refusal instead. Every such type is refused at every position
   * this pass emits at, so the two verdicts differ only where no code is
   * emitted at all.
   */
  #namesCaptured(type: Typed.Type): boolean {
    const key = this.#key(type);
    const memo = this.#named.get(key);
    if (memo !== undefined) return memo;
    const pending: Typed.Type[] = [type];
    const seen = new Set<string>();
    let found = false;
    for (let head = 0; head < pending.length && !found; head += 1) {
      this.#steps += 1;
      if (this.#steps > WALK_BUDGET) break;
      const actual = pending[head]!;
      switch (actual.kind) {
        case "Array":
        case "JsMap":
        case "JsSet":
          found = true;
          break;
        case "Tuple":
          pending.push(...actual.elements);
          break;
        case "Record":
          pending.push(...actual.fields.map((field) => field.type));
          break;
        case "Nullable":
          pending.push(actual.value);
          break;
        case "NominalRecord": {
          const occurrence = this.#key(actual);
          if (seen.has(occurrence)) break;
          seen.add(occurrence);
          for (const field of this.#nominals.recordFields(actual) ?? []) {
            pending.push(field.type);
          }
          break;
        }
        case "Union": {
          const occurrence = this.#key(actual);
          if (seen.has(occurrence)) break;
          seen.add(occurrence);
          for (const arm of this.#nominals.unionArms(actual) ?? []) {
            for (const slot of arm.slots) pending.push(slot.type);
          }
          break;
        }
        default:
          break;
      }
    }
    this.#named.set(key, found);
    return found;
  }

  /**
   * A structural key for one type occurrence, distinguishing exactly what the
   * plan table has to distinguish: two occurrences of one declaration under
   * different arguments are two plans, and under the same arguments they are
   * one. Nominals key on their **identity**, never their name, because two
   * declarations may share a spelling.
   *
   * Past the budget the key truncates, which conflates occurrences — harmless,
   * because a module whose types outrun the bound is one the checker refused.
   */
  #key(type: Typed.Type): string {
    this.#steps += 1;
    if (this.#steps > WALK_BUDGET) return "…";
    const of = (inner: Typed.Type): string => this.#key(inner);
    switch (type.kind) {
      case "Primitive":
        return type.name;
      case "Range":
        return "Range";
      case "JsValue":
        return "JsValue";
      case "Error":
        return "<error>";
      case "Variable":
        return `?${type.id}`;
      case "ExternType":
        return `x${type.externType}`;
      case "Vector":
        return `Vector(${of(type.element)})`;
      case "Set":
        return `Set(${of(type.element)})`;
      case "Array":
        return `Array(${of(type.element)})`;
      case "JsSet":
        return `JsSet(${of(type.element)})`;
      case "Node":
        return `Node(${of(type.element)})`;
      case "Nullable":
        return `Nullable(${of(type.value)})`;
      case "Map":
      case "JsMap":
        return `${type.kind}(${of(type.key)},${of(type.value)})`;
      case "Tuple":
        return `(${type.elements.map(of).join(",")})`;
      case "Record":
        return `{${type.fields.map((field) => `${field.name}:${of(field.type)}`).join(",")}${
          type.tail === undefined ? "" : `...${type.tail}`
        }}`;
      case "Function":
        return `(${type.parameters.map(of).join(",")})->${of(type.result)}`;
      case "Union":
        return `u${type.union}(${type.arguments.map(of).join(",")})`;
      case "NominalRecord":
        return `r${type.record}(${type.arguments.map(of).join(",")})`;
    }
  }
}

/** One plan node as emitted JavaScript — an object literal a reader can follow. */
function renderPlan(plan: CapturePlan | undefined): string {
  if (plan === undefined) return "{ k: \"tuple\", e: [] }";
  switch (plan.k) {
    case "array":
      return `{ k: "array", e: ${plan.e} }`;
    case "map":
      return `{ k: "map", key: ${plan.key}, value: ${plan.value} }`;
    case "set":
      return `{ k: "set", e: ${plan.e} }`;
    case "tuple":
      // `String` per slot rather than `join` on the list: `Array.prototype.join`
      // renders `null` as the empty string, which would emit `[, 1]` — a hole,
      // and a plan the interpreter reads as `undefined`.
      return `{ k: "tuple", e: [${plan.e.map((slot) => String(slot)).join(", ")}] }`;
    case "record":
      return `{ k: "record", fields: [${
        plan.fields.map(([name, slot]) => `[${JSON.stringify(name)}, ${slot}]`).join(", ")
      }], open: ${plan.open} }`;
    case "union":
      return `{ k: "union", arms: [${
        plan.arms.map(([tag, slots]) =>
          `[${JSON.stringify(tag)}, [${
            slots.map(([name, slot]) => `[${JSON.stringify(name)}, ${slot}]`).join(", ")
          }]]`
        ).join(", ")
      }] }`;
    case "nullable":
      return `{ k: "nullable", e: ${plan.e} }`;
  }
}
