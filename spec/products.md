# Hexagon Spec: Products

**Status:** Decided (July 2026)
**Scope:** Tuples, structural records, row polymorphism (as far as the user can see it), the nominal `record` declaration, field access, spread/update, `let`-destructuring, JS emission and `.d.ts` shapes.
**Not in scope:** `union` (own spec), full pattern matching (own spec — this doc fixes only flat `let`-destructuring), the constraint system and derived structural `Eq`/`Ord`/`Show` (constraint spec; this doc only names hooks), `type` aliases and the shared declaration-header grammar (declarations spec), row-unification internals (type-system internals spec; this doc fixes observable behaviour), block/layout/`;` rules (Lexer & Layout spec).
**Companions:** Functions spec (arity, `()`, no tuple↔args conversion), Primitive Types spec (§7 Show, §9 Unit), Type System Overview (row polymorphism as intent — this doc now decides it for records).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **Positions → tuple. Names → record.** Exactly one anonymous positional product and one anonymous named product. No named tuple elements (§2.2); no positional record syntax.
- **Structural records are row-polymorphic; the row machinery is hidden.** Rows are an inference phenomenon. Users never need the word "row"; annotators see only `...` (§4).
- **`record` is an erased nominal wrapper over a closed row.** Nominal at typecheck; the same POJO at runtime; structural at the `.d.ts` boundary (§5).
- **The unifier never unfolds a nominal record name.** Nominal↔structural crossings are explicit terms: `{...p}` out, the constructor in (§5.3). This preserves principal types and keeps `implement` coherence anchored to names.
- **Braces mean records, always** — type and term position, never blocks. Blocks are pure layout (Lexer & Layout spec).

---

## 2. Tuples

### 2.1 Syntax and typing

```
(1, "a")                 -- term: 2-tuple
(Int, String)            -- type
(1, "a", true)           -- arity 3; no upper cap
```

- **Arity ≥ 2.** `()` is the Unit literal (Primitive Types §9); `(e)` is grouping — there are no 1-tuples (Functions spec §3.1). No maximum arity.
- Structural: no declaration; two tuple types unify iff same arity and componentwise unification succeeds. Arity mismatch is reported as such, not as a component error.
- Immutable, like everything else.
- **No tuple↔argument-list conversion in either direction** (Functions spec §5 is authoritative). `plus(t)` where `t = (3, 7)` is an arity error with a destructuring hint.
- This distinction remains visible in displayed types: `((A, B)) -> C` takes one
  tuple, while `(A, B) -> C` takes two arguments (Functions §5.1).

### 2.2 No named elements (decided)

C#-style `(x: 1, y: 2)` is a **parse error** with the hint: "tuples are positional; for named fields use a record: `{x: 1, y: 2}`." Rationale: records already are the anonymous named product; a second one with subtly different semantics is pure confusion surface.

### 2.3 Positional access: `itemN`

```
t.item1     -- first component (1-based)
t.item2
```

- `itemN` for N ≥ 1, resolved **type-directed**: dot-access on a tuple-typed receiver interprets `itemN` positionally. `itemN` is **not a reserved word** — a record may have a field literally named `item1`, and on a record-typed receiver `r.item1` is ordinary field access. No overlap: no type is both tuple and record.
- Errors: `item0` → "tuple components are numbered from 1"; N > arity → "this tuple has K components; there is no itemN".
- **Emission: `t.itemN` → `t[N-1]`.** Accessor names are 1-based (language-facing); array indices are 0-based (emission-facing). The off-by-one lives in the emitter and nowhere else — same shape as the LSP column conversion.
- `itemN` does **not** participate in row polymorphism. It is positional sugar, not a field; you cannot abstract over "anything with an `item1`". Tuples are not rows.

### 2.4 Destructuring (v1: flat, with wildcards)

```
let (x, y) = t
let (a, _, c) = triple
```

- The pattern's arity must equal the tuple's arity (compile error otherwise, same report as §2.1).
- `_` discards a component; it binds nothing and may repeat.
- **Flat only in v1:** no nested patterns (`let ((a, b), c) = ...` is a parse error for now), no literals in patterns, nothing else. Nesting arrives with the pattern-matching spec, which owns the full pattern grammar; this destructuring form must be specified there as the degenerate case of that grammar, not as a second grammar.
- **No patterns in lambda parameters** in v1. `(x, y) => e` is a two-parameter lambda (Functions spec), never a tuple pattern. A lambda that takes one tuple destructures in its body: `t => { let (x, y) = t; ... }` (block per layout rules). Revisit with pattern matching.
- Value-restriction interaction: a tuple of syntactic values is a syntactic value (Functions spec §8.2); destructuring a `let`-bound tuple generalises each binding normally under the same rules.

