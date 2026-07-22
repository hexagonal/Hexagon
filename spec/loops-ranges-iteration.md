# Hexagon Spec: Loops, Ranges & Iteration

**Status:** Decided (July 2026). Hanging-questions section (§11) retains the deliberately open items with their owners; resolved items keep their numbers as anchors. Nothing in §11 blocks implementation of §1–§10.
**Scope:** The `for..in` loop, the `while` loop, the `Range` type and the `..` operator, `range`/`rangeDown`, the `Seq(a)` type and its functional-cursor protocol, loop typing (`Unit` bodies), desugaring, and JS emission.
**Not in scope:** `Iterable`'s declaration and type-member grammar (Collections Part 2 §8); `Iterable` resolution, diagnostics, table-opening, and the definitive instance table (Collections Part 5 §§2–4); indexing and slicing (Collections Parts 3–4); `..` precedence (Operators §9); the `Seq` combinator ship-list (`stdlib-roadmap.md`); boundary adaptation of foreign iterables and exported sequences (FFI Part 3); `break`/`continue` (deferred, §9.4); generators (§11.3); `AsyncSeq(a)` (future async spec, §11.4).
**Companions:** Statements, Blocks & Mutability (§3.2 discard rule, §6 `var`/`:=`, §7.4 constraints discharged here), Pattern Matching (§5 irrefutability gate, §6 loop-head position), Collections Part 2 (§8 `Iterable` declaration), Collections Part 5 (operational `Iterable`), Operators (§9 `..` precedence), Lexer (§5 numeric-literal rules), Primitive Types (`Bool` conditions, no truthiness; `Int`; §5.1 String), FFI Part 1 (§8.1 `Hex.Range`), FFI Part 3 (`Seq` boundary), `stdlib-roadmap.md` (Seq combinators; `Range` `Eq`/`Show`).

---

## 1. Doctrine

- **`for..in` is the loop.** The primary iteration form is `for p in e` over anything iterable. It requires no `var` and no mutability; the accumulate-in-a-loop idiom (the Roc motivation for `var`) is what `var` + this loop exist to serve *together*, but neither depends on the other.
- **Loops are `Unit`-typed expressions.** Consistent with the F# statement model (Statements spec §1): there is no statement category; a loop is an expression whose value is `()`.
- **Loop bodies are blocks, not lambdas.** Fixed in advance by Statements §7.4 and honored here. A lambda body could not touch enclosing `var`s (§6.2 there); a block can. This single fact also dictates the iteration protocol (§6.3: external iteration, never fold-based desugaring).
- **The loop head is a pattern position; its binders are head binders** (Statements §5, discharged per §7.4 there). `for x in xs` may shadow any name in scope; `for (k, v) in m` destructures as it binds (§2.1).
- **`for..in` takes JS's good keyword.** JS burned `for..in` on key enumeration and had to invent `for..of`. Hexagon has no such legacy; `for..in` means what it should have meant, and emits JS `for..of` (§8).
- **1-based, inclusive, everywhere.** Ranges are inclusive at both ends, consistent with Hexagon's global 1-based indexing doctrine (Primitive Types §5.1). Counting 1 to 10 is `1..10`, ten iterations.
- **External iteration, functional cursor.** The protocol underlying iteration is "give me the element and the successor state" (`Seq`, §6) — pure, no ref cells, no mutable cursor objects. The one mutation in a compiled loop is a local `var` in the loop's own block: exactly the mutation the language permits.

---

## 2. The `for..in` loop

### 2.1 Grammar

```
for p in e
    body...
```

- `for` PATTERN `in` EXPR, then a block (indentation per Lexer & Layout; the body block opens on the following line or via the ordinary block rules). `for` and `in` are keywords.
- The loop head is **one irrefutable pattern position** — one of Pattern Matching's five positions, under its single irrefutability gate (Pattern Matching §5–§6; no loop-specific dialect). Bare names, tuple patterns, record patterns, and vector patterns all ship in v1; a refutable pattern in the head is the standard Pattern Matching §5 error. `for (k, v) in m` is the canonical beneficiary: `Map` iteration yields `(k, v)` pairs (Collections Part 4 §7.2).
- The pattern's binders are **head binders**: they may shadow anything (Statements §5.1 rule 2); each is immutable within the body (it is not a `var`; `x := e` targeting one gets the standard "is not a `var`" family error, phrased for loop variables: "`x` is a loop variable and cannot be assigned; declare a `var`").
- Their scope is the body block, starting at the binder; they do not exist after the loop.

