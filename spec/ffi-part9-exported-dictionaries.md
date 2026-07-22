# Hexagon FFI Part 9: Exported Constraint Dictionaries

**Status:** Decided (July 2026), revised in place after external review (Sol) before landing. Normative promotion of `spec/notes/ffi-exported-dictionaries.md` (§§3–10 of which Part 8 defers to by name). The note's two delegated completions were confirmed in §13: handles and factories live in the instance declaration's home module under the lowercased other-party name, and evidence suffixes retain maximal constraints per variable before ordering. Preserves Part 7's corrected wrapper rule: a constrained generic edition exports the matching internal trailing-evidence function directly; a stable wrapper exists only when public ABI plumbing requires one (§9).
**Scope:** `Constraint.Dictionary<a>` declaration shapes and nominal TypeScript branding; constraint-owned fundamental handles (`Signed.int`); type-owned non-fundamental handles (`Rat.signed`); parameterized dictionary factories (`Vector.show(Show.string)`); the public-evidence closure and ownership/nameability rules; trailing evidence ordering; superconstraint nesting and duplicate elimination; the relationship to Part 8's Algorithm G trigger; emission, identity, collisions, validation policy, and cross-package dictionary ABI.
**Not in scope:** the specialization set, Algorithm S/G/N mechanics, and the fundamental type set (Part 8, `ffi-zero-cost-fundamental-exports.md` — Decided; **this part does not repeat the specialization algorithm**); constraint semantics, instance coherence, and the orphan rule (Constraints §2–§6 — consumed); general export correspondence and `.d.ts` structure (Part 7); package-resolution mechanics (Modules §12.1, future package spec).
**Companions:** Constraints §5–§6 (instance globality; dictionaries; superconstraint slots; evaluation-freeness; the §6.4 `.d.ts` flag this part discharges for the generic-edition case); Part 7 §1/§2/§7 (correspondence, lowercase binders, direct-vs-wrapper); Part 8 §4–§6/§9 (trigger, public capability, names, ABI events); Modules §7/§11.5 (home module; dictionary emission); Functions §5.4 (subject-first).

---

## 1. Doctrine

Constraint dictionaries are invisible and unnameable in Hexagon source (Constraints §6). At the JavaScript/TypeScript boundary they become compiler/runtime-produced evidence objects **only where a JS caller needs the generic edition of a constrained-polymorphic export**. Three compilation regimes remain distinct, and the foreign surface adds an entry-point form, not a fourth semantic regime:

1. **Known concrete Hexagon code** resolves instances statically and erases evidence.
2. **Genuinely polymorphic Hexagon code** carries dictionaries internally as a trailing suffix.
3. **JavaScript calling a generic constrained export** passes compiler-produced dictionaries explicitly in the same stable trailing suffix.
4. **JavaScript fundamental specializations** (`plusInt`, `plusFloat`, …) are named monomorphic entry points with direct bodies and no dictionaries — Part 8's surface, referenced, not restated.

The boundary never requires runtime type dispatch, prototype inspection, global instance search, JS-authored instance records, or automatic per-user-type function explosion. JavaScript composes evidence from **public handles and factories**; it never constructs a dictionary field-by-field as the supported path (fabrication is possible, as everywhere in JS, and governed by the trusted boundary — §10).

---

## 2. `Constraint.Dictionary<a>`

### 2.1 One dictionary type per constraint

`Dictionary` is a TypeScript-only public type exported by the module corresponding to one Hexagon constraint, qualified at use sites by an ordinary namespace alias:

```ts
Num.Dictionary<a>
Signed.Dictionary<a>
Eq.Dictionary<a>
Show.Dictionary<a>
```

These are **not** one universal dictionary type; each describes the operation record for one constraint at one value type. `Signed` here is a normal TypeScript/ESM namespace import alias (`import type * as Signed from "@hexagon/runtime/signed"` — specifier layout representative, qualification pattern normative), exactly parallel to companion qualification in Hexagon. `Dictionary` has no runtime constructor or value; handles and factories are the runtime surface (§3–§4).

### 2.2 Declaration shape: completed member set, nominal brand

The public dictionary shape is the constraint's **completed member set, including inherited defaulted operations**. `Eq.Dictionary<a>` contains both `equals` and `notEquals` even when the originating `honor Eq<T>` supplied only `equals` — the dictionary is the constraint's full API, not the instance author's keystroke record:

```ts
// eq.d.ts
declare const eqDictionaryBrand: unique symbol;

export interface Dictionary<a> {
  readonly [eqDictionaryBrand]: a;
  readonly equals: (x: a, y: a) => boolean;
  readonly notEquals: (x: a, y: a) => boolean;
}
```

