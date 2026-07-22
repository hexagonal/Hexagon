# Hexagon Spec: Pattern Matching

**Status:** Decided (July 2026).
**Scope:** The full pattern grammar — nested constructor patterns, tuple and record patterns, record punning, literal patterns, or-patterns, as-patterns, and (by reference) vector patterns; guards as arm syntax; the irrefutability judgment; the five pattern positions (`match` arms, `catch` arms, `let`, `for..in`, lambda parameters) and the generalized `match` scrutinee; exhaustiveness and reachability over the full grammar; emission. Rider decision: record **construction** punning (`{x}` ≡ `{x: x}` in value position) ships in v1 (§9).
**Not in scope:** the vector pattern's forms, typing, length-based exhaustiveness, irrefutability, rest spelling, and emission (Collections Part 3 §3 — the form joins this grammar, §2/§11.1; that spec owns its algorithm), range patterns (deferred, §11.2), active/view patterns (not planned, §10), the `match` keyword's precedence slot (Operators §3.2 already seats it among the eats-right forms), `Exn` matching (permanently excluded; Exceptions §3 is authoritative), string representation details behind `Eq<String>` (Primitive Types §5).
**Companions:** Unions (flat constructor patterns as this grammar's degenerate case; exhaustiveness doctrine; `match` emission baseline), Products (flat `let`-destructuring as degenerate case; record openness vocabulary; tuple emission), Exceptions (catch arms; open-sum reachability model), Statements/Blocks/Mutability §5/§5.4 (binder class is positional; `let`-pattern binders sequential), Collections Part 3 §3 (vector patterns), Collections Part 4 §7.2 (`for (k, v) in map` iteration), Operators (Eq/Ord elaboration for literals; chained comparisons in guards; `match` eats right), Decisions Batch 2026-07 (`Eq<Float>` SameValueZero — the reason Float literals are banned from patterns), Declarations Preamble §1.1 (the Rewrite Rule, which this doc's diagnostics obey).

---

## 1. Doctrine

- **One grammar, five positions, one gate.** There is a single pattern grammar. It is legal in full at the two refutable positions (`match` arms, `catch` arms) and gated by **irrefutability** (§5) at the three binding positions (`let`, `for..in`, lambda parameters). There are no per-position dialects and no per-position form exclusions. The uniform-rule decision (reversing an earlier "transparency rule" proposal — §10) is deliberate and closed.
- **The flat forms already shipped are this grammar's degenerate case** — exactly as Unions §4.2 and Products §2.4 contracted. Nothing about them changes; they simply stop being the ceiling.
- **Guards are arm syntax, not pattern syntax** (§3). A pattern is a static shape; a guard is a runtime test. Keeping them in separate grammatical strata is what keeps or-patterns, the same-bindings rule, and exhaustiveness simple.
- **Exhaustiveness and reachability remain hard errors and remain exact** over the decidable fragment (§7). Guarded arms contribute nothing to coverage. Infinite domains require a catch-all. This is the Unions §4.3 doctrine, generalized, not renegotiated.
- **Binder class is positional, never determined by pattern syntax** (Statements §5, the proper-subterm criterion): `match`-arm, `catch`-arm, lambda-parameter, and loop-pattern binders are **head binders** and shadow freely; every name a **`let` pattern** binds is a **sequential binder** (Statements §5.4) and may not reuse a name in scope. The same record pattern `{name}` is a head binder in an arm and a sequential binder on a `let` LHS. No pattern form creates a third class. **Duplicates within one simultaneous pattern are errors regardless of class.**
- **Emission stays readable**: cascades of `if`/`else if` on tags and fields, `switch` where a single tag discriminates, `const` binders from named fields, guards appended with `&&`. No decision-tree compilation that a TS author couldn't have written by hand.

---

## 2. The pattern grammar

The complete v1 inventory:

```
_                        -- wildcard: matches anything, binds nothing
x                        -- variable: matches anything, binds x
C(p1, ..., pn)           -- constructor pattern, sub-patterns nest freely
C                        -- nullary constructor
(p1, ..., pn)            -- tuple pattern, arity ≥ 2; (p) is grouping
{f1: p1, f2, ...}        -- record pattern: open; {f} puns as {f: f}
0   "yes"   true         -- literal patterns: Int, String, Bool only
p1 | p2                  -- or-pattern
p as x                   -- as-pattern: match p, additionally bind the whole to x
()                       -- the Unit pattern (trivially irrefutable)
[p1, ..., pn]  [ps, ...rest]  -- vector patterns (Collections Part 3 §3 owns forms,
                              --   typing, exhaustiveness, irrefutability, emission)
```

Grammar, loosest to tightest: `as` binds looser than `|`; both bind looser than the structural forms. So `Circle(r) | Square(r) as s` is `(Circle(r) | Square(r)) as s`. Parenthesize to override.

### 2.1 Wildcard and variable