### 2.2 Typing

- `e` must be **iterable** (§7): the judgment `Iterable(τ) = ε` — normatively, lookup in the global `Iterable` instance table (Collections Part 5 §2.2) — yields the element type; the loop pattern is checked against `ε` and must be irrefutable there (Pattern Matching §5). Its binders are bound at monotypes; head binders never generalise. The full resolution algorithm and failure taxonomy are Collections Part 5 §3.
- The **body block checks against `Unit`**. There is no carve-out: a non-`Unit` final expression in the body is the Statements §3.2 discard hard error, with loop-specific provenance phrasing (§10.2). This is a compile-time check performed once, exactly like any block-item `Unit` check; nothing happens at runtime. `throw` needs no special case (Statements §3.2 already covers it), so a body ending in `throw(...)` or a branch of one checks fine.
- The whole `for..in` expression has type **`Unit`**.
- In non-final block position a loop unifies with `Unit` trivially; in final position the enclosing function returns `Unit` — the same "no ceremony" payoff as block-final `:=` (Statements §4).

### 2.3 Reference desugaring

Semantics are defined by this desugaring (the emitter is free to do better, §8, but must agree observably):

```
-- for p in e
--   body

var cur = iterate(e)            -- cur : Seq(ε), a compiler-fresh name
-- loop:
--   match next(cur)
--     Some((p, rest)) =>
--       body                    -- p's binders are the head binders
--       cur := rest
--     None => ()                -- loop is done; value ()
```

- `iterate` is the ordinary `Iterable` constraint member (Collections Part 5 §2.3) converting the iterable to its `Seq` (§7); for `e : Seq(ε)` it is the identity.
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

