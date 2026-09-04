# Hexagon Spec: Pattern Matching

**Status:** Decided (July 2026).
**Scope:** The full pattern grammar — nested constructor patterns, tuple and record patterns, record punning, literal patterns, or-patterns, as-patterns, and (by reference) vector patterns; guards as arm syntax; the irrefutability judgment; the five pattern positions (`match` arms, `catch` arms, `let`, `for..in`, lambda parameters) and the generalized `match` scrutinee; exhaustiveness and reachability over the full grammar; emission. Rider decision: record **construction** punning (`{x}` ≡ `{x = x}` in value position) ships in v1 (§9). Term-position field separator is `=` corpus-wide (Products §8; §16 here).
**Not in scope:** the vector pattern's forms, typing, length-based exhaustiveness, irrefutability, rest spelling, and emission (Collections Part 3 §3 — the form joins this grammar, §2/§11.1; that spec owns its algorithm), range patterns (deferred, §11.2), active/view patterns (not planned, §10), the `match` keyword's precedence slot (Operators §3.2 already seats it among the eats-right forms), `Exn` matching (permanently excluded; Exceptions §3 is authoritative), string representation details behind `Eq<String>` (Primitive Types §5).
**Companions:** Unions (flat constructor patterns as this grammar's degenerate case; exhaustiveness doctrine; `match` emission baseline), Products (flat `let`-destructuring as degenerate case; record openness vocabulary; tuple emission), Exceptions (catch arms; open-sum reachability model), Statements/Blocks/Mutability §5/§5.4 (binder class is positional; `let`-pattern binders sequential), Collections Part 3 §3 (vector patterns), Collections Part 4 §7.2 (`for (k, v) in map` iteration), Operators (Eq/Ord elaboration for literals; chained comparisons in guards; `match` eats right), Decisions Batch 2026-07 (`Eq<Float>` SameValueZero — the reason Float literals are banned from patterns), Declarations Preamble §1.1 (the Rewrite Rule, which this doc's diagnostics obey).

---

## 1. Doctrine

- **One grammar, five positions, one gate.** There is a single pattern grammar. It is legal in full at the two refutable positions (`match` arms, `catch` arms) and gated by **irrefutability** (§5) at the three binding positions (`let`, `for..in`, lambda parameters). There are no per-position dialects and no per-position form exclusions. The uniform-rule decision (reversing an earlier "transparency rule" proposal — §10) is deliberate and closed.
- **The flat forms already shipped are this grammar's degenerate case** — exactly as Unions §4.2 and Products §2.4 contracted. Nothing about them changes; they simply stop being the ceiling.
- **Guards are arm syntax, not pattern syntax** (§3). A pattern is a static shape; a guard is a runtime test. (A declared pattern is a shape whose reading is a pure function — Pattern Declarations; the stratum is untouched.) Keeping them in separate grammatical strata is what keeps or-patterns, the same-bindings rule, and exhaustiveness simple.
- **Exhaustiveness and reachability remain hard errors and remain exact** over the decidable fragment (§7). Guarded arms contribute nothing to coverage. Infinite domains require a catch-all. This is the Unions §4.3 doctrine, generalized, not renegotiated.
- **Binder class is positional, never determined by pattern syntax** (Statements §5, the proper-subterm criterion): `match`-arm, `catch`-arm, lambda-parameter, and loop-pattern binders are **head binders** and shadow freely; every name a **`let` pattern** binds is a **sequential binder** (Statements §5.4) and may not reuse a name in scope, nor one whose definition is in progress (Statements §5.1). The same record pattern `{name}` is a head binder in an arm and a sequential binder on a `let` LHS. No pattern form creates a third class. **Duplicates within one simultaneous pattern are errors regardless of class.**
- **Emission stays readable**: cascades of `if`/`else if` on tags and fields, `switch` where a single tag discriminates, `const` binders from named fields, guards appended with `&&`. No decision-tree compilation whose output couldn't have been written by hand. *(Standing post-#147: this bullet constrains the emitter, not the language — emission shape is exactly the territory where readable JS remains a governing goal; the pivot demoted the TS-author test as a language-design adjudicator, not as an emission commitment. `decisions-ml-dialect-bool-2026-07.md` §1.)*

---

## 2. The pattern grammar

The complete v1 inventory:

```
_                        -- wildcard: matches anything, binds nothing
x                        -- variable: matches anything, binds x
C(p1, ..., pn)           -- constructor pattern, sub-patterns nest freely
C                        -- nullary constructor
(p1, ..., pn)            -- tuple pattern, arity 0 or ≥ 2; (p) is grouping
{f1 = p1, f2, ...}       -- record pattern: open; {f} puns as {f = f}
0   "yes"                -- literal patterns: Int, String only (#147)
p1 | p2                  -- or-pattern
p as x                   -- as-pattern: match p, additionally bind the whole to x
()                       -- the empty-tuple (`Unit`) pattern: the arity-0 tuple form (#159)
[p1, ..., pn]  [ps, ...rest]  -- vector patterns (Collections Part 3 §3 owns forms,
                              --   typing, exhaustiveness, irrefutability, emission)
(p1, ..., pn)name        -- declared pattern: a component list, then the pattern's name as a
                         --   suffix, bare always (Pattern Declarations owns declaration, typing,
                         --   resolution, coverage, emission; registered here by reference)
```

Grammar, loosest to tightest: `as` binds looser than `|`; both bind looser than the structural forms. So `Circle(r) | Square(r) as s` is `(Circle(r) | Square(r)) as s`. Parenthesize to override.

### 2.1 Wildcard and variable

