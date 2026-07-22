# Hexagon Spec: Unions

**Status:** Decided (July 2026)
**Scope:** The nominal `union` declaration: constructors (nullary and payload-carrying, named and unnamed slots), the `match` expression's union-specific facts (constructor patterns as the pattern grammar's degenerate case; closed-constructor exhaustiveness), generics and recursion, the tagged-POJO runtime representation, the all-nullary string special case, prelude `Option`/`Result`, derived-constraint semantics, JS emission and `.d.ts` shapes.
**Not in scope:** the full pattern grammar, guards, generalized scrutinees, and the general exhaustiveness/reachability/irrefutability machinery (Pattern Matching; this doc owns only the union-specific facts, §4), the declaration-header grammar shared with `record`/`type` (Declarations Preamble §§2–3), the constraint mechanism and `honor` (Constraints; this doc fixes derived-instance *semantics* only — invocation is Constraints §4.5), module-level qualification of constructor names (Modules), FFI conversions (`Nullable(a)` ↔ `Option` — FFI Part 2 §4–§5), foreign-backed nullary unions (`extern enum`, `ffi-foreign-enums.md`).
**Companions:** Products spec (the product half of the algebra; `itemN` vocabulary; nominal-name opacity doctrine; rows are records-only, Products §4), Functions spec (arity checking, constructors-as-functions, value restriction), Pattern Matching (§2/§7/§11.3), Method Syntax (§3.4 — union receivers in the dot-call table), Lexer & Layout spec (match arms are a layout block), Primitive Types §7 (Show display semantics), Collections Part 2 (`Hash`), FFI Part 7 §4 (constructor exports).

---

## 1. Doctrine

- **`union` is the nominal sum; there is no structural sum.** Rows are records-only (Products §4): no polymorphic variants, no open unions, no anonymous `A | B` type expressions in Hexagon source. Two unions with identical constructor sets do not unify.
- **The unifier treats a union name as opaque** — same doctrine as nominal `record` (Products §5.1). There is no structural counterpart to unfold to, so unions don't even have the `{...p}` crossing; the name is the whole story.
- **`match` is the only eliminator.** No field access on union-typed receivers, no generated predicates, no casts.
- **Exhaustiveness is a hard error.** Closed nominal sums + no subtyping make it exact and cheap; it is the payoff of the feature and is not demoted to a warning.
- **Runtime representation is what a TS author would hand-write:** string-tagged plain objects for the general case, bare string literals for the all-nullary case. No classes, no `instanceof`, no numeric tag compression.

---

## 2. Declaration

```
union Shape =
  | Circle(radius: Float)
  | Rect(width: Float, height: Float)
  | Point

union Option(a) = Some(value: a) | None
union Tree(a) = Leaf | Node(Tree(a), a, Tree(a))
```