```ts
// num.d.ts
declare const numDictionaryBrand: unique symbol;

export interface Dictionary<a> {
  readonly [numDictionaryBrand]: a;
  readonly add: (x: a, y: a) => a;
  readonly multiply: (x: a, y: a) => a;
  readonly fromNat: (value: number) => a;
}
```

```ts
// signed.d.ts (representative member set; the constraint declaration is authoritative)
declare const signedDictionaryBrand: unique symbol;

export interface Dictionary<a> {
  readonly [signedDictionaryBrand]: a;
  readonly num: Num.Dictionary<a>;
  readonly subtract: (x: a, y: a) => a;
  readonly negate: (x: a) => a;
  readonly fromInt: (value: number) => a;
}
```

- **The brand is Part 7 §5's non-exported `unique symbol` mechanism**, with one deliberate difference: the brand slot carries the type parameter (`readonly [brand]: a`), making `Eq.Dictionary<Rat>` and `Eq.Dictionary<number>` nominally distinct *and* inference-bearing — TypeScript can identify the value type from the evidence argument (diagnostic quality, §12).
- **Branding is nominal TypeScript evidence, not runtime validation** (§10). Superconstraint slots appear as nested dictionary fields (§7.1); members use the boundary faces of their Hexagon signatures with lowercase binders (Part 7 §2.2).

---

## 3. Evidence handles and ownership

### 3.1 The home rule

Every lawful instance whose constraint and instance-head components are publicly nameable receives a **public handle** (nullary evidence) or **factory** (parameterized evidence, §4). Where it lives and what it is called follow one rule:

> **A handle or factory is exported from its instance's home module** — which, by the orphan rule (Modules §7), is either the type's home module or the constraint's home module — **and is named after the other party, lowercased.**

The two cases the decision note enumerated are this rule's two branches:

