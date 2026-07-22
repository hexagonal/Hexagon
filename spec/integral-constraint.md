# Hexagon Spec: The `Integral` Constraint

**Status:** Decided (July 2026); compiler dictionaries and primitive instances implemented. Amended by James's decisions that `Rat` is required for v1 and uses `BigInt` representation.
**Scope:** The `Integral` prelude constraint (polymorphic Euclidean division API + `gcd`), its `Nat`/`Int`/`BigInt` instances, `gcd` semantics, `BigInt.lcm`, emission, and the reconciliation with the Division & Remainder spec's monomorphic functions.
**Not in scope:** `Rat` itself (a separate focused v1 spec — this constraint is its enabling machinery, and §9's generic-normalization test is its down payment); the semantics of the four division functions (Division & Remainder spec is authoritative; this doc adds no convention, only a polymorphic surface).
**Companions:** Division & Remainder spec (conventions, zero-divisor policy — edit note §10), Constraints spec (§7 prelude listing — edit note), Numeric Literals spec (`Num`/`fromNat`; signed normalization is a separate obligation).

---

## 1. Doctrine

> **`Integral` is the polymorphic face of integer division.** The monomorphic functions (`Int.div`, `BigInt.mod`, …) remain the primary, everyday spellings; `Integral` packages the same operations for code generic over integer types. `gcd` lives here because it is *definable* only here. `Float` is never `Integral`.

The motivating v1 client is `Rat`, whose top and bottom use `BigInt` — `gcd` finds the common factor, `quot` divides it out, `Num` supplies `0`/`1`, while the concrete BigInt implementation uses `Signed` and `Ord` for sign normalization. That client needs the *family*, which is why this is one constraint and not a `Gcd` micro-constraint.

## 2. Declaration

```
constraint Integral<a: (Num, Ord)> =
    div(x: a, y: a): a       -- Euclidean quotient
    mod(x: a, y: a): a       -- Euclidean remainder, in [0, abs(y))
    quot(x: a, y: a): a      -- truncated quotient
    rem(x: a, y: a): a       -- truncated remainder
    gcd(x: a, y: a): a       -- greatest common divisor, always >= 0
```

- **Superconstraints `(Num, Ord)`**: `Num` gives generic code non-negative literals via `fromNat`, and `Ord` gives comparisons. `Nat`, `Int`, and `BigInt` satisfy both. Code that also subtracts, negates, or normalizes signs states `Signed` separately; `Integral` itself does not require signedness.
- The five members obey the Division & Remainder spec's contracts *as laws of the constraint*: the two division identities, the Euclidean invariant, and §4's `gcd` laws. An `honor Integral<T>` whose members violate them is wrong in the same informal-but-documented sense as a lawless `Eq`.
- Zero-divisor behaviour is **not** a law of the constraint; it follows each instance's type doctrine. All three v1.1 instances throw `DivideByZeroError` (integer partiality throws), and any future instance is expected to do likewise — recorded as expectation, not equation.

## 3. Instances

```
honor Integral<Nat>    -- same safe-number operations, restricted to non-negative inputs
honor Integral<Int>    -- members are Int.div, Int.mod, Int.quot, Int.rem, Int.gcd
honor Integral<BigInt> -- members are the BigInt counterparts
```

- The instance bodies **are** the monomorphic functions — one implementation, two spellings. `Int.gcd` and `BigInt.gcd` are hereby added to the monomorphic families as the fifth member each.
- **`Float` is permanently not `Integral`**, and `gcd` is a member here precisely so that `gcd(1.5, 2.0)` fails with the exactly-right message: "`Float` is not `Integral`." This is also why `gcd` must not hang off the broader `Num` constraint.

## 4. `gcd` semantics

For all instances (laws, testable):

```
gcd(a, b) == gcd(b, a) == gcd(abs(a), abs(b))    -- sign-insensitive
gcd(a, b) >= 0                                    -- always non-negative
gcd(a, 0) == abs(a)                               -- hence:
gcd(0, 0) == 0
```

- `gcd(a, 0) = abs(a)` / `gcd(0,0) = 0` is the universal modern convention (it makes `gcd` the join of the divisibility lattice) and is **load-bearing for Rat**: normalizing `0/n` divides both parts by `gcd(0, n) = n`, yielding the canonical `0/1` with no special case.
- `gcd` never throws: the Euclidean algorithm's `mod` calls never see a zero divisor (that is the loop's termination condition), and the zero-argument cases are defined above.
- The Euclidean synergy, for the record: with `mod` in `[0, |b|)`, `gcd(a, b) = gcd(b, mod(a, b))` is sign-clean after one step — the base case's `abs` is the only sign logic in the algorithm. This is a payoff of the Euclidean convention, not an extra decision.

## 5. `lcm`: not a member; `BigInt.lcm` only (decided)

- **`lcm` is not in `Integral`**, and **`Int.lcm` does not exist.** Under the silent-overflow policy (Primitive Types §2.1), `lcm` is the arithmetic function whose *ordinary* inputs overflow: two coprime operands near 10^8 — unremarkable values — silently exceed 2^53 in the product. A function whose common case is a silent wrong answer should not exist at `Int`; a doc warning on a footgun is worse than absence.
- **`BigInt.lcm(a, b): BigInt`** is provided, monomorphic, defined as:

```
lcm(a, 0) == lcm(0, b) == 0
lcm(a, b) == abs(quot(a, gcd(a, b)) * b)     -- divide FIRST, then multiply
```

  Divide-first is exact (gcd divides `a`) and, though BigInt cannot overflow, keeps the intermediate small — cheaper and the correct form to document, since it is the form anyone porting to a fixed-width type must copy.