Unchanged from Unions §4.2 / Products §2.4: `_` binds nothing and may repeat; a non-uppercase-start name binds the matched value. **Duplicate binders anywhere within one whole pattern are a hard error** — `Rect(w, w)`, `{x: a, y: a}`, `(p, q) as p` — same message family as before ("`w` is bound twice in this pattern"). The check is over the entire pattern including `as` binders and through nesting; or-pattern alternatives are checked per-alternative (each alternative is a separate binding universe, then reconciled by §2.6's same-bindings rule).

An uppercase-start name in any pattern position is a constructor reference, never a binder (the case rule). The v1 "nested patterns arrive with pattern matching" parse error is hereby retired: they have arrived.

### 2.2 Constructor patterns — now nested

```
Node(Leaf, x, Node(l, y, r))     -- nesting to any depth
Some(Some(n))
Envelope(Header(id) as h, body)
```

- **Positional, always** (Unions §4.2 stands). Slot names never appear in constructor patterns in v1; the record pattern is where names live. Arity must equal constructor arity — same errors and hints as before (`Circle =>` gets the "`Circle` carries 1 field; write `Circle(_)`" hint; `Point()` gets the nullary-parens hint).
- Sub-patterns are full patterns: literals, or-patterns, further constructors, records, tuples, `as` — anything.
- Constructor patterns apply to `union` constructors, prelude exceptions in catch arms (`JsError(e)` — Exceptions §5.2), and **nominal `record` constructors**: `Point(pat)` is legal and destructures through the nominal wall, where `pat` matches the underlying record value — the pattern-side dual of the constructor term. In practice `Point({x, y})` is the useful spelling. (This is the explicit-crossing doctrine of Products §5.3, mirrored: the constructor is the way in; the constructor *pattern* is the way out. `{...p}` remains the expression-side exit; nothing implicit is added.)

### 2.3 Tuple patterns

```
(Some(x), None)                  -- nested
(a, _, (b, c))                   -- nesting includes tuples in tuples
```

Arity must equal the tuple's arity (Products §2.1 report shape). `(p)` is **grouping**, exactly as in expressions — there are no 1-tuples, so no ambiguity. `()` is the Unit pattern.

### 2.4 Record patterns — open, with punning

```
{name, age}                      -- pun: {name: name, age: age}
{name: n}                        -- rename: field name, binder n
{port: 0}                        -- literal sub-pattern
{mode: Verbose, port: p}         -- constructor sub-pattern + pun
{customer: {name}, total}        -- nested, punned at two depths
```

- **`{f: p}` — the field slot holds a full sub-pattern.** When the sub-pattern is a bare non-uppercase-start name equal to the field name, the `: name` may be dropped: **`{f}` ≡ `{f: f}`.** That's the entire punning rule.
- **Open by default, always, with no opt-out syntax.** A record pattern mentions any subset of the scrutinee's fields; unmentioned fields are neither bound nor constrained. There is no `...` in patterns and no closed-record pattern form in v1. This deliberately points the opposite way from *type annotations* (closed by default, Products §4): a pattern destructures a known-typed value; an annotation constrains an unknown one. The asymmetry is principled and must be documented, not smoothed over.
- Duplicate field names in one record pattern: error. A field the scrutinee's type lacks: the standard missing-field error naming the known fields (Products §3.2 family).
- Record patterns work on structural records and — through row polymorphism — on unannotated parameters, constraining them exactly as field access does (`fun getX({x}) = x` infers the row-polymorphic type; see §6.5).
- Nominal records: a bare record pattern does **not** match a nominal-record-typed scrutinee (the unifier never unfolds nominal names — Products §5.1). Go through the constructor pattern: `Point({x, y})`. Diagnostic: "`Point` is a nominal record; destructure it with `Point({x, y})`."
- Type-position confusion guard: `{x: Float}` in pattern position reads `Float` as a constructor sub-pattern. Since `Float` is a type, not a constructor, this errors as "`Float` is a type, not a constructor — patterns destructure values; did you mean a type annotation elsewhere?"

### 2.5 Literal patterns — `Int`, `String`, `Bool`; never `Float`

```
match n
  0 => "zero"
  1 => "one"
  _ => "many"

match answer
  true => proceed()
  false => abort()               -- exhaustive: no _ required (§7.1)
```

- A literal pattern elaborates through **`Eq`** exactly as `==` does (Operators §5.1): the arm test is `equals(scrutinee, lit)`, emitting `===` on the primitive fast path — which is every v1 case, since the allowed types are `Int`, `String`, `Bool`.
- **Typing joins ordinary inference.** An integer literal in a pattern contributes the same `Num` (via `fromNat`) and `Eq` constraints that `x == 0` would, and unifies with the scrutinee type; defaulting applies as usual. In v1 the scrutinee is concrete by the time patterns check, so this is invisible — but the spec fixes the mechanism so a future polymorphic scrutinee doesn't force an improvised rule. Literal patterns do not force early monomorphization beyond what the constraints imply.
- **`Float` literal patterns are a permanent hard error**, not a deferral. `Eq<Float>` is SameValueZero (Decisions Batch §1): `NaN` would never match its own literal, and `-0.0`/`0.0` would collapse — a pattern that *reads* exact and isn't. The diagnostic must redirect: "Float literals cannot appear in patterns; use a guard: `x when x == 1.5`" — where the SameValueZero semantics is at least attached to a visible `==`. Matching *on* a `Float` scrutinee is fine (variables, `_`, guards); only the literal form is banned.
- There is no `Char` type in Hexagon; single-character strings are `String` literals like any other.
- Negative integer literals: `-3` is legal as a literal pattern (the lexer/parser treats the sign as part of the literal in pattern position — patterns contain no operators, so there is no unary-minus expression to collide with).

### 2.6 Or-patterns `p | q`

```
Circle(_) | Rect(_, _) => "has area"
0 | 1 => "small"
{status: Pending} | {status: Queued} => wait()
```

- Alternatives are tried left to right; first match wins (observable only through binding, since patterns are pure — guards live outside, §3).
- **Same-bindings rule (F#):** every alternative must bind exactly the same set of names, each at unifiable types. Violation is a hard error naming the offender: "`x` is bound on the left of `|` but not the right." The common case binds nothing.
- `|` in pattern position is unambiguous: arms are layout-separated, union declarations are a different context, and there is no expression-position `|` in the language at all.
- Or-patterns nest: `Some(0 | 1)` is legal.
- **Spelling is `|`, not `or`** — decided (see §10). The pattern bar deliberately echoes the union-declaration bar: `match`'s "either of these alternatives" mirrors `union`'s "any of these alternatives," one symbol for one concept. The words-only rule (Operators §1.2) does not apply: it bans duplicate spellings of *Boolean value operators*; pattern `|` evaluates nothing and combines shapes, a role `|` already owns at declaration sites.

### 2.7 As-patterns `p as x`

```
Node(Leaf, x, Leaf) as leaf => promote(leaf)
Envelope(Header(id) as h, body) => log(id, h); deliver(body)
Circle(r) as s when r > 0.0 => draw(s)
```

- Matches `p`; on success additionally binds `x` to the *whole* value matched at this position. Zero-cost: the value is already in hand; emission is one `const`.
- `as` is the **loosest** pattern operator — looser than `|` — so `A(x) | B(x) as v` binds `v` to the whole in both alternatives, automatically satisfying the same-bindings rule. Parenthesizing the other way (`A(x) | (B(x) as v)`) then *fails* same-bindings, correctly.
- **Refutability-transparent** (§5): `p as x` is irrefutable iff `p` is.
- The `as` binder participates in the whole-pattern duplicate check (§2.1).
- Keyword choice: `as`, not `@` — words-only aesthetic (Operators §1.2), F# precedent. `@` in a pattern is a lex/parse error with the fixit "Hexagon spells as-patterns with `as`".

### 2.8 What a pattern is not

Patterns contain **no operators, no calls, no expressions**. `C(...)` in pattern position is constructor syntax resolved by the case rule, never a call. There is no evaluation inside a pattern; the only runtime work a pattern performs is tag tests, field/slot reads, and `Eq` tests for literals. Anything computational belongs in a guard.

---

## 3. Guards — `pattern when expr => body`

```
match shape
  Circle(r) when 0.0 <= r < 100.0 => draw(r)
  Circle(_)                       => tooBig()
  _                               => skip()
```

- **`when` is arm syntax, not pattern syntax.** The grammar of a match/catch arm is `pattern [when expr] => body`. A guard therefore always covers the *entire* arm pattern — `A(x) | B(x) when g` guards both alternatives — and can never appear inside a nested pattern. This placement is decided; guards-in-patterns would wreck or-pattern factoring, the same-bindings check, and exhaustiveness locality, for no expressive gain.
- The guard is an ordinary `Bool` expression with the pattern's binders in scope. Chained comparisons (`0 <= x < 100`) work exactly per Operators §5.3–5.4 and are the idiomatic guard spelling for ranges — this is the interaction that makes range *patterns* unnecessary in v1 (§11.2).
- **Guard termination (grammar pin):** the guard expression is terminated by the arm's `=>` — a top-level `=>` after `when` always belongs to the arm, never to a lambda. Without this pin, `p when f => x` would maximal-munch `f => x` as an eats-right lambda (Operators §3.2) and never find the arm's arrow. A lambda operand inside a guard (bizarre, but expressible) must be parenthesized: `p when apply(f, (x => x > 0)) => body`. Same resolution as F#'s. Diagnostic: "`=>` ends the guard; parenthesize the lambda."
- **Evaluation order is normative** (guards may be effectful): arms top to bottom; a guard is evaluated only after its arm's pattern has matched, at most once per `match` evaluation; if the guard is `false`, matching falls through to the next arm as if the pattern had failed.
- **A guarded arm contributes nothing to exhaustiveness** (§7.1). The checker does not attempt to prove guards total — not even `when true`. A match whose domain is only covered by guarded arms is non-exhaustive: hard error. This bites harder than F#'s warning; that is the point and the house rule (no warning tier).
- Guards appear only where arms appear: `match` and `catch`. There are no guards on `let`, `for..in`, or lambda parameters — those positions demand irrefutability, and a guard is the maximally refutable construct.

---

## 4. Typing patterns

Pattern typing is checking-mode against the scrutinee type, structurally:

- `_`, `x`: any type; `x` binds at the scrutinee type and is monomorphic in its binding position, never generalized. Its binder class comes from that position, not from this pattern form (§1).
- `C(p...)`: the scrutinee unifies with `C`'s union (or nominal record) type at a fresh instantiation; sub-patterns check against the instantiated slot types.
- Tuples: arity check, then componentwise.
- Records: each mentioned field's sub-pattern checks against that field's type; on an unknown scrutinee type, each mentioned field *constrains* the row exactly as dot-access does (fresh hidden tail — Products §3.2). Row vocabulary stays banned from diagnostics.
- Literals: unify with the scrutinee type and contribute `Eq` (+ `Num` for integer literals) constraints (§2.5).
- `p | q`: both check against the scrutinee type; binder types unify pairwise per the same-bindings rule.
- `p as x`: `p` checks against the scrutinee type; `x` binds at it.

- Vector patterns: typing per Collections Part 3 §3.2 (checked against `Vector(t)`; rest binders at `Vector(t)`).

Binder class is positional (Statements §5): arm, lambda-parameter, and loop-pattern binders are head binders and shadow freely; `let`-pattern binders are sequential and may not reuse in-scope names (Statements §5.4). All binders within one pattern are simultaneous (whence the duplicate rule), monomorphic, never generalized.

---

## 5. Irrefutability — the gate on binding positions

This section is the spec's center of gravity; implementers and doc-writers should get it exactly right.

### 5.1 The judgment

> A pattern `p` is **irrefutable at type `T`** iff `p` matches *every* value of `T`.

Operationally: run the exhaustiveness algorithm (§7) on the single-row matrix `[p]` against `T`. Irrefutable ⇔ exhaustive. **One algorithm serves both judgments** — implement it once; do not write a second syntactic approximation that will drift.

Consequences, spelled out:

| Pattern | At type | Verdict | Why |
|---|---|---|---|
| `_`, `x` | any | irrefutable | match everything by definition |
| `(p, q)` | tuple | irrefutable iff `p`, `q` are | tuples have one shape |
| `{f: p, g}` | record | irrefutable iff sub-patterns are | records have one shape; openness only widens |
| `()` | `Unit` | irrefutable | one value |
| `p as x` | `T` | iff `p` is | `as` adds a binding, not a test |
| `Some(x)` | `Option(a)` | **refutable** | `Option` has another constructor, `None` |
| `UserId(n)` | `UserId` (union `UserId = UserId(Int)`) | **irrefutable** | sole constructor: every `UserId` value has this shape |
| `Point({x, y})` | nominal `record Point` | irrefutable | a record constructor is always "sole constructor" |
| `0` | `Int` | refutable | infinite domain |
| `true` | `Bool` | refutable | `false` exists |
| `true \| false` | `Bool` | **irrefutable** | jointly cover the domain — the coverage definition, not a syntactic one, decides |
| `Some(_) \| None` | `Option(a)` | irrefutable | ditto (binds nothing, so same-bindings is satisfied) |
| vector patterns | `Vector(a)` | per Collections Part 3 §3 | length-based; that spec's verdicts are authoritative |

### 5.2 `Some(n)` vs `UserId(n)` — the story, in full

These two patterns are **syntactically identical** — a constructor applied to a binder — and their different verdicts confuse people until they see that irrefutability is not a property of the pattern's *shape* but of the pattern *against its type*:

- `Option(a)` declares **two** constructors. A value of type `Option(Int)` might be `None`. The pattern `Some(n)` therefore *can fail*, and `let Some(n) = opt` would have to do... something... on `None`. Languages answer that with a warning plus a runtime crash (F#, Haskell). Hexagon has no warning tier and no appetite for a compiler-inserted crash: **hard error** — "this pattern can fail: a value of type `Option(Int)` may be `None`; use `match`."
- `union UserId = UserId(Int)` declares **one** constructor. Every value of type `UserId` — all of them, forever, because unions are closed and nominal with no subtyping — has the shape `UserId(n)`. The pattern cannot fail. `let UserId(n) = id` is therefore a total destructure, exactly as safe as `let (x, y) = t`, and it is the idiomatic zero-cost unwrap of a newtype:

```
union UserId = UserId(Int)

fun format(id: UserId): String =
  let UserId(n) = id
  "user-${n}"

userIds |> map(UserId(n) => "user-${n}")     -- same thing, lambda-parameter position
```

The closedness of `union` is what makes this sound: adding a second constructor to `UserId` later flips every `UserId(n)` binding-position pattern from irrefutable to refutable, and **they all become compile errors at once**, pointing at exactly the code the change broke. That is the system working, and the docs should present it as such — the error message for the flipped case should say "this pattern no longer covers `UserId`: the type now also has constructor `Anonymous`; use `match`."

Nominal `record` newtypes get the same ergonomics through the constructor pattern (`Point({x, y})`, or `Wrapped(v)`-style if the record has one field accessed positionally — no: record constructor patterns take a *record* sub-pattern, so it's `Money({amount})`). Both newtype encodings — single-constructor union and nominal record — destructure uniformly in every binding position. Neither is privileged; pick by whether you want positional (`union`) or named (`record`) payload. (An earlier proposal to ban constructor patterns from lambda heads, which would have pushed people toward record newtypes for callback ergonomics, is rejected — §10.)

### 5.3 Where the gate applies

The gate is checked at `let` (§6.3), `for..in` (§6.4), and lambda parameters (§6.5). It is **not** checked at `match`/`catch` arms — refutability is those positions' entire job. The error message is uniform across the three gated positions: "this pattern can fail: ⟨counterexample⟩; use `match`" — with the counterexample rendered by §7.3's printer, reusing the exhaustiveness machinery's witness.

---

## 6. Pattern positions

### 6.1 `match` arms — and the generalized scrutinee

The v1 restriction "`match` scrutinees must be union-typed" is **retired**. A `match` scrutinee may now be any type; the arms' patterns must type against it. In particular:

```
match point
  (0, 0) => "origin"
  (x, 0) => "on x-axis: ${x}"
  (0, y) => "on y-axis: ${y}"
  _      => "elsewhere"

match user
  {role: Admin}        => allowAll()
  {role: _, verified: true} => allowSome()
  _                    => deny()

match flag
  true  => on()
  false => off()
```

Two **permanent** exclusions:

- **`Exn`.** An open sum can never satisfy exhaustiveness; `catch` is the only eliminator (Exceptions §3, unchanged). Diagnostic: "match requires a closed type; exceptions are inspected with `try`/`catch`."
- **Constraint-bounded abstract types.** A scrutinee whose type is a variable — even one carrying constraints (`c: Iterable`, some future `Item(c)` projection) — has no visible constructors and cannot be matched. Matching is structural on *known representation*; it never dispatches through a constraint, and it never scrutinizes a `Seq` or any other abstraction by its internals. Diagnostic: "cannot match on a value of abstract type `c`; use the operations its constraints provide." This is the implied-types interaction, stated so nobody expects `match` to grow constraint dispatch.

Everything else from Unions §4 stands: layout arms, `pattern [when g] => body`, expression semantics, single evaluation of the scrutinee, no braced form.

### 6.2 `catch` arms

Inherit the full grammar — nesting, literals, or-patterns, `as`, guards — as Exceptions §5.2 promised. The open-`Exn` model is unchanged: no exhaustiveness demand, implicit rethrow, reachability still checked (§7.2) and still a hard error. Or-patterns mixing domestic and foreign arms are legal: `ParseError(_) | JsError(_) => fallback`.

### 6.3 `let` patterns

```
let (x, y) = t
let {name, age} = user
let UserId(n) = id
let (Point({x, y}) as p) = origin
let Some(v) = opt                -- HARD ERROR: refutable
```

The LHS of `let` is now a full pattern, gated by irrefutability (§5). Products §2.4's flat-tuple form is the degenerate case; its "nested patterns arrive with pattern matching" error is retired. `let _ = e` remains a non-idiom — `_` alone binds nothing, and the discard spelling is `ignore` (Statements §3.3); a bare-`_` `let` is an error with the `ignore` fixit.

**Every name a `let` pattern binds is a sequential binder** (Statements §5/§5.4): it may not reuse any name in scope, punned fields included — `let {name, total} = order` errors if `name` is bound, with the pattern-aware fixits Statements §9.3 owns (discard with `_`, or rename the field: `{name: orderName}`). The arm/lambda/loop positions bind head binders as before; same grammar, different class, decided by position.

### 6.4 `for..in` loop variable

```
for (k, v) in pairs
  process(k, v)

for {id, name} in users
  register(id, name)
```

The loop variable is a single binder position with no arity question — full patterns, irrefutability-gated, binders are **head binders** (Statements §5). `for (k, v) in map` is live idiom: `Map` iteration yields `(k, v)` tuples (Collections Part 4 §7.2), and the tuple pattern destructures them exactly as above.

### 6.5 Lambda parameters — the depth rule

The collision: `(x, y) => e` must remain a **two-parameter lambda**, permanently (Functions/Products doctrine: no currying, no tuple↔args conversion). The resolution is by nesting depth, with **no new brackets and no grammar fork**:

> In a lambda head, the outer parentheses are the parameter list; **top-level commas separate parameters**. Each parameter is a full (irrefutable) pattern. Anything nested inside the parameter list is pattern syntax.

```
(x, y) => e            -- 2 parameters
((x, y)) => e          -- 1 parameter, tuple-destructured
{a, b} => e            -- 1 parameter, record-destructured (no collision: braces)
UserId(n) => e         -- 1 parameter, newtype-unwrapped (irrefutable: sole constructor)
x as v => e            -- legal, if pointless alone; useful as (({x} as r)) forms grow
(x, {a, b}, _) => e    -- 3 parameters, second record-destructured
Some(x) => e           -- HARD ERROR: refutable pattern in a binding position
```

Pins that make this airtight:

- **No grouping parens around a parameter list.** `((x, y)) => e` is unambiguously one tuple-destructured parameter, never "two params with stylistic parens." The diagnostic for the person who meant two parameters: "this is one parameter destructuring a tuple; for two parameters remove the outer parentheses."
- *Inside* a pattern, parens behave as in expressions: `(p)` groups, `(p, q)` is a tuple pattern. So `(((x, y)))` is one tuple-destructured parameter with a redundant grouping paren — legal, same meaning; the formatter normalizes.
- The zero-param (`() =>`) and single-bare-param (`x =>`) forms are unchanged. A single parameter without parens may be any paren-free pattern (`{a, b} =>`, `UserId(n) =>`, `x as v =>`); tuple-destructuring a sole parameter requires the parens by construction (`((x, y)) =>`).
- **Uniform rule:** constructor patterns are legal here exactly as everywhere else, gated only by irrefutability. `UserId(n) => n` is the F# `fun (UserId n) -> n`, adopted as-is. (The rejected carve-out: §10.)
- Header sugar (`let f(pat) = ...`, `fun f(pat) = ...`) desugars to lambdas and inherits everything above verbatim — parameters are the same head binders whichever spelling introduces them.
- Row interaction: `{x} => e` on an unannotated parameter constrains it row-polymorphically, exactly like `p => p.x`. `fun getX({x}) = x` infers the same type as `fun getX(p) = p.x`.

### 6.6 Position summary

| Position | Grammar | Gate | Guards |
|---|---|---|---|
| `match` arm | full | none (refutable is the job) | yes |
| `catch` arm | full | none; open model | yes |
| `let` | full | irrefutable | no |
| `for..in` | full | irrefutable | no |
| lambda param | full, depth rule for tuples | irrefutable | no |

---

## 7. Exhaustiveness and reachability

Both generalize from Unions §4.3. Both remain **hard errors**. Both remain **exact** over the decidable fragment. The algorithm is Maranget-style usefulness checking (the standard matrix construction); implement it once and derive all three judgments from it: exhaustiveness (is `_` useful after all arms?), reachability (is arm *k* useful after arms 1..k−1?), irrefutability (is the single-row matrix exhaustive? — §5.1).

### 7.1 Exhaustiveness

- Domains with finitely many shapes — unions (closed, nominal), `Bool` via literals, `Unit`, and tuples/records thereof — are checked exactly. **A `match` on `Bool` with `true` and `false` arms is exhaustive with no `_`** (the first non-union exhaustive domain; acceptance-tested).
- Infinite domains (`Int`, `String`, `Float`) are never covered by literals; exactness there means: **a catch-all (`_` or bare variable, possibly under `as`/or-composition per §5.1's coverage semantics) is required.**
- **Guarded arms contribute nothing** — including `when true`. Coverage is computed as if guarded arms were absent.
- Record patterns: coverage is computed over the **mentioned fields only**. Sound because unmentioned fields are unconstrained in every arm — openness means they cannot distinguish arms. (If two arms mention different field sets, the matrix is built over the union of mentioned fields, absent mentions widening to `_`.)
- Missing-case reporting must produce a **witness pattern**, rendered by §7.3: "match is missing cases: `(None, _)`", "match is missing cases: `{status: Queued}`". The Unions constructor-name listing is the degenerate rendering of this.

### 7.2 Reachability

- An arm is unreachable if its pattern is useless relative to the *unguarded* arms above it (guarded arms above cannot subsume — their guards may fail). Hard error, naming the shadowing arm, as before.
- Two arms with the same pattern and different guards are both reachable (the checker cannot prove a guard total): legal.
- A guarded arm whose pattern is already fully covered by an earlier **unguarded** arm is unreachable — `when true` does not launder it.
- Anything after a catch-all arm is unreachable. In `catch`, the Exceptions §5.3 logic transfers with or-patterns folded in: a second `JsError(_)` arm, or anything after `_`, is unreachable; domestic arms after a `JsError` arm are fine.

### 7.3 Counterexample rendering (normative for diagnostics)

Witnesses print as patterns: constructor names applied to `_` for unconstrained slots (`Node(_, _, _)`), tuples with `_` holes (`(None, _)`), records with only the discriminating fields (`{status: Queued}` — never invent mentions), literals for finite literal domains (`false`), and `_` where any value works. Prefer the shallowest witness that is genuinely missing. Multiple missing cases: list up to a small cap (say 3) then "…and N more".

---

## 8. Semantics

- Scrutinee evaluated exactly once; sub-values are read, never copied or reconstructed.
- Arms top to bottom; within an arm, or-pattern alternatives left to right; guard after pattern success, at most once (§3).
- Binding is left to right, all binders simultaneous (no pattern binder is in scope inside its own pattern).
- Patterns never invoke user code except the `Eq` test behind a literal (primitive `===` in every v1 case).

---

## 9. Rider decision: construction punning ships in v1

`{x, y}` in **value** position is `{x: x, y: y}`; composes with update spread: `{...p, x}` is `{...p, x: x}`. Products §3.1's deferral is dissolved.

- No ambiguity: braces are always records, never blocks; pattern vs value position is always syntactically determined; there is no competing single-field grouping form.
- **The two positions read the same sugar with opposite openness** — a pattern `{x, y}` mentions a subset; a literal `{x, y}` is the complete record. Same asymmetry the explicit forms already have; inherited, documented, not smoothed.
- Term-level only: `{x}` in **type** position remains an error ("record types need field types: `{x: SomeType}`").
- Emission: the pun emits JS shorthand `{x, y}` — which is precisely what a JS author would write; a small readable-JS win for free.

**Edit note to Products §3.1** below (§14).

---

## 10. Rejected alternatives (do not re-litigate without new information)

| Rejection | Reasoning |
|---|---|
| **The "transparency rule"** — banning top-level constructor patterns in lambda heads only | Proposed and reversed within this design session; recorded in full so it stays dead. The "reads as a call" objection proves too much (`let UserId(n) = id` and match arms look like calls too; one learned rule covers all positions). The suggested workaround (model newtypes as records to regain head-destructuring) let a grammar carve-out reach backwards into data modeling — disqualifying. And a per-position form exclusion is exactly the "third class" disease Statements §5 warned against. Uniform grammar + irrefutability gate is strictly simpler and F#-faithful. |
| **`or` as the or-pattern combinator** (C# precedent) | Four independent strikes. (1) Symbol coherence: pattern `\|` echoes the union-declaration `\|` — "match either" mirrors "the type is any of"; `or`-patterns beside `\|`-declarations breaks the rhyme. (2) Disanalogy: C#'s `and`/`or`/`not` patterns compose *predicates* (relational, type, property patterns); Hexagon patterns are purely structural, and predicate composition already lives in guards, where the real `or` works (`when x == 0 or y == 0`). (3) Symmetry pressure: C# ships the trio; adopting `or` invites demands for `and`-patterns (Hexagon's answer is `as`) and `not`-patterns (which wreck exhaustiveness reasoning). (4) A genuine parse ambiguity in paren-free lambda heads: `x or y => e` is both the expression `x or (y => e)` (eats-right lambda as `or`'s right operand — a valid parse) and a lambda with parameter pattern `x or y`; `\|` cannot collide because it is not an expression operator at all. |
| Guards inside patterns (`Some(x when x > 0)`) | Wrecks or-pattern factoring, same-bindings, and exhaustiveness locality. Guards are arm syntax, permanently (§3). |
| `Float` literal patterns | SameValueZero `Eq<Float>` makes them lie (`NaN`, `-0.0`). Permanent; guards are the escape (§2.5). |
| `@` for as-patterns | Words-only aesthetic; F# precedent for `as`; `@` is a new sigil buying nothing (§2.7). |
| Type-test patterns (F# `:? T`) | No subtyping, no downcasting, nominal opacity. There is nothing to test. Permanent. |
| Closed record patterns / `...` in patterns | Openness has no opt-out in v1; a "match exactly these fields" pattern has no use case that isn't better served by the type. Revisit only with evidence. |
| Guards counting toward exhaustiveness (even `when true`) | Requires totality checking of arbitrary expressions or ad-hoc special cases; the hard-error stance demands exactness, and exactness demands exclusion. |
| A second syntactic irrefutability judgment | One algorithm (§5.1); a syntactic approximation would drift from the exhaustiveness checker and mis-verdict `true \| false`. |
| New brackets to split tuples from parameter lists | Both parens uses are identity commitments (JS-style calls; ML-style tuples). The depth rule resolves the single-site collision without spending either (§6.5). |
| `let _ = e` as discard | Already rejected (Statements §3.3); reaffirmed now that `let` takes patterns. `ignore` is the one idiom. |

---

## 11. Deferred items and resolved anchor

1. **Resolved anchor (not a deferral).** The old "list/array patterns" gap is **discharged: vector patterns shipped** in Collections Part 3 §3, which owns their forms, typing, length-based exhaustiveness, irrefutability, rest spelling (`...`), and emission — the form is registered in §2 here by reference. **`Vector` owns `[...]` patterns in v1**: `List` is a reserved name with no representation (Collections Part 1 §1) and gets nothing; the borrowed FFI `Array(a)` has **no v1 pattern surface** — convert with `Array.toVector` and match the stable `Vector` snapshot. This is not an active design debt; a future proposal needs field evidence that the explicit conversion is inadequate and must account for `Array`'s borrowed stability contract. Number kept for existing §11.1 cross-references.
2. **Range patterns** (`1..10 =>`) — guards with chained comparisons (`when 1 <= x <= 10`) cover the need with visible semantics; interval exhaustiveness reasoning is not worth v1 complexity. Reserve nothing.
3. **Named-slot constructor patterns** (`Circle(radius: r)`) — plausible future ergonomics for wide constructors; positional-only stands for v1 (Unions §4.2 doctrine).
4. **String prefix/interpolation patterns** — not planned; noted only because JS developers may ask.
5. **Closed-record patterns** — see §10; would return only with evidence.

---

## 12. Diagnostics checklist

| Situation | Error / hint |
|---|---|
| Refutable pattern at `let`/`for..in`/lambda param | "this pattern can fail: ⟨witness⟩; use `match`" (§5.3) |
| Sole-constructor pattern flips refutable after a union gains a constructor | same family, naming the new constructor (§5.2) |
| Non-exhaustive `match` | "match is missing cases: ⟨witnesses⟩" via §7.3 renderer — add the missing arm(s) or a `_` catch-all |
| Unreachable arm (incl. guarded-arm subtleties) | hard error naming the shadowing arm (§7.2); remove the arm or reorder it above its shadower |
| Or-pattern binding mismatch | "`x` is bound on the left of `\|` but not the right — bind it in both alternatives; if unused, remove the binding from both" (§2.6) |
| Duplicate binder in one pattern (incl. `as`, nested) | "`w` is bound twice in this pattern; rename one occurrence"; for an unused subpattern binder suggest `_`, and for an unused `as` binder suggest removing the `as` clause (§2.1) |
| `let`-pattern name already in scope | Statements §5.1/§9.3's "already bound" error with the pattern-aware fixits (§6.3 here) |
| `Float` literal pattern | permanent error + guard fixit (§2.5) |
| Guard on `let`/`for..in`/lambda param | "guards are only legal on `match` and `catch` arms; use a `match`" (§3) |
| Bare lambda intended inside a guard | "`=>` ends the guard; parenthesize the lambda" (§3) |
| `when` inside a nested pattern | parse error, same message (§3) |
| `match` on `Exn` | "match requires a closed type; exceptions are inspected with `try`/`catch`" (§6.1) |
| `match` on constraint-bounded abstract type | "cannot match on a value of abstract type `c`; use the operations its constraints provide" (§6.1) |
| Bare record pattern on nominal-record scrutinee | "destructure it with `Point({x, y})`" (§2.4) |
| Type name in constructor-pattern position (`{x: Float}`) | "`Float` is a type, not a constructor…" (§2.4) |
| `((x, y)) => e` written meaning two params | "one parameter destructuring a tuple; remove the outer parentheses for two parameters" (§6.5) |
| `@` in a pattern | fixit: "Hexagon spells as-patterns with `as`" (§2.7) |
| `let _ = e` | error + `ignore` fixit (§6.3) |
| Pun in type position (`{x}` as a type) | "record types need field types" (§9) |
| Field pattern for a field the type lacks | missing-field family, naming known fields (§2.4) |
| Constructor/pattern arity mismatches, nullary parens, bare payload constructor | unchanged Unions §4.2 family; the "nested patterns arrive later" error is **retired** |

---

## 13. Decisions log

| Decision | Where |
|---|---|
| One grammar, five positions; refutable positions ungated; binding positions gated by irrefutability | §1, §6 |
| Uniform constructor patterns in lambda heads; "transparency rule" carve-out rejected and recorded | §6.5, §10 |
| Irrefutability = single-row exhaustiveness; one algorithm for both; `true \| false` irrefutable | §5.1 |
| `Some(n)` refutable / `UserId(n)` irrefutable — closed-union constructor count decides; flip-on-extension is a feature | §5.2 |
| Nested patterns everywhere; positional constructor patterns stand; nominal records destructure via constructor pattern `Point({x, y})` | §2.2 |
| Record patterns open by default, no `...`, punning `{f}` ≡ `{f: f}`; sub-pattern in field slot | §2.4 |
| Literal patterns: `Int`/`String`/`Bool` via `Eq`; ordinary inference (`Num` + `Eq` constraints); `Float` permanently banned with guard fixit; no `Char` | §2.5 |
| Or-patterns with F# same-bindings rule; spelling `\|` (C#'s `or` rejected: declaration/pattern coherence, predicate disanalogy, `and`/`not` pressure, lambda-head ambiguity) | §2.6, §10 |
| Guard termination: top-level `=>` after `when` belongs to the arm; lambdas in guards must parenthesize | §3 |
| `as` keyword; loosest pattern operator, looser than `\|`; refutability-transparent; zero-cost | §2.7 |
| Guards: `when`, arm syntax only, whole-arm coverage, evaluated after pattern at most once, contribute nothing to exhaustiveness (incl. `when true`) | §3 |
| `match` scrutinee generalized; `Exn` and constraint-bounded abstract types permanently excluded | §6.1 |
| Lambda heads: top-level commas = parameters; `((x, y))` = one tuple param; no grouping parens around param lists; single paren-free-pattern params | §6.5 |
| Exhaustiveness/reachability: Maranget matrix, hard errors, exact; `Bool` exhaustive via literals; record coverage over mentioned fields; witness-pattern rendering | §7 |
| Construction punning ships in v1; emits JS shorthand; term-level only | §9 |
| Binder class is positional (Statements §5): arm/lambda/loop binders head, `let`-pattern binders sequential; no third class; duplicate-in-whole-pattern error incl. `as`, class-independent | §1, §2.1, §4, §6.3 |
| Vector patterns shipped, owned by Collections Part 3 §3; `Vector` owns `[...]` in v1 (no `List`, no `Array` pattern surface); range patterns → guards; type-test patterns → never | §2, §10, §11.1 |

---

## 14. Edit notes to existing specs

Apply on next touch; until then this doc governs.

1. **Unions §4.2** → the flat-pattern restrictions (no nesting, no literals, no guards, no or/as, union-only scrutinees) are superseded; replace with a pointer here. The "nested patterns arrive with pattern matching" diagnostic is retired. §4.3's exhaustiveness text gains a pointer to §7 here. The decisions-log row "v1 patterns: flat + `_`" gains "superseded by Pattern Matching spec".
2. **Products §2.4** → flat-`let`-destructuring restrictions superseded (nesting now legal); lambda-parameter-patterns sentence superseded by §6.5 here. **§3.1** → "No shorthand `{x, y}`" is dissolved: construction punning ships (§9 here); strike the fast-follow note.
3. **Exceptions §5.2** → "the pattern-matching spec owns the superset grammar" is now discharged; catch arms take the full grammar. §5.3 reachability text gains the or-pattern note (§7.2 here).
4. **Operators §2/§3.2** → `match` "joins from the pattern-matching spec": joined. `when` joins the keyword inventory (arm syntax; not an operator, no table row).
5. **Lexer & Layout** → `when` and pattern-position `as` need keyword-table entries; no new layout rules (arms unchanged).
6. **hexagon-for-typescript-coders** → new chapter material: destructuring in lambda heads (`{a, b} =>` as the JS-muscle-memory hook), newtype unwrapping via `let UserId(n) =`, construction punning; `let`-pattern rebinding errors vs TS shadowing muscle memory (Statements §9.2 owns the same note).

---

## 15. Acceptance tests (golden: parse tree, inferred type, verdicts, emitted JS)

```
-- (a) Nesting + as + guard + chained comparison
match tree
  Node(Leaf, x, Leaf) as leaf when 0 <= x < 100 => promote(leaf)
  Node(l, _, r) => merge(l, r)
  Leaf => Leaf
-- guard emits: 0 <= x && x < 100 appended with && to the arm test

-- (b) Bool exhaustive via literals; no wildcard
match flag
  true => 1
  false => 0
-- exhaustive; adding `_ => 2` afterwards is an unreachable-arm error

-- (c) Or-pattern same-bindings
Circle(r) | Square(r) => r          -- OK: r bound both sides
Circle(r) | Point => r              -- ERROR: r bound on the left of | but not the right

-- (d) as looser than |
A(x) | B(x) as v => (x, v)          -- v = whole value in both alternatives

-- (e) Irrefutability: the Some/UserId pair
union UserId = UserId(Int)
let UserId(n) = id                  -- OK: sole constructor
let Some(v) = opt                   -- ERROR: this pattern can fail: None; use match

-- (f) true|false is irrefutable (coverage definition, not syntax)
let (true | false) = b              -- legal (binds nothing; pointless but principled)

-- (g) Lambda depth rule
(x, y) => x + y                     -- 2 params
((x, y)) => x + y                   -- 1 param, tuple; emits (t) => { const [x, y] = t; ... } or param-destructure
{a, b} => a ++ b                    -- 1 param, record; row-constrains if unannotated
UserId(n) => n                      -- 1 param, newtype unwrap
Some(x) => x                        -- ERROR: refutable pattern in a binding position

-- (h) Record openness + punning + literal sub-pattern
match user
  {role: Admin} => allowAll()
  {verified: true, name} => greet(name)
  _ => deny()
-- coverage computed over {role, verified, name}; witness rendering on removal of `_`:
--   match is missing cases: {role: Member, verified: false}   (or shallowest equivalent)

-- (i) Guards never count
match n
  x when x >= 0 => "nonneg"
  x when x < 0 => "neg"
-- ERROR: non-exhaustive — guarded arms contribute nothing; requires a catch-all

-- (i2) Guard termination: => after when belongs to the arm
match n
  x when isPositive => "pos"       -- guard is the expression `isPositive`; => is the arm's
  x when exists(preds, (p => p(x))) => "any"   -- lambda in a guard: parenthesized
  _ => "other"
-- `x when f => x` where a lambda guard was intended: error with parenthesize fixit

-- (j) Construction punning round trip
let name = "Ada"
let user = {name, verified: true}   -- {name: name, ...}; emits {name, verified: true}
let {name: n} = user                -- n = "Ada"

-- (k) Float literal ban
match temp
  0.0 => "freezing"                 -- ERROR: Float literals cannot appear in patterns; use a guard
  t when t <= 0.0 => "freezing"     -- the sanctioned spelling
  _ => "ok"

-- (l) Nominal record destructure
record Point = {x: Float, y: Float}
let Point({x, y}) = origin          -- OK; bare {x, y} against Point is the nominal-wall error

-- (m) for..in patterns
for (k, v) in pairs
  print("${k}: ${v}")

-- (n) Emission shape (readable-JS pin)
match shape
  Circle(r) when r > 0.0 => area(r)
  Circle(_) => 0.0
  Rect(w, h) => w * h
  Point => 0.0
-- emits an if/else-if cascade on shape.tag (guards preclude plain switch fall-through),
-- OR switch with guard-carrying cases restructured; either accepted if a TS author would write it
```