- instance declared with the **type** (the normal user-package case) → **type-owned**, named by the constraint: `Rat.signed`, `Customer.eq`;
- instance declared with the **constraint** (the fundamental instances; a user constraint honored for another package's type) → **constraint-owned**, named by the type: `Signed.int`, `MyShow.vector(...)`.

The rule is a derivation of ownership reality rather than a preference: only the instance's home module is guaranteed to exist in the declaring package — a user package honoring its constraint for `Vector` cannot add exports to the runtime's `vector` module. Confirmed at review (§13.1).

### 3.2 Constraint-owned fundamental handles

Fundamental evidence lives under the constraint namespace for discoverability:

```ts
// num.d.ts
export declare const nat: Dictionary<number>;
export declare const int: Dictionary<number>;
export declare const float: Dictionary<number>;
export declare const bigInt: Dictionary<bigint>;

// signed.d.ts
export declare const int: Dictionary<number>;
export declare const float: Dictionary<number>;
export declare const bigInt: Dictionary<bigint>;
```

giving `Num.nat`, `Num.int`, `Signed.int`, `Signed.float`, `Signed.bigInt`, `Eq.string`, `Show.bool`, and so on. These remain useful even though fundamental *function* entry points are specialized (Part 8): factories and generic editions need composable evidence — `Vector.show(Show.string)` has nowhere else to get its element dictionary.

### 3.3 Type-owned handles

Public non-fundamental evidence lives in the public type's companion module under the lowercase constraint name:

```ts
// rat.d.ts
import type * as Num from "@hexagon/runtime/num";
import type * as Signed from "@hexagon/runtime/signed";

export declare const num: Num.Dictionary<Rat>;
export declare const signed: Signed.Dictionary<Rat>;
export declare const eq: Eq.Dictionary<Rat>;
export declare const show: Show.Dictionary<Rat>;
```

```ts
import * as Rat from "./rat.js";
plus(half, third, Rat.num);
```

`Rat.signed` is ordinary namespace-import qualification — packages never mutate a central runtime object or attach properties to the `Rat` runtime value.

### 3.4 Materialization, freezing, identity

A public handle forces its instance dictionary to be **materialized as a module-level constant with stable ESM identity** — the same export-forces-materialization principle as Part 7 §12.2's constructors — even when no internal Hexagon code ever reifies that dictionary (internal known-concrete calls keep erasing evidence; Constraints §6.1). Dictionary objects **should be frozen** (`Object.freeze`) where practical; freezing is strongly recommended, not load-bearing (§10). Instance construction is evaluation-free (Constraints §6.3), so materialization has no initialization-order story.

---

## 4. Parameterized dictionary factories

An instance whose evidence depends on other evidence is a real **factory function**; the public name is still the home rule's (§3.1):

```ts
// vector.d.ts
export declare function show<a>(
  element: Show.Dictionary<a>,
): Show.Dictionary<Hex.Vector<a>>;

// option.d.ts
export declare function eq<a>(
  element: Eq.Dictionary<a>,
): Eq.Dictionary<Option<a>>;

// map.d.ts
export declare function show<k, v>(
  key: Show.Dictionary<k>,
  value: Show.Dictionary<v>,
): Show.Dictionary<Hex.Map<k, v>>;
```

```ts
plus(vecA, vecB, Vector.signed(Signed.int));       // if such an instance exists
render(items, Vector.show(Show.string));
```

- **"Parameterized dictionary factory" is the compiler term; the public surface is deliberately the short companion operation** `Vector.show(...)`. The name matches the implementation exactly: a real function accepting required dictionaries and returning the composed dictionary object.
- **Factory argument order** follows the instance head's declared type-parameter order; where one parameter requires several dictionaries, that parameter's evidence is ordered by the §6 constraint ordering. Argument order is ABI (§11).
- **Factories may memoize by input-dictionary identity.** Memoization is an implementation optimization and must not change evidence semantics; it is sound because global coherence (Constraints §5) guarantees two lawful dictionaries for the same public instance cannot disagree within one program graph. Callers must not rely on the *identity* of factory results either way — only handles (§3.4) promise stable identity.
- Factories are exported functions with stable ESM identity, exported directly per §9.

---

## 5. The public-evidence closure

Public evidence is determined by **nameability, not current consumption**. A handle/factory exists iff:

1. the constraint is public;
2. the instance head's outer type constructor is public;
3. every type and evidence component appearing in the handle or factory signature is public;
4. the lawful instance is present in the compiled program graph.

When these hold, the handle/factory appears **even if no exported generic function currently consumes it** — public capability is stable under refactoring, supports separately compiled packages, and supplies composable inputs for factories needed elsewhere. This closure is exactly what Part 8 §4.1 consumes as "publicly obtainable": a public handle, or a public factory applied to recursively publicly obtainable inputs.

Internal instances remain compiler plumbing; their existence never reshapes a foreign module's public surface (Part 8 §5). Because instances ignore Hexagon's `export` syntax entirely (Constraints §5.3 — `export honor` remains illegal), evidence exposure is **generated from this rule**, never written by the user.

An instance failing condition 3 alone (a private type inside the factory signature) stays private with the §12 explanatory diagnostic when something exported would have needed it.

---

## 6. Trailing evidence and ordering

### 6.1 Two-ended elaboration

Hexagon privileges the first ordinary argument as the subject; evidence is neither a subject nor a source argument:

```text
pipe/source supplies from the left:  [subject] [ordinary arguments]
compiler/evidence supplies from the right:                        [evidence]
```

> Pipes elaborate at the left edge; constraint resolution elaborates at the right edge.

Source-level argument positions never move when evidence is inserted or erased; a Part 8 specialization removes only the suffix.

### 6.2 The ordering rule

For multiple constrained variables, evidence occupies a deterministic suffix ordered by **(type-variable ordinal, constraint name)** — the variable's position in the declared type-parameter list first, then the constraint name alphabetically within one variable. Ordinals, not spellings: alpha-renaming type variables in source can never change the ABI (the same stance as Part 8 §6.1's naming).

```hexagon
export let inspect<a: (Eq, Show), b: Ord>(subject: a, other: b): String = ...
```

```ts
export declare function inspect<a, b>(
  subject: a,
  other: b,
  eqA: Eq.Dictionary<a>,
  showA: Show.Dictionary<a>,
  ordB: Ord.Dictionary<b>,
): string;
```

Suffix **positions** are the ABI; the `.d.ts` parameter names (`eqA`, `showA`, …) are representative documentation, generated as lowercase-constraint + variable for readability, and carry no contract.

---

## 7. Superconstraints and duplicate elimination

### 7.1 Nesting