- If a genuine polymorphic-`lcm` client ever appears, the non-breaking path is a `constraint Lcm<a: Integral>` with the `BigInt` instance only — recorded as the door, not built.

## 6. Emission

Nothing new; the standard constraint story applies:

- **Concrete call sites** (the overwhelming majority): the dictionary is statically known, so `gcd(x, y)` at `Int` emits a **direct call** to the instance function — `Int.gcd(x, y)` in the established scheme. This is the "compiles into gcdInt / gcdBigInt" behaviour, and it is table-lookup coherence, not specialization machinery.
- **Polymorphic call sites** (inside generic `Rat` functions): ordinary dictionary passing — `dict.gcd(x, y)`.
- The `gcd` helper bodies are iterative, not recursive (readable-JS; no stack concerns):

```js
// Int instance (shape)
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b !== 0) { const t = a % b; a = b; b = t; }
  return a;
}
```

  Note the helper may use **bare native `%`** internally: after the leading `abs`es both operands are non-negative, where every convention agrees. The Euclidean-vs-truncated distinction matters to `gcd`'s *specification* (§4's laws in terms of `mod`), not to this implementation. BigInt body identical with `0n` and a manual abs.

## 7. Reconciliation with the Division & Remainder spec

That spec's §3 says the four functions are "monomorphic `Int` functions, not constraint members." **Softened, not reversed:** they remain the primary spellings and the recommended form in all concrete code; this spec adds that they also serve as the `Integral` instance bodies, giving generic code a door. The two-tier pattern — monomorphic module functions doubling as instance members — is now precedented for any future case (edit note §10). Everyday code keeps writing `Int.mod`; only `<a: Integral>` signatures touch the constraint.

## 8. Diagnostics

| Situation | Message (shape) |
|---|---|
| `gcd`/`div`/`mod`/`quot`/`rem` at `Float` | ordinary missing-instance error: "`Float` is not `Integral`"; for `gcd` add "gcd is defined for integer types (`Nat`, `Int`, `BigInt`)" — never suggest rounding |
| Name `Int.lcm` not found | curated hint: "`Int` has no `lcm` — its results overflow `Int`'s safe range for ordinary inputs; use `BigInt.lcm`" (name-not-found hints are cheap; this one prevents a hand-rolled `a * b / gcd` with the overflow bug) |
| Unsolved tyvar at a bare `gcd(x, y)` call with no other constraint source | standard ambiguity error per Numeric Literals §6 machinery; `Num` superconstraint defaulting resolves the literal-only case to `Int` as usual |

## 9. Acceptance tests

```
-- gcd laws across signs (Int and BigInt agree)
Int.gcd(12, 18)     -- 6
Int.gcd(-4, 6)      -- 2
Int.gcd(-4, -6)     -- 2
Int.gcd(7, 0)       -- 7
Int.gcd(-7, 0)      -- 7
Int.gcd(0, 0)       -- 0

-- Polymorphic use: the Rat down payment
fun normalize<a: Integral>(n: a, d: a): (a, a) =
    let g = gcd(n, d)
    if g == 0 then (0, 1)                    -- 0/0 input; literals via Num super
    else
        let (n2, d2) = (quot(n, g), quot(d, g))
        if d2 < 0 then (negate(n2), negate(d2)) else (n2, d2)   -- Ord super at work
-- normalize : <a: Integral>(a, a) -> (a, a)
-- concrete sites emit direct calls: normalize(4, -6) uses Int.gcd/Int.quot → (-2, 3)
-- normalize(4n, -6n) uses the BigInt instance → (-2n, 3n)

-- Float excluded, with the right words
gcd(1.5, 2.0)       -- ERROR: `Float` is not `Integral`

-- lcm at BigInt only
BigInt.lcm(4n, 6n)  -- 12n
BigInt.lcm(0n, 5n)  -- 0n
Int.lcm             -- ERROR: name not found + curated hint (§8)
```

## 10. Decisions log & edit notes

| Decision | Where |
|---|---|
| `Integral<a: (Num, Ord)>` prelude constraint: `div`/`mod`/`quot`/`rem`/`gcd` | §2 |
| Instances `Nat`, `Int`, `BigInt`; `Float` permanently excluded | §3 |
| `gcd` non-negative; `gcd(a,0)=abs(a)`; `gcd(0,0)=0`; never throws | §4 |
| `Int.gcd`/`BigInt.gcd` added to the monomorphic families | §3 |
| `lcm` not in the constraint; `Int.lcm` does not exist; `BigInt.lcm` monomorphic, divide-first, `lcm(a,0)=0` | §5 |
| Monomorphic functions double as instance bodies (two-tier pattern, now precedented) | §7 |
| `gcd` helpers may use native `%` internally post-`abs` | §6 |

Edit notes:
- **Constraints spec §7 (prelude listing):** add `Integral<a: (Num, Ord)>` with the five members; instances `Nat`, `Int`, `BigInt`.
- **Division & Remainder spec §3:** "monomorphic `Int` functions, not constraint members" → append "…in their primary spelling; they additionally serve as the `Integral` instance bodies (Integral spec §7)." Add `gcd` to the family listing there or cross-reference §3–4 here.
- **Exceptions spec:** no registry change — `Integral` members throw through their instance bodies, already registered; `gcd`/`lcm` never throw.
- **Rat (required v1 spec):** cite §9's `normalize` as the intended shape; `Rat` fixes `BigInt` as its representation (the choice §5 anticipates) while the constraint keeps the principle honest.
