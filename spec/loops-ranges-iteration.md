# Hexagon Spec: Loops, Ranges & Iteration

**Status:** Decided (July 2026) — with an explicit **hanging-questions** section (§11) for items deliberately left open; nothing in §11 blocks implementation of §1–§10.
**Scope:** The `for..in` loop, the `while` loop, the `Range` type and the `..` operator, `range`/`rangeDown`, the `Seq(a)` type and its functional-cursor protocol, the compiler-known `Iterable` judgment, loop typing (`Unit` bodies), desugaring, and JS emission.
**Not in scope:** the indexing operator `[]` and slicing semantics (indexing/collections spec — this doc records the seam, §11.7), `break`/`continue` (deferred pending a deepdive, §9.4), generators / `seq { yield }` comprehensions (§11.3), `AsyncSeq(a)` (own future spec, §11.4), user-implementable `Iterable` via associated types (v2, §11.1), operator precedence of `..` (operators spec, §3.5), the full `Seq` combinator listing (stdlib listing).
**Companions:** Statements, Blocks & Mutability spec (§3.2 discard rule, §6 `var`/`:=`, §7.4 binding constraints on this spec), Lexer & Layout spec (blocks; edit note §10.1 here), Constraints spec (coherence model that the v2 `Iterable` exposure relies on), Primitive Types spec (`Bool` conditions, no truthiness; `Int`).

Written for a future implementation session against the existing `hexc` architecture: Algorithm J, union-find tyvars, level-based generalisation, constraints as dictionaries, layout pass, readable-JS emission with `.d.ts`.

---

## 1. Doctrine

- **`for..in` is the loop.** The primary iteration form is `for x in e` over anything iterable. It requires no `var` and no mutability; the accumulate-in-a-loop idiom (the Roc motivation for `var`) is what `var` + this loop exist to serve *together*, but neither depends on the other.
- **Loops are `Unit`-typed expressions.** Consistent with the F# statement model (Statements spec §1): there is no statement category; a loop is an expression whose value is `()`.
- **Loop bodies are blocks, not lambdas.** Fixed in advance by Statements §7.4 and honored here. A lambda body could not touch enclosing `var`s (§6.2 there); a block can. This single fact also dictates the iteration protocol (§6.3: external iteration, never fold-based desugaring).
- **The loop variable is a head binder** (Statements §5, pre-registered in §7.4 there). `for x in xs` may shadow any name in scope.
- **`for..in` takes JS's good keyword.** JS burned `for..in` on key enumeration and had to invent `for..of`. Hexagon has no such legacy; `for..in` means what it should have meant, and emits JS `for..of` (§8).
- **1-based, inclusive, everywhere.** Ranges are inclusive at both ends, consistent with Hexagon's global 1-based indexing doctrine (Primitive Types §5.1). Counting 1 to 10 is `1..10`, ten iterations.
- **External iteration, functional cursor.** The protocol underlying iteration is "give me the element and the successor state" (`Seq`, §6) — pure, no ref cells, no mutable cursor objects. The one mutation in a compiled loop is a local `var` in the loop's own block: exactly the mutation the language permits.

---

## 2. The `for..in` loop

### 2.1 Grammar

```
for x in e
  body...
```

- `for` NAME `in` EXPR, then a block (indentation per Lexer & Layout; the body block opens on the following line or via the ordinary block rules). `for` and `in` are keywords.
- The loop variable is a **single bare name** in v1. No destructuring patterns in the loop head (`for (k, v) in pairs` is a parse error with the hint "destructure in the body: `let (k, v) = pair`"). Pattern heads arrive with the pattern-matching spec, which owns the full pattern grammar — same deferral shape as lambda parameters (Products §2.4).
- The loop variable is a **head binder**: it may shadow anything (Statements §5.1 rule 2); it is immutable within the body (it is not a `var`; `x := e` targeting it gets the standard "is not a `var`" family error, phrased for loop variables: "`x` is a loop variable and cannot be assigned; declare a `var`").
- Its scope is the body block, starting at the binder; it does not exist after the loop.

### 2.2 Typing

