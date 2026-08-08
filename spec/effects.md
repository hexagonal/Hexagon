# Hexagon Spec: Effects

**Status:** Decided (#355). The two-point effect discipline ships in v1. The checker ships flag-gated; §10 lists what must land before the flag defaults on. Nothing here has a warning tier.
**Scope:** What an effect is; the three arrows (`->`, `=>`, `=>!`) and their readings; the call-mark trichotomy (bare, `!`, `?`); effect variables in inference; symmetric enforcement at calls and faces; the extern ownership split and trusted purity claims; the `Seq`/`Stream` posture.
**Not in scope:** Exceptions — deliberately outside the effect (§1); `Stream`'s module surface (`stream.md`); token shapes (Lexer §8); the pipe rewrite (Operators §8); the dot-call form (Method Syntax §2); display grammar for arrows (Functions §5.1).
**Companions:** Functions (§4.1 annotations, §5.1 displayed types, §7.4 the monomorphic knot, §8 generalization), Statements, Blocks & Mutability (§6.2 — the coupling §7.4 here names), Constraints (§2 — members are pure), Intrinsics (§4.2 verification), FFI Part 4 (extern bindings; the `pure` claim), FFI Part 3 (the `Seq` launder; the `Stream` crossing), Loops (§6 `Seq`, §7 `Iterable`), `stream.md`.

---

## 1. Doctrine

- **The tracked effect is observable interaction with the world.** Reading input, writing output, consulting a clock or an entropy source, mutating foreign state. Nothing else is an effect: allocation is not, `var` inside a function body is not (it cannot escape — Statements §6.2), and **throwing is not**. Exceptions are the partiality/defect channel (Exceptions spec), the Rust cut: `Int.div` throwing `DivideByZeroError` does not make division effectful, and `Result` is untouched. Without this cut the doctrine of throwing companions would make the whole prelude impure.
- **The lattice has two points: pure and impure.** There are no effect rows, no effect families, no user-declared effect kinds. A design that wants "which effect" is a different language; Hexagon asks only "does the world notice".
- **Purity is the silent one.** A bare call, an unmarked body, a `->` arrow — silence is the strongest claim. Effects are what get spelled: `!` on calls, `=>`/`=>!` on arrows. A reader who sees nothing may assume the world is untouched.
- **The system is Hindley–Milner all the way down.** The effect is one more unifiable component of every function type, ranging over the two-point lattice; effect variables are ordinary type variables (§3.4). This is the effects system reached by *refusing to leave* HM — the same commitment that fixed the rest of the type system. There is no subeffecting, no row polymorphism, no effect subsumption: colours unify or they do not.
- **Asynchrony is out of scope, permanently for this ruling.** `async` is a separate axis, not a point on this lattice; v1 is synchronous, and the async question files its own issue when it arises. Nothing here pre-decides it.

## 2. The three arrows

Function types carry a colour on every arrow. The display grammar (zero/one/many domains, right association) is Functions §5.1's, unchanged; this section fixes what each arrow means.

```text
->     pure: this function touches nothing the world can observe
=>     linked: this signature's one effect variable — the caller's instantiation decides
=>!    the impure constant: this function performs effects, unconditionally
```

### 2.1 `->` — the pure arrow

A `->` function performs no observable effect at any instantiation. As a demand — a `->` arrow in a parameter annotation — it refuses impure arguments by ordinary unification (§4.3): `memoize`-shaped functions get their purity guarantee from the type, with no new mechanism.

### 2.2 `=>` — the linked arrow

Every `=>` written in one signature denotes **the same, single, implicitly quantified effect variable** — the signature's colour. One variable per signature, never two (§2.4). The linked reading is what makes higher-order functions effect-polymorphic for free:

```text
fold : (Seq(a), b, (b, a) => b) -> b
```

`fold`'s callback arrow and — if the signature had more `=>` positions — every other `=>` in it share one colour. Instantiated with a pure `combine`, the whole call is pure; instantiated impure, the call is impure. The signature never says "impure"; it says "as impure as you make it". (`fold`'s own outer arrow is `->`: running `fold` performs nothing the callback doesn't — see §3.3 for why the outer arrow is the one a call mark reads.)

**The else-constant rule.** A `=>` with no signature to link to is the impure constant. Two positions trigger it: a data-declaration field (§2.5, where it is load-bearing), and a signature whose only `=>` is a single occurrence nothing links against — where "linked" and "constant" coincide, since a variable observed nowhere else defaults away (§3.4). In everyday code the rule almost never decides anything: the common source of constant impurity is a user extern, and those are impure by the ownership split (§6.1), not by this rule. The weight is carried by §6.1; the else-constant rule's one indispensable client is the data field.

### 2.3 `=>!` — the impure constant, spelled

`=>!` is one token (Lexer §8.1); the bang trails the arrow it condemns, matching the call mark's postfix position. `!=>` is not a token and cannot become one — `!=` wins maximal munch (Lexer §8.2).

`=>!` names the impure constant explicitly. It is **mandatory** where a bare `=>` would link — that is, in a signature carrying linked arrows, a function whose own colour is constant-impure must write `=>!`, because `=>` there would claim polymorphism the body refutes (§4.2). It is **legal** anywhere the colour truly is the impure constant, including positions where an unlinked `=>` would already mean that; the two spellings coincide there and neither is canonicalized away. (`Stream`'s field is written `=>` — `stream.md`; a face that wants to shout writes `=>!`.)

### 2.4 The conservative join — one variable, ever

A body that both performs its own unconditional effects and forwards a callback's colour does **not** get a second effect variable. Its own colour is the conservative join: constant-impure — counting impure is fine, and the join is what `=>!` spells.

**The join governs the function's *own* colour only.** The callback arrows it forwards **keep their linked variable**:

```text
withTransaction : ((String => String) =>! String)
```

The outer arrow is `=>!` — `withTransaction` writes to the world on its own account, so every call to it wears `!` (§3.3). The callback's arrow stays `=>` — a *pure* callback is accepted, and stays pure in the caller's accounting. Rounding the callback's arrow up to `=>!` would refuse pure callbacks outright: purity-as-polymorphism works through variables, and `=>!` is not one.

### 2.5 Data-field arrows: the constant, never linked

A function-typed field of a `record` or `union` declaration carries `->` (a pure field) or `=>` (the impure constant). **A data declaration has no signature, so its arrows have no variable to link to** — `=>` in a data field *is* the constant, always; `=>!` is legal there and means the same thing.

The divergence must be said out loud, because the same written shape reads differently by position: `{ step: () => String }` **in a parameter annotation** is part of that function's signature, so its arrow links — the enclosing function is polymorphic in the field's colour. The identical text **in a `record` declaration** is data, and the arrow is the constant. A record type is a set of values with no enclosing quantifier; a signature is a quantified contract. The two readings are both pinned in the conformance suite.

This is the sentence `Stream` stands on: `Stream(a)`'s field `next: () => Option(a)` is pull-impure by declaration (`stream.md`), and `Seq(a)`'s field `pull: () -> Option((a, Seq(a)))` is pure by declaration — the two-type split of §7.

### 2.6 Values wear no colours

- **Lambdas are always written with the term arrow `=>`**, pure ones included. The term-level `=>` is the lambda syntax (Functions §3.1) and says nothing about colour; a lambda's colour is **inferred from its body's marks**. There is no pure-asserting term arrow.
- **References are colourless.** A name, a field access, a stored function — none carries a mark (§3.2's corollary: no argument list, no mark). Storing an impure function is not an effect; calling it is.
- A **term-level purity demand** is the existing ascription: `(f : a -> b)` — rigid, per the Ascription spec. A **signature demand** (`->` in a parameter annotation) refuses impure arguments by unification. No new demand form exists.
- A lambda **return annotation** gives an unparenthesized `=>` to the body: `(x): A => B => body` cannot be written meaning "returns `A => B`". An impure function type in a lambda's return annotation must be parenthesized: `(x): (A => B) => body`. Functions §4.1 owns the rule; the required report and fixit are §9's.

## 3. The call trichotomy

### 3.1 Three marks, one question

Every call wears exactly one of three states:

```text
f(x)      bare — this call is pure
f!(x)     dirty — this call performs effects
f?(x)     conducting — this call is as effectful as the enclosing instantiation makes it
```

The teaching model: **every call is a pipe.** A pipe is clean, dirty, or conducting. The developer's question at each call: *is this a source, or just a conductor?* A function that reads the world is a source — its calls wear `!`. A function that merely runs what it was handed conducts — its call on the handed-in value wears `?`, and the conductor is only live when the far end is: `combine?(accumulator, value)` inside `fold` runs effects exactly when the caller instantiated `combine` impure. References are colourless as a corollary, not a fence: no pipe, no mark.

The trichotomy is exhaustive *because* of one-variable-per-signature (§2.2): inside a body, the only possible non-constant colour is the enclosing signature's variable, so pure / impure / the-variable covers every call. The one apparent exception — a body storing a lambda into a function-typed field — is resolved by §2.5: the field's arrow is a constant, so no second variable ever enters scope.

`?` is the deliberate pun on Rust's trained gesture: this line defers to my caller.

### 3.2 The mark's anchor is the argument list

A mark governs **an argument list**, whatever the callee expression:

```text
save!(document)          -- ordinary call
(source.pull)!()         -- parenthesized field access, then a marked call
document.show()          -- a dot call marks its own argument list (bare here: show is pure)
stream.next!()           -- dot call, marked
maker("s")!(document)    -- each argument list marks its own call
```

- The mark is written glued immediately before `(` (Lexer §8.1). Dot calls (Method Syntax §2.1) and the `(e.name)(…)` opt-out each anchor the mark to their own list; a chain marks each link for what that link's call is.
- A **pipe stage** is a call, so it takes a mark: `x |> save!` — the bare-stage form's mark stands at the end of the stage, and the rewrite carries it onto the call it builds: `save!(x)`. Operators §8 owns the rewrite; a stage with its own argument list marks that list as usual (`x |> take!(3)` → `take!(x, 3)`).
- A mark anywhere else — on a reference, mid-expression — is a parse error (§9): a reference carries no colour.

### 3.3 The outermost arrow: a mark describes this call only

**A mark speaks about the colour of the outermost arrow of the callee's type, at this instantiation — nothing more.** A call whose *evaluation* touches nothing is bare, whatever it returns:

```text
let wired = compose(save2, audit2)    -- bare: evaluating compose builds a closure
wired!(document)                      -- the composite's own invocation is the effect
compose(save2, audit2)!(document)     -- both in one expression: outer call bare, inner list marked
```

`compose`'s outer arrow is pure — it allocates a closure and touches nothing — so its call is bare even when the composite it returns is impure. The effect surfaces where the composite is *invoked*, and the mark surfaces with it. Read it as order of operations for marks: each argument list is marked for the arrow it discharges.

### 3.4 Effect variables are type variables

The effect component rides the ordinary machinery — unification, levels, generalization (Functions §8) — with no parallel solver:

- **Monomorphic in the knot.** Within a `fun` group's strongly-connected component, a signature's effect variable is a not-yet-generalized monotype like every other variable (Functions §7.4); recursive calls share it. It generalizes per member, when that member's binding generalizes.
- **Settled at body close.** A declaration's own colour and its calls' mark obligations are resolved when its body closes, not at module end. This is required, not latitude: under end-of-module settling, a module-internal call to a not-yet-generalized neighbour would see a still-linked variable, and the pure corpus would read as conductors — every bare call in `Seq.hex` would demand `?`.
- **The defaulting clause.** An effect variable still unconstrained when its signature settles defaults to **pure**. Harmless by construction: nothing observed the variable, so nothing distinguishes the choice — and it is what makes an unlinked single `=>` coincide with the constant (§2.2) rather than leak a phantom variable.

## 4. Enforcement is symmetric, and error-grade

### 4.1 At calls: six directions, one-token fixits

The required mark at a call is computed from the callee's outermost arrow colour at this instantiation: impure constant → `!`, the enclosing signature's variable → `?`, pure → bare. **Any other mark is an error — including a mark on a provably pure call.** A tolerated-but-wrong mark would rot into noise; symmetric enforcement is what keeps silence meaningful. All six wrong-mark directions report the same shape, each with a one-token fixit:

> this call runs effects, so `save` wants `!`, not no mark
> this call is as effectful as the enclosing instantiation makes it, so `combine` wants `?`, not `!`
> this call is pure, so `next` wants no mark, not `?`

(the remaining three directions permute the same sentence; §9 tabulates.)

### 4.2 At faces: both directions

A written arrow that contradicts the body's solved colour is an error **in both directions**:

- `=>` over a body solved to the impure constant: *"this signature's `=>` promises a colour the caller chooses, but the body solves it to the impure constant — a function that performs its own unconditional effects rounds up, and its face is `=>!`"* — fixit `=>!` (§2.4's join, surfaced).
- `=>` over a body solved pure: *"…but the body solves it to the pure constant — the honest face is `->`"* — fixit `->`. This is the **lie of generality**, mechanized: a pure function wearing `=>` would force `!`-or-`?` ceremony onto every caller for effects that cannot occur.
- `=>!` over a body that performs no unconditional effect: *"this face is the impure constant `=>!`, but the body performs no unconditional effect — it is effect-polymorphic, and its face is `=>`"* — fixit `=>`.

The pure direction matters as much as the impure one: over-claiming and under-claiming both break the reader's contract, and neither is a style matter.

### 4.3 The pure demand

An impure function meeting a `->` demand is an ordinary unification failure with a dedicated report:

> a `->` arrow promises purity, and this function performs effects — the demand is written `->`, the function's face `=>` or `=>!`

This is the whole enforcement of `memoize`-class contracts and of `Seq`'s §7 posture; nothing beyond unification is involved.

## 5. Calls with no mark seat

Four call forms have no position for a mark, by grammar:

1. **Operator applications** — `x + y` elaborates to a constraint member call (Operators §1.1) with no bang position; `x +! y` is not grammar, and negation is the word `not`.
2. **Bracket indexing** — `xs[i]` is `at`, definitionally (Collections Part 3 §5).
3. **`for` heads** — `for x in xs` desugars through the iteration protocol (Loops §2.3, §7.1).
4. **String interpolation** — `"${x}"` renders its holes through `Show` (Primitive Types §5).

The consequence is a demand, not an accident: **everything these forms dispatch to must be pure.**

- **Constraint members are `->`-demanded.** Every member of every constraint — `show`, `compare`, `hash`, `add`, `iterate`, all of them — has pure arrows throughout its declared header, and an `honor` instance's member bodies must check pure. Constraints §2 owns the rule. Derived instances are pure by construction (their generated bodies call members).
- **`Iterable` can never have an effectful instance.** `iterate` is a member, so it is pure; a type whose traversal performs effects cannot honor `Iterable` and cannot stand in a `for` head. This lands exactly where it will matter next: `Map`/`Set` iteration is pure by this sentence.
- **`for` headers are never marked, and loop bodies may be impure.** The head is protocol (pure by the above); the body is a block, not a lambda, and its statements mark their own calls as usual (ruling: iteration protocol is pure; effects live in the body).

## 6. The world's doors

### 6.1 The extern ownership split

Purity at a boundary declaration splits by **who owns the implementation**:

- **Compiler-owned intrinsic rows** (`extern from "hex:intrinsic"`) take their purity from Intrinsics §4.2's verification — the compiler is the implementer and is held to the declared scheme, parametricity obligation included. No purity annotation is written on an intrinsic row, and one is refused: *"intrinsic rows are verified rather than trusted; `pure` is for user-written externs"*. The prelude's intrinsics are pure-faced with zero annotation churn.
- **User-written externs are effectful by default.** A foreign function is trust territory (FFI Part 1 §3.1), and the honest default for the unknown is the impure constant: an unannotated `extern fun` has `=>!`-coloured arrows. The **trusted purity claim** is the contextual modifier `pure` on the declaration — `export pure fun trim(document: String): String` — a trusted-row obligation of exactly the Intrinsics §4.2 species: believed, not checked, and the module author answers for it. FFI Part 4 owns the form.

### 6.2 The two trusted-purity species

A `pure` claim on something that does touch the world is a lie — except for two shapes where the claim is *sound*, not merely customary. The ruling names them so every future claim can be tested against one or the other:

- **Species (a): unobservable world-writes.** A write-only channel the program cannot read back. The debug probe is the member: a pure-faced `log` that writes to the console changes nothing any Hexagon expression can observe. What it forfeits is multiplicity and ordering — under the per-instantiation contract a probe in a pure producer may print once, many times, or never (a memoized `Seq` step prints once however often traversed). Fine for debugging; disqualifying for real logging, which belongs behind a banged extern. **The caveat:** `console.log` is replaceable, and a replaced sink is a read path; a conforming debug probe captures its sink at initialization.
- **Species (b): owned, memoized, at-most-once world-reads.** A read the runtime performs at most once and then owns — the result is a value; the world can no longer vary it. `seqMemoize` is the member, and so is FFI Part 3's inbound adapter: *memoization makes the foreign iterator's mutability invisible* (Part 3 §4) — the launder that lets an effectful JavaScript iterable become a pure-faced `Seq` at the boundary, unchanged in v1.

Species (a) permanently excludes a pure-faced `random()` or `readLine()` — a read the program observes is never unobservable. Species (b) excludes any *replayable* read — replay is exactly what at-most-once forbids. The slogan survives both doors amended once: **silence means nothing the program can observe.**

### 6.3 What the claim costs

A trusted claim is per-module-author accountability, the same currency as every extern type. The compiler does not verify species membership; it verifies intrinsic rows (§6.1) and believes user rows. A claims audit belongs to review, not the checker.

## 7. The sequence posture

- **`Seq` is pure by construction.** Its field is `pull: () -> Option((a, Seq(a)))` — a pure thunk, by §2.5. Every producer and combinator is pure; building a pipeline is pure; *the five strict consumers* — `fold`, `forEach`, `find`, `any`, `all` — are the only doors effects enter through, each with a linked-`=>` callback and a `?`-marked body call. An effectful step function can no longer be smuggled into a lazy pipeline at all: `Seq.unfold` with an impure producer is §4.3's unification refusal. The `memoize` landmine — memoization observably changing how many times effects run, with no type-level story — is dissolved rather than patched: the producer position demands purity, and what remains for `memoize` to claim is species (b).
- **Effectful sequences are nominal siblings, never effect parameters.** The two-point lattice degenerates "a type parameterized by effect" into "two types" — so Hexagon ships two types, on the Kotlin `Sequence`/`Flow` and F# `Seq`/`AsyncSeq` precedent, and no effect variable ever appears in a type constructor's arguments. `Stream(a)` is the pull-impure sibling: no tail, field arrow the impure constant, consumers `=>!` (`stream.md`, the owning spec). A push sibling (`Observable`) is future work; async is out of scope (§1).
- **The FFI gains a declared choice at the boundary.** A foreign iterable at a `Seq(a)` position takes Part 3's launder — adaptation plus at-most-once memoization, species (b), purity manufactured honestly. The same object at a `Stream(a)` position crosses raw, protocol to protocol, no adapter and no memoization — impurity declared instead (FFI Part 3's `Stream` section). Nothing about the v1 `Seq` boundary changes.
- **The coupling that makes purity true.** Statements §6.2 (a lambda cannot touch an outer `var`) and §6.4 (no ref cells, no mutable fields) are what make a `->` face a *fact* rather than a convention — there is no mutable capture for a pure-faced closure to smuggle. That same fence is why a compiler may treat pure instantiations as free for fusion and reordering within the semantics those sections fix. The effects discipline leans on those sections; weakening them re-opens this ruling.

## 8. Emission

Colours and marks erase. Arrows, `!`, `?`, and `pure` claims exist for the checker and the reader; emitted JavaScript is identical with and without them, and no runtime representation of colour exists. (The debug probe's captured sink, §6.2, is the probe's own implementation detail, not a colour representation.)

## 9. Diagnostics checklist (implementer-facing)

Messages are normative in shape; the mark table's six rows share one sentence frame.

| Situation | Error |
|---|---|
| Bare call, `!` required | "this call runs effects, so `save` wants `!`, not no mark" + fixit: mark the call `!` |
| Bare call, `?` required | "this call is as effectful as the enclosing instantiation makes it, so `combine` wants `?`, not no mark" + fixit: mark the call `?` |
| `!` written, `?` required | same frame: "…so `combine` wants `?`, not `!`" |
| `?` written, `!` required | "this call runs effects, so `save` wants `!`, not `?`" |
| `!` written, call pure | "this call is pure, so `next` wants no mark, not `!`" + fixit: remove the mark |
| `?` written, call pure | "this call is pure, so `next` wants no mark, not `?`" |
| Non-identifier callee | the frame's subject degrades to "this call": "this call runs effects, so this call wants `!`, not no mark" |
| `=>` face, body impure-constant | "this signature's `=>` promises a colour the caller chooses, but the body solves it to the impure constant — a function that performs its own unconditional effects rounds up, and its face is `=>!`" + fixit `=>!` (§4.2) |
| `=>` face, body pure | "…solves it to the pure constant — the honest face is `->`" + fixit `->` (§4.2) |
| `=>!` face, body effect-polymorphic | "this face is the impure constant `=>!`, but the body performs no unconditional effect — it is effect-polymorphic, and its face is `=>`" + fixit `=>` (§4.2) |
| Impure argument at a `->` demand | "a `->` arrow promises purity, and this function performs effects — the demand is written `->`, the function's face `=>` or `=>!`" (§4.3) |
| Mark not before an argument list (and not a bare pipe stage's end) | parse error: "a call mark governs an argument list; write it immediately before `(`, or (in a `|>` stage) at the end of the stage — a reference carries no colour" (§3.2) |
| Prefix `!` on an expression (negation intent) | the `not` redirect survives the token change: "Hexagon spells logical negation `not`" — position-selected by the parser now that `!` lexes (Lexer §10's row; a prototype deviation, §10 here) |
| Unparenthesized `=>` type in a lambda return annotation | "a lambda's return annotation gives an unparenthesized `=>` to the body, so this reads as the body starting here; an impure function type in a return annotation must be parenthesized" + parenthesizing fixit (§2.6) |
| `pure` on an intrinsic row | "intrinsic rows are verified rather than trusted; `pure` is for user-written externs" (§6.1) |

## 10. Staging: before the flag defaults on

The shipped checker implements this ruling behind a project flag; flag-off compilation is token-for-token the pre-ruling language. Obligations before the flag defaults on, recorded here because each is normative surface, not polish:

- **LSP hover and `.d.ts` faces must render the trio.** A signature a reader cannot see is not a face; display is part of the contract (Functions §5.1 owns the grammar).
- **The prefix-`!` `not` redirect** (§9) — the prototype reports the mark-position error instead.
- **The return-annotation report should lead with its fixit** — it currently fires amid consequential type errors.
- **The deferred dot-call goal path** (Method Syntax §3) must be exercised against marks — a goal resolved at the deadline anchors its mark to the same argument list.
- **Declaration-site variance analysis** must include effect slots (it currently skips them — over-restriction, not unsoundness).

## 11. Rejected alternatives (do not re-litigate without new information)

- **Effect-parameterized types** (`Seq(a, e)`, Koka-style rows): refused — it reintroduces the machinery HM-nativeness exists to avoid, and the two-point lattice makes the nominal split (§7) strictly cheaper.
- **The Swift collapse** — weakening `!` to "possibly impure" and dropping `?`: the recorded fallback if the trichotomy had failed its bake. It failed the other way: `!` on a body's forwarded-callback call would constantify the variable and kill the pure face. Not adopted; recorded because it is the natural simplification a future reader will propose.
- **A second effect variable for const ⊔ var bodies**: never — §2.4's join.
- **Marks on references** ("effectful values"): values wear no colours (§2.6); the effect happens at the call.
- **`^` or `~` as the conducting mark**: `?` won on the trained gesture — "this line defers to my caller."
- **`!=>`**: not a token; `!=` wins the munch, and the bang trails what it condemns (§2.3).
- **A pure-asserting term lambda arrow** (`x -> body`): dropped — inference from the body plus the ascription demand covers it with zero new syntax.

## 12. Decisions log

| Decision | Where |
|---|---|
| Two-point lattice; effect = observable world interaction; exceptions and `Result` outside; async out of scope | §1 |
| Arrow trio `->` / `=>` / `=>!`; one linked variable per signature; else-constant rule (weight carried by the extern default) | §2.1–§2.3 |
| Conservative join governs the function's own colour only; forwarded callback arrows keep their variable; `=>!` spells the join | §2.4 |
| Data-field arrows: `->` or the impure constant, never linked; the annotation/data divergence stated | §2.5 |
| Lambdas always the term `=>`; colour inferred; references colourless; demands via ascription/unification; return-annotation parens | §2.6 |
| Call trichotomy bare/`!`/`?`; pipe teaching model; mark anchors the argument list; pipe stages are calls | §3.1–§3.2 |
| The outermost-arrow sentence: a mark describes this call only | §3.3 |
| Effect variables are tyvars: monomorphic in the SCC knot, settled at body close, unconstrained defaults pure | §3.4 |
| Symmetric enforcement, error-grade, at calls (six directions) and faces (both directions) | §4 |
| Four unmarkable call forms ⇒ constraint members `->`-demanded; `Iterable` instances pure; `for` heads never marked | §5 |
| Extern ownership split: intrinsics verified, user externs impure by default with contextual `pure` claim | §6.1 |
| Two trusted-purity species: unobservable world-writes; owned at-most-once world-reads; captured-sink caveat | §6.2 |
| `Seq` pure by construction; effectful sequences are nominal siblings (`Stream`); FFI position choice | §7 |
| Colours and marks erase at emission | §8 |
| Flag staging and the un-flagging obligations | §10 |
