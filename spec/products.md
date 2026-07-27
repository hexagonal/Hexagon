# Hexagon Spec: Products

**Status:** Decided (July 2026)
**Scope:** Tuples, structural records, row polymorphism (as far as the user can see it), the nominal `record` declaration, field access, spread/update, construction punning, destructuring (as the pattern grammar's degenerate case), JS emission and `.d.ts` shapes.
**Not in scope:** `union` (own spec), the full pattern grammar and binder rules (Pattern Matching; Statements §5 for binder class), the constraint mechanism and derivation invocation (Constraints §4.5; this doc fixes structural-instance *semantics*), `type` aliases and the shared declaration-header grammar (Declarations Preamble §§2–3), row-unification internals (this doc fixes observable behaviour), block/layout/`;` rules (Lexer & Layout spec).
**Companions:** Functions spec (arity, `()`, no tuple↔args conversion), Primitive Types spec (§7 Show, §9 Unit), Pattern Matching (§6.3/§6.5/§9 — destructuring, lambda-head patterns, punning), Method Syntax (§3.4–§3.5 — `itemN` and fused dot calls in the resolution table), Collections Part 2 (`Hash`), Collections Part 3 §2/§13 (trailing-comma rule and directed edit note), FFI Part 7 (export faces).

---

## 1. Doctrine

- **Positions → tuple. Names → record.** Exactly one anonymous positional product and one anonymous named product. No named tuple elements (§2.2); no positional record syntax.
- **Structural records are row-polymorphic; the row machinery is hidden.** Rows are an inference phenomenon. Users never need the word "row"; annotators see only `...` (§4).
- **`record` is an erased nominal wrapper over a closed row.** Nominal at typecheck; the same POJO at runtime; structural at the `.d.ts` boundary (§5).
- **The unifier never unfolds a nominal record name.** Nominal↔structural crossings are explicit terms: `{...p}` out, the constructor in (§5.3). This preserves principal types and keeps `honor` coherence anchored to names.
- **Braces mean records, always** — type and term position, never blocks. Blocks are pure layout (Lexer & Layout spec).
- **`:` types; `=` binds** (§8 correction record). A record *type* gives each field a type: `{x: Float}`. A record *term* — literal or pattern — binds each field: `{x = 1.0}`, `{x = p}`. This makes `:` *classify* everywhere in the language — "is of type" in annotations and record types, "with these obligations" in constraint binders (`<a: Ord>`, Constraints §1) — and `=` mean "binds" everywhere it appears (`let`, `fun`, `honor`, record fields); the token, not the position, tells the reader which kind of braces they are looking at.

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

C#-style `(x: 1, y: 2)` is a **parse error** with the hint: "tuples are positional; for named fields use a record: `{x = 1, y = 2}`." Rationale: records already are the anonymous named product; a second one with subtly different semantics is pure confusion surface.

### 2.3 Positional access: `itemN`

```
t.item1     -- first component (1-based)
t.item2
```

- `itemN` for N ≥ 1, resolved **type-directed**: dot-access on a tuple-typed receiver interprets `itemN` positionally. `itemN` is **not a reserved word** — a record may have a field literally named `item1`, and on a record-typed receiver `r.item1` is ordinary field access. No overlap: no type is both tuple and record.
- `itemN` participates in Method Syntax's dot-call resolution table (§3.4 there): `t.itemN(args…)` is the positional access followed by an ordinary call, and the component must be callable; all positional-access rules below apply unchanged.
- Errors: `item0` → "tuple components are numbered from 1"; N > arity → "this tuple has K components; there is no itemN".
- **Emission: `t.itemN` → `t[N-1]`.** Accessor names are 1-based (language-facing); array indices are 0-based (emission-facing). The off-by-one lives in the emitter and nowhere else — same shape as the LSP column conversion.
- `itemN` does **not** participate in row polymorphism. It is positional sugar, not a field; you cannot abstract over "anything with an `item1`". Tuples are not rows.

### 2.4 Destructuring (the pattern grammar's degenerate case)

```
let (x, y) = t
let (a, _, c) = triple
let ((a, b), c) = nested          -- nested irrefutable patterns: legal (Pattern Matching)
```

- The pattern's arity must equal the tuple's arity (compile error otherwise, same report as §2.1).
- `_` discards a component; it binds nothing and may repeat.
- **Tuple destructuring is the degenerate case of the full pattern grammar** (Pattern Matching §2/§6.3): nested irrefutable patterns ship. Refutable patterns at `let` receive the Pattern Matching §5 irrefutability error.
- **Lambda parameters accept irrefutable patterns** under Pattern Matching §6.5's depth rule: `(x, y) => e` remains a two-parameter lambda, permanently; `((x, y)) => e` is one tuple-destructured parameter. That spec owns the rule and its diagnostics.
- **Every name a `let` pattern binds is a sequential binder** (Statements §5/§5.4): it may not reuse a name in scope. Arm and lambda-head positions bind head binders; class is positional, never pattern-determined.
- Value-restriction interaction: a tuple of syntactic values is a syntactic value (Functions spec §8.2); destructuring a `let`-bound tuple generalises each binding normally under the same rules.

### 2.5 Constraints

Componentwise, at every arity, via **automatic compiler-derived structural instances — and user-closed**: users cannot write instances for tuples (Constraints §4.5/§9.3; structural types have no constructor to key on and no home module). This doc fixes the semantics:

- `Eq`: component-wise conjunction; defined iff every component type has `Eq`.
- `Ord`: lexicographic, left to right; defined iff every component has `Ord`.
- `Show`: `show (1, "a")` is `"(1, a)"` — parenthesised, comma-separated, components via their own `show` (display semantics per Primitive Types §7; note `String` shows bare).
- `Hash`: structural, automatic, registered to **Collections Part 2** (its algorithm and its consistency-with-derived-`Eq` rule live there, not here).
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
{x = 1.0, y = 2.0}           -- literal
{}                           -- the empty record (type and value); never a block
r.x                          -- field access
{...r, x = 3.0}              -- functional update (§3.3)
```

- `name: Type` in type position / `name = expr` in term position, comma-separated, braces (§1 doctrine; §8 correction record). Field names are non-uppercase-start identifiers (term-level names, Functions spec §2 case rule).
- **Construction punning ships** (Pattern Matching §9): `{x, y}` in value position is `{x = x, y = y}`, and it composes with update spread — `{...p, x}` is `{...p, x = x}`. Term-level only; `{x}` in *type* position remains an error ("record types need field types"). The emitter uses JS shorthand whenever a field key and its emitted value are the same identifier, whether the Hexagon source used `{x}` or the equivalent `{x = x}`. **No** computed keys, methods, getters, or spreads-as-construction beyond §3.3.
- **Tuple and record *literals* permit a trailing comma after the final element/field in an otherwise-valid literal** (`{x = 1, y = 2,}`, `(1, "a",)`) — Collections Part 3 §2/§13. Existing tuple arity and empty-record rules are unchanged. This is a term-literal rule; nothing is inferred for type syntax.
- Duplicate field names in one literal or type: compile error.
- Field order is **not significant** to the type: `{x: Float, y: Float}` and `{y: Float, x: Float}` are the same type. (Emission order: as written in the constructing literal; see §3.5.)
- Braces never mean blocks — see the Lexer & Layout spec for the `x => { ... }` diagnostic this requires.

### 3.2 Field access

`r.x` requires the checker to know `r`'s type has field `x`:

- Concrete (closed row, or nominal per §5): checked against the known fields; missing field is a compile error naming the record's known fields.
- Unknown (`r` is a fresh tyvar, e.g. an unannotated parameter): access **constrains** `r`'s type to a record containing `x`, with a fresh hidden tail — this is where row polymorphism does its silent work. `fun getX(r) = r.x` infers the row-polymorphic type with no annotation (§4).
- The **fused dot-call form** `r.name(args…)` defers through Method Syntax's DotCall goal and *means* field access whenever the receiver is not head-known-nominal — the row fallback is that form's defined meaning, so **Tier-0 row inference results are unchanged** by dot calls (Method Syntax §3.5). Bare `r.name` is field access always, by grammar.

### 3.3 Spread update — and the crossing

`{...p, overrides}`:

- **Update semantics:** every overridden field must already exist in `p`'s type, at the same type (unifies with the declared field type). Field *addition* is a compile error: "record update cannot add fields; `p` has no field `z`". Result type = `p`'s type — structural in, same structural type out; nominal in, nominal out (§5.3).
- **v1 shape restriction: exactly one spread, and it comes first.** `{x = 3, ...p}`, `{...a, ...b}` are parse errors. This dodges JS's later-spread-wins precedence entirely; may be relaxed later.
- **`{...p}` with no overrides is the nominal→structural eliminator** (§5.3). On an already-structural `p` it is a plain shallow copy of the same type (legal, occasionally useful, harmless).
- **Emission: same shape, JS separator.** `{...p, x = 3.0}` emits `{...p, x: 3.0}` — a shallow copy, which is exactly what the spread syntax means in JS. The `=`→`:` field-separator swap is the only distance between source and output (§3.5); the structure never lies.

### 3.4 Constraints

Same structural derivation story as tuples (§2.5), fieldwise — automatic, compiler-derived, user-closed; `Hash` registered to Collections Part 2: `Eq`/`Ord`/`Show` defined iff every field's type has them. `Ord` over structural records is field-name-lexicographic then value-lexicographic; nominal records receive it only by explicit opt-in (Constraints §4.5). `show {x = 1, y = 2}` is `"{x = 1, y = 2}"`, fields in name order (deterministic regardless of construction order) — `show` prints the literal a Hexagon author would write, so it follows the term separator (§8). This is the "derived structural show for records" that Primitive Types §7 promises.

### 3.5 Emission

Records are **POJOs**: `{x = 1.0, y = 2.0}` emits `{x: 1.0, y: 2.0}` — same fields, same order, JS's `:` separator (the one token the emitter translates; §8). Field order in the emitted literal follows the source literal. `.d.ts`: an inline object type or a named `type`, structurally — `{ x: number; y: number }`.

---

## 4. Row polymorphism (the visible surface)

Three tiers; the word "row" appears in none of them.

**Tier 0 — invisible (the default).** Unannotated code gets row polymorphism from inference alone:

```
fun getX(r) = r.x        -- inferred: works on any record with field x
getX({x = 1.0, y = 2.0}) -- fine
getX({x = 1.0})          -- fine
getX({y = 2.0})          -- compile error: no field x
```

**Tier 1 — `...` in annotations: "and possibly more fields."**

```
fun getX(r: {x: Float, ...}): Float = r.x
```

- An annotation **without** `...` is a **closed** row: exactly these fields. `fun f(r: {x: Float}) = ...` rejects `{x = 1.0, y = 2.0}` — error message must say the record has *extra* fields and suggest `...` if acceptance was intended.
- Each bare `...` denotes its own fresh, anonymous tail.

**Tier 2 — named tails `...r`: relating two rows.** Needed only to assert two record types share the same unknown remainder:

```
fun touch(p: {x: Float, ...r}): {x: Float, ...r} = {...p, x = p.x + 1.0}
```

Non-uppercase-start per the type-variable start-class rule; lowercase `a` remains the display convention. It is scoped like other type variables in the same signature. Rarely written; it exists because inferred types must be *displayable* — LSP hover on Tier-0 `getX` shows `{x: Float, ...} -> Float`, or `...a` when a tail is shared across positions. The pretty-printer's output is the ceiling of what a user ever sees.

**Observable unification behaviour** (internals in the type-system spec): field-order-insensitive; open rows unify by matching common fields and constraining tails; **no field addition/deletion/concatenation operations exist** — rows appear in record types only, Elm-0.16-level power, deliberately (Elm's retreat from full extension is the calibration point). No width subtyping; unification only.

**Diagnostics vocabulary (binding):** never "row", "row variable", "lacks constraint". Say "this record may have more fields", "this function requires a record with at least `x`", "these records must have the same additional fields".

---

## 5. Nominal `record`

### 5.1 Declaration

```
record Point = {x: Float, y: Float}
```

(The header grammar — parameters, `derives` position, layout continuation — is Declarations Preamble §§2–3. This doc fixes the semantics for the monomorphic case; the parameterised case behaves identically with the row instantiated.)

The declaration expands to, precisely:

1. **A fresh nominal type constant `Point`** (compile-time only). Not an alias: `Point` and `{x: Float, y: Float}` do **not** unify; the unifier treats `Point` as opaque and never unfolds it. The row is retained as `Point`'s *definition*, consulted by elaboration (§5.3), invisible to unification. (Why: unfolding destroys principal types — resolution order would decide whether a tyvar ends up nominal or structural — and collapses `honor Show<Point>` vs `honor Show<Vec>` coherence. Decided; do not re-litigate.)
2. **A constructor function `Point : {x: Float, y: Float} -> Point`** in the term namespace (uppercase-start, per the Functions spec's reservation for constructors). Argument is the exact closed row; ordinary record-literal checking applies (all fields, no extras).
3. **Elaboration rules keyed to the name** (§5.3).
4. **Nothing at runtime** (§5.4).

### 5.2 What `record` does *not* generate

No per-field accessor functions (dot access is the accessor). **No automatic instances**: a nominal record derives only by explicit opt-in — `honor C<Point> = derive` or the header `derives` clause (Constraints §4.5; Declarations Preamble §2.3) — with the structural semantics of §2.5/§3.4 applied to the definition row. An operation requiring an underived constraint produces the ordinary unsatisfied-constraint error with the corresponding fixit, such as "add `derives Eq`" for `==` or "add `derives Show`" for `show`.

### 5.3 Transparent operations and the explicit crossing

For `p : Point` (all pure elaboration against the definition row — no row unification involved):

| Operation | Behaviour |
|---|---|
| `p.x` | checked against `Point`'s row; transparent |
| `{...p, x = 3.0}` | overrides checked against the row; **result type `Point`** — nominal in, nominal out |
| `Point({x = 1.0, y = 2.0})` | construction; ordinary call, closed-row literal check |
| `{...p}` (no overrides) | **the nominal→structural crossing**: type is the closed row `{x: Float, y: Float}`, which then row-unifies normally (e.g. with `{x: Float, ...}` parameters) |

What does **not** work, by design: passing `p` directly where `{x: Float, ...}` is expected (type error; diagnostic must suggest `{...p}`), and unifying `Point` with any structural record type or other nominal name. The crossings are terms, not coercions.

**Recorded v2 option (considered, not adopted):** implicit nominal→structural coercion inserted in *checking* mode only (where the expected type is annotation-known — decidable, no inference pollution; the bidirectional machinery planned for rank-2 would host it). Declined for v1 because "compiles with an annotation, fails without" is a confusing failure mode for exactly our audience. Revisit only with field evidence that `{...p}` ceremony is a real pain point.

### 5.4 Emission

- A `Point` **is** the POJO. No wrapper, no brand, no tag.
- `Point({x = 1.0, y = 2.0})` **applied directly erases**: emits `{x: 1.0, y: 2.0}`.
- The constructor is first-class (`map(rows, Point)` is legal); when *referenced* rather than applied, the emitter materialises an identity function — `const Point = r => r;` — emitted on demand (or once per declaration, implementer's choice). **Export is a mandatory demand site**: `export record Point` emits one stable named ESM constructor for JavaScript consumers (FFI Part 7 §3). Direct applications still erase, including internal applications of an exported constructor.
- `{...p}` emits `{...p}` (a real shallow copy — honest).
- `.d.ts`: for an **ordinary exported record**, `type Point = { x: number; y: number };` — structural, because the TS boundary is structural regardless; nominality is a Hexagon-side compile-time discipline only, and the spec says so out loud rather than pretending otherwise. An **`export opaque record`** instead uses FFI Part 7 §5's brand-only face (one non-exported `unique symbol`; no fields exposed) — opacity, unlike ordinary nominality, *does* cross the boundary.

---

## 6. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Named tuple elements `(x: 1, y: 2)` | parse error; hint: use a record `{x = 1, y = 2}` (§2.2) |
| `:` in a term-position record — `{x: 1}` as a literal | parse error; fixit: "record fields bind with `=`: `{x = 1}`; `:` gives a field its type in record *types*" (§8; the JS-muscle-memory near-miss, permanent diagnostic) |
| `{x := 1}` in a literal | parse error; fixit: "did you mean `=`? `:=` assigns to a `var` (Statements §6)" (§8) |
| `{x => e}` in a term brace | parse error; fixit: "did you mean `=`? `=>` is the lambda/arm arrow — a lambda-valued field is `{x = y => e}`" (§8; the hash-rocket habit, one character from `=`; distinct from Lexer & Layout §5's `x => { ... }` braces-as-block case) |
| Tuple passed to n-ary function | arity error + destructuring hint (Functions spec §5; §2.1) |
| `t.item0` / `t.itemN` beyond arity | targeted messages (§2.3) |
| Destructuring arity mismatch | tuple-arity error (§2.4) |
| Refutable pattern at `let`/lambda param; `let`-pattern rebinding | Pattern Matching §5.3 and Statements §9.3 own the respective errors and fixits (§2.4 routes) |
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
| `t.itemN`, 1-based, type-directed, emits `t[N-1]`; not a row; unchanged in the dot-call resolution table | §2.3 |
| Destructuring = the pattern grammar's degenerate case: nesting ships; lambda-head irrefutable patterns per the depth rule; `let`-pattern binders sequential | §2.4 |
| Tuples = JS arrays, TS tuple types | §2.6 |
| Record syntax `{name: Type}` in types / `{name = expr}` in terms; construction punning ships (`{x, y}`, `{...p, x}`); trailing comma in term literals; `{}` = empty record | §3.1, §8 |
| Spread update `{...p, x = e}`; no field addition; one spread, first; emits the JS spread | §3.3 |
| Term-position field separator is `=`, type-position is `:` — `:` classifies language-wide, `=` means "binds"; patterns follow terms (Pattern Matching §16); `show` follows the literal; JS emission translates `=`→`:` | §8 |
| Rows hidden: Tier 0 invisible / Tier 1 `...` / Tier 2 `...r`; closed-by-default annotations | §4 |
| Row power = access + update only; no extension/deletion/concat; records only; no subtyping | §4 |
| "Row" banned from diagnostics | §4 |
| `record` = opaque nominal + constructor fn + elaboration rules + nothing at runtime | §5.1, §5.4 |
| Unifier never unfolds nominal names; crossings are explicit terms (`{...p}` / constructor) | §5.1, §5.3 |
| Implicit checking-mode coercion: considered, deferred to v2-with-evidence | §5.3 |
| `.d.ts` structural for ordinary exports; `export opaque record` = FFI Part 7 §5 brand-only face | §5.4 |
| Structural Eq/Ord/Show/Hash: automatic, compiler-derived, **user-closed** (semantics §2.5/§3.4; `Hash` → Collections Part 2); nominal records derive only by explicit `derive`/`derives` (Constraints §4.5) | §2.5, §3.4, §5.2 |
| Tier-0 row inference unchanged by dot calls; fused `r.name(args…)` = field access unless head-known nominal | §3.2 |

---

## 8. Correction record: term-position record fields bind with `=` (July 2026)

This spec originally used `:` as the field separator in **both** positions: `{x: Float}` (type) and `{x: 1.0}` (literal), with record patterns following (`{x: p}`). Superseded, corpus-wide: **record types keep `:`; record terms — literals and patterns — use `=`.** The sections above are edited in place; this record preserves the decision trail.

### 8.1 Rationale

- **`:` classifies everywhere else in Hexagon** — "is of type" in `let x: Int`, parameter and return annotations, `record Point = {x: Float, y: Float}`; "with these obligations" in constraint binders `<a: Ord>` (Constraints §1). Term-position record literals were the sole place `:` sat between a name and a *value*, and because §1 commits to "braces mean records, always, in both positions," the classifying and binding readings occurred in visually identical contexts, distinguishable only by position. The token now disambiguates: `:` classifies, `=` binds.
- **The operator family becomes uniform**: `=` binds (`let`, `fun`, `honor`, record fields), `:=` mutates, `:` types, `=>` maps (lambdas, arms). A field initializer *is* a binding; `=` is the semantically honest token.
- **The confusion was observed, not hypothesized**: Pattern Matching had to legislate a dedicated diagnostic for `{x: Float}` in pattern position being misread as an annotation (its former §2.4 guard). Under `=` that misreading class is structurally impossible, and the guard becomes a crisper fixit (Pattern Matching §16).
- **Precedent**: the ML family — Standard ML, OCaml, Haskell, F#, and **Elm**, whose record-type/record-value split (`{ x : Float }` / `{ x = 1 }`) is exactly this rule and whose row-polymorphism power level §4 already cites as the calibration point.
- **No grammar cost.** `=` is not an expression operator (assignment is `:=`; equality is `==`), braces are never blocks, and bindings cannot appear inside braces — `{x = e}` has exactly one parse. The former `{x:= 1}` maximal-munch trap (`:` + `=` lexing as `:=`) disappears along with the `:` itself; a written `{x := 1}` now gets its own fixit (§6).

### 8.2 Honest cost, recorded

For JS-trained readers (the target audience), `{x: 1}` is muscle memory, and `{x = 1}` is a *false friend*: in JS destructuring it means a default value, and in JS literals it is a syntax error. Answered rather than dismissed: Hexagon already asks this audience to relearn `fun`, `:=`, `match`, and no-`return`; the permanent §6 fixit catches the literal habit on first contact; and the alternative was a permanent ambiguity inside the language's own annotation convention. Emission is unaffected — records are still POJOs, and the emitter's JS-shorthand rule keys on field name = emitted identifier, not on surface syntax.

Pattern position carries its own, *larger* cost, recorded in Pattern Matching §16: there the old `:` matched JS destructuring's rename semantics exactly, so `=` gives up a true correspondence, not just a habit.

### 8.3 Rejected alternative (do not re-litigate without new information)

| Rejection | Reasoning |
|---|---|
| Keep `:` in term position (JS/TS/Rust style) | Overloads "is of type" in visually identical brace contexts; demonstrably confusing in pattern position (§8.1); breaks the `=`-binds family rule. JS familiarity genuinely argues for it — in pattern position the old `:` even matched JS destructuring's rename exactly (Pattern Matching §16) — but that cost is one-time, per-reader, and fixit-caught, while the annotation-convention overload is permanent and internal to the language. |
| `=` in literals but `:` in patterns | Reintroduces the overload in the position where it was observed; breaks construction/destructuring symmetry (punning must read identically both ways); no precedent anywhere. |

### 8.4 Scope of the token, precisely

- **Unchanged, `:`** — record *types* (`{x: Float, ...}`), all annotations, the `record`/`type` declaration RHS (type position), everything in emitted JS and `.d.ts` (that's JavaScript's separator; the emitter translates), and JS/`.d.ts` example blocks throughout the corpus.
- **Changed, `=`** — record literals, update spread overrides (`{...p, x = 3.0}`), record patterns (`{f = p}`, Pattern Matching §16), the derived `show` rendering (`"{x = 1, y = 2}"`), witness-pattern rendering in diagnostics (Pattern Matching §7.3).
- **Punning is untouched** in both worlds: `{x, y}`, `{...p, x}`, pattern `{f}`.

### 8.5 Edit notes to other specs — **all discharged** (implementation PR, July 2026)

Every edit below was applied in the implementation PR that landed this syntax in the parser, the stdlib, the playground, and the book; the list is kept as the decision trail, not as outstanding work. The only `:` occurrences remaining anywhere in the corpus for these examples are record *types*, annotations, and emitted JavaScript — which is where `:` belongs.

1. **Statements/Blocks/Mutability §5.1, §6.3, §9.1–§9.3 (acceptance-test comment, book edit note, diagnostics checklist)** → the rename fixit `{name: orderName}` becomes `{name = orderName}` (four occurrences), and the record-immutability fixit's suggested copy `{...p, x: e}` becomes `{...p, x = e}` (two occurrences: §6.3 prose and the §9.3 checklist row).
2. **Modules** (the `Point` examples: `make`, import examples) → `Point({x = x, y = y})`, `Point({x = 1.0, y = 2.0})`.
3. **Method Syntax** (§3.4 examples) → `f({callback = n => n + 1})`, `Box({size = 3})`.
4. **Collections Part 2** (the `hash(Point {x: 1.0, y: 2.0})` example) → `hash(Point({x = 1.0, y = 2.0}))` (also repairing the missing constructor-call parens in that line).
5. **Collections Part 4** (the `Weird` example) → `Map.set(Map.empty, Weird({s = "K"}), 1)` (same paren repair).
6. **Decisions Batch 2026-07** (nominal-Eq examples) → `Point({x = 1.0, y = 2.0})`, `Blob({x = 1.0})`.
7. **Lexer & Layout** (the `x => { print(x) }` diagnostic) → "entries aren't `field = value`"; no new layout rules — the change is purely a parser-level token choice inside braces.
8. **hexagon-for-typescript-coders** → the records chapter teaches the `:`/`=` split up front, names both JS false friends (`{x: 1}` literal habit → fixit; `{x = 1}` destructuring-default misreading), and shows the emitted JS is still `{x: 1}`. Its update section's "the spread syntax emits *itself* — no lies in the output" is now **false as stated** and takes §3.3's honest form instead: same shape, JS separator, the structure never lies.
9. **The book (`book/`) and the working notes (`spec/notes/`)** — the records chapter now teaches the `:`/`=` split and both JS false friends where it previously stated the old rule outright ("a record literal uses `name: expression`"); its punning expansions, the continuity notes, the chapter plan, and the `Seq({ pull = ... })` family in the working notes all moved with it.
10. **Implementation, same PR** — parser (`=` accepted in literals, update overrides, and patterns; `:` in a term brace is a parse error), the three permanent §6 fixits, the derived `show` rendering, `stdlib/` + `runtime/VectorTrie.hex`, and the playground examples. Nothing in the emitted JavaScript or `.d.ts` changed: the emitter translates `=`→`:` and the output bytes are identical, which the emission tests pin.