- `e` must be **iterable** (§7): the checker's judgment `Iterable(τ) = ε` yields the element type; the loop variable is bound at type `ε` (a monotype; head binders never generalise).
- The **body block checks against `Unit`**. There is no carve-out: a non-`Unit` final expression in the body is the Statements §3.2 discard hard error, with loop-specific provenance phrasing (§10.3). This is a compile-time check performed once, exactly like any block-item `Unit` check; nothing happens at runtime. `throw` needs no special case (Statements §3.2 already covers it), so a body ending in `throw(...)` or a branch of one checks fine.
- The whole `for..in` expression has type **`Unit`**.
- In non-final block position a loop unifies with `Unit` trivially; in final position the enclosing function returns `Unit` — the same "no ceremony" payoff as block-final `:=` (Statements §4).

### 2.3 Reference desugaring

Semantics are defined by this desugaring (the emitter is free to do better, §8, but must agree observably):

```
-- for x in e
--   body

var cur = iterate(e)            -- cur : Seq(ε), a compiler-fresh name
-- loop:
--   match next(cur)
--     Some((x, rest)) =>
--       body                    -- x is the head binder
--       cur := rest
--     None => ()                -- loop is done; value ()
```

- `iterate` is the (v1: compiler-internal) conversion from the iterable to its `Seq` (§7); for `e : Seq(ε)` it is the identity.
- The cursor `var` lives in the loop's own scope; `body` is a block, not a lambda, so `body` touching *user* `var`s is legal and the `cur :=` reassignment is legal — the design closes with Statements §6.2 rather than fighting it.
- `e` is evaluated **once**, before iteration begins.

---

## 3. Ranges

### 3.1 The `Range` type and the `..` operator

```
1..10                -- the Ints 1,2,...,10, in order
lo..hi               -- general form; lo, hi : Int
for i in 1..n        -- the counting loop
```