Superconstraint evidence is **nested in the subconstraint dictionary as slots** (Constraints §6.2 — slot name is the superconstraint's name, lowercased):

```ts
// ord.d.ts
import type * as Eq from "@hexagon/runtime/eq";

export interface Dictionary<a> {
  readonly [ordDictionaryBrand]: a;
  readonly eq: Eq.Dictionary<a>;
  readonly compare: (x: a, y: a) => Ordering;
}
```

A JS caller passes only the most specific required dictionary; an `Ord.Dictionary<a>` discharges both `Ord<a>` and `Eq<a>`.

### 7.2 Duplicate elimination: maximal constraints only

When a declaration constrains one variable with both a constraint and its (transitive) superconstraint, the suffix must not request the superconstraint's evidence separately — it is already inside the subconstraint's dictionary. The rule, stated normatively:

> Per constrained variable, the evidence suffix contains dictionaries for the **maximal constraints** only — those that are not (transitive) superconstraints of another constraint declared on the same variable. Elimination happens before the §6.2 ordering is applied; the eliminated constraint's members are reached through the retained dictionary's nested slot.

So `<a: (Eq, Ord)>` produces one `Ord.Dictionary<a>` parameter, and the emitted body reaches `equals` as `ord.eq.equals`. Consequences, ABI-relevant: adding a subconstraint that newly subsumes a previously maximal constraint **changes the suffix** and is a breaking ABI event (§11); the internal Hexagon convention and the public edition apply the same canonicalization, which is what keeps §9's direct export possible. Confirmed at review (§13.2).

---

## 8. Relationship to Part 8

By reference, adding nothing to Part 8's algorithms:

- **The generic base-name edition exists iff Algorithm G's trigger holds** (Part 8 §4.1): at least one complete, publicly obtainable evidence assignment for all constrained variables with at least one non-fundamental component. "Publicly obtainable" is §5's closure, recursively through factories.
- **The source base name is reserved** for the generic edition even while absent (Part 8 §6.1), which keeps the first qualifying public instance an **additive** ABI event and the loss of the last one a **breaking** event (Part 8 §9.4).
- **Fundamental specializations are not wrappers** over the edition and take no dictionaries (Part 8 §8.1); handles exist independently of specializations because factories and editions consume them (§3.2).
- Private types and internal call sites never reshape the surface (Part 8 §5); this part's §5 closure is the "public instance graph" input to that rule.

---

## 9. Emission: direct export, wrapper only for plumbing

The generic edition uses **the same trailing-evidence convention as internal polymorphic code** (§6, §7.2 canonicalization shared). Consequently, in the common case there is nothing to wrap:

> When the internal trailing-evidence function already has the public convention — source parameters in order, canonical evidence suffix — **it is exported directly**, with raw identity and stable ESM binding (Part 7 §1). A **stable module-level wrapper** is generated **only when public ABI plumbing requires one**: a supported top-level adapted position in the same signature (an `Iterable<a>` parameter declared `Seq(a)`, Part 3), a named conversion's required validation, or an internal form that no longer matches the public convention (e.g. the optimizer split or specialized the only internal edition under Part 8 §8.2's freedoms).

This is Part 7's corrected direct-vs-wrapper rule applied to constrained exports. Where a wrapper exists it follows the corpus wrapper discipline: allocated once with the ESM binding, stable JS identity, no defensive validation (Part 6 §1; Part 7 §7). Representative emission of the direct case:

```js
export function plus(x, y, num) {
  return num.add(x, y);
}
```

---

## 10. Validation policy

- **Fixed-arity v1 calls perform no routine evidence validation.** TypeScript's nominal brands (§2.2) catch ordinary mistakes statically; untyped JavaScript remains governed by the trusted boundary (Part 1 §1/§3.1). A fabricated or mutated dictionary is a contract violation with unspecified affected observations.
- **Dictionaries should be frozen where practical** (§3.4); freezing is hygiene, not a checked invariant. No language targeting JS can prevent deliberate boundary lies without the universal validation Hexagon rejects for ordinary fast calls.
- **The future variadic seam is recorded, not designed** (deferred with rest parameters, Part 4 §11): trailing evidence remains mechanically compatible with a typed variadic tuple and right-edge extraction, and *that* future case is pre-registered as one where runtime brand recognition **is** recommended, because an omitted dictionary could otherwise consume the final ordinary rest argument. Nothing about v1 changes.

---

## 11. Cross-package dictionary ABI

Public dictionaries from separately compiled Hexagon packages interoperate **only against a compatible `@hexagon/runtime` dictionary ABI version**. The ABI commitments:

- constraint member names and callable signatures (the completed member set, §2.2);
- superconstraint slots and their names (§7.1);
- evidence suffix ordering and duplicate-elimination canonicalization (§6.2, §7.2);
- brand identity/recognition where present;
- factory argument order (§4);
- runtime package major compatibility.

**Adding, removing, or renaming a constraint member — including adding a defaulted member — is a public dictionary-ABI event**, as is changing superconstraint structure, factory argument order, or evidence ordering (Part 8 §9.5 points here). Package metadata/interface files must eventually record the dictionary ABI/runtime version; the mechanics stay with the package-system design (Modules §12.1), which inherits this requirement.

---

## 12. Diagnostics checklist