### 2.5 Constraints

Componentwise, at every arity, via compiler-derived structural instances (mechanism in the constraints spec; this doc fixes the semantics):

- `Eq`: component-wise conjunction; defined iff every component type has `Eq`.
- `Ord`: lexicographic, left to right; defined iff every component has `Ord`.
- `Show`: `show (1, "a")` is `"(1, a)"` — parenthesised, comma-separated, components via their own `show` (display semantics per Primitive Types §7; note `String` shows bare).
- Derivation is structural at any arity — generated by the compiler, not a family of per-arity instances.

### 2.6 Emission

| Hexagon | JS | `.d.ts` |
|---|---|---|
| `(1, "a")` | `[1, "a"]` | `[number, string]` (TS tuple type) |
| `t.item2` | `t[1]` | — |
| `let (x, y) = t` | `const [x, y] = t;` | — |

Plain arrays, no wrapper, no tag. TS tuple types are exactly what a TS author would hand-write. Wildcard destructuring emits JS array-destructuring holes (`const [a, , c] = t;`) or positioned indexing, emitter's choice — prefer whichever reads better case-by-case.

---

## 3. Structural records

### 3.1 Syntax

```
{x: Float, y: Float}         -- type: closed row (exactly these fields)
{x: 1.0, y: 2.0}             -- literal
{}                           -- the empty record (type and value); never a block
r.x                          -- field access
{...r, x: 3.0}               -- functional update (§3.3)
```

- `name: Type` / `name: expr`, comma-separated, braces. Field names are lowercase-initial identifiers (term-level names, Functions spec §2 case rule).
- **No shorthand `{x, y}`** for `{x: x, y: y}` in v1 (recorded as a fast-follow candidate — easy to add, impossible to remove). **No** computed keys, methods, getters, or spreads-as-construction beyond §3.3. A record literal is `name: expr` pairs, full stop.
- Duplicate field names in one literal or type: compile error.
- Field order is **not significant** to the type: `{x: Float, y: Float}` and `{y: Float, x: Float}` are the same type. (Emission order: as written in the constructing literal; see §3.5.)
- Braces never mean blocks — see the Lexer & Layout spec for the `x => { ... }` diagnostic this requires.

### 3.2 Field access

`r.x` requires the checker to know `r`'s type has field `x`:

- Concrete (closed row, or nominal per §5): checked against the known fields; missing field is a compile error naming the record's known fields.
- Unknown (`r` is a fresh tyvar, e.g. an unannotated parameter): access **constrains** `r`'s type to a record containing `x`, with a fresh hidden tail — this is where row polymorphism does its silent work. `fun getX(r) = r.x` infers the row-polymorphic type with no annotation (§4).

### 3.3 Spread update — and the crossing

`{...p, overrides}`:

- **Update semantics:** every overridden field must already exist in `p`'s type, at the same type (unifies with the declared field type). Field *addition* is a compile error: "record update cannot add fields; `p` has no field `z`". Result type = `p`'s type — structural in, same structural type out; nominal in, nominal out (§5.3).
- **v1 shape restriction: exactly one spread, and it comes first.** `{x: 3, ...p}`, `{...a, ...b}` are parse errors. This dodges JS's later-spread-wins precedence entirely; may be relaxed later.
- **`{...p}` with no overrides is the nominal→structural eliminator** (§5.3). On an already-structural `p` it is a plain shallow copy of the same type (legal, occasionally useful, harmless).
- **Emission: as itself.** `{...p, x: 3.0}` emits `{...p, x: 3.0}` — a shallow copy, which is exactly what the syntax means in JS. No lies in the output.

### 3.4 Constraints

