# Hexagon Spec: Type System Overview

**Status:** Orienting document (July 2026). Records the overall shape so it doesn't get lost between the detailed specs. Individual decisions live in — and are overruled by — the specific specs; anything stated only here and nowhere else should be treated as *intent*, not as a settled decision. *Touched 2026-07-29 (#147): §1 restated under the ML-dialect doctrine (`decisions-ml-dialect-bool-2026-07.md` §1); `Bool` moved from the §3 primitive row to the prelude unions; §2.8 and §4 re-grounded.*
**Scope:** the one-paragraph identity of the language, the pillars of the type system, the inventory of type formers, and the spec map (what's written, what's owed).
**Not in scope:** everything. Every section here is a pointer to a real spec, existing or forthcoming.

---

## 1. What Hexagon is

Hexagon is an **ML dialect that targets JavaScript** — the posture of F# with Fable (#147, `decisions-ml-dialect-bool-2026-07.md` §1): the language's semantics and surface belong to the ML family; JavaScript is the compilation target it serves excellently. It uses a Hindley–Milner type system with **row polymorphism** and **type constraints** (ad-hoc polymorphism via dictionary passing). JS interop is a first-class property of the *target*: the emitter pursues idiomatic, readable JS and accurate `.d.ts` files wherever they do not constrain the language, so Hexagon code is a good citizen inside an existing JS project — a valued outcome, no longer a design adjudicator.

The intended user is a JS developer with moderate FP capability who wants to do **some light functional work inside a JS environment** — not a Haskell refugee. That is an audience fact, and #147 did not change it. What #147 retired is the adjudication rule this paragraph used to state — that every design decision trading theoretical strength for JS-native ergonomics had been made in that direction. The standing decisions it pointed at (f64 `Int`, no currying, silent overflow, `undefined` as Unit) all stand on their recorded rationales; but where ML-family semantics and JS-native surface genuinely conflict in *new* questions, the ML answer now wins by default, and the JS-specific answer must earn its place by pointing at something JavaScript-specific (decisions doc §1.1).

---

## 2. Pillars

