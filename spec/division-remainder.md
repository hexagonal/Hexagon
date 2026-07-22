# Hexagon Spec: Integer Division & Remainder

**Status:** Decided (July 2026); compiler companion operations and emitted runtime semantics implemented. Closes the reopened question in Operators §14.3a; amended to record `Rat` as a required v1 consumer.
**Scope:** The division/remainder function families on `Int`, `BigInt`, and `Float`: names, conventions, zero-divisor behaviour, emission, diagnostics.
**Not in scope:** The `Frac` constraint and `/` (Operators §6.1, unchanged); the rejection of a `%` operator (Operators §13, unchanged — this doc supplies the semantics that rejection deferred to names); `Num`/`Signed` literal machinery (Numeric Literals spec); checked-overflow variants (Primitive Types §2.1).
**Companions:** Operators & Precedence spec (§6.1, §13, §14.3a — edit notes §8 here), Primitive Types spec (§2 — edit note), Integral Constraint spec (generic family and v1 `Rat` normalization), Exceptions spec (registry addition), `hexagon-for-typescript-coders` Ch. 3.4 (needs no change; it never named the convention).

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

- **All four throw `DivideByZeroError` on `b == 0`.** JS's `a % 0` is `NaN`, which would silently break the Int-is-a-whole-JS-number invariant; the truncated pair gets no IEEE exemption just because its convention matches JS — the *type* is `Int`, and `Int` partiality throws (same doctrine as `Int.div` always had, and as `IndexError`).
- `quot`/`rem` satisfy their own identity (`quot(a,b) * b + rem(a,b) == a`) with `abs(rem(a,b)) < abs(b)` and `rem` taking the dividend's sign. Names per the Haskell (`quot`/`rem` vs `div`/`mod`) and Rust lineage.
- **Why `quot`/`rem` exist at all:** interop and porting. `Int.rem(a, b)` is bit-for-bit JS's `a % b` (for valid `Int` inputs), so code transliterated from JS/TS — or any C-family source — can keep its remainder semantics under a name that *says* it's the machine convention. The docs for `rem` state "this is JS's `%`" in those words.
- All four are monomorphic `Int` functions, not constraint members — same status as `Int.div` always had (`Int` is `Signed` but not `Frac`; Operators §6.1).

## 4. `BigInt` mirrors `Int`

`BigInt.div` / `BigInt.mod` / `BigInt.quot` / `BigInt.rem`, same conventions, same identities, same `DivideByZeroError` on a zero divisor.

One implementation wrinkle, binding: **native JS BigInt `/` and `%` already throw on `0n`** — but a `RangeError`, not a branded Hexagon exception. The runtime helpers must produce `DivideByZeroError` (the standard `$hex: true` + `name` branding, Exceptions spec) — by pre-checking `b === 0n`, not by catch-and-rebrand (a `try`/`catch` around every remainder is worse readable-JS than one comparison). The observable rule is uniform: **a zero divisor at any integer type throws `DivideByZeroError`, never a raw JS error, never `NaN`.**

Note JS BigInt's native `%` is truncated, same as `number`'s — so `BigInt.rem` enjoys the same near-bare emission as `Int.rem` (§6).

## 5. The `Float` family

```
Float.mod(a: Float, b: Float): Float   -- Euclidean remainder
Float.rem(a: Float, b: Float): Float   -- truncated remainder (JS's `%` on floats; C's fmod)
```

### 5.1 Semantics

