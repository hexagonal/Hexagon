# Hexagon Spec: Type System Overview

**Status:** Orienting document (July 2026). Records the overall shape so it doesn't get lost between the detailed specs. Individual decisions live in — and are overruled by — the specific specs; anything stated only here and nowhere else should be treated as *intent*, not as a settled decision.
**Scope:** the one-paragraph identity of the language, the pillars of the type system, the inventory of type formers, and the spec map (what's written, what's owed).
**Not in scope:** everything. Every section here is a pointer to a real spec, existing or forthcoming.

---

## 1. What Hexagon is

Hexagon is an ML-style language. It uses a Hindley–Milner type system with **row polymorphism** and **type constraints** (ad-hoc polymorphism via dictionary passing). Its compilation target is JavaScript, with **JS interop as a first-class design consideration**: emitted code is idiomatic, readable JS with accurate `.d.ts` files, so Hexagon code is a good citizen inside an existing JS project.

The intended user is a JS developer with moderate FP capability who wants to do **some light functional work inside a JS environment** — not a Haskell refugee. Every design decision that trades theoretical strength for JS-native ergonomics (f64 `Int`, no currying, silent overflow, `undefined` as Unit) has been made deliberately in that direction.

---

## 2. Pillars

1. **Hindley–Milner inference, Algorithm J.** Union-find mutable type variables, level-based generalisation. Types are optional everywhere; untyped code is the primary form. Annotations exist for comprehension and constraining, never because the compiler needs them.
2. **Let-polymorphism with the ML value restriction.** Generalisation happens at `let`/`fun`/module export; only syntactic values generalise; lambda parameters are monomorphic; `var` never generalises. (Observable rules fixed in the Functions spec §8.)
3. **No `forall` binder.** Lowercase initial = type variable, uppercase initial = type name; implicit quantification falls out of the case rule (Primitive Types spec §1). Rank-2 types, if they arrive, come through a separate annotation-gated pathway.
4. **Type constraints, compiled to dictionaries.** `Num`, `Eq`, `Ord`, `Show` (+ `Frac`), user constraints via `implement` blocks. Monomorphic code pays nothing — dictionaries appear only in genuinely polymorphic functions. Closed defaulting rule: unresolved literal-born tyvars whose constraints are all in the closed set {Num, Eq, Ord, Show} default to `Int` (Numeric Literals spec §4).
5. **Row polymorphism for records.** Structural records with row variables in the unifier — the one deliberate extension beyond vanilla HM. Extent and mechanics are the Products spec's job (open: width-subtyping-free row polymorphism à la Elm/PureScript is the presumed shape; whether rows appear anywhere besides records — e.g. polymorphic variants — is presumed **no** for v1).
6. **No subtyping.** Rows give the "this function accepts any record with at least field x" ergonomics without a subsumption relation. Unification-only.
7. **N-ary functions, no currying.** `TFun([A, B], C)`; arity checked at every call; no partial application (Functions spec).
8. **Readable-JS emission as a semantic constraint.** The type system is designed so that types erase: no runtime tags, no wrappers, monomorphic literals and arithmetic emit as plain JS. Where a feature would force runtime scaffolding on common code, the feature loses (see: Int-as-BigInt rejection, int32 rejection).

---

## 3. Type former inventory

| Former | Kind | Spec | Status |
|---|---|---|---|
| `Int`, `Float`, `Bool`, `String`, `BigInt`, `Unit` | primitives | Primitive Types | **decided** |
| function types (n-ary) | built-in | Functions | **decided** |
| tuples | structural product, positional | Products (forthcoming) | conventions fixed by Functions spec (no 1-tuples, `()` nullary, no tuple↔args conversion); rest owed |
| structural records | structural product, named, row-polymorphic | Products (forthcoming) | direction fixed here; mechanics owed |
| `record` | nominal product declaration | Products (forthcoming) | owed — including its relation to structural rows (wrapper over a row vs. independent) |
| `union` | nominal sum declaration | Unions (forthcoming) | owed — constructors, matching, exhaustiveness, tagged JS representation |
| `type` | alias declaration | Declarations preamble or Products (forthcoming) | owed — parameterisation, recursion ban, alias-vs-expansion display |
| type variables `a b c` | — | Primitive Types §1, Functions §4.2 | decided |
| constraints (`Num`, `Eq`, `Ord`, `Show`, `Frac`, user) | — | Constraints (forthcoming) | partially fixed by Numeric Literals + Primitive Types §7 |
| extern / FFI shapes (`Nullable(T)` etc.) | boundary-only | FFI (forthcoming) | boundary types never leak into pure Hexagon semantics |

---

## 4. JS interop commitments (type-system-visible)

- Every primitive maps to a native JS type with no wrapper (Primitive Types §1 table). `Unit` ↔ `undefined`; `Int`/`Float` ↔ `number`; `BigInt` ↔ `bigint`.
- Emitted `.d.ts` must be honest and idiomatic: n-ary functions as n-ary TS functions, `void`/`undefined` for Unit, `bigint` only where BigInt genuinely appears.
- Products/unions must choose JS representations a JS consumer would plausibly hand-write (records as plain objects is the presumption; tuple and union representations are owed to their specs, with the readable-JS goal as the tiebreaker).
- Foreign nullability lives at the boundary (`Nullable(T)`), never inside the language's own types.

---

## 5. Spec map

**Written:** Primitive Types · Functions · Numeric Literals.
**Owed, in rough dependency order:**

1. **Declarations preamble** — shared header grammar for `type` / `record` / `union` (capitalisation, type-parameter syntax, placement), plus `type` alias semantics.
2. **Products** — tuples, structural records + rows, nominal `record`, destructuring. Must resolve: row-polymorphism mechanics in Algorithm J; nominal-record-vs-row relationship; ownership of the pattern grammar (shared with Unions).
3. **Unions** — nominal sums, constructors, pattern matching, exhaustiveness, JS tagging.
4. **Constraints** — `implement`, superconstraints, derived structural `Show`/`Eq` for products and unions, Eq/Ord semantics incl. NaN/−0.
5. **Type-system internals** — Algorithm J details, levels, row unification, rank-2 pathway.
6. Also owed: 1-based indexing (global), operators (incl. `|>`), modules, FFI, LSP display.

---

## 6. Decisions vs. intents (read this before citing this doc)

Decided elsewhere and merely echoed here: everything in §2 items 1–4, 7–8; the §3 rows marked decided.
**Intent, first stated here, needs its real spec:** row polymorphism as the record mechanism (§2.5); no subtyping (§2.6); rows-for-records-only in v1; records-as-plain-objects presumption (§4). If a forthcoming spec finds a reason to deviate, it wins — then update this doc.