Same structural derivation story as tuples (§2.5), fieldwise: `Eq`/`Ord`/`Show` defined iff every field's type has them. `Ord` over records is field-name-lexicographic then value-lexicographic — but flag: record `Ord` is of marginal value and may be dropped to `Eq`+`Show` only; the constraints spec decides. `show {x: 1, y: 2}` is `"{x: 1, y: 2}"`, fields in name order (deterministic regardless of construction order). This is the "derived structural show for records" that Primitive Types §7 promises.

### 3.5 Emission

Records are **POJOs**: `{x: 1.0, y: 2.0}` emits itself. Field order in the emitted literal follows the source literal. `.d.ts`: an inline object type or a named `type`, structurally — `{ x: number; y: number }`.

---

## 4. Row polymorphism (the visible surface)

Three tiers; the word "row" appears in none of them.

**Tier 0 — invisible (the default).** Unannotated code gets row polymorphism from inference alone:

```
fun getX(r) = r.x        -- inferred: works on any record with field x
getX({x: 1.0, y: 2.0})   -- fine
getX({x: 1.0})           -- fine
getX({y: 2.0})           -- compile error: no field x
```

**Tier 1 — `...` in annotations: "and possibly more fields."**

```
fun getX(r: {x: Float, ...}): Float = r.x
```

- An annotation **without** `...` is a **closed** row: exactly these fields. `fun f(r: {x: Float}) = ...` rejects `{x: 1.0, y: 2.0}` — error message must say the record has *extra* fields and suggest `...` if acceptance was intended.
- Each bare `...` denotes its own fresh, anonymous tail.

**Tier 2 — named tails `...r`: relating two rows.** Needed only to assert two record types share the same unknown remainder:

```
fun touch(p: {x: Float, ...r}): {x: Float, ...r} = {...p, x: p.x + 1.0}
```

Lowercase per the type-variable case rule; scoped like other type variables in the same signature. Rarely written; exists because inferred types must be *displayable* — LSP hover on Tier-0 `getX` shows `{x: Float, ...} -> Float`, or `...a` when a tail is shared across positions. The pretty-printer's output is the ceiling of what a user ever sees.