- **No throw, ever.** Zero divisor and non-finite operands follow IEEE 754 and yield `NaN`, exactly as `Float` division does (Primitive Types: "float division follows IEEE 754"). The throw/`NaN` split between the `Int` and `Float` families is not an inconsistency — it is the *same* split the language already has between `Int.div` (throws) and float `/` (doesn't). Integer partiality throws; float partiality is `NaN`.
- `Float.rem` is IEEE-exact: `fmod` introduces **no rounding error** (the true remainder of two doubles is always representable). Worth stating in user docs; it surprises people.
- `Float.mod` is `rem` adjusted into `[0, abs(b)]`: `r = a % b; r < 0 ? r + abs(b) : r`. The adjustment addition can round: when `r` is a tiny negative and `abs(b)` is large, `r + abs(b)` may round **up to `abs(b)` itself**, so the honest invariant at `Float` is `0 <= result <= abs(b)`, with the upper boundary reachable only via rounding. Rust's `rem_euclid` has the identical documented edge (e.g. `(-1e-300).rem_euclid(3.0)` can yield `3.0`); Hexagon documents rather than "fixes" it — any fix breaks exactness elsewhere.
- The primary use cases are why `Float.mod` earns its place: angle wrapping (`theta |> Float.mod(tau)`), phase accumulators, hue rotation — all want the non-negative residue, and JS's `%` returning a negative for a negative angle is a classic graphics bug this function deletes.

### 5.2 Precedent at `Float`

Rust is the direct model: `%` on `f64` is truncated, `f64::rem_euclid` is Euclidean — Hexagon's split, at float type, shipped and stable. Haskell declines the question (`div`/`mod`/`quot`/`rem` are `Integral`-only; `Data.Fixed.mod'` is a floored library afterthought). Lean 4 core gives `Float` no modulo at all. So the field is: provide-both (Rust) or provide-nothing (Haskell, Lean); nobody provides a *different* convention, and "Euclidean if provided" is uncontradicted.

### 5.3 No `Float.quot`, no Euclidean float division (decided)

The quotient halves exist at `Int`/`BigInt` because those types have no `/` — the pair jointly defines division. `Float` has true `/`; the quotient side is a trivial composition (`Float.trunc(a / b)`, `Float.floor(a / b)`), the division identity holds only up to rounding at float type so there is no exact pair-contract to honor, and Rust's `f64::div_euclid` is the half nobody calls. Omitting them keeps §1's doctrine sentence load-bearing: pairs where they define division, standalone remainders where division already exists.

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

## 7. Diagnostics

| Situation | Message (shape) |
|---|---|
| `intA / intB` (existing, Operators §6.1) | unchanged, but the hint now reads: "`Int` has no `/`; use `Int.div`/`Int.mod` (Euclidean), or `Int.quot`/`Int.rem` for JS's truncating `%` semantics" |
| Zero divisor at runtime, any integer function | `DivideByZeroError`; message names the function that threw (`Int.rem: divisor is zero`), per the provenance-tagged phrasing rule |

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

-- Zero divisors: all four throw, branded
Int.mod(1, 0)    -- throws DivideByZeroError
Int.rem(1, 0)    -- throws DivideByZeroError (NOT NaN; not JS behaviour)
BigInt.rem(1n, 0n) -- throws DivideByZeroError (NOT RangeError; §4)

-- Float: IEEE, no throws
Float.rem(-7.0, 3.0)   -- -1.0   (bare JS %)
Float.mod(-7.0, 3.0)   -- 2.0
Float.mod(-0.5, 6.283185307179586)  -- ~5.783185307179586 (angle wrap, non-negative)
Float.mod(1.0, 0.0)    -- NaN
Float.rem(1.0, 0.0)    -- NaN

-- The doctrine, exercised
isEven = n => Int.mod(n, 2) == 0    -- correct for negative n; with rem it wouldn't be
```

## 10. Decisions log

| Decision | Where |
|---|---|
| `mod`/`div` are Euclidean at every type that has them; closes Operators §14.3a | §1–2 |
| `quot`/`rem` (truncated) provided at `Int`/`BigInt` for JS/C-family interop; naming per Haskell/Rust, `jsMod` rejected | §3, §8 |
| All integer-type division/remainder functions throw `DivideByZeroError` on zero; BigInt pre-checks rather than rebranding `RangeError` | §3–4 |
| `Float.mod` (Euclidean) and `Float.rem` (truncated, bare `%`) provided; NaN on zero divisor; no throw | §5 |
| No `Float.quot`, no Euclidean float division | §5.3 |
| `Float.mod` invariant is `0 <= r <= abs(b)` (boundary via rounding only); `Float.rem` is IEEE-exact | §5.1 |
| Emission via named runtime helpers; inlining is QoI latitude | §6 |

## 11. Edit notes to existing specs

- **Operators §14.3a:** CLOSED — Euclidean adopted; delete the "reopened" block, point here.
- **Operators §6.1:** "(floored, `DivideByZeroError` on zero divisor)" → "(Euclidean — see Division & Remainder spec; `DivideByZeroError` on zero divisor)"; extend the `intA / intB` diagnostic hint per §7 here.
- **Operators §13 (`%` row):** "…`Int.mod` (floored) is the way" → "…`Int.mod` (Euclidean) and `Int.rem` (truncated) are the way — two conventions, two names."
- **Primitive Types §2 (Division paragraph):** "deliberately chosen (floored) semantics" → "deliberately chosen **Euclidean** semantics"; add the `Int.quot`/`Int.rem` pair to the sentence.
- **Exceptions spec (registry):** `DivideByZeroError` throwers now: `Int.div`, `Int.mod`, `Int.quot`, `Int.rem`, the four `BigInt` counterparts, and the Rat construction boundary reached by `Rat.create`, division, and reciprocal.
- **hexagon-for-typescript-coders Ch. 3.4:** optional one-liner when next touched: "`Int.mod` is always non-negative (unlike JS's `%`); `Int.rem` is JS's `%` under an honest name."