Unchanged from Unions §4.2 / Products §2.4: `_` binds nothing and may repeat; a non-uppercase-start name binds the matched value. **Duplicate binders anywhere within one whole pattern are a hard error** — `Rect(w, w)`, `{x = a, y = a}`, `(p, q) as p` — same message family as before ("`w` is bound twice in this pattern"). The check is over the entire pattern including `as` binders and through nesting; or-pattern alternatives are checked per-alternative (each alternative is a separate binding universe, then reconciled by §2.6's same-bindings rule).

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
- **Resolution of the constructor name** *(#763)*. A constructor pattern's head resolves **in scope first** — the module's own constructors, the prelude's bare set (Modules §5.5), a qualified spelling `Alias.Name` through a module alias (Modules §3.1), and the term-position companion fallback (Modules §5.1 rule 3), each exactly as in an expression — **and then in the expected type**: where scope has nothing for a bare uppercase-start head, and the pattern's expected type is a union or nominal record whose constructor set holds the spelling, the head resolves to that constructor. The door reads a constructor set **as the reporting module may write it**: outside an `opaque` type's home module its constructors are private (Modules §4.2), so the door does not open on them, and a bare head over an opaque record or union abroad draws the opaque family's own refusal at the type's noun — "cannot destructure opaque record `Point`; use an operation exported by its home module", "cannot destructure opaque union `Handle`; use an operation exported by its home module", or, where the home exports declared patterns over the type, the sentence that names them (§2.4; Pattern Declarations §3.3) — never a constructor no spelling in this module can write. The expected type is the scrutinee's at the top of a pattern and the slot type at the pattern's position inside one — the declaration's, as instantiated when the pattern is checked (see *Beneath* below; §4's checking mode: `Pair(North, South)` looks `North` up in the declared component type, `Some(North)` under `Option(Direction)` in the instantiated payload), so nothing is inferred and nothing is searched — the door reads a type the pattern's position had already fixed. "In scope" reads **module-wide**: a spelling this module declares in the term namespace is in scope everywhere in it, so the door never answers for that spelling, and a use above the declaration is Functions §7.2's declared-later error under Modules §5.4's reservation — never the door's meaning. The door answers only where scope has nothing, the Modules §5.1 companion-fallback shape — answering, never ranking — so every program that resolved without it resolves identically under it; a same-spelled constructor in scope wins outright, and where that constructor belongs to another type — another union's constructor, or another nominal record's — the arm is the ordinary type error, whose message names the qualified spelling of the constructor the expected type does hold (§12) — unless that type is `opaque` abroad, where no such spelling exists and the opaque refusal leads instead (§2.4), the deeper fault reported alone. The same-name-both-sides tell (`expected Box, found Box` — Modules §5.1 rule 2's term) is exactly the report this sentence exists to replace. The qualified pattern is unchanged and still **fixes** the scrutinee type where it was undetermined: `Direction.North` resolves in the module and unifies as §4 says. **Where the expected type is not determined when the pattern is checked, the door is closed**, and a bare head scope does not bind is refused naming the qualified spelling and the seat that would open the door (an annotated `let` around the function; an ascription on the scrutinee) — the closed-door refusal: one meaning fewer, never a different one. The seats decide when that can happen. At the **top** of a `match`, `let`, or `for..in` pattern the subject is typed before its pattern, and at `match` §6.1's abstract-type refusal already guarantees the scrutinee's head is known when its arms are checked — or the match is refused first: §6.1 leads, and the door's refusal is not additionally reported — so the door at a pattern's top is never order-dependent there. **Beneath** the top, the door reads the instantiated slot type as it stands when the pattern is checked, and a payload variable that a sibling arm's qualified pattern is what fixes (`match None` with the arms `Some(Direction.North)` and `Some(East)`) is undetermined until that arm has been checked: the refusal there can depend on arm order — the licence Functions §4.3 already grants the abstract-scrutinee refusal — with the same repairs, the qualified spelling or an ascription on the scrutinee, and never a different meaning. At a lambda parameter the type is known only where a supplying seat handed it in (Functions §4.3; §6.5), and a parameter pattern under no seat takes the refusal. A `catch` arm is no seat of the door's: it matches the open `Exn`, which has no constructor set, and exception constructors are bare or qualified there as everywhere (Exceptions §5.2). The door reaches every union whose constructors this module may write — the module's own (where scope answers first anyway), an imported one, and the prelude's qualified-only constructors (Modules §5.5): `match a.compare(b)` writes its arms `Less`, `Equal`, `Greater` bare, the lookup binding nothing in scope, which is exactly the pollution §5.5's qualified-only rule exists to prevent. In expression position there is no such door (Modules §9.13): `Direction.North`.

### 2.3 Tuple patterns

```
(Some(x), None)                  -- nested
(a, _, (b, c))                   -- nesting includes tuples in tuples
```

Arity must equal the tuple's arity (Products §2.1 report shape). `(p)` is **grouping**, exactly as in expressions — there are no 1-tuples, so no ambiguity. `()` is the arity-0 case of this form: the empty-tuple pattern, `Unit`'s sole pattern, irrefutable because all zero of its components are *(reclassified 2026-07-30, #159 — formerly a dedicated "Unit pattern"; Products §2.7)*.

### 2.4 Record patterns — open, with punning

```
{name, age}                      -- pun: {name = name, age = age}
{name = n}                       -- rename: field name, binder n
{port = 0}                       -- literal sub-pattern
{mode = Verbose, port = p}       -- constructor sub-pattern + rename
{customer = {name}, total}       -- nested, punned at two depths
```

- **`{f = p}` — the field slot holds a full sub-pattern.** When the sub-pattern is a bare non-uppercase-start name equal to the field name, the `= name` may be dropped: **`{f}` ≡ `{f = f}`.** That's the entire punning rule.
- **Open by default, always, with no opt-out syntax.** A record pattern mentions any subset of the scrutinee's fields; unmentioned fields are neither bound nor constrained. There is no `...` in patterns and no closed-record pattern form in v1. This deliberately points the opposite way from *type annotations* (closed by default, Products §4): a pattern destructures a known-typed value; an annotation constrains an unknown one. The asymmetry is principled and must be documented, not smoothed over.
- Duplicate field names in one record pattern: error. A field the scrutinee's type lacks: the standard missing-field error naming the known fields (Products §3.2 family).
- Record patterns work on structural records and — through row polymorphism — on unannotated parameters, constraining them exactly as field access does (`fun getX({x}) = x` infers the row-polymorphic type; see §6.5).
- Nominal records: a bare record pattern does **not** match a nominal-record-typed scrutinee (the unifier never unfolds nominal names — Products §5.1). Go through the constructor pattern: `Point({x, y})`. Diagnostic: "`Point` is a nominal record; destructure it with `Point({x, y})`." The suggestion is the user's own pattern wrapped in the missing constructor: it names the fields the pattern itself wrote, punned — never the declaration's list — so it teaches exactly the missing move and can enumerate nothing the author has not already spelled. **Opacity intercepts the redirect** (Modules §4.2): outside an opaque record's home module the suggested spelling is a locked door — the constructor is private there — so the seat draws the opaque family's refusal instead, "cannot destructure opaque record `Point`; use an operation exported by its home module", the sibling of the field-access and update sentences. An opaque **union** takes the same sentence at its own noun — "cannot destructure opaque union `Handle`; use an operation exported by its home module" — at the door's seat (§2.2), the redirect above being a nominal record's alone. **Where the home module exports a declared pattern over the type, the sentence names it instead** — "cannot destructure opaque record `Rat`; match it with `(top, bottom)rat`", every exported pattern over the type in its own spelling, components as declared, up to a small cap (Pattern Declarations §3.3): the door the reader was meant to take is named, not merely the one that is locked. A diagnostic never signposts a spelling the reader cannot write. Inside the home module `opaque` changes nothing, here as everywhere.
- Separator near-miss: `:` inside a term-position record — pattern or literal — is a parse error with the Products §6/§8 fixit ("record fields bind with `=`; `:` gives a field its type in record *types*"). This retires the old type-position confusion guard: under `:`-in-terms, `{x: Float}` in a pattern parsed as a constructor sub-pattern and needed a bespoke "`Float` is a type, not a constructor" diagnostic; under `=` the misreading is caught at the token (§16). One refinement, because the old guard's actual customer *meant an annotation*: when the text after the `:` is uppercase-start (`{x: Float}`), the separator repair alone would be a wrong turn — `{x = Float}` just errors again below — so the fixit appends: "if you meant a type, patterns destructure values; annotate outside the pattern." The bespoke message survives only for the genuinely written `{x = Float}` — `Float` there *is* a constructor-position name, and the error stays "`Float` is a type, not a constructor — patterns destructure values."

### 2.5 Literal patterns — `Int`, `String`; never `Float`

```
match n
    0 => "zero"
    1 => "one"
    _ => "many"

match answer
    True => proceed()
    False => abort()               -- NOT literal patterns: constructor patterns (§2.2)
```

- **Bool left this section (corrected 2026-07-29, #147).** `Bool` is now the prelude union `False | True` (Unions §8), so `True`/`False` in patterns are nullary **constructor patterns** (§2.2), and the exhaustiveness of the second example above is ordinary closed-constructor union checking (§7.1) — no literal machinery involved. The example is retained here as the contrast case, because it is the respelling of what was previously this section's Bool-literal example.
- A literal pattern elaborates through **`Eq`** exactly as `==` does (Operators §5.1): the arm test is `equals(scrutinee, lit)`, emitting `===` on the primitive fast path — which is every v1 case, since the allowed types are `Int`, `String` *(corrected 2026-07-29, #147 — Bool removed)*.
- **Typing joins ordinary inference.** An integer literal in a pattern contributes the same `Num` (via `fromNat`) and `Eq` constraints that `x == 0` would, and unifies with the scrutinee type; defaulting applies as usual. In v1 the scrutinee is concrete by the time patterns check, so this is invisible — but the spec fixes the mechanism so a future polymorphic scrutinee doesn't force an improvised rule. Literal patterns do not force early monomorphization beyond what the constraints require.
- **`Float` literal patterns are a permanent hard error**, not a deferral. `Eq<Float>` is SameValueZero (Decisions Batch §1): `NaN` would never match its own literal, and `-0.0`/`0.0` would collapse — a pattern that *reads* exact and isn't. The diagnostic must redirect: "Float literals cannot appear in patterns; use a guard: `x when x == 1.5`" — where the SameValueZero semantics is at least attached to a visible `==`. Matching *on* a `Float` scrutinee is fine (variables, `_`, guards); only the literal form is banned.
- There is no `Char` type in Hexagon; single-character strings are `String` literals like any other.
- Negative integer literals: `-3` is legal as a literal pattern (the lexer/parser treats the sign as part of the literal in pattern position — patterns contain no operators, so there is no unary-minus expression to collide with).

### 2.6 Or-patterns `p | q`

```
Circle(_) | Rect(_, _) => "has area"
0 | 1 => "small"
{status = Pending} | {status = Queued} => wait()
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

Patterns contain **no operators, no calls, no expressions**. `C(...)` in pattern position is constructor syntax resolved by the case rule, never a call. There is no evaluation inside a pattern; the only runtime work a pattern performs is tag tests, field/slot reads, and `Eq` tests for literals. Anything computational belongs in a guard. **One exception, and only one:** a declared pattern `p(...)` applies its `view` — a function the declaration requires to be pure, applied at most once per pattern per position (Pattern Declarations §2.1, §5) — which is why it is the exception this sentence can afford.

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
- **Guard termination (grammar pin):** the guard expression is terminated by the arm's `=>` — a top-level `=>` after `when` always belongs to the arm, never to a lambda. Without this pin, `p when f => x` would maximal-munch `f => x` as an eats-right lambda (Operators §3.2) and never find the arm's arrow. Same resolution as F#'s. **The arm's claim on the arrow is dropped inside any bracket** — `(`, `[`, `{` — because a bracket must close before the arm's `=>` can arrive: `p when apply(f, x => x > 0) => body` is legal, and the parenthesized `(x => x > 0)` is a style choice, not a requirement (this sentence formerly read "must be parenthesized"; softened July 2026). Only a lambda written *bare at the guard's top level* is unavailable, and it is unavailable at no cost: a guard must be `Bool` and a lambda never is, so the claim can never suppress a well-typed program.
- **The diagnostic "`=>` ends the guard; parenthesize the lambda" is retired** (July 2026), superseded by the pin it was written to repair. The parse it caught now succeeds — `p when f => x` reads as guard `f`, body `x`, which is exactly what the pin asks for — so the fixit has no trigger, and firing it would mean guessing that a user who wrote a valid guard meant a lambda. A bare lambda genuinely intended at guard top level surfaces as an honest type mismatch (`Bool` expected, function found), which names the real problem.
- **Evaluation order is normative** (guards may be effectful): arms top to bottom; a guard is evaluated only after its arm's pattern has matched, at most once per `match` evaluation; if the guard is `False`, matching falls through to the next arm as if the pattern had failed.
- **A guarded arm contributes nothing to exhaustiveness** (§7.1). The checker does not attempt to prove guards total — not even `when True`. A match whose domain is only covered by guarded arms is non-exhaustive: hard error. This bites harder than F#'s warning; that is the point and the house rule (no warning tier).
- Guards appear only where arms appear: `match` and `catch`. There are no guards on `let`, `for..in`, or lambda parameters — those positions demand irrefutability, and a guard is the maximally refutable construct.

---

## 4. Typing patterns

Pattern typing is checking-mode against the scrutinee type, structurally:

- `_`, `x`: any type; `x` binds at the scrutinee type and is monomorphic in its binding position, never generalized. Its binder class comes from that position, not from this pattern form (§1).
- `C(p...)`: `C` resolves per §2.2 — in scope, else in the expected type, which a door-resolved head reads before anything unifies — then the scrutinee unifies with `C`'s union (or nominal record) type at a fresh instantiation, and sub-patterns check against the instantiated slot types. (A scope-resolved head may thereby *determine* an undetermined scrutinee; a door-resolved head was determined by it.)
- Tuples: arity check, then componentwise.
- Records: each mentioned field's sub-pattern checks against that field's type; on an unknown scrutinee type, each mentioned field *constrains* the row exactly as dot-access does (fresh hidden tail — Products §3.2). Row vocabulary stays banned from diagnostics.
- Literals: unify with the scrutinee type and contribute `Eq` (+ `Num` for integer literals) constraints (§2.5).
- `p | q`: both check against the scrutinee type; binder types unify pairwise per the same-bindings rule.
- `p as x`: `p` checks against the scrutinee type; `x` binds at it.

- Vector patterns: typing per Collections Part 3 §3.2 (checked against `Vector(t)`; rest binders at `Vector(t)`).
- `(p1, ..., pn)name` (declared pattern): `name` resolves per Pattern Declarations §3.3 — in the pattern namespace, else in the expected type's home module's exported patterns; the scrutinee unifies with the pattern's subject at a fresh instantiation; sub-patterns check against the instantiated component types (Pattern Declarations §3.1).

Binder class is positional (Statements §5): arm, lambda-parameter, and loop-pattern binders are head binders and shadow freely; `let`-pattern binders are sequential and may not reuse in-scope names or names whose definition is in progress (Statements §5.4, §5.1). All binders within one pattern are simultaneous (whence the duplicate rule), monomorphic, never generalized.

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
| `{f = p, g}` | record | irrefutable iff sub-patterns are | records have one shape; openness only widens |
| `()` | `Unit` | irrefutable | the tuple row at arity 0 — vacuously, all zero components are irrefutable (#159; no longer a separate case) |
| `p as x` | `T` | iff `p` is | `as` adds a binding, not a test |
| `Some(x)` | `Option(a)` | **refutable** | `Option` has another constructor, `None` |
| `UserId(n)` | `UserId` (union `UserId = UserId(Int)`) | **irrefutable** | sole constructor: every `UserId` value has this shape |
| `Point({x, y})` | nominal `record Point` | irrefutable | a record constructor is always "sole constructor" |
| `0` | `Int` | refutable | infinite domain |
| `True` | `Bool` | refutable | `False` exists — an ordinary two-constructor union since #147 |
| `True \| False` | `Bool` | **irrefutable** | jointly cover the domain — the coverage definition, not a syntactic one, decides |
| `Some(_) \| None` | `Option(a)` | irrefutable | ditto (binds nothing, so same-bindings is satisfied) |
| vector patterns | `Vector(a)` | per Collections Part 3 §3 | length-based; that spec's verdicts are authoritative |
| `(q1, …, qn)name` (declared pattern) | the pattern's subject | irrefutable iff every `qi` is | the view is total — the outer form is always "sole constructor" (Pattern Declarations §3.1) |

### 5.2 `Some(n)` vs `UserId(n)` — the story, in full

These two patterns are **syntactically identical** — a constructor applied to a binder — and their different verdicts confuse people until they see that irrefutability is not a property of the pattern's *shape* but of the pattern *against its type*:

- `Option(a)` declares **two** constructors. A value of type `Option(Int)` might be `None`. The pattern `Some(n)` therefore *can fail*, and `let Some(n) = opt` would have to do... something... on `None`. Languages answer that with a warning plus a runtime crash (F#, Haskell). Hexagon has no warning tier and no appetite for a compiler-inserted crash: **hard error** — "this pattern can fail: a value of type `Option(Int)` may be `None`; use `match`."
- `union UserId = UserId(Int)` declares **one** constructor. Every value of type `UserId` — all of them, forever, because unions are closed and nominal with no subtyping — has the shape `UserId(n)`. The pattern cannot fail. `let UserId(n) = id` is therefore a total destructure, exactly as safe as `let (x, y) = t`, and it is the idiomatic zero-cost unwrap of a newtype:

```
union UserId = UserId(Int)

fun format(id: UserId): String =
    let UserId(n) = id
    "user-${n}"

userIds |> Seq.map(UserId(n) => "user-${n}") -- same thing, lambda-parameter position
```

The closedness of `union` is what makes this sound: adding a second constructor to `UserId` later flips every `UserId(n)` binding-position pattern from irrefutable to refutable, and **they all become compile errors at once**, pointing at exactly the code the change broke. That is the system working, and the docs should present it as such. The message at each flipped site is §5.3's uniform gate line, and it needs no flip-specific variant: the witness — rendered by §7.3, tiers and route clause included — *is* the constructor that arrived, so the report names `Anonymous` in the spelling the flipped module can lawfully write, and where it has none (a common flip situation: the constructor did not exist when the imports were written, and no alias reaches it), the route clause names the import that spells it. No bespoke "no longer covers" message exists, on principle rather than by economy *(#639)*: that sentence states the union's *history*, and the compiler has none — a flipped `let UserId(n)` and a freshly written `let Some(n)` present identically, a union with two constructors and a pattern covering one of them, so any temporal message would fire falsely on fresh code.

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
    {role = Admin}       => allowAll()
    {role = _, verified = True} => allowSome()
    _                    => deny()

match flag
    True  => on()
    False => off()
```

Two **permanent** exclusions:

- **`Exn`.** An open sum can never satisfy exhaustiveness; `catch` is the only eliminator (Exceptions §3, unchanged). Diagnostic: "match requires a closed type; exceptions are inspected with `try`/`catch`."
- **Constraint-bounded abstract types.** A scrutinee whose type is a variable — even one carrying constraints (`c: Iterable`, some future `Item(c)` projection) — has no visible constructors and cannot be matched. Matching is structural on *known representation*; it never dispatches through a constraint, and it never scrutinizes a `Seq` or any other abstraction by its internals. Diagnostic: "cannot match on a value of abstract type `c`; use the operations its constraints provide." This is the implied-types interaction, stated so nobody expects `match` to grow constraint dispatch. *(#513.)* The refusal reads the scrutinee's type at dispatch, so expected-type propagation (Functions §4.3) decides what it sees: a seat's expectation arrives before the arms are checked, and the refusal is left to programs where no seat determined the type. When it does fire on a scrutinee that is a lambda parameter — the match function's own binder included — whose type is an **undetermined inference variable**, the constraint-operations advice points nowhere; the report instead carries the rider: "the parameter's type is not determined here; give the parameter a type — bind the function with its own annotated `let`, or use it where its parameter type is known." Both rewrites are legal in **both** spellings — a match function's parameter is compiler-fresh and cannot itself be annotated, so the rider never names the parameter-annotation edit, and §6.7's desugar-equality (one diagnostic for both spellings) is preserved. A parameter whose type is a **declared** variable (rigid — Functions §4.1) is determined, abstract by declaration, and keeps the constraint-operations advice. The same guarantee is what makes §2.2's constructor door order-independent at the top of this seat's patterns: by the time an arm is checked, the scrutinee's head is known or the match has been refused — the refusal leading, the door's own refusal never reported beside it — so a bare head at the top of an arm never resolves differently by the order inference happened to run in. (Beneath the top, where an arm can be what determines a payload variable, §2.2 states the order-sensitive case and its repairs.)

Everything else from Unions §4 stands: layout arms, `pattern [when g] => body`, expression semantics, single evaluation of the scrutinee, no braced form.

**A `match` whose head begins its logical item may take a `catch` clause** — the match catch expression, owned by Exceptions §5.4: a `catch` block at the match head's column whose arms handle exceptions thrown by the *scrutinee's evaluation only* (a mid-line head takes no clause). The clause changes nothing in this section — the scrutinee types against the data arms as above, the data arms alone satisfy exhaustiveness (§7.1), and both permanent exclusions stand; in particular, a catch clause does not make `match` an eliminator for `Exn`.

### 6.2 `catch` arms

Inherit the full grammar — nesting, literals, or-patterns, `as`, guards — as Exceptions §5.2 promised. The open-`Exn` model is unchanged: no exhaustiveness demand, implicit rethrow, reachability still checked (§7.2) and still a hard error. Or-patterns mixing domestic and foreign arms are legal: `ParseError(_) | JsError(_) => fallback`.

Catch arms occupy two seats — `try`'s clause (Exceptions §5.1) and the match catch clause (Exceptions §5.4) — with one grammar and one semantics in both; everything in this section reads on the arms, not the construct holding them.

### 6.3 `let` patterns

```
let (x, y) = t
let {name, age} = user
let UserId(n) = id
let (Point({x, y}) as p) = origin
let Some(v) = opt                -- HARD ERROR: refutable
```

The LHS of `let` is now a full pattern, gated by irrefutability (§5). Products §2.4's flat-tuple form is the degenerate case; its "nested patterns arrive with pattern matching" error is retired. `let _ = e` remains a non-idiom — `_` alone binds nothing, and the discard spelling is `ignore` (Statements §3.3); a bare-`_` `let` is an error with the `ignore` fixit.

**Every name a `let` pattern binds is a sequential binder** (Statements §5/§5.4): it may not reuse any name in scope — nor one whose definition is in progress (Statements §5.1), the pattern's own names included while its RHS is resolved — punned fields too — `let {name, total} = order` errors if `name` is bound, with the pattern-aware fixits Statements §9.3 owns (discard with `_`, or rename the field: `{name = orderName}`). The arm/lambda/loop positions bind head binders as before; same grammar, different class, decided by position.

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

One group is not the parameter list: a parenthesised group with a declared pattern's name **against** its closing parenthesis is a suffixed pattern, and one parameter — `(n, d)rat => e` takes one `Rat`, where `(n, d) => e` takes two (Pattern Declarations §3.1). The name closes the group before the head's own parentheses are read; whitespace before the name is what makes a parameter list.

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
- **The constructor door at a parameter** (§2.2, #763): a bare constructor head that scope does not bind resolves in the parameter's type only where a supplying seat handed that type in before the pattern is checked (Functions §4.3) — under `import Pair as Pairs`, `pairs.map(Pair({first, second}) => first)` with `pairs` known, or a function bound with its own annotated `let` (Functions §4.3 — a pattern parameter carries no annotation of its own, Functions §4.1). Under no seat — `let f = Pair({first, second}) => first` — the head is refused naming the qualified spelling and the annotated-`let` seat that would open the door (§12) — loud, and never silently different by seat. `UserId(n) => n` on the module's own type is untouched: scope answers first. (A match function's parameter is the scrutinee, so the undetermined case there is §6.1's refusal, not this one.)

### 6.6 Position summary

| Position | Grammar | Gate | Guards |
|---|---|---|---|
| `match` arm | full | none (refutable is the job) | yes |
| `catch` arm | full | none; open model | yes |
| `let` | full | irrefutable | no |
| `for..in` | full | irrefutable | no |
| lambda param | full, depth rule for tuples | irrefutable | no |

(The match function, §6.7, adds no row: its arms are ordinary `match` arms, and its parameter is a compiler-fresh binder no pattern ever names.)

### 6.7 The match function — `match` without a scrutinee *(#505)*

A `match` that **ends its logical item** — no scrutinee expression, nothing after the keyword — is a **function literal**: the unary function that matches its argument against the arm block.

```
let labels = Vector.map(options, match
    Some(value) => value
    None => "missing"
)
```

- **Semantics by desugar, normatively.** `match` + arms is `$x => match $x` + arms, for a fresh, unnameable binder. Everything follows from the desugar: the type is `p -> r` (the patterns' type to the unified body type, with the expected type flowing in from context as for any lambda — Functions §4.3's channel *(#513)*, whose supplying seats hand the parameter its type before the arms are checked); the full arm grammar with guards; colour — the arrow's colour joins from the arm bodies exactly as any lambda body's (Effects §3.1); single evaluation, trivially.
- **Exhaustiveness is demanded** (§7.1), as for every match: the function must be total over its parameter type. Reachability likewise (§7.2). This is the form's whole point — the disciplined door to refutable matching in callback position, which §6.5's irrefutability gate refuses to lambda heads. The gate itself is untouched; its `Some(x) => e` hard error now carries the fixit "for a match function, write `match` with arms."
- **Unary, permanently.** OCaml's `function` is currying's child; the match function is the n-ary language's counterpart, and there is no n-ary reading (no currying, no tuple↔args conversion — Functions/Products doctrine). Application and arity are the ordinary rules on `p -> r`.
- **Disambiguation is one token of lookahead**: any token after `match` on the same line means the scrutinee form, unchanged (§6.1). The arm block is required, as for every match; a scrutinee-less head with nothing following is the ordinary missing-arms parse error. A bare `match` at line end had no parse before this form existed, so the grant is purely additive.
- **A match function is a lambda literal** and a syntactic value (Functions §8.2). *(#700.)* Its one former written-form seat is retired: `fun` is header-only (Functions §7.1), so `fun size = match …` is a parse error whose rewrite names the parameter and the scrutinee — `fun size(shape) = match shape …`. Every *expression* seat is untouched: a `let` RHS, a call argument, a pipe stage, an ascription — Functions §4.3's supplying seats hand the parameter its type there as ever.
- **No `catch` clause, on principle.** The clause observes the scrutinee's evaluation (Exceptions §5.4), and a match function's scrutinee is its parameter — a value already produced, under other handlers, before the function was entered; there is nothing left to observe. The desugar makes this the §7.2 cannot-throw class by construction (a bare variable read). A `catch` at the seat gets the dedicated diagnostic with the honest rewrite: "a match function's parameter is already a value; there is nothing here for `catch` to observe — to guard the arm bodies, write a lambda whose body is `try match x …` with `catch` aligned to the `try`" — the `try` heading its own line inside the lambda body, which is the one legal layout of that composition under §5.4's attachment rules. Body-wrapping sugar, should callback evidence ever demand it, would be a different construct and starts from field evidence.

Emission is the desugar's: an arrow function over the ordinary match lowering, its binder named under the emitter's hygiene rules — the readable-JS commitments are unchanged.

---

## 7. Exhaustiveness and reachability

Both generalize from Unions §4.3. Both remain **hard errors**. Both remain **exact** over the decidable fragment. The algorithm is Maranget-style usefulness checking (the standard matrix construction); implement it once and derive all three judgments from it: exhaustiveness (is `_` useful after all arms?), reachability (is arm *k* useful after arms 1..k−1?), irrefutability (is the single-row matrix exhaustive? — §5.1).

### 7.1 Exhaustiveness

- Domains with finitely many shapes — unions (closed, nominal — which since #147 includes the prelude `Bool`), and tuples/records thereof — are checked exactly. `Unit`'s former standalone listing is **deleted** *(2026-07-30, #159)*: since it is the arity-0 tuple (Products §2.7), a `match` on `Unit` with a `()` arm is exhaustive with no `_` through the ordinary tuple clause, vacuously at zero components. **A `match` on `Bool` with `True` and `False` arms is exhaustive with no `_`** — this survives verbatim in force, respelled in form: it is now the ordinary closed-constructor union path, and the former "`Bool` via literals" carve-out (the first non-union exhaustive domain) is **deleted** *(corrected 2026-07-29, #147; the acceptance test is retained, respelled, now exercising the union path)*.
- Infinite domains (`Int`, `String`, `Float`) are never covered by literals; exactness there means: **a catch-all (`_` or bare variable, possibly under `as`/or-composition per §5.1's coverage semantics) is required.**
- **Guarded arms contribute nothing** — including `when True`. Coverage is computed as if guarded arms were absent.
- **Declared patterns** (Pattern Declarations §4, which owns the clauses): each declared pattern present in a column is a complete **signature** of its own — a one-constructor shape — beside the type's constructor signature. Specialising on a pattern `p` of arity *n* yields *n* component columns; rows headed by `p` contribute their components, wildcard rows *n* wildcards, and rows headed by any other signature's head are **dropped** (sound, since the checker cannot relate two views; conservative, so a match mixing views needs a catch-all) — save a row whose components are all irrefutable, which is a wildcard row at that column. A wildcard is useful in the column iff useful under every complete signature present — and in the default matrix where the constructor signature is incomplete or absent — so the match is exhaustive iff some complete signature's every specialisation is; the witness is built from the constructor signature where present, else the first pattern the arms write. A pattern the arms do not write enters no column.
- Record patterns: coverage is computed over the **mentioned fields only**. Sound because unmentioned fields are unconstrained in every arm — openness means they cannot distinguish arms. (If two arms mention different field sets, the matrix is built over the union of mentioned fields, absent mentions widening to `_`.)
- Missing-case reporting must produce a **witness pattern**, rendered by §7.3: "match is missing cases: `(None, _)`", "match is missing cases: `{status = Queued}`". The Unions constructor-name listing is the degenerate rendering of this.

### 7.2 Reachability

- An arm is unreachable if its pattern is useless relative to the *unguarded* arms above it (guarded arms above cannot subsume — their guards may fail). Hard error, naming the shadowing arm, as before. When no single arm subsumes — the arm is dead only against several arms jointly, as in `W(True)` / `W(False)` / `_` — the report names none of them, because naming one would be false: "this case is unreachable; the patterns above already cover it".
- Two arms with the same pattern and different guards are both reachable (the checker cannot prove a guard total): legal.
- A guarded arm whose pattern is already fully covered by an earlier **unguarded** arm is unreachable — `when True` does not launder it.
- Anything after a catch-all arm is unreachable — a declared pattern whose components are all irrefutable included (Pattern Declarations §4). An arm under one declared pattern is otherwise never reported dead on another's account: the checker cannot relate two views of a value, as it cannot prove a guard total, and the exactness claim ranges over what it can decide. In `catch`, the Exceptions §5.3 logic transfers with or-patterns folded in: a second `JsError(_)` arm, or anything after `_`, is unreachable; domestic arms after a `JsError` arm are fine.
- The match catch clause (Exceptions §5.4) adds one judgment of its own, run where these judgments already run — after elaboration: a scrutinee whose elaborated form is a bare variable read (a plain reference, never an evidence application) or a literal whose elaboration erases to a primitive construction (Numeric Literals §5; hole-free String literals and the Unit literal `()` qualify; non-empty tuple, vector, and record literals never) cannot throw, so the entire clause is unreachable — hard error, same doctrine as every dead arm. Exact and deliberately minimal: no throw-analysis through calls exists (throwing is not an effect), and the judgment never leans on an unchecked law — where user `Num` elaboration is in play, it declines. Inside the clause, the catch logic above applies unchanged; across the section boundary there is nothing to check (the two arm-sets never compete for one evaluation).

### 7.3 Counterexample rendering (normative for diagnostics)

Witnesses print as patterns: constructor names applied to `_` for unconstrained slots (`Node(_, _, _)`) and bare for nullary (`False`), tuples with `_` holes (`(None, _)`), records with only the discriminating fields (`{status = Queued}` — never invent mentions), and `_` where any value works *(the former "literals for finite literal domains" clause is deleted — corrected 2026-07-29, #147: Bool was its only customer, and `False` now renders as an ordinary constructor witness)*. Prefer the shallowest witness that is genuinely missing. Multiple missing cases: list up to a small cap (say 3) then "…and N more".

**Constructor spelling** *(#607)*. A witness is a pattern, and diagnostics must print what the user can paste back in — so each constructor name in a witness prints in the spelling the reporting module can lawfully write, preferring the barest one:

1. **Bare**, where the bare spelling pastes back as that constructor: in scope and denoting it — declared here, or the prelude's unshadowed name — or, scope having nothing for the spelling, reachable through §2.2's door, which is every constructor of the scrutinee's own type and of the declared slot types beneath it *(#763)*. The ordinary case, and since the door nearly the whole of it; witnesses under it are unchanged by this rule, byte for byte.
2. **Qualified**, where bare would be wrong or absent but a pastable qualification is in scope: an occluded prelude constructor prints through its declaring prelude module's ambient name (`Bool.True` — Modules §5.4's qualified reach, which occlusion never removes), and a constructor reached through an in-scope module alias prints through the alias (`A.Off` — Modules §3.1 admits the form in patterns). Both spellings paste into an arm as printed. The occlusion case is the sharp one: under `union Flag = True | Maybe`, a `Bool` witness printed bare as `True` names the occluder — a spelling that means the wrong constructor and cannot repair the match.
3. **Qualified, with the route stated**, where the module has no pastable spelling at all — the bare spelling is taken by a binding of this module's own (so §2.2's door, which reads scope first, does not open), and no in-scope alias reaches the constructor. The message says where it lives and names the one repair, the module import (Modules §3 — no per-name import exists, #762), the witness pasting qualified through the alias the edit binds — a spelling that pastes back once the named import is made, the clause's own precondition: ``match is missing cases: `Flags.Off` — `Off` is declared in module `Flags`, and this module binds another `Off`; `import Flags` and spell it `Flags.Off` ``. A repair to name always exists for a declared type that crossed a module boundary: visibility is never the obstacle — Modules §4.3 bars a private union, and its #629 extern arm a private foreign enum, from crossing an exported face — and the alias is the importer's to choose. The clause names the module **by its name** (Modules §2.3; a module import carries no path, #829): this is the one place the section promises an import line the reader pastes rather than looks up. One route clause per declaring module, covering the listed names that lack a pastable spelling — never the names a shallower tier already spelled; the "…and N more" tail names no constructors and so routes none. One corner routes through the prelude's full name: a prelude constructor bare-occluded while a same-spelled module alias shadows the prelude module's own ambient name — the clause states the shadowing and names the qualified import of the prelude module, `import Hex.Bool as HexBool` and spell it `HexBool.True` (Modules §3.1; Packages §2.4), the alias's rename being the other repair. The clause rides with the witness, not with one message: every diagnostic that renders a counterexample through this section — the §5.3 gate included — carries it under the same conditions; where a seat's message already carries its own trailing fixit (the lambda-parameter gate's §6.7 line), the route clause stands before that fixit.
4. **No hidden-name tier exists, on purpose.** An opaque union's constructors are unnameable abroad — and no witness may print them. In a well-typed match the tier is empty by construction: a witness that names a constructor can be demanded only by arms that name constructors of the same union (literal and vector-length refutations demand no constructor name), and an opaque union's are unnameable outside its home, so a match over one abroad can only ever be missing `_` itself — or a declared pattern's witness, `(_, _, _)rgb`, whose name is an *exported* one the arms themselves wrote (Pattern Declarations §3.3, §4). On an error program the emptiness is an obligation instead: **a pattern that failed to type must not widen the witness's vocabulary** — at the `match` and `catch` seats and the three §5.3 gates alike, coverage reads the broken pattern as `_` while its row's well-typed columns stand as written. The broken pattern is granted maximal cover because the deeper fault leads: a report fires only for cases that stay missing under every repair of the broken pattern, and its witness is built from well-typed patterns alone, so no unnameable constructor can enter it — a match whose one arm is broken reports the type error and nothing else. The grant reaches exhaustiveness and irrefutability only; §7.2 takes the dual reading — an arm is dead only if it stays dead under every repair, so a broken pattern is never a shadower, while a genuine catch-all above still shadows a broken arm below it. No diagnostic under this section ever demands a name the reader cannot obtain — §3's opaque-destructure interception is the same law at the redirect seat: a diagnostic never signposts a spelling the reader cannot write.

The tiers are judged per constructor occurrence — a nested witness may print an in-scope outer constructor bare while an inner one takes the qualified spelling or the route clause. A declared pattern's name in a witness (`(_, 1)rat`) prints as the arms wrote it — always bare, tier 1 and no other (Pattern Declarations §4).

---

## 8. Semantics

- Scrutinee evaluated exactly once; sub-values are read, never copied or reconstructed.
- Arms top to bottom; within an arm, or-pattern alternatives left to right; guard after pattern success, at most once (§3).
- Binding is left to right, all binders simultaneous (no pattern binder is in scope inside its own pattern).
- Patterns never invoke user code except the `Eq` test behind a literal (primitive `===` in every v1 case) — and a declared pattern's pure `view`, applied at most once per pattern per position before the arms are tested (Pattern Declarations §5).

---

## 9. Rider decision: construction punning ships in v1

`{x, y}` in **value** position is `{x = x, y = y}`; composes with functional update: `{p with x}` is `{p with x = x}` (update re-spelled `with`, Products §9 — patterns themselves have no update form, so that change touches nothing else in this spec). Products §3.1's deferral is dissolved.

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
| Guards counting toward exhaustiveness (even `when True`) | Requires totality checking of arbitrary expressions or ad-hoc special cases; the hard-error stance demands exactness, and exactness demands exclusion. |
| A second syntactic irrefutability judgment | One algorithm (§5.1); a syntactic approximation would drift from the exhaustiveness checker and mis-verdict `True \| False`. |
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
| Refutable pattern at `let`/`for..in`/lambda param | "this pattern can fail: ⟨witness⟩; use `match`" (§5.3); at a lambda param the fixit adds "for a match function, write `match` with arms" (§6.7) |
| `catch` clause on a match function | "a match function's parameter is already a value; there is nothing here for `catch` to observe — to guard the arm bodies, write a lambda whose body is `try match x …` with `catch` aligned to the `try`" (§6.7; Exceptions §9) |
| Sole-constructor pattern flips refutable after a union gains a constructor | §5.3's uniform gate line, no flip-specific message — the witnesses are the arriving constructors, spelled per §7.3's tiers with the route clause where the flipped module cannot spell them (§5.2, #639) |
| Non-exhaustive `match` | "match is missing cases: ⟨witnesses⟩" via §7.3 renderer — add the missing arm(s) or a `_` catch-all; constructor spellings per §7.3's tiers, with a route clause naming the declaring module and the working import where no pastable spelling is in scope |
| Unreachable arm (incl. guarded-arm subtleties) | hard error naming the shadowing arm (§7.2); remove the arm or reorder it above its shadower; when several arms jointly cover it, no arm is named: "this case is unreachable; the patterns above already cover it" |
| Or-pattern binding mismatch | "`x` is bound on the left of `\|` but not the right — bind it in both alternatives; if unused, remove the binding from both" (§2.6) |
| Duplicate binder in one pattern (incl. `as`, nested) | "`w` is bound twice in this pattern; rename one occurrence"; for an unused subpattern binder suggest `_`, and for an unused `as` binder suggest removing the `as` clause (§2.1) |
| `let`-pattern name already in scope | Statements §5.1/§9.3's "already bound" error with the pattern-aware fixits (§6.3 here) |
| `Float` literal pattern | permanent error + guard fixit (§2.5) |
| Guard on `let`/`for..in`/lambda param | "guards are only legal on `match` and `catch` arms; use a `match`" (§3) |
| `when` inside a nested pattern | parse error, same message (§3) |
| `match` on `Exn` | "match requires a closed type; exceptions are inspected with `try`/`catch`" (§6.1) |
| `catch` clause on a cannot-throw scrutinee | "this `catch` can never run: evaluating ⟨scrutinee⟩ cannot throw" (§7.2; Exceptions §5.4) |
| `match` on constraint-bounded abstract type | "cannot match on a value of abstract type `c`; use the operations its constraints provide" (§6.1); when the scrutinee is a lambda parameter whose type is an undetermined inference variable, the rider instead: "the parameter's type is not determined here; give the parameter a type — bind the function with its own annotated `let`, or use it where its parameter type is known" (§6.1, #513) |
| Constructor pattern over an opaque type abroad — the door's refusal (§2.2), and the spelling §2.4's redirect would otherwise have suggested | the opaque family's sentence at the type's noun: "cannot destructure opaque record `Point`; use an operation exported by its home module", "cannot destructure opaque union `Handle`; use an operation exported by its home module"; where the home exports declared patterns over the type, "…; match it with `(top, bottom)rat`" naming them (§2.4; Modules §4.2; Pattern Declarations §3.3) |
| Bare record pattern on nominal-record scrutinee | "destructure it with `Point({x, y})`" — the user's own pattern wrapped; outside an opaque record's home module, opacity intercepts: "cannot destructure opaque record `Point`; use an operation exported by its home module", or the sentence naming the home's exported patterns where it has any (§2.4; Modules §4.2) |
| `:` in a term-position record (pattern or literal), e.g. `{x: p}` | Products §6/§8 fixit: "record fields bind with `=`; `:` gives a field its type in record *types*"; uppercase-start RHS (`{x: Float}`) appends "if you meant a type, patterns destructure values; annotate outside the pattern" (§2.4, §16) |
| Type name in constructor-pattern position (`{x = Float}`) | "`Float` is a type, not a constructor…" (§2.4) |
| Bare constructor head scope does not bind; expected type known and lacking the spelling | "`Direction` has no constructor `Nort`" + near-miss (§2.2) |
| Bare constructor head scope binds to another type's constructor — a union's or a nominal record's; expected type holds the spelling | the arm's ordinary type error, carrying the qualified spelling the expected type does hold: "`North` here is `Compass.North`; this arm matches a `Direction` — write `Direction.North`"; for a record rival the module declares, "`Box` here is this module's `Box`; this pattern matches a `Lib.Box` — write `Lib.Box({…})`", the sub-pattern the reader's own, and for one reached through Modules §5.1 rule 3 (an alias spelled `Box` over a module exporting a constructor `Box`) "`Box` here is `Box.Box`; …" — never the bare same-name tell; where the expected type is opaque abroad the opaque refusal leads instead, there being no qualified spelling to name (§2.2) |
| Bare constructor head scope does not bind; expected type undetermined when the pattern is checked (a lambda parameter under no supplying seat; a nested slot a later arm is what fixes) | "no bare `Pair` here: its type is not determined at this pattern — write `Pairs.Pair({first, second})`, or bind the function with its own annotated `let`" — the second rewrite being the written-face lift (Functions §4.3; a pattern parameter carries no annotation of its own, Functions §4.1), and reading "or ascribe the scrutinee" at a nested slot; where the pattern is a match scrutinee's own binder, §6.1's refusal leads and this row is not reported (§2.2, §6.5) |
| `((x, y)) => e` written meaning two params | "one parameter destructuring a tuple; remove the outer parentheses for two parameters" (§6.5) |
| `@` in a pattern | fixit: "Hexagon spells as-patterns with `as`" (§2.7) |
| `let _ = e` | error + `ignore` fixit (§6.3) |
| Pun in type position (`{x}` as a type) | "record types need field types" (§9) |
| Field pattern for a field the type lacks | missing-field family, naming known fields (§2.4) |
| Constructor/pattern arity mismatches, nullary parens, bare payload constructor | unchanged Unions §4.2 family; the "nested patterns arrive later" error is **retired** |
| A declared pattern's own seats — arity, match-only expression use, a contested suffix, the suffix under an undetermined type, the opaque refusal naming the exported patterns | Pattern Declarations §7 |

---

## 13. Decisions log

| Decision | Where |
|---|---|
| One grammar, five positions; refutable positions ungated; binding positions gated by irrefutability | §1, §6 |
| Uniform constructor patterns in lambda heads; "transparency rule" carve-out rejected and recorded | §6.5, §10 |
| Irrefutability = single-row exhaustiveness; one algorithm for both; `True \| False` irrefutable | §5.1 |
| `Some(n)` refutable / `UserId(n)` irrefutable — closed-union constructor count decides; flip-on-extension is a feature | §5.2 |
| Nested patterns everywhere; positional constructor patterns stand; nominal records destructure via constructor pattern `Point({x, y})` | §2.2 |
| **Constructor patterns resolve in scope first, then in the expected type** (#763): "in scope" reads module-wide (a later-declared constructor draws the declared-later error above it, never the door); the scrutinee's type at the top, the instantiated slot type beneath as it stands when the pattern is checked (so a refusal there may depend on arm order — Functions §4.3's licence); nothing inferred; `match`, `let`, and `for..in` subjects typed before the pattern, a lambda parameter only under a supplying seat, `catch` no seat; at a `match` scrutinee's own binder §6.1's refusal leads and the door's is not reported; the qualified pattern unchanged and still fixing the type; reaches the prelude's qualified-only constructors; no expression-side door (Modules §9.13) | §2.2, §4, §6.1, §6.5 |
| Witness tiers re-cut for the door (#763, #762): tier 1 is every constructor the door reaches; tier 3 is the taken-spelling case, repaired by the module import alone | §7.3 |
| Record patterns open by default, no `...`, punning `{f}` ≡ `{f = f}`; sub-pattern in field slot | §2.4 |
| Pattern field separator is `=`, matching literals (Products §8); the `{x: Float}` type-confusion guard is retired in favour of the token-level `:`-in-terms fixit | §2.4, §16 |
| Literal patterns: `Int`/`String` via `Eq` (`Bool` removed 2026-07-29, #147 — constructor patterns now); ordinary inference (`Num` + `Eq` constraints); `Float` permanently banned with guard fixit; no `Char` | §2.5 |
| Or-patterns with F# same-bindings rule; spelling `\|` (C#'s `or` rejected: declaration/pattern coherence, predicate disanalogy, `and`/`not` pressure, lambda-head ambiguity) | §2.6, §10 |
| Guard termination: top-level `=>` after `when` belongs to the arm; the claim is dropped inside any bracket, so a lambda in a guard needs no extra parens; the parenthesize fixit is retired | §3 |
| `as` keyword; loosest pattern operator, looser than `\|`; refutability-transparent; zero-cost | §2.7 |
| Guards: `when`, arm syntax only, whole-arm coverage, evaluated after pattern at most once, contribute nothing to exhaustiveness (incl. `when True`) | §3 |
| `match` scrutinee generalized; `Exn` and constraint-bounded abstract types permanently excluded | §6.1 |
| Lambda heads: top-level commas = parameters; `((x, y))` = one tuple param; no grouping parens around param lists; single paren-free-pattern params | §6.5 |
| Exhaustiveness/reachability: Maranget matrix, hard errors, exact; `Bool` exhaustive via closed constructors (#147); record coverage over mentioned fields; witness-pattern rendering in pastable spellings, the route stated where none is in scope (#607) | §7 |
| Construction punning ships in v1; emits JS shorthand; term-level only | §9 |
| Binder class is positional (Statements §5): arm/lambda/loop binders head, `let`-pattern binders sequential; no third class; duplicate-in-whole-pattern error incl. `as`, class-independent | §1, §2.1, §4, §6.3 |
| Vector patterns shipped, owned by Collections Part 3 §3; `Vector` owns `[...]` in v1 (no `List`, no `Array` pattern surface); range patterns → guards; type-test patterns → never | §2, §10, §11.1 |
| Match catch clause (#500, owned by Exceptions §5.4): catch arms' second seat, one grammar and one semantics in both; window = scrutinee evaluation only; exhaustiveness and reachability per-section, plus the cannot-throw judgment (post-elaboration, erasure-gated); §14.3's edit note discharged on the same touch | §6.1, §6.2, §7.2, §14 |
| The match function (#505): scrutinee-less `match` = unary function literal, semantics by fresh-binder desugar; exhaustiveness demanded (totality); unary permanently (no n-ary reading); a lambda literal for written-form checks *(amended under #700: the `fun`-RHS seat is retired — `fun` is header-only, Functions §7.1; every expression seat stands)* and a syntactic value; no `catch` clause on principle (the parameter is already a value — nothing to observe; body-wrapping sugar would be a different construct, field-evidence-first); §6.5's gate untouched, its lambda fixit added | §6.7 |
| §1's emission bullet restated post-#147 (2026-07-29): readable emission is an emitter commitment, standing because it constrains no language semantics; TS-author phrasing retired | §1, §15(n) |
| `()` reclassified (2026-07-30, #159): the dedicated `Unit` pattern dissolves into the arity-0 tuple pattern; `Unit` exhaustiveness via the tuple clause; the standalone finite-domain listing deleted; no diagnostic or verdict changes | §2, §2.3, §5.1, §7.1; Products §2.7 |
| Expected-type propagation (#513, owned by Functions §4.3): supplying seats hand a lambda parameter its type before arm checking, so the match function works at every seat that writes its type; §6.1's abstract-type refusal stands, reduced to programs no seat determines, and gains the undetermined-parameter rider | §6.1, §6.7, §12 |
| Declared patterns (#834): `(p1, …, pn)name` joins the grammar by reference; the one exception to the no-user-code rule is the pure `view`; irrefutable iff the components are; a one-constructor shape to the matrix, other forms in the column dropped; witnesses under the same spelling tiers | §2, §2.8, §4, §5.1, §7.1, §7.3, §8; Pattern Declarations |
| The constructor flip has no bespoke diagnostic (#639): §5.3's gate line serves it, the witness being the arriving constructor, §7.3-rendered; the formerly prescribed "no longer covers" sentence is retired — it states history the compiler does not have, and would fire falsely on fresh code | §5.2, §12 |

---

## 14. Edit notes to existing specs

Apply on next touch; until then this doc governs.

1. **Unions §4.2** → the flat-pattern restrictions (no nesting, no literals, no guards, no or/as, union-only scrutinees) are superseded; replace with a pointer here. The "nested patterns arrive with pattern matching" diagnostic is retired. §4.3's exhaustiveness text gains a pointer to §7 here. The decisions-log row "v1 patterns: flat + `_`" gains "superseded by Pattern Matching spec".
2. **Products §2.4** → flat-`let`-destructuring restrictions superseded (nesting now legal); lambda-parameter-patterns sentence superseded by §6.5 here. **§3.1** → "No shorthand `{x, y}`" is dissolved: construction punning ships (§9 here); strike the fast-follow note.
3. **Exceptions §5.2** → **Discharged** (on the #500 touch): §5.2 repoints here as grammar owner — catch arms take the full grammar; §5.3 carries the or-pattern note (§7.2 here) and the guard-semantics note; the deferred-to-pattern-spec diagnostics row is retired.
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

-- (b) Bool exhaustive via closed constructors (#147); no wildcard
match flag
    True => 1
    False => 0
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

-- (f) True|False is irrefutable (coverage definition, not syntax)
let (True | False) = b              -- legal (binds nothing; pointless but principled)

-- (g) Lambda depth rule
(x, y) => x + y                     -- 2 params
((x, y)) => x + y                   -- 1 param, tuple; emits t => { const [x, y] = t; ... } or param-destructure
{a, b} => a ++ b                    -- 1 param, record; row-constrains if unannotated
UserId(n) => n                      -- 1 param, newtype unwrap
Some(x) => x                        -- ERROR: refutable pattern in a binding position

-- (h) Record openness + punning + literal sub-pattern
match user
    {role = Admin} => allowAll()
    {verified = True, name} => greet(name)
    _ => deny()
-- coverage computed over {role, verified, name}; witness rendering on removal of `_`:
--   match is missing cases: {role = Member, verified = False}   (or shallowest equivalent)

-- (i) Guards never count
match n
    x when x >= 0 => "nonneg"
    x when x < 0 => "neg"
-- ERROR: non-exhaustive — guarded arms contribute nothing; requires a catch-all

-- (i2) Guard termination: => after when belongs to the arm
match n
    x when isPositive => "pos"       -- guard is the expression `isPositive`; => is the arm's
    x when exists(preds, p => p(x)) => "any"     -- lambda in a guard: the call's bracket
                                                 -- drops the arm's claim; parens optional
    _ => "other"
-- `x when f => x` parses as guard `f`, body `x` — the pin, not an error (§3)

-- (j) Construction punning round trip
let name = "Ada"
let user = {name, verified = True}  -- {name = name, ...}; emits {name, verified: true}
let {name = n} = user               -- n = "Ada"

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
-- OR switch with guard-carrying cases restructured; either accepted if it reads as hand-written JS

-- (o) The constructor door (§2.2, #763): imported constructors bare in arms
-- direction.hex: export union Direction = North | East | South | West
import Direction
fun turn(d: Direction): Direction =          -- type: Modules §5.1 rule 2
    match d
        North => East                        -- pattern: the door (scrutinee's type);
        East => South                        --   expression: no door — ERROR: no bare East;
        South => West                        --   write Direction.East
        West => North
-- with the arm bodies written Direction.East etc., the function compiles;
-- match is exhaustive, and a missing arm's witness prints bare (§7.3 tier 1)
let f = match                                -- the match function: parameter undetermined
    North => 1                               -- ERROR: §6.1's refusal, with its rider — the
    _ => 0                                   --   arms are never reached, so no door report
let g = match
    Direction.North => 1                     -- OK: the qualified pattern fixes the type
    _ => 0
-- prelude reach: Ordering's constructors are qualified-only (Modules §5.5), bare here
fun sign(a: Int, b: Int): Int =
    match a.compare(b)
        Less => -1
        Equal => 0
        Greater => 1

-- (o2) A module of its own that takes the spelling (a separate file: compass.hex)
import Direction
union Compass = North | South                -- in scope module-wide (§2.2), above and below
fun h(d: Direction): Int =
    match d
        North => 1                           -- ERROR: North here is Compass.North; this arm
        _ => 0                               --   matches a Direction — write Direction.North

-- (p) Nested, from declarations; and the record fallback (Modules §5.1 rule 3)
-- pair.hex: export record Pair = {first: Direction, second: Direction}
import Pair
fun same(p: Pair): Bool =
    match p
        Pair({first = North, second = North}) => True   -- Pair: rule 3; North: the door,
        _ => False                                      --   from the declared field type
-- (p2) A separate file (firsts.hex) whose alias is not spelled like the constructor
import Direction
import Pair as Pairs
let first = Pair({first, second}) => first   -- ERROR: no bare Pair here: its type is not
                                             --   determined at this pattern — write
                                             --   Pairs.Pair({first, second}), or bind the
                                             --   function with its own annotated let
let firstOf(p: Pairs.Pair): Direction =
    match p
        Pair({first, second}) => first       -- OK: the door, the scrutinee's type known

-- (q) Beneath the top, the slot type as it stands (§2.2): arm order can matter
let a = match None
    Some(Direction.North) => 1               -- fixes the payload: Option(Direction)
    Some(East) => 2                          -- OK: the door reads Direction
    _ => 0
let b = match None
    Some(East) => 2                          -- ERROR: the payload is undetermined here —
    Some(Direction.North) => 1               --   write Direction.East, or ascribe the scrutinee
    _ => 0
```

---

## 16. Correction record: pattern fields bind with `=` (July 2026)

Record patterns originally used `:` as the field separator (`{name: n}`), matching the then-current literal syntax. Superseded by **Products §8**, which is the governing record for the change and its rationale: term-position records — literals *and* patterns — use `=` (`{name = n}`); `:` is reserved for record types. The sections above are edited in place.

Pattern-specific consequences, decided here:

- **Patterns follow literals, necessarily.** Construction/destructuring symmetry is a design pillar of this spec (§9: "the two positions read the same sugar"); punning must expand identically in both positions (`{f}` ≡ `{f = f}`). A literal/pattern separator split was considered and rejected — Products §8.3.
- **The §2.4 type-confusion guard is retired, upgraded.** The old diagnostic existed because `{x: Float}` in a pattern *parsed* (as a constructor sub-pattern) and had to be caught semantically. Under `=`, a `:` in any term-position record is caught at the token with the Products §6 fixit — earlier, and with the true cause named for the separator-habit case. The annotation-intent case — the old guard's actual customer — is served by the uppercase-start refinement in §2.4 (the fixit appends "annotate outside the pattern"), not by the separator repair alone. The "type, not a constructor" message survives only for an explicit `{x = Float}`.
- **Witness rendering (§7.3) and the missing-case reporter (§7.1) print `=`** — witnesses are patterns, and diagnostics must print what the user can paste back in.
- **Precedent for `=` in patterns**: OCaml and Haskell destructure with `{field = pattern}`; the same-token symmetry with construction is theirs too.
- **Honest cost, pattern-specific — and larger than the literal's.** In pattern position the old `:` was a *true* friend to JS: Hexagon's `{name: n}` and JS destructuring's `{name: n}` both meant "field `name`, binder `n`" — an exact correspondence (the retired §2.4 line glossed it "rename," which is JS's word too). `=` is the diverging token here: a JS reader first parses `{name = n}` as a default value. Accepted with eyes open: construction/destructuring symmetry (§9; Products §8.3 rejects the split) outranks a position-local correspondence with JS, and the §2.4 fixit catches the habit at the token. Products §8.2 records the literal-position cost, where JS offers no true-friend option at all.
- **No emission change**: patterns never emitted their surface syntax anyway (they compile to tag tests and `const` binders).