- `x..y` is a binary operator on `Int`s producing a value of the concrete type **`Range`**: a lightweight, immutable, *lazy* description of a bounded integer progression. It is **not** a `Vector` — `for i in 1..1_000_000` allocates nothing.
- `Range` is monomorphic over `Int` in v1. No Float ranges, no ranges over arbitrary `Ord` types (no use case until `Char`-like types exist; pre-registered rejection for v1). A `Range(a)` over `<a: (Signed, Ord)>` is specifically rejected: fractional ranges inherit IEEE accumulation drift in loop bounds (Haskell's `[0.1, 0.2 .. 1.0]` overshoot is the cautionary precedent), while `Int`-only ranges have an exact element count and make the §8 counting-loop emission (`x <= hi`) trivially correct.
- **Interaction with polymorphic literals and widening:** the *literals* in `1..10` are polymorphic as always (`fromNat(k) : α, Num α` — Numeric Literals machinery, untouched), but `..` demands `Int` operands, so each `α` unifies with `Int` on the spot. Defaulting never runs; the constraint discharges at the `Int` instance; `fromNat` erases (Numeric Literals §5). Consequently `1..10 : Range` and the loop variable is `Int`, unconditionally. When that established `Int` later meets an independently established `Float` accumulator, Numeric Literals §5.1 widens it contextually through `Float.fromInt`; the range itself remains monomorphic (acceptance test §10.3(i)).
- Ranges are **inclusive at both ends**, always. There is no exclusive-end variant and no half-open syntax (`..<`, `...`) in v1: with 1-based indexing, the half-open idiom's *raison d'être* (`0..<len`) does not arise — the natural loops are `1..n` and `1..length(xs)`, both inclusive. Pre-registered rejection; revisit only with field evidence.
- Conceptually a `Range` is `(start, end, direction)` where direction ∈ {ascending, descending}; direction is **not user-visible** in v1 (no field access on `Range`; it is opaque). `..` always builds ascending; `rangeDown` builds descending (§3.3).
- `Range` is iterable with element type `Int` (§7; instance row Collections Part 5 §4).

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

### 3.5 Precedence (resolved — Operators §9)

`..`'s precedence is decided as this spec's recorded intent: looser than arithmetic, tighter than comparison, non-associative and non-chaining (`1..2..3` is a parse error). Operators §5/§9 is the owner; this spec does not depend on the placement.

### 3.6 Constraints on `Range`

`Eq` and `Show` are plausible and deferred to `stdlib-roadmap.md` (which also tracks the dependent `Hash<Range>`); nothing in this spec requires them. `Range` is not `Ord`, not `Signed`.

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

Anything with an `Iterable` instance (§7). The definitive v1 instance table — element types, `iterate` strategies, and the borrowed-view notes — is owned by **Collections Part 5 §4**. By ownership, the provided families are:

- **Collections/prelude-owned:** `Range` (element `Int`, §3), `Vector(a)`, `Seq(a)` (`iterate` is the identity, §6), `Map(k, v)` (element `(k, v)` — the canonical `for (k, v) in m` head, §2.1), `Set(a)`, and `String` (element: one-codepoint `String`, Collections Part 5 §5).
- **FFI-owned borrowed views:** `Array(a)`, `JsMap(k, v)`, `JsSet(a)` (rows recorded in Collections Part 5 §4; semantics in their owning FFI parts).

User nominal types may join the table with lawful `honor Iterable<T>` instances in v1 (Collections Part 5 §7). No other **provided instance row** ships in v1.

---

## 6. `Seq(a)` — the lazy sequence and the iteration protocol

### 6.1 The type

`Seq(a)` is a **concrete stdlib type** in v1: an immutable, lazy sequence of `a`s, possibly infinite. It is the F# `seq<'T>` role (the one common-currency sequence abstraction everything can convert into) realized with OCaml `Seq`'s pure representation instead of .NET's mutable enumerator.

### 6.2 The functional cursor

The core protocol is one function:

```
Seq.next : Seq(a) -> Option((a, Seq(a)))
```

- `Some((x, rest))`: the head element and the *successor sequence*; the original is unchanged (values are immutable — there is nothing else it could be).
- `None`: exhausted.
- This is the entire iteration protocol. There is **no `Iterator` constraint, no cursor object, no `moveNext`/`current` pair** — pre-registered rejection (§9.5). A "cursor" is just a `Seq` value held in a `var` (§2.3).

### 6.3 Why external iteration is mandatory (recorded, do not re-litigate)

A fold/`walk`-based ("internal iteration") protocol cannot back `for..in`: it would turn the loop body into a callback lambda, and Statements §6.2/§7.4 forbid exactly that — a lambda body cannot touch enclosing `var`s, which would kill the accumulator idiom the loop exists for. Folds exist in the stdlib as ordinary functions; they are consumers of the protocol, never its foundation.

### 6.4 Laziness and effects

A `Seq` may be backed by deferred computation (a mapping combinator applies its function on demand). This spec fixes only the protocol (§6.2) and the type's existence; the v1 `Seq` combinator ship-list is owed to **`stdlib-roadmap.md`**, decided there under the collections naming doctrine. **No `seq { yield }` comprehension syntax** in v1 (§11.3) — `Seq` needs none of it.

### 6.5 Emission

`Seq(a)` is emitted onto **JS's native iterable/iterator protocol** — a `Seq` value is (or wraps) a JS iterable, so `for (const x of s)` is directly valid on the JS side, `Seq` pipelines read like the generator-library code a JS developer already knows, and the `.d.ts` face is `Iterable<a>`. The precise representation (plain iterable-of-`[Symbol.iterator]`, or a small wrapper preserving persistence of `next`) is an implementation choice constrained by §6.2's semantics: `Seq.next(s)` must not consume `s` from the caller's perspective. Implementers: JS iterators are single-shot and mutable; the wrapper must memoize or re-derive to honor persistence. This is the one place the pure protocol costs something; monomorphic loops avoid the machinery entirely (§8). `for..in`, `while`-based cursor consumption, and `Seq`-consuming combinators must use constant-stack iteration in emitted JS — Hexagon does not promise tail-call optimization (FFI Part 3 §6).

Boundary crossing — what a foreign iterable becomes in Hexagon, and what an exported Hexagon sequence is to JavaScript (adapter identity, memoization spine, retention, foreign throws) — is owned by **FFI Part 3** and not restated here.

---

## 7. `Iterable` — the real constraint, restricted in v1

### 7.1 The judgment is instance lookup

The checker's judgment:

> **Iterable(τ) = ε** — "τ can be iterated, with element type ε."

is normatively **lookup in the global `Iterable` instance table**: find the unique instance whose head constructor is τ's outer constructor; ε is that instance's `Item` binding under the substitution of τ's arguments (Collections Part 5 §2.2). The declaration lives in Collections Part 2 §8:

```
constraint Iterable<c> =
    type Item
    iterate(xs: c): Seq(Item)
```

- `iterate` is an **ordinary constraint member** — a real prelude term, callable at concrete types (Collections Part 5 §2.3); the §2.3 desugaring names it.
- The table is **open to users in v1**: a user nominal type joins via a lawful `honor Iterable<T>` instance in one of its two legal homes (Collections Part 5 §7; orphan rule per Modules §7). The full resolution algorithm, failure taxonomy, table-opening rules, and finalized rows are owned by **Collections Part 5 §§2–4**.
- The v1 restriction: `Iterable` is **projection-bearing** and therefore **cannot constrain a generic binder**, and `Item`/`Item(c)` cannot appear in source type expressions (Collections Part 2 §7.2–§7.3). Functions generic over "any iterable" are not writable in v1; the idiom is to **take a `Seq(a)` parameter** and let callers convert (`for x in xs` where `xs : Seq(a)` infers fine — `Seq`'s instance has a variable element).
- Consequently `Iterable` never appears in inferred signatures, hovers, or unsatisfied-constraint errors in v1 — non-leakage holds **by construction** (no binder can introduce it), not by suppression (Collections Part 2 §8).
- When the checker sees `for p in e` with `e : τ` and τ is an unsolved metavariable, the error is **annotation-required**; a rigid (binder-bound) variable instead gets the `Seq(a)` rewrite hint — the split diagnostics are Collections Part 5 §3.2 (§10.2 here summarizes).
### 7.2 The v2 remainder (implied types)

The declaration, `Item` naming, `honor`-side `type Item = τ` bindings, and user instances are **v1** (Collections Part 2 §5–§8; Part 5). What remains v2 is the implied-types feature proper, owned by Collections Part 2 §11 / Part 1 §6.3:

- **deferred `Item(α)` goals** in inference (the machinery that would let `Iterable` constrain a binder);
- the **`Item(c)` reference syntax** in type expressions (v1 reserves it by rejecting it with a message that knows what it will become — Collections Part 2 §7.3);
- **obligations on type members** (`type Item: Show`) and other projection-bearing constraints;
- `derive via`.

Nothing in §1–§10 changes when that remainder lands.

---

## 8. JS emission

Readable-JS doctrine: the general mechanism exists; the common case erases.

| Hexagon | JS |
|---|---|
| `for x in 1..10` (syntactic ascending range in the head) | `for (let x = 1; x <= 10; x++) { ... }` |
| `for x in lo..hi` (syntactic range, non-literal bounds) | `for (let x = lo; x <= hi; x++)` — with `hi` bound to a `const` first if it is a non-trivial expression (evaluate once, §2.3) |
| `for x in rangeDown(hi, lo)` (syntactic) | `for (let x = hi; x >= lo; x--)` (same once-evaluation rule) |
| `for p in e` over a directly iterable provided type | `for (const p of e)`-shaped — a destructuring head where `p` destructures, e.g. `for (const [k, v] of m.entries())` (Collections Part 4 §11) |
| `for p in e` through a user `Iterable` instance | statically resolved `iterate` call producing a `Seq`, then `for (const p of s)`-shaped iteration (Collections Part 5 §9) |
| `while cond` | `while (cond) { ... }` |
| `Range` as a first-class value (escapes a loop head) | a small range object implementing the JS iterable protocol, materialised on demand (same on-demand doctrine as constructors, Unions §6.4) |

- The counting-loop erasure is **mandatory**, not an optimisation option — it is the readable-JS goal at the language's most common loop, same status as `fromNat` erasure (Numeric Literals §5). "Syntactic range" means the loop head's expression is literally a `..` application / `range(...)` / `rangeDown(...)` call; a `Range` arriving through a variable takes the general `for..of` path.
- Provided directly iterable representations take the native path (`Vector` per Collections Part 3, `Seq` per §6.5, materialised `Range` objects, plus the other rows enumerated by Collections Part 5 §9). A user instance instead emits its statically resolved `iterate` call once and traverses the resulting `Seq`; the user's value need not itself implement JavaScript's iterable protocol. Both paths preserve §2.3's once-evaluation rule.
- Loop bodies emit as ordinary JS blocks; `var`/`:=` inside them emit per Statements §8 (`let` / `=`), which is sound *because* bodies are blocks, not closures — the same coupling recorded in Statements §8 holds here.
- `.d.ts` impact: `Seq(a)` ↔ `Iterable<a>`; `Range` faces as **`Hex.Range`** — an opaque branded interface extending `Iterable<number>` (FFI Part 1 §8.1) — if it ever crosses the boundary; loops themselves are function-internal and never do.

---

## 9. Pre-registered rejections

1. **C-style `for(init; cond; step)`: does not exist.** Counting is `for i in 1..n`; irregular stepping is `while` + `var`. Its header is three statement positions jammed into one line — the shape the layout syntax exists to avoid — and it is fully redundant with two features Hexagon already has.
2. **`do..while`: no.** Rare; expressible with `while` + a `var` flag or restructuring. F# — the statement-model precedent — does not have it either.
3. **`loop` (loop-forever): no in v1.** Only coherent alongside `break`; automatically part of the break/continue deepdive (below). `while true` covers the interim (§4 note).
4. **`break` / `continue`: not in v1 — deepdive owed.** F# has neither and has lived without them for two decades; Hexagon starts from the same position (removing them later is impossible; adding them is easy). The deepdive's known decision surface, recorded so it is not rediscovered: (a) statement-flavored `break` as a `Unit`-ish expression legal only in loop bodies — cheapest, but the first non-exception non-local control flow; (b) break-with-value (Rust's `break expr`) — makes loops non-`Unit`, drags the loop's type in; (c) labeled variants — decline outright. The F#-flavored alternative to weigh: `while` + flag covers most `break` cases, inverted `if` covers most `continue` cases; whether that ergonomics is acceptable is exactly what the deepdive decides, with field evidence from real Hexagon code (shared revisit-bar with compound assignment, Statements §6.4).
5. **An `Iterator` constraint / cursor objects: never.** The `Seq(a)` functional cursor (§6.2) makes a second constraint and its implied `Iter` type pure structure with no job (the `Iterable`-returns-`Iterator` design collapsed once the cursor became a concrete type). Even in v2, `Iterable` is the only iteration constraint.
6. **Fold-based `for..in` desugaring:** forbidden, §6.3.
7. **Half-open ranges, Float ranges, ranges over `Ord`:** §3.1.
8. **Descending-by-operand-order:** §3.4.
9. *(resolved)* **Bare-name-only loop heads.** The v1 restriction this item once deferred is superseded: loop heads take full irrefutable patterns (§2.1; Pattern Matching §6, Collections Part 4 §7.2).

---

## 10. Edit notes, diagnostics, acceptance tests

### 10.1 Edit notes (all applied; anchors preserved)

1. **Lexer (numeric literals): applied.** Lexer §5 owns the rule — a `.` in a numeric literal must be followed by a digit; `1.` and `.5` are lex errors with fixits. This makes `1..10` lex as `1` `..` `10` under maximal munch; `..` is a token.
2. **Statements §7.4: discharged.** The two binding constraints (block bodies; head-binder loop variables) are normative here; Statements §7.4 records the discharge.
3. **Statements §5 (head binders list): applied.** The loop head's binders are definite members; `while` has no binder.
4. **Primitive Types §5.1 / String iteration: resolved.** Decided by Collections Part 5 §5 — see §11.6.

### 10.2 Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Loop body's final expression is non-`Unit` | "the final expression of the loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended" — Statements §3.2 family, loop provenance |
| `e` in `for p in e` has a concrete non-iterable type, not a user nominal | "`τ` is not iterable" (+ conversion hint where one exists, e.g. `toSeq`) |
| `e`'s type is a user nominal with no instance | the two-legal-homes message: name the `honor Iterable<T>` home and the conversion/`Seq(a)` alternatives (Collections Part 5 §3.3) |
| `e`'s type is an unsolved metavariable | "cannot determine what `e` iterates over; add a type annotation" (§7.1) |
| `e`'s type is a rigid (binder-bound) variable | "`e` has the generic type `c`, and `Iterable` cannot constrain a type variable in v1; take a `Seq(a)` parameter instead" (Collections Part 5 §3.2) |
| Assignment to a loop binder | "`x` is a loop variable and cannot be assigned; declare a `var`" |
| Refutable pattern in the loop head | the standard Pattern Matching §5 irrefutability error (loop heads are a binding position; no loop-specific dialect) |
| Non-`Bool` `while` condition | ordinary type error; never suggest truthiness |
| `1.` / `.5` literal | lex error + fixit (Lexer §5; §10.1.1) |
| `1..2..3` | parse error: "`..` does not chain; a range has exactly two endpoints" (Operators §9) |

Diagnostics obey the Rewrite Rule (Declarations Preamble §1.1): where a legal spelling of the intent exists, the error names it.

### 10.3 Acceptance tests (golden: inferred type + emitted JS)

```
-- (a) The accumulator idiom, at last (completes Statements §9.1(a))
fun sumTo(n) =
    var total = 0
    for i in 1..n
        total := total + i
    total
-- sumTo : Int -> Int
-- emits: let total = 0; for (let i = 1; i <= n; i++) { total = total + i; } return total;

-- (b) Empty range: zero iterations
sumTo(0)                       -- 0

-- (c) General-path iteration
fun printAll(xs) =
    for x in xs
        print(x)                   -- assuming print : String -> Unit
-- xs : Vector(String) at a call site → for (const x of xs) { print(x); }

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
-- countdown : Int -> Unit  (block-final loop; function returns Unit, no ceremony)

-- (f) Loop variable is a head binder; immutable
let i = 99
for i in 1..3                  -- fine: head binder shadows
    i := 5                       -- ERROR: loop variable cannot be assigned

-- (g) Seq as the generic idiom (v1's answer to "any iterable" parameters)
fun firstOrZero(s: Seq(Int)): Int =
    ...Seq.next(s)...            -- Seq has an Iterable instance; for..in over s is fine

-- (h) Range escaping a loop head
let r = 1..10
for x in r                     -- general path: r materialised as an iterable object
    ...

-- (i) Literals in `..` pin to Int; later arithmetic may widen that Int
var total = 0.0                -- total : Float (monomorphic Float literal)
for x in 1..10                 -- x : Int — `..` unifies both literal tyvars with Int
    total := total + x           -- x widens through Float.fromInt; emitted JS stays
                               -- `total = total + x`
-- total : Float; range emission unaffected: for (let x = 1; x <= 10; x++)

-- (j) Pattern loop head (canonical; per-row goldens live in Collections Parts 4–5)
for (k, v) in m                -- m : Map(String, Int); k : String, v : Int
    ...
-- emits: for (const [k, v] of m.entries()) { ... }
```

---

## 11. Hanging questions — live deferrals and resolved anchors

1. *(resolved — re-scoped)* **Implied types.** The `Iterable` declaration, `Item` naming, `honor`-side `type Item = τ` bindings, and user instances are v1 (Collections Part 2 §5–§8; Part 5 §7). The genuine v2 remainder — deferred `Item(α)` goals, `Item(c)` reference syntax, obligations on type members, `derive via` — is owned by Collections Part 2 §11 / Part 1 §6.3. See §7.2.
2. *(resolved)* **Derivation timing.** No longer an independent question: the declaration shipped with Collections Part 2; only the §11.1 v2 remainder is sequenced later, by its owner.
3. **Generators (`seq { ... }` / `yield`).** Coroutine feature, big surface, own spec. `Seq` the type needs none of it; nobody should assume `Seq` implies `yield`.
4. **`AsyncSeq(a)`.** Not a v1 feature. Direction recorded for a future async spec: `next : AsyncSeq(a) -> Promise(Option((a, AsyncSeq(a))))`, mapping onto JS's `AsyncIterator` as `Seq` maps onto `Iterator`; the eventual `for await`-style consumption form belongs to that spec. Core async (`Promise(a)`, `async fun`, `await`) needs no machinery from this spec and no implied types.
5. **Range step.** `range(lo, hi, step)` vs `(1..10).by(2)` vs nothing. No v1 client; decide when field evidence arrives (likely alongside the break/continue deepdive, since both are "loop ergonomics under load").
6. *(resolved)* **`String` iteration.** Decided: `String` is iterable with **one-codepoint `String`** items, in codepoint order; the conversion pair is `String.toSeq`/`String.fromSeq`. Owner: Collections Part 5 §5 (Primitive Types §5.1 conforms).
7. *(resolved)* **Slicing and indexing.** `Vector` and `String` are decided by Collections Part 3 §§5–6/§9; borrowed `Array` is decided by FFI Part 2 §6.3; Map key access is Collections Part 4 §4. This spec's surviving contribution stands: `Range` is a first-class value fit to appear inside `[]`.
8. **Break/continue deepdive** — §9.4, revisit-bar shared with compound assignment (Statements §6.4).

---

## 12. Decisions log

| Decision | Where |
|---|---|
| `for p in e` + block; the loop head is one irrefutable pattern position (tuple/record/vector patterns ship; `for (k, v) in map` canonical); binders are head binders, immutable | §2.1 |
| Body block checks against `Unit`, no carve-out; §3.2 discard error with loop provenance; loop expression is `Unit` | §2.2 |
| Reference desugaring: `var` cursor + `Seq.next` pulls; `iterate` is the `Iterable` constraint member; iterated expression evaluated once | §2.3 |
| `x..y` operator → concrete lazy `Range`; `Int`-only; inclusive both ends; no half-open form | §3.1 |
| Literals in `..` stay polymorphic but unify with `Int` at the operator; no defaulting; loop variable is always `Int`; an independently established `Float` accumulator contextually widens that value through `fromInt` | §3.1, §10.3(i) |
| `range(lo, hi)` prelude twin; `rangeDown(hi, lo)` for descending; direction never inferred from operand order | §3.2–3.4 |
| Ascending `lo > hi` ⇒ empty; descending `hi < lo` ⇒ empty; `lo == hi` ⇒ one element | §3.4 |
| `..` precedence decided as recorded intent (looser than arithmetic, non-chaining) — Operators §9 owns | §3.5 |
| `while cond` + block; condition grammar = `if`'s, by reference; `Bool`, no truthiness; `Unit`; `while true` legal, no `Never` type invented | §4 |
| `Seq(a)`: concrete lazy sequence type in v1; protocol is the functional cursor `next : Seq(a) -> Option((a, Seq(a)))`; persistence mandatory | §6 |
| External iteration mandatory; fold-based desugaring forbidden (lambda boundary) | §6.3 |
| `Seq` emits onto the JS iterable protocol; `.d.ts` face `Iterable<a>`; constant-stack traversal; boundary adaptation owned by FFI Part 3 | §6.5 |
| `Iterable` is the real constraint in v1: judgment = global-instance lookup; `iterate` an ordinary member; user `honor` instances lawful; projection-bearing, so no generic binders and no `Item(c)` in source; non-leakage by construction; operational spec owned by Collections Part 5 | §7 |
| v2 remainder re-scoped: deferred `Item(α)` goals, `Item(c)` syntax, member obligations, `derive via` — Collections Part 2 §11 owns | §7.2, §11.1 |
| Emission: counting-loop erasure for syntactic ranges (mandatory), `for..of` general case (destructuring heads for patterns), `while` verbatim, on-demand `Range` objects; `Range` faces as branded `Hex.Range` extending `Iterable<number>` | §8 |
| Rejections: C-`for`, `do..while`, `loop`, break/continue (deepdive owed, decision surface recorded), `Iterator` constraint (never), half-open/Float/`Ord` ranges; bare-name-only heads superseded | §9 |
| Numeric-literal digit-after-`.` rule owned by Lexer §5; `1.`/`.5` errors with fixits; frees `1..10` | §10.1 |
| `String` iterable, one-codepoint items — Collections Part 5 §5 owns | §11.6 |
