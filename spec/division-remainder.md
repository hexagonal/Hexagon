# Hexagon Spec: Integer Division & Remainder

**Status:** Decided (July 2026); compiler companion operations and emitted runtime semantics implemented. Closes the reopened question in Operators §14.3a; amended to record `Rat` as a required v1 consumer. Amended 2026-11-14 (#1545): a divisor written as a literal zero is refused when the program is compiled, at every exact division the language owns (§12).
**Scope:** The division/remainder function families on `Int`, `BigInt`, and `Float`: names, conventions, zero-divisor behaviour, emission, diagnostics. The refusal, when the program is compiled, of a divisor written as a literal zero at every exact division the language owns (§12).
**Not in scope:** The `Frac` constraint and `/` (Operators §6.1, unchanged), save the check of a divisor written as a literal zero (§12); the rejection of a `%` operator (Operators §13, unchanged — this doc supplies the semantics that rejection deferred to names); `Num`/`Signed` literal machinery (Numeric Literals spec); checked-overflow variants (Primitive Types §2.1).
**Companions:** Operators & Precedence spec (§6.1, §13, §14.3a — edit notes §8 here), Primitive Types spec (§2 — edit note), Integral Constraint spec (generic family and v1 `Rat` normalization), Exceptions spec (registry addition), `rat.md` §3–§4 and `dec.md` §6 (the other exact divisions §12 checks), Regex §8 (the same line of sight for a literal), `hexagon-for-typescript-coders` Ch. 3.4 (needs no change; it never named the convention).

---

## 1. Doctrine

> **`mod` means Euclidean, everywhere in Hexagon. `rem` means the truncated machine convention (JS's `%`), everywhere. The name tells you which contract you're getting.**

- At `Int` and `BigInt`, remainder functions come in **pairs** with their quotient functions, because integer types have no true division — the pair jointly *defines* it via the identity in §2.
- At `Float`, the remainder functions stand **alone**, because `/` already exists; there is no `Float.quot` and no Euclidean float division (§5.3).
- There is no `%` operator (Operators §13): modulo has multiple live conventions, a symbol hides the choice, a name documents it. This spec is that documentation.

## 2. The Euclidean convention

For `b ≠ 0`, `Int.div` and `Int.mod` are the unique pair satisfying:

```
div(a, b) * b + mod(a, b) == a          -- the division identity
0 <= mod(a, b) < abs(b)                  -- the Euclidean invariant
```

Equivalently: `div(a, b)` is `floor(a / b)` when `b > 0` and `ceil(a / b)` when `b < 0`; `mod` is the residue that makes the identity hold. The invariant is the whole point: **the remainder is a canonical residue — non-negative, unconditionally** — with no caveat about the sign of either operand. Floored (Python/Knuth) shares the identity but lets the remainder take the divisor's sign; truncated (C/JS/Java) lets it take the *dividend's* sign, which is the convention that breaks `isEven`-via-remainder, hash bucketing, ring indexing, and calendar arithmetic on negative inputs.

This convention is load-bearing for v1 `Rat`: its normalization consumes the `Integral` Euclidean family, so gcd reduction and bottom-sign canonicalization share one sign-stable integer foundation.

The three conventions, side by side (they agree wherever both operands are non-negative — i.e. in most real code):

| `a`, `b` | Euclidean `div, mod` | Floored | Truncated (`quot, rem`) |
|---|---|---|---|
| `7, 3` | `2, 1` | `2, 1` | `2, 1` |
| `-7, 3` | `-3, 2` | `-3, 2` | `-2, -1` |
| `7, -3` | `-2, 1` | `-3, -2` | `-2, 1` |
| `-7, -3` | `3, 2` | `2, -1` | `2, -1` |

Euclidean and floored differ **only when the divisor is negative** (rows 3–4); Euclidean is the one whose remainder column reads `1, 2, 1, 2` with no signs to reason about.

**Authority and precedent:** Boute, *The Euclidean definition of the functions div and mod* (ACM TOPLAS, 1992) — the standard argument that Euclidean is the mathematically preferred definition. Adopters: **Lean 4** (`Int.ediv`/`Int.emod` back the default `%` on `Int`), **R6RS Scheme** (`div`/`mod` are Euclidean), **Dart** (`%` on `int` is Euclidean-remainder, with `remainder()` for truncated — the killer precedent: a web-targeting language shipping exactly Hexagon's split, compiled to JS for years), **Rust** (`div_euclid`/`rem_euclid` alongside truncated `%`).

## 3. The `Int` family

```
Int.div(a: Int, b: Int): Int      -- Euclidean quotient
Int.mod(a: Int, b: Int): Int      -- Euclidean remainder, in [0, abs(b))
Int.quot(a: Int, b: Int): Int     -- truncated quotient  (rounds toward zero)
Int.rem(a: Int, b: Int): Int      -- truncated remainder (JS's `%` exactly)
```

- **All four throw `DivideByZeroFault` on `b == 0`.** JS's `a % 0` is `NaN`, which would silently break the Int-is-a-whole-JS-number invariant; the truncated pair gets no IEEE exemption just because its convention matches JS — the *type* is `Int`, and `Int` partiality throws (same doctrine as `Int.div` always had, and as `IndexFault`). A `b` written as a literal zero is refused before the program runs (§12).
- `quot`/`rem` satisfy their own identity (`quot(a,b) * b + rem(a,b) == a`) with `abs(rem(a,b)) < abs(b)` and `rem` taking the dividend's sign. Names per the Haskell (`quot`/`rem` vs `div`/`mod`) and Rust lineage.
- **Why `quot`/`rem` exist at all:** interop and porting. `Int.rem(a, b)` is bit-for-bit JS's `a % b` (for valid `Int` inputs), so code transliterated from JS/TS — or any C-family source — can keep its remainder semantics under a name that *says* it's the machine convention. The docs for `rem` state "this is JS's `%`" in those words.
- All four are monomorphic `Int` functions, not constraint members — same status as `Int.div` always had (`Int` is `Signed` but not `Frac`; Operators §6.1). *(Superseded by the Integral constraint, and the spellings survived it: the four are `Integral<Int>`'s members, `Int.div` is the member qualified (Modules §5.3), and since #344 the bodies are source `honor` blocks in `stdlib/Int.hex`. The conventions, identities, and guards above are unchanged — the Integral spec's reconciliation section governs.)*

## 4. `BigInt` mirrors `Int`

`BigInt.div` / `BigInt.mod` / `BigInt.quot` / `BigInt.rem`, same conventions, same identities, same `DivideByZeroFault` on a zero divisor.

One implementation wrinkle, binding: **native JS BigInt `/` and `%` already throw on `0n`** — but a `RangeError`, not a branded Hexagon fault. The runtime helpers must produce `DivideByZeroFault` (the standard `$hex` — the declaring module, #488 — plus `name` branding, Exceptions spec) — by pre-checking `b === 0n`, not by catch-and-rebrand (a `try`/`catch` around every remainder is worse readable-JS than one comparison). The observable rule is uniform: **a zero divisor at any integer type throws `DivideByZeroFault`, never a raw JS error, never `NaN`.**

Note JS BigInt's native `%` is truncated, same as `number`'s — so `BigInt.rem` enjoys the same near-bare emission as `Int.rem` (§6).

## 5. The `Float` family

```
Float.mod(a: Float, b: Float): Float   -- Euclidean remainder
Float.rem(a: Float, b: Float): Float   -- truncated remainder (JS's `%` on floats; C's fmod)
```

*(Landed, #344 — the last companion milestone.)* Both live in `stdlib/Float.hex` as **plain exports** — `Float` is not `Integral` (Integral spec §1), so unlike every integer type's family these are not constraint members and never join a dispatch set. `rem` is the companion's intrinsic-door declaration (`floatRem`, lowering the bare `a % b` §6 tables); `mod` is ordinary Hexagon above it — the §5.1 adjustment written over `rem`, the ordinary comparison operators, `Num<Float>`'s add, and `Signed<Float>`'s negate, which is exactly the strictly-simpler layering `Int.hex` uses for its Euclidean family. Neither spelling is bare (Modules §5.5 seeds no prelude function or member bare but `ignore` and `show`): `mod` and `rem` are reached through their qualified homes — `Integral.mod`/`Integral.rem` for the polymorphic members, `Float.mod`/`Float.rem` for the float family — and by the dot call, which is type-directed and never reads the bare layer, so the one spelling shape serves every numeric type.

### 5.1 Semantics

- **No throw, ever.** Zero divisor and non-finite operands follow IEEE 754 and yield `NaN`, exactly as `Float` division does (Primitive Types: "float division follows IEEE 754"). The throw/`NaN` split between the `Int` and `Float` families is not an inconsistency — it is the *same* split the language already has between `Int.div` (throws) and float `/` (doesn't). Integer partiality throws; float partiality is `NaN`.
- `Float.rem` is IEEE-exact: `fmod` introduces **no rounding error** (the true remainder of two doubles is always representable). Worth stating in user docs; it surprises people.
- `Float.mod` is `rem` adjusted into `[0, abs(b)]`: `r = a % b; r < 0 ? r + abs(b) : r`. The adjustment addition can round: when `r` is a tiny negative and `abs(b)` is large, `r + abs(b)` may round **up to `abs(b)` itself**, so the honest invariant at `Float` is `0 <= result <= abs(b)`, with the upper boundary reachable only via rounding. Rust's `rem_euclid` has the identical documented edge (e.g. `(-1e-300).rem_euclid(3.0)` can yield `3.0`); Hexagon documents rather than "fixes" it — any fix breaks exactness elsewhere.
- The primary use cases are why `Float.mod` earns its place: angle wrapping (`theta |> Float.mod(tau)`), phase accumulators, hue rotation — all want the non-negative residue, and JS's `%` returning a negative for a negative angle is a classic graphics bug this function deletes.

### 5.2 Precedent at `Float`

Rust is the direct model: `%` on `f64` is truncated, `f64::rem_euclid` is Euclidean — Hexagon's split, at float type, shipped and stable. Haskell declines the question (`div`/`mod`/`quot`/`rem` are `Integral`-only; `Data.Fixed.mod'` is a floored library afterthought). Lean 4 core gives `Float` no modulo at all. So the field is: provide-both (Rust) or provide-nothing (Haskell, Lean); nobody provides a *different* convention, and "Euclidean if provided" is uncontradicted.

### 5.3 No `Float.quot`, no Euclidean float division (decided)

The quotient halves exist at `Int`/`BigInt` because those types have no `/` — the pair jointly defines division. `Float` has true `/`; the quotient side is a trivial composition (`Float.trunc(a / b)`, `Float.floor(a / b)` — Primitive Types §3's checked `Float`-to-`Int` exits), the division identity holds only up to rounding at float type so there is no exact pair-contract to honor, and Rust's `f64::div_euclid` is the half nobody calls. Omitting them keeps §1's doctrine sentence load-bearing: pairs where they define division, standalone remainders where division already exists.

## 6. Emission

No `%` operator exists in Hexagon, so every one of these is an ordinary prelude call; readable-JS is satisfied by small named runtime helpers plus inlining latitude:

| Function | Helper body (shape) |
|---|---|
| `Int.mod` / `BigInt.mod` | zero guard; `r = a % b; return r < 0 ? r + abs(b) : r` (BigInt: `b < 0n ? -b : b` for the abs) |
| `Int.div` / `BigInt.div` | zero guard; `r = mod(a, b); return (a - r) / b` (exact within `Int` range; BigInt exact always) |
| `Int.quot` | zero guard; `Math.trunc(a / b)` |
| `Int.rem` / `BigInt.rem` | zero guard; `a % b` |
| `BigInt.quot` | zero guard; `a / b` (native BigInt division *is* truncated) |
| `Float.rem` | **bare `a % b`** — no guard, no helper; IEEE does the rest |
| `Float.mod` | `r = a % b; return r < 0 ? r + Math.abs(b) : r` — no guard (NaN flows through) |

Inlining latitude (quality-of-implementation, not spec): where the divisor is a positive constant, `Int.mod(a, k)` may inline as `((a % k) + k) % k`, and where the dividend is provably non-negative, as bare `a % k`; `Int.rem` with a provably nonzero divisor may drop the guard. The helper-call form is the required baseline and is itself acceptable readable-JS — a named call that says `mod` is more readable than an inlined double-`%` trick.

*(Edit note, #344.)* The `BigInt` rows above are no longer runtime helpers: `BigInt.div`/`BigInt.mod`/`BigInt.gcd`/`BigInt.lcm` and the zero guards are ordinary Hexagon in `stdlib/BigInt.hex`, and `BigInt.quot`/`BigInt.rem` are its intrinsic-door declarations, whose lowerings keep exactly the shapes tabled here (intrinsics §3.2). The shapes stay normative for behaviour; where the body now lives is stdlib-roadmap §5.1's business. *(Second landing, #344.)* The `Int` rows followed: the Euclidean pair, `gcd`, and the zero guards are ordinary Hexagon in `stdlib/Int.hex`, over its door pair `intQuot`/`intRem`, whose lowerings keep exactly the shapes tabled here. `stdlib/Nat.hex` honors `Integral` the same way (the Integral spec owns the `Nat` instance; at `Nat` the Euclidean and truncated conventions coincide value-wise, and the guards' messages name `Nat`). *(Third landing, #344.)* The `Float` rows followed at their milestone, the last: `Float.rem` is `stdlib/Float.hex`'s door declaration `floatRem`, whose lowering keeps exactly the bare-`%` shape tabled here, and `Float.mod` is ordinary Hexagon above it (§5's landing note). With them the `__hex_floatMod`/`__hex_floatRem` helpers and the whole transitional `PrimitiveOperation` route died (intrinsics §9.2 — `Float` was the family's last owner); every row in this table now describes source, and the shapes stay normative for behaviour.

## 7. Diagnostics

| Situation | Message (shape) |
|---|---|
| `intA / intB` (existing, Operators §6.1) | unchanged, but the hint now reads: "`Int` has no `/`; use `Int.div`/`Int.mod` (Euclidean), or `Int.quot`/`Int.rem` for JS's truncating `%` semantics" |
| A divisor written as a literal zero, at any division §12.2 lists | refused when the program is compiled, with §12.5's report |
| Zero divisor at runtime, any integer function, where §12 does not refuse the division | `DivideByZeroFault`; message names the function that threw (`Int.rem: divisor is zero`), per the provenance-tagged phrasing rule. *(#344: the fault's declared home is `stdlib/Integral.hex` — the constraint whose members the guards protect — one declaration for every honoring companion; `BigInt`'s, `Int`'s, and `Nat`'s guards throw it from source — a `Nat` division's message now names `Nat`, where the shared wired helper once said `Int` — and `Float` has no integer functions to guard)* |

Docs (not compiler) obligations: `rem`'s doc line says "this is JS's `%`"; `mod`'s says "always non-negative"; `Float.mod`'s notes the rounding boundary (§5.1).

## 8. Rejected alternatives (do not relitigate)

- **Floored `div`/`mod`** (Python, Knuth; the former leaning recorded in Primitive Types §2): shares the division identity but the remainder takes the divisor's sign — one caveat where Euclidean has none. Euclidean's unconditional `[0, |b|)` is the stronger math-first contract; Boute's paper is the argument; the two agree for positive divisors, so the switch costs nothing in common code. Floored's one concrete advantage — a floored `div` is bare `Math.floor(a/b)` — is outweighed by the invariant.
- **Truncated as the default `mod`**: rejected by both prior camps and still rejected; it is the convention that makes `mod(-7, 3)` negative and breaks residue-class reasoning. It survives — correctly labelled — as `rem`.
- **`jsMod` naming for the truncated function**: considered (self-documenting for the audience) but truncated is C/Java/Rust/JS-BigInt's convention too, not a JS quirk, and its quotient partner has no JS name to borrow (JS lacks an integer-division operator). `quot`/`rem` carries the Haskell/Rust lineage and keeps the pair symmetric; the docs and the `/`-on-Int diagnostic do the "this is JS's `%`" bridging by saying it outright.
- **A `%` operator**: Operators §13, unchanged and reinforced — this spec is the payoff of "a name documents the choice": Hexagon has *two* remainder names because there are two live conventions, which is exactly what one symbol could never say.
- **`Float.quot` / Euclidean `Float.div`**: §5.3.
- **Floored float `mod`** (Haskell's `Data.Fixed.mod'`, Python's float `%`): would make `Float.mod` and `Int.mod` disagree in convention across the numeric tower; uniformity of the doctrine sentence wins.
- **Throwing `Float.mod`/`Float.rem` on zero divisor**: would contradict the settled IEEE stance of float `/`; float partiality is `NaN` in Hexagon, full stop.
- **Omitting `Float.mod`/`Float.rem` entirely** (Haskell/Lean position): angle-wrapping is too common to leave to a hand-rolled two-liner that half the audience will write with the negative-result bug; and `Float.rem` costs nothing (it *is* the JS operator).
- **Reading a name, or folding arithmetic, to find a zero divisor** (#1545): §12.1. Go and C# read a named constant, but each has a `const` declaration that defines one, and Hexagon has none; reading a `let` would also part from Regex §8, where binding a value with `let` is how a program meets a fault on purpose. A fold needs a limit on how far it reaches, and every such limit is an accident of the checker. A `const` declaration, if the language gains one, would revisit this rule and Regex §8 together.
- **A warning for a written zero divisor** (#1545), as Rust's lint and Java's and Kotlin's warnings are: §12.4. Hexagon has no warning tier (Declarations Preamble §1.1), and a division that faults every time it is reached is either refused or left to fault when it runs.
- **A door through which a function declares a checked seat** (#1545): §12.2. It would have no customer whose rule the compiler does not already know, as Regex §11 found for running library code while compiling.
- **Checking a zero divisor at `Float`** (#1545): §12.2. `Float` answers `Infinity` and `NaN` there (§5.1), and the entry above keeps that stance for `Float.mod` and `Float.rem`; there is no fault to report early.
- **Checking `/` only where the text decides that it runs at `Rat`** (#1545; Method Syntax §3.1): §12.3. Some plain `Rat` divisions by a written zero would compile and fault when they run, and a programmer would have to learn which; the check reads a solved type only to know that the division is exact, and chooses nothing by it.

## 9. Acceptance tests

```
-- Euclidean pair: identity + invariant on all sign combinations (§2 table)
Int.div(7, 3)    -- 2      Int.mod(7, 3)    -- 1
Int.div(-7, 3)   -- -3     Int.mod(-7, 3)   -- 2
Int.div(7, -3)   -- -2     Int.mod(7, -3)   -- 1
Int.div(-7, -3)  -- 3      Int.mod(-7, -3)  -- 2

-- Truncated pair: JS's answers exactly
Int.quot(-7, 3)  -- -2     Int.rem(-7, 3)   -- -1
Int.quot(7, -3)  -- -2     Int.rem(7, -3)   -- 1
Int.quot(-7, -3) -- 2      Int.rem(-7, -3)  -- -1

-- Zero divisors: all four throw, branded, where the zero is not written as a literal (§12)
let zero = 0
let bigZero = 0n
Int.mod(1, zero)          -- throws DivideByZeroFault
Int.rem(1, zero)          -- throws DivideByZeroFault (NOT NaN; not JS behaviour)
BigInt.rem(1n, bigZero)   -- throws DivideByZeroFault (NOT RangeError; §4)

-- Float: IEEE, no throws
Float.rem(-7.0, 3.0)   -- -1.0   (bare JS %)
Float.mod(-7.0, 3.0)   -- 2.0
Float.mod(-0.5, 6.283185307179586)  -- ~5.783185307179586 (angle wrap, non-negative)
Float.mod(1.0, 0.0)    -- NaN
Float.rem(1.0, 0.0)    -- NaN

-- The doctrine, exercised
isEven = n => Int.mod(n, 2) == 0    -- correct for negative n; with rem it wouldn't be

-- A divisor written as a literal zero: refused when the program is compiled (§12)
Int.mod(1, 0)             -- ERROR: division by zero: `Int.mod(1, 0)` has no value; write the divisor that was meant
1.mod(0)                  -- ERROR, the same report quoting `1.mod(0)`; so are `1 |> Int.mod(0)` and `Integral.mod(1, 0)`, each quoting its own text
BigInt.rem(1n, -0n)       -- ERROR: a sign does not hide a written zero
Int.div(0, (0: Int))      -- ERROR: nor does a written type; the dividend is not read
let r: Rat = 1 / 0.0      -- ERROR: division by zero: `1 / 0.0` has no value; write the divisor that was meant
1.5d.divide(0.00d, 2)     -- ERROR: division by zero: `1.5d.divide(0.00d, 2)` has no value; write the divisor that was meant
1 // 0                    -- ERROR: a fraction's bottom is never zero, so `1 // 0` has no value; write the bottom that was meant
Rat.create(1n, 0n)        -- ERROR: a fraction's bottom is never zero, so `Rat.create(1n, 0n)` has no value; write the bottom that was meant
fun never() = Int.div(1, 0)                          -- ERROR, though nothing calls it
try Int.div(1, 0) catch DivideByZeroFault(_) => 0    -- ERROR: the check reads the text, not the run

-- Not checked: each faults or answers when it runs
Int.div(1, zero)          -- throws DivideByZeroFault: a name is never read
Int.div(1, 2 - 2)         -- throws DivideByZeroFault: nothing is folded
let g = Int.div
g(1, 0)                   -- throws DivideByZeroFault: a function value is never checked
let f = x => x / 0
f(1.0)                    -- Infinity: a division at a type variable is never checked
f(1 // 2)                 -- throws DivideByZeroFault, for the same reason
Rat.reciprocal(0)         -- throws DivideByZeroFault: not a checked seat
1.0 / 0.0                 -- Infinity: `Float` is not checked
```

## 10. Decisions log

| Decision | Where |
|---|---|
| `mod`/`div` are Euclidean at every type that has them; closes Operators §14.3a | §1–2 |
| `quot`/`rem` (truncated) provided at `Int`/`BigInt` for JS/C-family interop; naming per Haskell/Rust, `jsMod` rejected | §3, §8 |
| All integer-type division/remainder functions throw `DivideByZeroFault` on zero; BigInt pre-checks rather than rebranding `RangeError` | §3–4 |
| `Float.mod` (Euclidean) and `Float.rem` (truncated, bare `%`) provided; NaN on zero divisor; no throw | §5 |
| No `Float.quot`, no Euclidean float division | §5.3 |
| `Float.trunc(a / b)` and `Float.floor(a / b)` are compositions through Primitive Types §3's checked rounding exits, not a float quotient family | §5.3; #919 |
| `Float.mod` invariant is `0 <= r <= abs(b)` (boundary via rounding only); `Float.rem` is IEEE-exact | §5.1 |
| Emission via named runtime helpers; inlining is QoI latitude *(superseded per family by #344 — `BigInt` at the first landing, `Int`/`Nat` at the second, `Float` at the third and last: every body lives in its companion, natives through the intrinsic door, the `__hex_floatMod`/`__hex_floatRem` helpers gone with the door family; the §6 shapes stay normative for behaviour)* | §6 |
| A divisor written as a literal zero is refused when the program is compiled, at a closed list of every exact division the language owns, in every spelling of its call and wherever its text stands; a name is never read and nothing is folded; `/` and the `Integral` members are checked by the type they run at, never at a type variable; `Float` is not checked; the report replaces the fault for a written zero only, names the rewrite, and carries one note and no fix (#1545) | §12 |

## 11. Edit notes to existing specs

- **Operators §14.3a:** CLOSED — Euclidean adopted; delete the "reopened" block, point here.
- **Operators §6.1:** "(floored, `DivideByZeroFault` on zero divisor)" → "(Euclidean — see Division & Remainder spec; `DivideByZeroFault` on zero divisor)"; extend the `intA / intB` diagnostic hint per §7 here.
- **Operators §13 (`%` row):** "…`Int.mod` (floored) is the way" → "…`Int.mod` (Euclidean) and `Int.rem` (truncated) are the way — two conventions, two names."
- **Primitive Types §2 (Division paragraph):** "deliberately chosen (floored) semantics" → "deliberately chosen **Euclidean** semantics"; add the `Int.quot`/`Int.rem` pair to the sentence.
- **Exceptions spec (registry):** `DivideByZeroFault` throwers now: `Int.div`, `Int.mod`, `Int.quot`, `Int.rem`, the four `BigInt` counterparts, the four `Nat` counterparts *(added with the second landing, #344 — their messages name `Nat`)*, `Rat.divide`, and the Rat construction boundary reached by `Rat.create` and reciprocal.
- **hexagon-for-typescript-coders Ch. 3.4:** optional one-liner when next touched: "`Int.mod` is always non-negative (unlike JS's `%`); `Int.rem` is JS's `%` under an honest name."

## 12. A divisor written as a literal zero

> **A checked division whose divisor is written as a literal zero is refused when the program is compiled.** The checked divisions are a closed list (§12.2), and every other zero divisor of an exact division faults when the division runs.

A division by zero has no value, and where the divisor is a literal zero the program's text already says so. The compiler reports it there, as an error, and the program does not compile. The check is the compiler's own arithmetic: one comparison of a literal with zero, made once the types are solved. It runs no library code (Regex §11), adds nothing to inference, changes no type, and changes nothing the compiler emits. The run-time guards stay the general rule (§3, §4; `dec.md` §6; `rat.md` §3, §4), and this report is their earliest form, for the one divisor whose zero the compiler can read without running anything (Friendly Numerics, tenet 6).

### 12.1 A written zero

A **written zero** is a numeric literal whose value is zero, in any spelling Lexer §5 admits (`0`, `0n`, `0x0`, `0.0`, `0d`, `0.00d`), alone or under any signs, parentheses and written types: `-0`, `(0)`, `(0: BigInt)`. Its value is the one it has at the type of the seat it stands at, so an unsuffixed decimal literal is a written zero at a `Rat` or `Dec` seat, where it is promoted (Numeric Literals §3, §5.1).

Nothing else is a written zero. A name is never read: after `let zero = 0`, `1 // zero` compiles and faults when it runs, and that is how a program, a test among them, meets the fault on purpose, as Regex §8 has it for a pattern. Nothing is computed: `1 // (2 - 2)` and `r / (0 // 5)` fault when they run, though their divisors are zero every time. A fraction written with `//` is built, not a literal (Operators §6.4).

### 12.2 The checked seats

The check reads the divisor of every exact division the language owns, and nothing else. These are the **checked divisions**, and the list is closed:

| Division | The divisor it reads |
|---|---|
| `top // bottom` (Operators §6.4) | `bottom` |
| `Rat.create(top, bottom)` (`rat.md` §3) | `bottom` |
| `a / b`, where the division runs at `Rat` (§12.3; Operators §6.1) | `b` |
| `div`, `mod`, `quot` and `rem`, where they run at `Nat`, `Int` or `BigInt` (§3, §4; Integral spec §2) | the second parameter |
| `Dec.divide` and `Dec.divideEven` (`dec.md` §6) | the second parameter |

Each is read in every spelling of its call: qualified through its companion, an alias of the companion, or its constraint (`Int.div(7, 0)`, `Integral.div(7, 0)`, `Rat.divide(r, 0)`, `Frac.divide(r, 0)`); by the dot (`7.div(0)`, `r.divide(0)`, `d.divide(0d, 2)`); and as a stage of `|>` (`7 |> Int.mod(0)`). Every spelling calls the one operation (Operators §6.1, Method Syntax §1), and `a / b` at `Rat` is `Frac.divide` at `Rat` written as an operator. A function value is never read: after `let g = Int.div`, `g(7, 0)` is a call of `g`, whose divisor the text does not name, and it faults when it runs, as a function value of `Regex.compile` is compiled where it is evaluated (Regex §8).

These are never checked:

- **`Float`'s division and remainders.** A zero divisor at `Float` is an IEEE answer, not a fault (§5.1): `1.0 / 0.0` and `let r: Float = 1 / 0` answer `Infinity`, and `Float.mod(1.0, 0.0)` and `Float.rem(1.0, 0.0)` answer `NaN`.
- **`Rat.reciprocal` and `Rat.pow`.** Their zero bottom comes from an operand, not from a divisor the text writes, so `Rat.reciprocal(0)`, `Rat.pow(0, -1)` and `0 ** -1` at `Rat` fault when they run (`rat.md` §4).
- **Every other function**, in the standard library or in a program, however it divides. No declaration makes a seat checked. The list changes only by an amendment of this section, as when a new exact numeric type brings a division of its own.

### 12.3 The type a division runs at

`a / b` is checked where it runs at `Rat`, and a call of an `Integral` member where it runs at `Nat`, `Int` or `BigInt`; at `Float` a zero divisor is an answer, not a fault. So whether such a division is checked depends on the type it runs at. That is the type the checker solved for it, whether the program wrote it or inference gave it: `let r: Rat = 1 / 0` is refused, and so is `x / 0` where `x` was bound above to `3 // 4`. The type tells the check only that the division is exact. It chooses no interpretation: the program means the same with the check or without it, and the division it refuses faults every time it is reached.

A division at a type variable is never checked, whatever types its callers bring. After `let f = x => x / 0`, `f(1.0)` answers `Infinity` and `f(1 // 2)` faults when it runs: the division runs at `Float` for one caller and at `Rat` for another, and each answers as its type does. The check reads each division once, as it is written, and never a copy of it that a compiler makes for a caller's type. A call of an `Integral` member at a type variable, or at an instance a program declares, is not checked either.

### 12.4 Where it reaches

The report is an error, since Hexagon has no warning tier (Declarations Preamble §1.1). It is made at every checked seat wherever its text stands: in a function nobody calls, in a branch no run takes, and inside a `try` whose `catch` would take the fault. A division by a written zero is wrong text wherever it stands, as a bad pattern is (Regex §8). The dividend is not read: `0 // 0` and `x / 0` are refused as `1 // 0` is. The installed compiler, the language server and the playground refuse the same divisions, since the check is the checker's own.

The report takes the fault's place only for a written zero at a checked division. `DivideByZeroFault` does not change: who throws it, the message it carries, and the guards that throw it stay as §3, §4, §7, `dec.md` §6 and `rat.md` §3 and §4 have them, for every zero divisor this section does not refuse.

A fraction pattern with a zero bottom is a different judgment, on the other side of `=>`: `n // 0 =>` is a dead case, refused as unreachable (Pattern Matching §7.2). This section reads a fraction written as a value.

### 12.5 The report

The report is a phrase (Declarations Preamble §1.3) that states the fact and the rewrite, quoting the division as it is written, and it stands on the written zero. It carries one note, which says why the error is the compiler's. It carries no fix, since no edit of a zero divisor is right for every program: the programmer writes the divisor that was meant. It names no other route to the fault, since a message that defers names no fix (Regex §11).

| Situation | Message and note |
|---|---|
| A fraction's bottom written as a literal zero: `top // 0`, and `Rat.create(top, 0)` in any spelling | "a fraction's bottom is never zero, so `1 // 0` has no value; write the bottom that was meant", with the note "a fraction's bottom written as a literal is checked when the program is compiled" |
| Any other checked divisor written as a literal zero: `a / 0` at `Rat`; `div`, `mod`, `quot` or `rem` at `Nat`, `Int` or `BigInt`; `Dec.divide` or `Dec.divideEven`; in any spelling | "division by zero: `Int.mod(7, 0)` has no value; write the divisor that was meant", with the note "a divisor written as a literal is checked when the program is compiled" |

§9 carries the acceptance lines.