**Observable unification behaviour** (internals in the type-system spec): field-order-insensitive; open rows unify by matching common fields and constraining tails; **no field addition/deletion/concatenation operations exist** — rows appear in record types only, Elm-0.16-level power, deliberately (Elm's retreat from full extension is the calibration point). No width subtyping; unification only.

**Diagnostics vocabulary (binding):** never "row", "row variable", "lacks constraint". Say "this record may have more fields", "this function requires a record with at least `x`", "these records must have the same additional fields".

---

## 5. Nominal `record`

### 5.1 Declaration

```
record Point = {x: Float, y: Float}
```

(Header grammar — placement, type parameters `record Pair(a) = ...` — is the declarations spec's job; this doc fixes the semantics for the monomorphic case and requires the parameterised case to follow identically with the row instantiated.)

The declaration expands to, precisely:

1. **A fresh nominal type constant `Point`** (compile-time only). Not an alias: `Point` and `{x: Float, y: Float}` do **not** unify; the unifier treats `Point` as opaque and never unfolds it. The row is retained as `Point`'s *definition*, consulted by elaboration (§5.3), invisible to unification. (Why: unfolding destroys principal types — resolution order would decide whether a tyvar ends up nominal or structural — and collapses `implement Show Point` vs `implement Show Vec` coherence. Decided; do not re-litigate.)
2. **A constructor function `Point : {x: Float, y: Float} -> Point`** in the term namespace (uppercase initial, per the Functions spec's reservation of uppercase for constructors). Argument is the exact closed row; ordinary record-literal checking applies (all fields, no extras).
3. **Elaboration rules keyed to the name** (§5.3).
4. **Nothing at runtime** (§5.4).

### 5.2 What `record` does *not* generate

No per-field accessor functions (dot access is the accessor). No derived `Eq`/`Ord`/`Show` decided here — whether nominal records get automatic structural instances or require explicit `implement` is the **constraints spec's** question; this spec only guarantees the definition row is available to that machinery.

### 5.3 Transparent operations and the explicit crossing

For `p : Point` (all pure elaboration against the definition row — no row unification involved):

| Operation | Behaviour |
|---|---|
| `p.x` | checked against `Point`'s row; transparent |
| `{...p, x: 3.0}` | overrides checked against the row; **result type `Point`** — nominal in, nominal out |
| `Point({x: 1.0, y: 2.0})` | construction; ordinary call, closed-row literal check |
| `{...p}` (no overrides) | **the nominal→structural crossing**: type is the closed row `{x: Float, y: Float}`, which then row-unifies normally (e.g. with `{x: Float, ...}` parameters) |

What does **not** work, by design: passing `p` directly where `{x: Float, ...}` is expected (type error; diagnostic must suggest `{...p}`), and unifying `Point` with any structural record type or other nominal name. The crossings are terms, not coercions.

**Recorded v2 option (considered, not adopted):** implicit nominal→structural coercion inserted in *checking* mode only (where the expected type is annotation-known — decidable, no inference pollution; the bidirectional machinery planned for rank-2 would host it). Declined for v1 because "compiles with an annotation, fails without" is a confusing failure mode for exactly our audience. Revisit only with field evidence that `{...p}` ceremony is a real pain point.

### 5.4 Emission

- A `Point` **is** the POJO. No wrapper, no brand, no tag.
- `Point({x: 1.0, y: 2.0})` **applied directly erases**: emits `{x: 1.0, y: 2.0}`.
- The constructor is first-class (`map(rows, Point)` is legal); when *referenced* rather than applied, the emitter materialises an identity function — `const Point = r => r;` — emitted on demand (or once per declaration, implementer's choice); direct applications still erase.
- `{...p}` emits `{...p}` (a real shallow copy — honest).
- `.d.ts`: `type Point = { x: number; y: number };` — structural, because the TS boundary is structural regardless. Nominality is a Hexagon-side compile-time discipline only, and the spec says so out loud rather than pretending otherwise.

---

## 6. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Named tuple elements `(x: 1, y: 2)` | parse error; hint: use a record `{x: 1, y: 2}` (§2.2) |
| Tuple passed to n-ary function | arity error + destructuring hint (Functions spec §5; §2.1) |
| `t.item0` / `t.itemN` beyond arity | targeted messages (§2.3) |
| Destructuring arity mismatch | tuple-arity error (§2.4) |
| Nested pattern in v1 destructuring | parse error; "nested patterns arrive with pattern matching" (§2.4) |
| Record update adds a field | "record update cannot add fields; `p` has no field `z`" (§3.3) |
| Multiple/late spread | parse error, v1 shape restriction (§3.3) |
| Closed-row annotation rejects wider record | mention *extra* fields; suggest `...` (§4) |
| Missing field on access | name the known fields (§3.2) |
| Nominal `Point` where `{x: Float, ...}` expected | type error; suggest `{...p}` (§5.3) |
| `x => { print(x) }` | record-literal/block confusion — owned by Lexer & Layout spec; cross-referenced here because records cause it |
| Any diagnostic tempted to say "row" | rewrite per §4 vocabulary rules |

---

## 7. Decisions log

| Decision | Where |
|---|---|
| Positions→tuple, names→record; no named tuple elements | §1, §2.2 |
| Tuples: arity ≥ 2, no cap, structural, immutable | §2.1 |
| `t.itemN`, 1-based, type-directed, emits `t[N-1]`; not a row | §2.3 |
| Destructuring: flat with `_` in v1; no lambda-parameter patterns | §2.4 |
| Tuples = JS arrays, TS tuple types | §2.6 |
| Record syntax `{name: Type}` / `{name: expr}`; no shorthand in v1; `{}` = empty record | §3.1 |
| Spread update `{...p, x: e}`; no field addition; one spread, first; emits itself | §3.3 |
| Rows hidden: Tier 0 invisible / Tier 1 `...` / Tier 2 `...r`; closed-by-default annotations | §4 |
| Row power = access + update only; no extension/deletion/concat; records only; no subtyping | §4 |
| "Row" banned from diagnostics | §4 |
| `record` = opaque nominal + constructor fn + elaboration rules + nothing at runtime | §5.1, §5.4 |
| Unifier never unfolds nominal names; crossings are explicit terms (`{...p}` / constructor) | §5.1, §5.3 |
| Implicit checking-mode coercion: considered, deferred to v2-with-evidence | §5.3 |
| `.d.ts` is structural; nominality is Hexagon-side only | §5.4 |
| Derived Eq/Ord/Show: semantics here (§2.5, §3.4), mechanism + nominal-record policy → constraints spec | §2.5, §3.4, §5.2 |