| Situation | Diagnostic (rewrite named) | Owner |
|---|---|---|
| JS call missing its evidence suffix (caught by TS) | the `.d.ts` names the expected `Constraint.Dictionary<a>` parameters; generated documentation lists candidate public handle homes (`Signed.int`, `Rat.signed`, `Vector.show(...)`) | §6, docs obligation |
| mismatched evidence in TypeScript | the nominal brand identifies the expected value type (`Eq.Dictionary<Rat>` vs supplied `Eq.Dictionary<number>`) | §2.2 |
| generated handle/factory name colliding with an explicit public export of the same module | hard error naming the instance and the explicit export; **fix is a source rename — the compiler never silently renames public evidence** (Part 8 §6.2 family) | §3 |
| public instance with an unnameable signature component, referenced by an exported generic surface | handle stays private; error explains which component is private and that exporting it would publish the evidence | §5 |
| incompatible runtime/dictionary ABI between packages | report both packages and both ABI versions where metadata permits, before the call | §11 |
| generic edition absent (no qualifying public assignment) | not an error — generated documentation points JS callers at the Part 8 specializations | §8 |

---

## 13. Review resolutions

### 13.1 The instance-home rule (§3.1)

**Confirmed.** The decision note enumerated two ownership cases (fundamental → constraint-owned; user type → type-owned) but omitted a user constraint honored for a type whose module the declaring package cannot touch (`honor MyShow<Vector(a)>`, lawful at the constraint's home). The unified rule — **home = the instance declaration's home module; name = the other party, lowercased** — covers all three without a new mechanism. Leaving the third case handle-less would contradict the public-evidence closure.

### 13.2 Duplicate-evidence elimination (§7.2)

**Confirmed.** Canonicalization retains **maximal constraints per variable, eliminating subsumed superconstraints before ordering, identically in the internal and public conventions**. Keeping duplicates is redundant; applying elimination only after assigning positions would make positions unstable under equivalent constraint lists.

### 13.3 Runtime constraint-module layout (deferred, not blocking)

`@hexagon/runtime/signed`-style subpath specifiers are used as representative throughout; the normative content is the qualified access pattern (`Signed.Dictionary`, `Signed.int`) and one-module-per-constraint organization. Exact specifier layout belongs to runtime packaging (with Modules §12.1's package questions). Flagged so promotion doesn't accidentally freeze a path spelling.

---

## 14. Decisions log (quick reference)

| Decision | Where |
|---|---|
| Evidence objects exist at the boundary only for JS callers of generic editions; three regimes + entry-point form; no runtime dispatch, instance search, or JS-authored instances | §1 |
| One `Dictionary` type per constraint, namespace-qualified (`Signed.Dictionary<a>`); no universal dictionary type; no runtime `Dictionary` value | §2.1 |
| Dictionary shape = the constraint's **completed member set including inherited defaults**; nominal brand via non-exported `unique symbol` whose slot carries `a` (inference-bearing) | §2.2 |
| **Home rule:** handle/factory exported from the instance declaration's home module, named after the other party lowercased — yielding constraint-owned `Signed.int` and type-owned `Rat.signed` as two branches (confirmed at review) | §3.1, §13.1 |
| Public handles force dictionary materialization: module-level constants, stable ESM identity, frozen where practical | §3.4 |
| Parameterized evidence is a real companion factory (`Vector.show(Show.string)`); argument order = instance-head parameter order (ABI); memoization licensed by coherence, identity of results unpromised | §4 |
| Public-evidence closure: nameability (4 conditions), never consumption; generated, never written (`export honor` stays illegal); feeds Part 8 §4.1's "publicly obtainable" | §5 |
| Two-ended elaboration doctrine; suffix ordered by (type-variable ordinal, constraint name); positions are ABI, parameter names representative | §6 |
| Superconstraint evidence nested (Constraints §6.2); callers pass the most specific dictionary; **suffix contains maximal constraints only**, eliminated before ordering, same rule internally and publicly (confirmed at review) | §7, §13.2 |
| Part 8 relationship by reference: Algorithm G trigger, base-name reservation, additive/breaking ABI events; specializations are not wrappers; handles independent of specializations | §8 |
| **Direct export of the internal trailing-evidence function when conventions match; stable wrapper only for ABI plumbing** (Part 7 correction preserved); wrapper discipline unchanged where one exists | §9 |
| No routine runtime evidence validation; TS brands mandatory; freeze recommended; variadic right-edge extraction deferred with pre-registered brand-validation recommendation | §10 |
| Cross-package compatibility requires a compatible dictionary ABI; member/superconstraint/ordering/factory-order changes are ABI events (defaulted members included); metadata requirement inherited by the package spec | §11 |