1. **Hindley–Milner inference, Algorithm J.** Union-find mutable type variables, level-based generalisation. Types are optional everywhere; untyped code is the primary form. Annotations exist for comprehension and constraining, never because the compiler needs them. Inference runs with **expected-type propagation** (#513): a type a seat determines — an annotation, an ascription, a known callee's parameter, the pipe's piped value — reaches inward and lands at lambdas before their bodies are inferred, and at arithmetic operations as their home type (Numeric Literals §5.1's expected-type lift). It rides a **normative elaboration schedule** — non-lambda arguments first, lambda literals last, a lambda-literal callee after its arguments — an ordering device over the same HM judgments, with the schedule itself part of the language's definition (Functions §4.3 owns the rules).
2. **Let-polymorphism with the ML value restriction.** Generalisation happens at `let`/`fun`/module export; only syntactic values generalise; lambda parameters are monomorphic; `var` never generalises. (Observable rules fixed in the Functions spec §8.)
3. **No `forall` binder.** Non-uppercase-start = type variable, uppercase-start = type name; implicit quantification falls out of the start-class rule (Primitive Types §1; Lexer §3). Rank-2 types, if they arrive, come through a separate annotation-gated pathway.
4. **Type constraints, compiled to dictionaries.** `Num`, `Signed`, `Eq`, `Ord`, `Show` (+ `Frac`), user constraints via `honor` blocks. Monomorphic code pays nothing — dictionaries appear only in genuinely polymorphic functions. Closed defaulting rule: unresolved literal-born tyvars whose constraints are all in the closed defaultable set — the constraints whose `Int` instance ships with the compiler — default to `Int` (Numeric Literals spec §4, as corrected under #135; that document no longer enumerates the set).
5. **Row polymorphism for records.** Structural records with row variables in the unifier — the one deliberate extension beyond vanilla HM. Extent and mechanics are the Products spec's job (open: width-subtyping-free row polymorphism à la Elm/PureScript is the presumed shape; whether rows appear anywhere besides records — e.g. polymorphic variants — is presumed **no** for v1).
6. **No subtyping.** Rows give the "this function accepts any record with at least field x" ergonomics without a subsumption relation. Unification-only.
7. **N-ary functions, no currying.** `TFun([A, B], C)`; arity checked at every call; no partial application (Functions spec).
8. **Zero-cost erasure as a semantic constraint.** The type system is designed so that types erase: no runtime tags, no wrappers, monomorphic literals and arithmetic emit as plain JS. Where a feature would force runtime scaffolding on common code, the feature loses (see: Int-as-BigInt rejection, int32 rejection). *(Retitled 2026-07-29, #147 — formerly "Readable-JS emission as a semantic constraint." The pillar's force was always cost and boundary honesty, both independent grounds that survive the pivot; readable emitted JS remains a valued outcome of erasure, not the constraint itself.)*

---

## 3. Type former inventory

| Former | Kind | Spec | Status |
|---|---|---|---|
| `Nat`, `Int`, `Float`, `String`, `BigInt` | primitives | Primitive Types | **decided** — `Bool` left the set 2026-07-29 (#147; Primitive Types §12): see the prelude-unions row; `Unit` left 2026-07-30 (#159; Primitive Types §13): see the tuples row |
| function types (n-ary) | built-in | Functions | **decided** |
| tuples — incl. `Unit`, the empty tuple (#159) | structural product, positional | Products (forthcoming) | conventions fixed by Functions spec (no 1-tuples, `()` nullary, no tuple↔args conversion); rest owed |
| structural records | structural product, named, row-polymorphic | Products (forthcoming) | direction fixed here; mechanics owed |
| `record` | nominal product declaration | Products (forthcoming) | owed — including its relation to structural rows (wrapper over a row vs. independent) |
| `union` | nominal sum declaration | Unions (forthcoming) | owed — constructors, matching, exhaustiveness, tagged JS representation |
| prelude unions: `Option`, `Result`, `Bool` | declared `union`s shipped in the prelude | Unions §8 | **decided** — `Bool` reclassified from primitive (#147), representation pinned to JS `boolean` (Unions §6.2) |
| `type` | alias declaration | Declarations preamble or Products (forthcoming) | owed — parameterisation, recursion ban, alias-vs-expansion display |
| type variables `a b c` | — | Primitive Types §1, Functions §4.2 | decided |
| constraints (`Num`, `Signed`, `Eq`, `Ord`, `Show`, `Frac`, user) | — | Constraints (forthcoming) | partially fixed by Numeric Literals + Primitive Types §7 |
| extern / FFI shapes (`Nullable(a)` etc.) | boundary-only | FFI (forthcoming) | boundary types never leak into pure Hexagon semantics |

---

## 4. JS interop commitments (type-system-visible)

- Every primitive maps to a native JS type with no wrapper (Primitive Types §1 table). `Nat`/`Int`/`Float` ↔ `number`; `BigInt` ↔ `bigint`. `Bool` — no longer a primitive (#147) — keeps its zero-cost `boolean` face through the representation pin (Unions §6.2); `Unit` — no longer a primitive either (#159) — keeps its `undefined` face through the arity-0 clause of the tuple representation rule (Products §2.6).
- Emitted `.d.ts` must be honest and idiomatic: n-ary functions as n-ary TS functions, `void`/`undefined` for Unit, `bigint` only where BigInt genuinely appears.
- Product/union representations are unboxed structural data: records as plain objects (Products §3.5), tuples as plain arrays (Products §2.6), unions as string-tagged POJOs with a bare-string all-nullary case (Unions §6) — each the natural zero-cost representation at the boundary. That each matches what a JS consumer would plausibly hand-write is a valued outcome; it is no longer the tiebreaker (#147: on genuine conflict the ML answer wins by default, decisions doc §1.1).
- Foreign nullability lives at the boundary (`Nullable(a)`), never inside the language's own types.

---

## 5. Spec map

**Written:** Primitive Types · Functions · Numeric Literals.
**Owed, in rough dependency order:**

1. **Declarations preamble** — shared header grammar for `type` / `record` / `union` (capitalisation, type-parameter syntax, placement), plus `type` alias semantics.
2. **Products** — tuples, structural records + rows, nominal `record`, destructuring. Must resolve: row-polymorphism mechanics in Algorithm J; nominal-record-vs-row relationship; ownership of the pattern grammar (shared with Unions).
3. **Unions** — nominal sums, constructors, pattern matching, exhaustiveness, JS tagging.
4. **Constraints** — `honor`, base constraints, derived structural `Show`/`Eq` for products and unions, Eq/Ord semantics incl. NaN/−0.
5. **Type-system internals** — Algorithm J details, levels, row unification, rank-2 pathway.
6. Also owed: 1-based indexing (global), operators (incl. `|>`), modules, FFI, and the constraint portion of LSP display. Function-type display is fixed by Functions §5.1.

---

## 6. Decisions vs. intents (read this before citing this doc)

Decided elsewhere and merely echoed here: everything in §2 items 1–4, 7–8; the §3 rows marked decided.
**Intent, first stated here, needs its real spec:** row polymorphism as the record mechanism (§2.5); no subtyping (§2.6); rows-for-records-only in v1. (The records-as-plain-objects presumption formerly listed here was discharged: Products §3.5 decides it; §4 now cites the owners.) If a forthcoming spec finds a reason to deviate, it wins — then update this doc.