- `x..y` is a binary operator on `Int`s producing a value of the concrete type **`Range`**: a lightweight, immutable, *lazy* description of a bounded integer progression. It is **not** a `List` — `for i in 1..1_000_000` allocates nothing.
- `Range` is monomorphic over `Int` in v1. No Float ranges, no ranges over arbitrary `Ord` types (no use case until `Char`-like types exist; pre-registered rejection for v1). A `Range(a)` over `<a: (Num, Ord)>` is specifically rejected: fractional ranges inherit IEEE accumulation drift in loop bounds (Haskell's `[0.1, 0.2 .. 1.0]` overshoot is the cautionary precedent), while `Int`-only ranges have an exact element count and make the §8 counting-loop emission (`x <= hi`) trivially correct.
- **Interaction with polymorphic literals:** the *literals* in `1..10` are polymorphic as always (`fromInt(k) : α, Num α` — Numeric Literals machinery, untouched), but `..` demands `Int` operands, so each `α` unifies with `Int` on the spot. Defaulting never runs; the constraint discharges at the `Int` instance; `fromInt` erases (Numeric Literals §5). Consequently `1..10 : Range` and the loop variable is `Int`, unconditionally — a `Float` accumulator meeting the loop variable is an ordinary type error, fixed with an explicit `Float.fromInt(x)` (no implicit numeric coercion, ever; acceptance test §10.3(i)).
- Ranges are **inclusive at both ends**, always. There is no exclusive-end variant and no half-open syntax (`..<`, `...`) in v1: with 1-based indexing, the half-open idiom's *raison d'être* (`0..<len`) does not arise — the natural loops are `1..n` and `1..length(xs)`, both inclusive. Pre-registered rejection; revisit only with field evidence.
- Conceptually a `Range` is `(start, end, direction)` where direction ∈ {ascending, descending}; direction is **not user-visible** in v1 (no field access on `Range`; it is opaque). `..` always builds ascending; `rangeDown` builds descending (§3.3).
- `Range` is iterable with element type `Int` (§7).

### 3.2 `range` — the prelude twin

```
range : (Int, Int) -> Range
range(1, 10)         -- identical to 1..10
```

`lo..hi` and `range(lo, hi)` denote the same value; the operator is the idiomatic spelling, the function is the first-class one (pass it, partially configure it, and it is where a future step parameter would live — §11.5). Both are inclusive.

### 3.3 `rangeDown`

```
rangeDown : (Int, Int) -> Range
rangeDown(10, 1)     -- 10,9,...,1
```

Descending iteration is **never inferred from operand order** (§3.4); it is always the separately-named `rangeDown(hi, lo)`, first argument the larger. No operator spelling in v1.

### 3.4 Empty ranges (decided, with rationale — do not re-litigate)

- Ascending: **`lo > hi` ⇒ the empty range.** Not an error, not a descending range. Rationale: "do this n times" is `for i in 1..n`, and `n = 0` must mean zero iterations. Familiar from Rust/Kotlin/Python's ordering behavior.
- Descending: the mirror rule — for `rangeDown(hi, lo)`, **`hi < lo` ⇒ empty**.
- `lo == hi` is the one-element range in both directions.
- Iterating an empty range executes the body zero times; the loop is still `Unit`, no special case.

### 3.5 Precedence (deferred, intent recorded)

Operator precedence is the operators spec's business. Recorded intent for that spec: `..` binds **looser than arithmetic** (`1..n+1` means `1..(n+1)`; `a*2..b*2` means `(a*2)..(b*2)`) and does not chain (`1..2..3` is a parse error). The loops spec does not depend on the resolution.

### 3.6 Constraints on `Range`

`Eq` and `Show` are plausible and deferred to the stdlib listing; nothing in this spec requires them. `Range` is not `Ord`, not `Num`.

---

## 4. The `while` loop

```
while cond
  body...
```

- `while` EXPR, then a block. The condition's grammar is **the `if` condition's grammar, by reference** — whatever the operators/expressions spec decides for `if` (parenthesization, layout) applies here verbatim; this spec does not restate it.
- `cond : Bool`, checked. **No truthiness** (Primitive Types §4) — an `Int` or `Option` condition is an ordinary type error.
- The condition is re-evaluated before each iteration, zero-or-more-times semantics (a false condition on entry runs the body zero times).
- The body block checks against `Unit`, same rule and same diagnostic family as `for..in` (§2.2).
- The whole `while` expression has type `Unit`.
- `while` is **load-bearing** in v1: with no `break`/`continue` (§9.4), every "loop until" pattern lives here, with the exit condition in the head and progress via `var`/`:=`:

```
fun collatzSteps(n0) =
  var n = n0
  var steps = 0
  while n != 1
    if isEven(n) then n := Int.div(n, 2) else n := 3 * n + 1
    steps := steps + 1
  steps
```

- **`while true`:** legal, type `Unit`. With no `break`, an intentional infinite loop exits only via `throw` (or process end). Note for implementers and doc-writers: Hexagon has no `Never`/bottom type, so `while true ...` in final block position makes the function return `Unit` as far as the checker knows, even though it never returns. Accepted for v1; a `Never` type is not being invented here.

---

## 5. What comes after `in`

Anything satisfying the `Iterable` judgment (§7). In v1 that is, at minimum:

| Type | Element type | Notes |
|---|---|---|
| `Range` | `Int` | §3 |
| `List(a)` | `a` | |
| `Seq(a)` | `a` | `iterate` is identity |
| `String` | **open — §11.6** | flagged, not decided |

Maps/Sets join the table when they exist (their specs must state their element type — for a Map, presumably a pair, which also wants the loop-head destructuring deferred in §2.1; note the interaction).

---

## 6. `Seq(a)` — the lazy sequence and the iteration protocol

### 6.1 The type

`Seq(a)` is a **concrete stdlib type** in v1: an immutable, lazy sequence of `a`s, possibly infinite. It is the F# `seq<'T>` role (the one common-currency sequence abstraction everything can convert into) realized with OCaml `Seq`'s pure representation instead of .NET's mutable enumerator.

### 6.2 The functional cursor

The core protocol is one function:

```
Seq.next : (Seq(a)) -> Option((a, Seq(a)))
```

- `Some((x, rest))`: the head element and the *successor sequence*; the original is unchanged (values are immutable — there is nothing else it could be).
- `None`: exhausted.
- This is the entire iteration protocol. There is **no `Iterator` constraint, no cursor object, no `moveNext`/`current` pair** — pre-registered rejection (§9.5). A "cursor" is just a `Seq` value held in a `var` (§2.3).

### 6.3 Why external iteration is mandatory (recorded, do not re-litigate)

A fold/`walk`-based ("internal iteration") protocol cannot back `for..in`: it would turn the loop body into a callback lambda, and Statements §6.2/§7.4 forbid exactly that — a lambda body cannot touch enclosing `var`s, which would kill the accumulator idiom the loop exists for. Folds (`Seq.fold`, `List.walk`-alikes) exist in the stdlib as ordinary functions; they are consumers of the protocol, never its foundation.

### 6.4 Laziness and effects

A `Seq` may be backed by deferred computation (`Seq.map(s, f)` applies `f` on demand). The stdlib listing owes the combinator set (`map`, `filter`, `take`, `takeWhile`, `fold`, `toList`, `fromList`, `unfold`, ...); this spec fixes only the protocol (§6.2) and the type's existence. **No `seq { yield }` comprehension syntax** in v1 (§11.3) — `Seq` needs none of it.

### 6.5 Emission

`Seq(a)` is emitted onto **JS's native iterable/iterator protocol** — a `Seq` value is (or wraps) a JS iterable, so `for (const x of s)` is directly valid on the JS side, `Seq` pipelines read like the generator-library code a JS developer already knows, and the `.d.ts` face is `Iterable<T>`. The precise representation (plain iterable-of-`[Symbol.iterator]`, or a small wrapper preserving persistence of `next`) is an implementation choice constrained by §6.2's semantics: `Seq.next(s)` must not consume `s` from the caller's perspective. Implementers: JS iterators are single-shot and mutable; the wrapper must memoize or re-derive to honor persistence. This is the one place the pure protocol costs something; monomorphic loops avoid the machinery entirely (§8).

---

## 7. `Iterable` — compiler-known in v1

### 7.1 The judgment

The checker has a built-in judgment:

> **Iterable(τ) = ε** — "τ can be iterated, with element type ε."

Satisfied per the §5 table. Internally this is a table keyed on type constructor, with an element-type column and an iterate-strategy column — deliberately the *same shape* as a constraint-instance table with an associated type, because that is what it becomes in v2 (§11.1): the exposure is "make this table user-writable," not a replacement.

- When the checker sees `for x in e` with `e : τ`:
  - τ resolved to a constructor in the table → `x : ε` by substitution.
  - τ an unsolved tyvar → **error, annotation required**: "cannot determine what `e` iterates over; add a type annotation." v1 does not defer this goal (that machinery arrives with associated types, §11.1); functions generic over "any iterable" are not writable in v1. `Seq(a)` is the workaround and the idiom: take a `Seq(a)` parameter and let callers convert (`for x in xs` where `xs : Seq(a)` infers fine — `Seq` is in the table with a variable element).
  - τ resolved to a non-iterable constructor → "`τ` is not iterable" naming the type, with a conversion hint where one exists.
- `Iterable` never appears in inferred signatures, hovers, or errors as a constraint name in v1 — there is no user-visible constraint to leak (same discipline as `fromInt` non-leakage, Numeric Literals §6).

### 7.2 The v2 shape (decided-in-principle; own spec)

Recorded so the v1 table is built pointing the right way:

```
constraint Iterable<c> =
  type Elem
  iterate(xs: c): Seq(Elem)
```

— one constraint, one **associated type** (`Elem`, referenced in type expressions as `Elem(c)`), one member returning the concrete `Seq`. On the `implement` side the binding is written with the keyword too — `type Elem = a` — symmetric with the declaration, and self-announcing (a bare `Elem = a` would be shaped like a term-level binding of an uppercase name, which Functions §2 reserves for constructors). The `type` keyword is **shared with the module-level alias declaration** (Type System Overview §3; declarations preamble owed) — deliberately: an associated type *is* a per-instance type alias resolved by table lookup, and position fully disambiguates the parses (module level / `constraint` body / `implement` block — the Rust precedent, three positions, one keyword). The associated-types spec must note where the rules diverge from the alias's: the alias recursion ban doesn't transfer (`type Elem = a` can only mention the instance's binders, so recursion is unwritable), and the alias-vs-expansion display question gets its own answer (`Elem(c)` with unresolved `c` cannot expand — that is the deferred goal; with resolved `c` it should expand in hovers, `Elem(List(Int))` displaying as `Int`). Requires the associated-types feature (deferred-goal handling in inference, `type` members in `constraint`/`implement`, namespacing, `.d.ts`/LSP display), which gets its own spec (§11.1). Nothing in §1–§10 changes when it lands; user types join the table via `implement`.

---

## 8. JS emission

Readable-JS doctrine: the general mechanism exists; the common case erases.

| Hexagon | JS |
|---|---|
| `for x in 1..10` (syntactic ascending range in the head) | `for (let x = 1; x <= 10; x++) { ... }` |
| `for x in lo..hi` (syntactic range, non-literal bounds) | `for (let x = lo; x <= hi; x++)` — with `hi` bound to a `const` first if it is a non-trivial expression (evaluate once, §2.3) |
| `for x in rangeDown(hi, lo)` (syntactic) | `for (let x = hi; x >= lo; x--)` (same once-evaluation rule) |
| `for x in e` (general case) | `for (const x of e)` |
| `while cond` | `while (cond) { ... }` |
| `Range` as a first-class value (escapes a loop head) | a small range object implementing the JS iterable protocol, materialised on demand (same on-demand doctrine as constructors, Unions §6.4) |

- The counting-loop erasure is **mandatory**, not an optimisation option — it is the readable-JS goal at the language's most common loop, same status as `fromInt` erasure (Numeric Literals §5). "Syntactic range" means the loop head's expression is literally a `..` application / `range(...)` / `rangeDown(...)` call; a `Range` arriving through a variable takes the general `for..of` path.
- The general path relies on §6.5: everything in the §5 table is a JS iterable in emitted form (`List` per its own emission, `Seq` per §6.5, materialised `Range` objects), so `for (const x of e)` is always valid.
- Loop bodies emit as ordinary JS blocks; `var`/`:=` inside them emit per Statements §8 (`let` / `=`), which is sound *because* bodies are blocks, not closures — the same coupling recorded in Statements §8 holds here.
- `.d.ts` impact: `Seq(a)` ↔ `Iterable<T>`; `Range` appears as the emitted range object's interface (or `Iterable<number>`) if it ever crosses the boundary; loops themselves are function-internal and never do.

---

## 9. Pre-registered rejections

1. **C-style `for(init; cond; step)`: does not exist.** Counting is `for i in 1..n`; irregular stepping is `while` + `var`. Its header is three statement positions jammed into one line — the shape the layout syntax exists to avoid — and it is fully redundant with two features Hexagon already has.
2. **`do..while`: no.** Rare; expressible with `while` + a `var` flag or restructuring. F# — the statement-model precedent — does not have it either.
3. **`loop` (loop-forever): no in v1.** Only coherent alongside `break`; automatically part of the break/continue deepdive (below). `while true` covers the interim (§4 note).
4. **`break` / `continue`: not in v1 — deepdive owed.** F# has neither and has lived without them for two decades; Hexagon starts from the same position (removing them later is impossible; adding them is easy). The deepdive's known decision surface, recorded so it is not rediscovered: (a) statement-flavored `break` as a `Unit`-ish expression legal only in loop bodies — cheapest, but the first non-exception non-local control flow; (b) break-with-value (Rust's `break expr`) — makes loops non-`Unit`, drags the loop's type in; (c) labeled variants — decline outright. The F#-flavored alternative to weigh: `while` + flag covers most `break` cases, inverted `if` covers most `continue` cases; whether that ergonomics is acceptable is exactly what the deepdive decides, with field evidence from real Hexagon code (shared revisit-bar with compound assignment, Statements §6.4).
5. **An `Iterator` constraint / cursor objects: never.** The `Seq(a)` functional cursor (§6.2) makes a second constraint and its associated `Iter` type pure structure with no job (the `Iterable`-returns-`Iterator` design collapsed once the cursor became a concrete type). Even in v2, `Iterable` is the only iteration constraint.
6. **Fold-based `for..in` desugaring:** forbidden, §6.3.
7. **Half-open ranges, Float ranges, ranges over `Ord`:** §3.1.
8. **Descending-by-operand-order:** §3.4.
9. **Loop-head destructuring patterns:** deferred to the pattern-matching spec, §2.1.

---

## 10. Edit notes, diagnostics, acceptance tests

### 10.1 Edit notes to existing specs (apply on merge)

1. **Lexer & Layout (numeric literals):** add the rule — **a `.` in a numeric literal must be followed by a digit.** `1.` and `.5` are lex errors with fixits ("write `1.0`" / "write `0.5`"). This makes `1..10` lex as `1` `..` `10` under maximal munch (the Rust scar, avoided). `..` is a token. Primitive Types §3's "a literal is Float iff it contains a `.` or exponent" is unchanged in spirit; the digit-after-dot requirement is the lexer-level sharpening.
2. **Statements §7.4:** the two binding constraints (block bodies; head-binder loop variable) are now discharged by this spec — update the forward reference to point here.
3. **Statements §5 (head binders list):** "when the loops spec arrives, the loop variable of `for..in`" → now definite; add the `while`-has-no-binder non-case for completeness.
4. **Primitive Types §5.1:** the "forthcoming spec" language around iteration of `String` should point at §11.6 here once the element question is decided.

### 10.2 Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Loop body's final expression is non-`Unit` | "the final expression of the loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended" — Statements §3.2 family, loop provenance |
| `e` in `for x in e` is not iterable (concrete τ) | "`τ` is not iterable" (+ conversion hint where one exists, e.g. `toSeq`) |
| `e`'s type is an unsolved tyvar | "cannot determine what `e` iterates over; add a type annotation" (§7.1) |
| Assignment to the loop variable | "`x` is a loop variable and cannot be assigned; declare a `var`" |
| Pattern in loop head | parse error + "destructure in the body: `let (k, v) = pair`" (§2.1) |
| Non-`Bool` `while` condition | ordinary type error; never suggest truthiness |
| `1.` / `.5` literal | lex error + fixit (§10.1.1) |
| `1..2..3` | parse error: "`..` does not chain" (final phrasing owed to operators spec) |

### 10.3 Acceptance tests (golden: inferred type + emitted JS)

```
-- (a) The accumulator idiom, at last (completes Statements §9.1(a))
fun sumTo(n) =
  var total = 0
  for i in 1..n
    total := total + i
  total
-- sumTo : (Int) -> Int
-- emits: let total = 0; for (let i = 1; i <= n; i++) { total = total + i; } return total;

-- (b) Empty range: zero iterations
sumTo(0)                       -- 0

-- (c) General-path iteration
fun printAll(xs) =
  for x in xs
    print(x)                   -- assuming print : (String) -> Unit
-- xs : List(String) at a call site → for (const x of xs) { print(x); }

-- (d) Discard in a loop body
for x in 1..10
  compute(x)                   -- ERROR (10.2 row 1) if compute returns non-Unit
for x in 1..10
  ignore(compute(x))           -- fine

-- (e) while, load-bearing
fun countdown(n0) =
  var n = n0
  while n > 0
    n := n - 1
-- countdown : (Int) -> Unit  (block-final loop; function returns Unit, no ceremony)

-- (f) Loop variable is a head binder; immutable
let i = 99
for i in 1..3                  -- fine: head binder shadows
  i := 5                       -- ERROR: loop variable cannot be assigned

-- (g) Seq as the generic idiom (v1's answer to "any iterable" parameters)
fun firstOrZero(s: Seq(Int)): Int =
  ...Seq.next(s)...            -- Seq is in the Iterable table; for..in over s is fine

-- (h) Range escaping a loop head
let r = 1..10
for x in r                     -- general path: r materialised as an iterable object
  ...

-- (i) Literals in `..` pin to Int; no defaulting; no implicit coercion
var total = 0.0                -- total : Float (monomorphic Float literal)
for x in 1..10                 -- x : Int — `..` unifies both literal tyvars with Int
  total := total + x           -- ERROR: cannot unify Float with Int (ordinary type
                               -- error at `+`; no literal mentioned — the literals
                               -- resolved cleanly, this is not a Numeric Literals §6 case)

var total2 = 0.0
for x in 1..10
  total2 := total2 + Float.fromInt(x)   -- fine; the Int→Float boundary is visible
-- total2 : Float; range emission unaffected: for (let x = 1; x <= 10; x++)
```

---

## 11. Hanging questions (recorded, not decided)

1. **Associated types (v2) — own spec, decided-in-principle.** Design sketch fixed by this spec's needs: `type Elem` members in `constraint`, `type Elem = a` lines in `implement` (keyword shared with the module-level alias declaration, position-disambiguated — §7.2), reference syntax candidate `Elem(c)` (type-application-shaped; coherence makes it a table-lookup type function — search-free, riding on the Constraints §5 discipline exactly as Rust's design rides on its coherence). Its spec owes: the deferred-`Elem(α)` goal mechanism in inference (the first feature to touch `unify`'s environs — deserves its own treatment, not a loops-spec subsection), namespacing of associated type names (constructor-rule family, but in the type namespace), whether an associated type may carry an obligation (`type Elem: Show`) — the minimal answer suffices since §9.5 killed the big client — the divergences from alias rules noted in §7.2 (recursion, expansion in display), and `.d.ts`/LSP display. *Needed by:* the first user-defined collection type that wants `for..in`. Until then, `toSeq` conversion functions are the seam (§7.1).
2. **Derivation timing:** sequence the associated-types spec immediately after this one, or on first demand — open, low stakes given (1) is design-settled.
3. **Generators (`seq { ... }` / `yield`).** Coroutine feature, big surface, own spec. `Seq` the type needs none of it; nobody should assume `Seq` implies `yield`.
4. **`AsyncSeq(a)`.** Committed to v1 *as a direction* but specified in a future (async) spec: `next : (AsyncSeq(a)) -> Promise(Option((a, AsyncSeq(a))))`, mapping onto JS's `AsyncIterator` as `Seq` maps onto `Iterator`; the eventual `for await`-style consumption form belongs to that spec. Core async (`Promise(a)`, `async fun`, `await`) needs no machinery from this spec and no associated types.
5. **Range step.** `range(lo, hi, step)` vs `(1..10).by(2)` vs nothing. No v1 client; decide when field evidence arrives (likely alongside the break/continue deepdive, since both are "loop ergonomics under load").
6. **`String` iteration element.** Hexagon has no `Char`; if `String` is iterable, the element is presumably a length-1 (codepoint) `String`, consistent with the codepoint indexing doctrine (Primitive Types §5.1) — presumed, not decided; grapheme questions lurk. Decide before `String` enters the §5 table; shipping v1 with `String` *not* iterable (use `String.codepoints : (String) -> Seq(String)` explicitly) is an acceptable interim.
7. **Slicing.** `xs[i]` and `xs[lo..hi]` belong to the indexing/collections spec, including the partiality story (the leaning from design discussion: `IndexError` throw for `xs[i]`, and note the honest framing — JS returns `undefined` out of bounds, so a bounds check exists either way; throwing wins on *type* cleanliness, not speed). Open within that spec: whether a range slice clamps or throws. This spec's contribution is only that `Range` is a first-class value fit to appear inside `[]`.
8. **Break/continue deepdive** — §9.4, revisit-bar shared with compound assignment.

---

## 12. Decisions log

| Decision | Where |
|---|---|
| `for x in e` + block; loop variable is a single-name head binder, immutable; patterns deferred | §2.1 |
| Body block checks against `Unit`, no carve-out; §3.2 discard error with loop provenance; loop expression is `Unit` | §2.2 |
| Reference desugaring: `var` cursor + `Seq.next` pulls; iterated expression evaluated once | §2.3 |
| `x..y` operator → concrete lazy `Range`; `Int`-only; inclusive both ends; no half-open form | §3.1 |
| Literals in `..` stay polymorphic but unify with `Int` at the operator; no defaulting; loop variable is always `Int`; `Float` accumulators need explicit `Float.fromInt` | §3.1, §10.3(i) |
| `range(lo, hi)` prelude twin; `rangeDown(hi, lo)` for descending; direction never inferred from operand order | §3.2–3.4 |
| Ascending `lo > hi` ⇒ empty; descending `hi < lo` ⇒ empty; `lo == hi` ⇒ one element | §3.4 |
| `..` precedence deferred to operators spec (intent: looser than arithmetic, non-chaining) | §3.5 |
| `while cond` + block; condition grammar = `if`'s, by reference; `Bool`, no truthiness; `Unit`; `while true` legal, no `Never` type invented | §4 |
| `Seq(a)`: concrete lazy sequence type in v1; protocol is the functional cursor `next : (Seq(a)) -> Option((a, Seq(a)))`; persistence mandatory | §6 |
| External iteration mandatory; fold-based desugaring forbidden (lambda boundary) | §6.3 |
| `Seq` emits onto the JS iterable protocol; `.d.ts` face `Iterable<T>` | §6.5 |
| `Iterable` compiler-known in v1: internal (constructor → element, strategy) table shaped as the future instance table; never leaks into signatures/hovers; unsolved iterable tyvar = annotation-required error; `Seq` parameters are the generic idiom | §7 |
| v2 exposure decided-in-principle: `constraint Iterable<c> = type Elem; iterate(xs: c): Seq(Elem)`; `Elem(c)` reference syntax candidate; own spec | §7.2, §11.1 |
| Emission: counting-loop erasure for syntactic ranges (mandatory), `for..of` general case, `while` verbatim, on-demand `Range` objects | §8 |
| Rejections: C-`for`, `do..while`, `loop`, break/continue (deepdive owed, decision surface recorded), `Iterator` constraint (never), half-open/Float/`Ord` ranges | §9 |
| Lexer edit note: digit required after `.` in numeric literals; `1.`/`.5` errors with fixits; frees `1..10` | §10.1 |