- **Leading `|` is optional** (the F#/OCaml rule): the first alternative may or may not be preceded by a bar, in both one-line and multi-line forms. The two spellings are the same declaration — one grammar rule, not two forms. **Preferred style** (recorded for the stdlib and any future formatter): one-liners omit the leading bar; multi-line declarations put `|` at the head of *every* alternative, so cases align vertically and adding, removing, or reordering a case is a one-line diff.
- The header grammar — parameters, `derives` position, and the layout-continuation rule (the `|` alternatives are a continuation of the declaration, not a block; no VOPEN after `=`) — is Declarations Preamble §§2–3 (§2.4 for the continuation). This doc fixes the semantics; the parameterised case behaves identically to the monomorphic case with the parameters instantiated.
- The union name and every constructor name are **uppercase-start** (Functions §2: uppercase is reserved for types and constructors). The union name enters the type namespace; each constructor enters the **term namespace, unqualified, in module scope** (Elm/Gleam style). Two constructors with the same name among in-scope unions is an error at the point that makes it ambiguous; the declaration-site case (two unions in one module sharing a constructor name) is a hard error at the second declaration. Qualified access and import-driven disambiguation are the modules spec's business.
- Duplicate constructor names within one union: hard error.
- **Recursion is allowed**, direct or mutual, through any payload position (`Tree` above). Unlike `type` aliases (whose recursion ban is the declarations spec's), the nominal indirection makes this sound with no occurs-check involvement: the union name is a type *constant* to the unifier, so a recursive payload is just another mention of a constant.

### 2.1 Constructor payloads: parameter-list-like, names optional

A constructor's parenthesised payload is declared like a function parameter list, except that names are optional — **per constructor, all slots are named or all are unnamed**; mixing is a parse error ("name all of this constructor's fields or none of them"). Rationale: a half-named payload would emit an object with fields `radius` and `item2` side by side, which fails the readable-JS test.

```
Circle(radius: Float)          -- named slot
Rect(width: Float, height: Float)
Node(Tree(a), a, Tree(a))      -- unnamed slots
Point                          -- nullary: no parens at all
```

- Unnamed slots take the tuple vocabulary at the representation level: they emit as `item1 … itemN` fields (§6). This is emission-facing only — there is **no** `s.itemN` access on a union value (§5).
- Named slots must be non-uppercase-start (term-level names). A slot named **`tag` is a hard compile error** — that key belongs to the representation (§6): "`tag` is reserved as the union's discriminant field; rename this field."
- Duplicate slot names within one constructor: error.
- `C()` — empty parens — is a parse error: a nullary constructor is written bare, `Point`, mirroring how it is used (§2.2). (Hint: "remove the `()`; nullary constructors take no argument list.")
- **Slot names do not create named-argument call syntax.** Construction and patterns are positional, always (§2.2, §4.1). Names choose the emitted field names and document intent; nothing more. This keeps the Products §2.2 rejection of `(x: 1, y: 2)` intact — there is still no named-positional anything at call sites.

**Stdlib style rule (recorded, not enforced):** name every slot unless the constructor is `Option`/`Result`-shaped obvious — and note the prelude names even those (§8), because their emitted shape is the FFI's most-trafficked surface.

### 2.2 Constructors as terms

- A payload constructor is a **function** in the term namespace: `Circle : Float -> Shape`, `Node : (Tree(a), a, Tree(a)) -> Tree(a)`. Ordinary n-ary function rules apply wholesale (Functions §5): arity is displayed with the same zero/one/many convention, checked at calls ("`Rect` expects 2 arguments, got 1"), and never implies partial application or tuple splatting.
- Constructors are **first-class**: `map(radii, Circle)` is legal. Emission of a referenced-not-applied constructor: §6.4.
- A **nullary constructor is a value**, not a zero-arg function: `None : Option(a)`, used bare. `None()` is a type error (calling a non-function) with a targeted hint: "`None` is a value, not a function; write it without `()`."
- **Value restriction:** a constructor application whose arguments are syntactic values is a syntactic value (Functions §8.2 already says so). `let x = Some(1)` generalises… to nothing interesting after literal defaulting (`Option(Int)`), but `let n = None` generalises to `n : Option(a)` — a nullary constructor is a value, so the classic `let xs = emptyList()` monomorphism trap does **not** apply to `None`. This is deliberate and pleasant; assert it in tests.

---

## 3. Typing

- `union Shape = ...` introduces the type constant `Shape` (or type constructor, if parameterised). Opaque to unification: `Shape` unifies with `Shape` and with nothing else; `Tree(a)` unifies with `Tree(b)` by unifying `a := b`. No unfolding, no structural comparison, ever.
- Constructor types are as given in §2.2, with the union's type parameters generalised: each *use* of `Some` instantiates a fresh `a`, standard let-polymorphism.
- There is no subtyping among unions, no constructor-set inclusion, no "this function accepts any union containing `Circle`". If that itch ever needs scratching it is a polymorphic-variants feature and is **out**, per the overview's rows-for-records-only call.

---

## 4. `match`

### 4.1 Syntax

```
match shape
  Circle(r) => 3.14 * r * r
  Rect(w, h) => w * h
  Point => 0.0
```

- `match scrutineeExpr` followed by a **layout block of arms** — one arm per VSEP, `;` usable as the compressed newline exactly per the Lexer & Layout rules. There is no braced form: braces are records, so Rust-style `match e { ... }` does not exist and must produce the standard brace diagnostic if attempted.
- Each arm is `pattern => body`. The `=>` is the same token as the lambda arrow; no ambiguity arises because arms occur only inside a `match` block (the parser is in match-arm context after VOPEN following a `match` head). A pattern is *not* a parameter list; the parser must not route it through lambda parsing.
- The arm body is an expression: same line, or an indented block whose final expression is the arm's value — identical to lambda bodies (Functions §3.1).
- `match` is an **expression**; all arm bodies unify to one result type. The scrutinee is evaluated once.

### 4.2 Constructor patterns (this grammar's degenerate case; the full grammar is Pattern Matching's)

```
Circle(r)        -- constructor, binding each slot to a fresh non-uppercase-start name
Rect(_, h)       -- `_` discards a slot; may repeat
Point            -- nullary constructor
Node(Leaf, x, r) -- nested sub-patterns: legal (Pattern Matching §2.2)
_                -- wildcard arm: matches anything, binds nothing
```

- **The flat forms above are the degenerate case of the single pattern grammar** (Pattern Matching §2). Nesting, literals, guards, or-patterns, as-patterns, tuple/record/vector patterns, and **generalized `match` scrutinees** (tuples, records, `Bool`, …) all ship there; an uppercase-start name in a slot position is simply a nested constructor pattern.
- **Positional, always** (this doc's rule, standing). `Circle(r)` binds `r` to the first slot whether the declaration named it `radius` or not; slot names never appear in constructor patterns in v1. **Named-slot constructor patterns** (`Circle(radius: r)`) remain a genuine deferred item, owned by Pattern Matching §11.3.
- **Unions own the constructor arity/nullary diagnostics**: pattern arity must equal constructor arity — a payload constructor used bare (`Circle =>`) is an arity error with the hint "`Circle` carries 1 field; write `Circle(_)` to ignore it"; a nullary constructor with parens (`Point() =>`) gets the §2.2 hint. Pattern Matching §2.2 consumes these unchanged.
- Duplicate binder in one whole pattern (`Rect(w, w)`): error (whole-pattern check now Pattern Matching §2.1's).

### 4.3 Exhaustiveness and reachability (union-specific facts; general machinery is Pattern Matching §7)

The general algorithm — Maranget-style usefulness over the full grammar, witness-pattern rendering, guarded-arms-count-nothing, irrefutability as single-row exhaustiveness — is **Pattern Matching §7/§5's**, generalizing this section's doctrine without renegotiating it. What remains union-specific and owned here:

- **Closed nominal constructor sets make coverage exact**: over flat constructor patterns it is set difference, and the missing-constructor listing ("match is missing cases: `Point`, `None`") is the degenerate rendering of Pattern Matching §7.3's witness printer.
- Both judgments remain **hard errors** — that doctrine originated here and Pattern Matching §1 carries it forward ("generalized, not renegotiated").
- `_` (or a bare variable) remains the explicit opt-out; a dead arm remains always a bug or leftover.
- **The closedness payoff** (no subtyping, no open sums) is what makes sole-constructor patterns irrefutable at binding positions and makes adding a constructor flip every such site loudly — Pattern Matching §5.2 tells that story on this section's foundation.

---

## 5. No eliminator but `match`

- **Bare dot access on a union-typed receiver is a compile error** — including `s.tag` and `s.itemN`: "union values are inspected with `match`". The representation's field names are not part of the language surface. (The FFI exposes the representation contract to *JS-side* consumers — Unions §6.5, FFI Part 7 §4; Hexagon-side code never touches it.)
- A **fused dot call** `opt.getOrElse(0)` may resolve to an ordinary **companion operation** under Method Syntax (§3.4 there — nominal unions are its cleanest receivers, having no field surface to collide with). This is companion dispatch, a static rewrite to `Option.getOrElse(opt, 0)`; **it exposes no fields and inspects no representation** — `match` remains the only way to look inside a union value.
- No generated `isCircle` predicates, no `Shape.circle?`, nothing.
- Single-constructor unions are legal but are **not** the newtype idiom — `record` covers "nominal wrapper over one payload" (Products §5) with lighter access. A future lint may suggest as much; not required.

---

## 6. Runtime representation & emission

Two representations, chosen **per union declaration** by one syntactic test: *does any constructor carry a payload?*

### 6.1 General case: string-tagged POJOs

Each constructed value is a plain object with a `tag` field holding the constructor name as a string, and payload fields flat beside it:

| Hexagon | JS |
|---|---|
| `Circle(2.0)` | `{tag: "Circle", radius: 2.0}` |
| `Rect(3.0, 4.0)` | `{tag: "Rect", width: 3.0, height: 4.0}` |
| `Node(l, x, r)` (unnamed slots) | `{tag: "Node", item1: l, item2: x, item3: r}` |
| `Point` (nullary, mixed union) | `{tag: "Point"}` — a **module-level shared constant**, see below |

- Named slots emit under their declared names; unnamed slots as `item1…itemN` (1-based names, the products vocabulary; no index arithmetic here since these are object keys, not array positions).
- **Nullary constructors in a mixed union emit as one shared frozen-by-convention constant**: `const Point = {tag: "Point"};` — constructions reference it, allocating nothing. Sound because everything is immutable and `Eq` is structural (§7); identity is never observed. Generic nullary constructors (`None`) are a single constant shared across all instantiations — types erase.
- **`tag` is why §2.1 reserves the name.** No nesting-under-`value` alternative: rejected because it doubles access depth in every emitted match body and reads worse, for the sole benefit of un-reserving one field name.
- **Rejected representations** (do not re-litigate without new information): Elm-style compressed tags (`{$: 0, a: ...}`) — violates readable-JS at the feature's core; per-constructor classes (Gleam's JS backend) — drags in `instanceof`, prototype identity across module/realm boundaries, and class-shaped `.d.ts` for what is plain data; numeric tags — same disease as `$`, plus worthless in a debugger.

### 6.2 All-nullary special case: bare strings

A union in which **every** constructor is nullary emits its values as **string literals**:

```
union Color = Red | Green | Blue
```

| Hexagon | JS | `.d.ts` |
|---|---|---|
| `Red` | `"Red"` | `type Color = "Red" \| "Green" \| "Blue";` |
| `match c` arms | `switch (c) { case "Red": ... }` | — |

This is the single most idiomatic TS pattern for enum-likes and a large interop win; taken with eyes open (decided). The cost, stated loudly:

> **Representation cliff:** adding a payload-carrying constructor to an all-nullary union flips the *entire* union — including the pre-existing constructors — to the tagged-POJO representation. Hexagon-side code is unaffected (`match` is the only eliminator, and it recompiles). JS-side consumers of the emitted values break. This is accepted because any constructor addition is already a breaking change for JS consumers (their switches stop being exhaustive); the cliff changes *how* it breaks, not *whether*.

For every exported all-nullary union, **generated FFI documentation must carry this warning**; the emitter should additionally place it in a `.d.ts` doc comment (FFI Part 7 §4.1). The obligation is normative even though the comment placement is representative.

`extern enum` is the explicit FFI exception to this representation rule. It retains
nullary-union typing and matching while using captured foreign object-member values as
constructors; `ffi-foreign-enums.md` owns that boundary form. It does not change the
representation of any ordinary `union` declaration described here.

- **Rejected: bare strings for nullary constructors of *mixed* unions.** It would force `typeof s === "string" ? s : s.tag` into every emitted match — codegen noise on the hottest path of the feature — and a two-headed `.d.ts`. Uniformity within a union is non-negotiable; the special case is per-union, never per-constructor.
- Parameterised all-nullary unions (phantom parameters: `union P(a) = X | Y`) still qualify — the test is syntactic (any payload anywhere?), not about the parameters.

### 6.3 Emitting `match`

Source `match` compiles to a JS `switch` on `s.tag` (general case) or on `s` itself (string case), with pattern binders emitted as `const` bindings from the payload fields — using the *declared* field names (`const r = s.radius;`), since patterns are positional in the source but the representation is named:

```
switch (s.tag) {
  case "Circle": { const r = s.radius; return 3.14 * r * r; }
  case "Rect":   { const w = s.width, h = s.height; return w * h; }
  case "Point":  return 0.0;
}
```

- `match` is an expression but `switch` is a statement. Emission strategy, in order of preference: **(a) statement lifting** — when the match's value feeds a `return`, a `const` initialisation, or is itself a statement, emit the `switch` in statement position with per-arm `return`/assignment (as above; covers the overwhelming majority of real code); **(b) an IIFE** wrapping the switch, for genuinely inline expression positions. A chain of ternaries is permitted for small all-nullary matches where it reads better; emitter's judgment. Exhaustiveness is compiler-checked, so no `default` throwing branch is required — emitting an unreachable `default` for JS-side debugging hygiene is permitted but not required. A `_` arm emits as `default`.
- Trivial binders should not obstruct readability: an arm body using a slot once may inline the access rather than materialise the `const`; emitter's choice, prefer whichever reads better (same license as Products §2.6 wildcard emission).

### 6.4 Constructors in emitted JS

- **Applied directly, the constructor erases into the object literal** — `Circle(2.0)` emits `{tag: "Circle", radius: 2.0}`, never a function call. Same doctrine as `record`'s constructor (Products §5.4).
- **Referenced as a value**, the emitter materialises the function on demand: `const Circle = (radius) => ({tag: "Circle", radius});` (once per declaration or per module, implementer's choice; direct applications still erase). **Export of a non-opaque union is a mandatory demand site**: it materialises each payload constructor once as a stable named ESM function; string-case and nullary POJO constructors export their existing constants (FFI Part 7 §4). Internal direct applications still erase. `export opaque union` exports the type only and does not materialise or expose its constructors merely because the type is exported (FFI Part 7 §5).

### 6.5 `.d.ts`

The general case emits the discriminated union a TS author would hand-write:

```ts
type Shape =
  | { tag: "Circle"; radius: number }
  | { tag: "Rect"; width: number; height: number }
  | { tag: "Point" };
```

- Unnamed slots appear as `item1` etc. — legal, if charmless; the stdlib style rule (§2.1) exists so exported unions carry real names.
- Parameterised unions emit TS generics: `type Option<a> = { tag: "Some"; value: a } | { tag: "None" };` (type-parameter casing follows the Hexagon source; TS is case-agnostic here).
- All-nullary case: the string-literal union, §6.2 table.
- An exported **non-opaque** union declares every constructor in `.d.ts` (FFI Part 7 §4): payload constructors as functions returning the union type, mixed-union nullaries as shared constants, and all-nullary constructors as string constants. A generic shared nullary constant uses the `never` instantiation (`None: Option<never>`). An `export opaque union` instead has FFI Part 7 §5's brand-only type face and exposes no constructors.

---

## 7. Derived constraints (semantics here, mechanism in constraints spec)

Mirroring Products §2.5/§3.4 — the structural semantics, applied to the declaration's constructors and payloads. **Nominal unions receive no automatic instances**: `Eq`, `Ord`, `Show` — and `Hash`, whose algorithm and derived-`Eq` consistency condition are **Collections Part 2's** — derive only through explicit opt-in, `honor C<Shape> = derive` or the header `derives` clause (Constraints §4.5; same rule as nominal records). The semantics each derivation implements:

- **`Eq`:** same constructor, then payload-wise conjunction. Different constructors are unequal, full stop.
- **`Ord`:** by **constructor declaration order** first, then payload-wise lexicographic. Declaration order becoming semantically significant is mildly unpleasant and is what every ML-family language does; recorded, accepted. **Implementer note for the string case (§6.2):** declaration order is *not* alphabetical order, so `Ord` on an all-nullary union must not compile to JS `<` on the strings — it needs a declaration-index table (`{Red: 1, Green: 2, Blue: 3}` and compare indices). Same shape of trap as codepoint-vs-code-unit `Ord String` (Primitive Types §5); the cheap representation does not get to redefine the semantics.
- **`Show`:** display semantics per Primitive Types §7. Constructor name; parens iff payload; components via their own `show`, comma-separated, **positional** regardless of slot names: `show(Circle(2.0))` is `"Circle(2)"`… — careful: `Float`'s show is JS formatting, so `"Circle(2)"` only if the payload prints so; the rule is the shape, not this example — `show(None)` is `"None"`, `show(Some("a"))` is `"Some(a)"` (String shows bare, pre-existing wart-by-design). Slot names do not appear in `show` output (that is `Debug`-flavoured territory, reserved with `#{}` per Primitive Types §5.4).
- No `Signed`, no `Frac`, obviously. **Derivation fails when a required payload instance is absent**: `honor Show<T> = derive` (or `derives Show`) where some payload type has no `Show` is the Constraints §8 underivable-slot error, naming the offending slot and its type — a union over a function type simply cannot derive `Show`, and the absence is the feature (Primitive Types §7).

---

## 8. Prelude: `Option` and `Result`

```
union Option(a) = Some(value: a) | None
union Result(a, e) = Ok(value: a) | Err(error: e)
```

- **Success type first** in `Result`, matching the subject-first convention (Functions §5.3).
- Payload slots are **named** even though these are the "obvious" constructors, because their emitted shape (`{tag: "Some", value: x}`, `{tag: "Err", error: e}`) is the most-trafficked union surface at the FFI, and `value`/`error` is what a TS author writes there. This deliberately overrides the §2.1 style rule's escape hatch for the prelude's own exports.
- **Pre-registered rejection — `Option(a)` is not `a | undefined`.** Compiling `Option` to nullable erasure is the tempting interop move and is wrong: `Some(None)` and `None` collapse (generic code over `Option(a)` breaks whenever `a` instantiates to another Option); it special-cases the one place the language promises uniformity; and the emitted type lies structurally. JS-side nullability lives at the boundary as `Nullable(a)`, with the final **`Nullable`-owned** conversions — `Nullable.toOption`, `Nullable.fromOption` (`None` → `undefined`), and `Nullable.fromOptionOrNull` (`None` → `null`) — per FFI Part 2 §4–§5. `Option` owns no nullable-conversion aliases. Do not re-litigate without new information.
- The standard partiality story elsewhere in the stdlib (`Int.checkedAdd : ... -> Option(Int)`, `BigInt.toInt` partial, etc.) is this `Option`. Nothing changes there; the type it referred to now exists.

---

## 9. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Payload field named `tag` | hard error: reserved as the discriminant; rename (§2.1) |
| Mixed named/unnamed slots in one constructor | parse error: all or none (§2.1) |
| `C()` empty payload parens (declaration or pattern) | "nullary constructors take no argument list" (§2.1, §4.2) |
| Calling a nullary constructor: `None()` | type error + "`None` is a value; write it without `()`" (§2.2) |
| Constructor arity mismatch (call) | standard arity error (Functions §5) |
| Pattern arity mismatch | arity error; bare payload constructor gets the `Circle(_)` hint (§4.2 — owned here, consumed by Pattern Matching §2.2) |
| Duplicate binder in a whole pattern | error (Pattern Matching §2.1 owns the whole-pattern check) |
| Non-exhaustive match on a union | hard error listing missing constructors — the degenerate witness rendering (§4.3; general machinery Pattern Matching §7) |
| Unreachable arm | hard error, naming the shadowing case (§4.3; Pattern Matching §7.2) |
| Braced match body `match e { ... }` | the Lexer & Layout brace diagnostic (records-not-blocks) |
| Bare dot access on a union value (incl. `.tag`, `.itemN`) | "union values are inspected with `match`" (§5; a fused dot call resolving to a companion operation is not access — Method Syntax) |
| Duplicate constructor name (within a union / across a module's unions) | hard error at declaration (§2) |
| Underivable payload in a `derive` | Constraints §8's error, naming the offending slot and its type (§7) |

---

## 10. Decisions log

| Decision | Where |
|---|---|
| `union` = closed nominal sum; no structural variants; no unfolding; no subtyping | §1, §3 |
| Leading `\|` optional (F#/OCaml rule); preferred style: omit on one-liners, bar every case in multi-line | §2 |
| Constructors: uppercase, module-scope terms; payload = param-list with optional names, all-or-none per constructor | §2, §2.1 |
| `tag` reserved as payload field name | §2.1 |
| Slot names are representation/docs only — construction and patterns always positional | §2.1, §4.1–4.2 |
| Nullary constructors are values (no `()`); generalise as values (`None : Option(a)`) | §2.2 |
| Recursion allowed (nominal indirection) | §2 |
| `match`: layout arms, `pattern => expr`, expression, single evaluation; only eliminator; fused dot calls = companion dispatch, never field exposure | §4, §5 |
| Constructor patterns = the pattern grammar's degenerate case (full grammar, nesting, generalized scrutinees: Pattern Matching); positional always; named-slot patterns deferred to Pattern Matching §11.3; arity/nullary diagnostics owned here | §4.2 |
| Exhaustiveness and reachability: hard errors, exact over closed constructor sets; general machinery Pattern Matching §7 on this section's doctrine | §4.3 |
| Representation: string-tagged flat POJOs; shared constants for nullary; classes/compressed tags rejected | §6.1 |
| All-nullary unions emit bare strings; per-union test; representation cliff accepted and documented | §6.2 |
| Mixed-union string nullaries rejected | §6.2 |
| Constructor applications erase; referenced constructors materialise on demand; non-opaque export is a mandatory stable materialization site; opaque export exposes no constructors | §6.4; FFI Part 7 §§4–5 |
| `.d.ts` = hand-written-style discriminated union / string-literal union for non-opaque exports, with constructors in their representation shapes; opaque export = brand-only type face | §6.5; FFI Part 7 §§4–5 |
| No automatic instances for nominal unions; Eq/Ord/Show/Hash by explicit `derive`/`derives` only (Constraints §4.5); semantics here; `Hash` → Collections Part 2; derivation fails on absent payload instances | §7 |
| Ord by declaration order (index table for string case); Show positional | §7 |
| Prelude `Option`/`Result`, named payloads, success-first `Result` | §8 |
| `Option` ≠ `a \| undefined`; nullability is `Nullable(a)` at the boundary; conversions are `Nullable.toOption`/`fromOption`/`fromOptionOrNull` (FFI Part 2 §4–§5) | §8 |
